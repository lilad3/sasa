"""
L'équipe d'une boutique : les comptes que crée le propriétaire, et le mot du patron.

Un compte créé ici reçoit un mot de passe provisoire, affiché une seule fois au propriétaire.
Il expire au bout de 72 h, et la personne doit le remplacer à sa première connexion : avant
cela, Django refuse tout le reste (accounts.permissions.PasswordChosen).
"""

import re
import secrets
from datetime import timedelta

from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import ErrorDetail, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.models import User, UserSession
from accounts.sessions import require_reauth, revoke_all
from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import enforce

from . import plans
from .models import Membership, NoteAudience, Role, TeamNote, TeamNoteReceipt
from .permissions import GRANTABLE, ShopScopedView
from .storefront import plain_text

TEMPORARY_PASSWORD_LIFETIME = timedelta(hours=72)
MEMBER_CREATE_LIMIT = (20, 3600)  # par boutique
NOTE_SEND_LIMIT = (30, 3600)  # par auteur
# Sans 0/O, 1/I/L : un mot de passe provisoire se dicte sans confusion.
TEMPORARY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
ROLE_ORDER = {Role.OWNER: 0, Role.MANAGER: 1, Role.SELLER: 2}


def temporary_password():
    """Trois blocs de 4 caractères (≈ 59 bits), par exemple « K7FM-92QX-HT4P »."""
    chars = "".join(secrets.choice(TEMPORARY_ALPHABET) for _ in range(12))
    return f"{chars[:4]}-{chars[4:8]}-{chars[8:]}"


def full_name(user):
    return f"{user.first_name} {user.last_name}".strip() or user.email


def member_payload(membership, *, with_email):
    """`with_email` : le lecteur gère la boutique ; il voit aussi l'e-mail et les droits accordés aux gérants."""
    user = membership.user
    data = {
        "user_id": str(user.pk),
        "name": full_name(user),
        "first_name": user.first_name,
        "last_name": user.last_name,
        "role": membership.role,
        "joined_at": membership.created_at,
        # N'a pas encore remplacé son mot de passe provisoire.
        "pending": user.must_change_password,
        "temporary_password_expires_at": user.temporary_password_expires_at if user.must_change_password else None,
    }
    if with_email:
        data["email"] = user.email
        if membership.role == Role.MANAGER:
            data["grants"] = sorted(membership.grants or [])
            data["discount_cap_percent"] = membership.discount_cap_percent
    return data


def staff_membership(shop, user_id, requester):
    """
    Un gérant ou un vendeur de la boutique ; le propriétaire ne se modifie pas d'ici.
    Un gérant à qui l'on a confié l'équipe (team.manage_sellers) ne vise que des vendeurs.
    """
    membership = Membership.objects.select_related("user").filter(shop=shop, user_id=user_id).first()
    if membership is None:
        raise NotFound("Membre introuvable.")
    if membership.role == Role.OWNER:
        raise PermissionDenied("Le propriétaire de la boutique ne peut être ni modifié ni retiré.")
    if requester.role != Role.OWNER and membership.role != Role.SELLER:
        raise PermissionDenied("Un gérant ne gère que les vendeurs.")
    return membership


class MemberCreateSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    first_name = serializers.CharField(min_length=1, max_length=80, validators=[plain_text])
    last_name = serializers.CharField(min_length=1, max_length=80, validators=[plain_text])
    # Un seul propriétaire par boutique : on ajoute des gérants et des vendeurs.
    role = serializers.ChoiceField(choices=[(Role.MANAGER, "Gérant"), (Role.SELLER, "Vendeur")])

    def validate_email(self, value):
        return value.strip().lower()


class MemberListView(ShopScopedView):
    permission_by_method = {"GET": "team.view", "POST": "team.manage_sellers"}

    def get(self, request, slug):
        # L'e-mail des autres n'est montré qu'au propriétaire : un vendeur n'en a pas besoin.
        with_email = "shop.manage" in self.permissions
        memberships = Membership.objects.filter(shop=self.shop).select_related("user")
        ordered = sorted(memberships, key=lambda m: (ROLE_ORDER[m.role], full_name(m.user).lower()))
        return Response([{**member_payload(m, with_email=with_email), "is_you": m.user_id == request.user.pk} for m in ordered])

    def post(self, request, slug):
        enforce("member_create", str(self.shop.pk), MEMBER_CREATE_LIMIT)
        serializer = MemberCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if self.membership.role != Role.OWNER and data["role"] != Role.SELLER:
            raise PermissionDenied("Un gérant ajoute des vendeurs, pas des gérants.")
        # Donner accès aux commandes et aux téléphones des clients est une action grave.
        require_reauth(request)
        plans.ensure_room(self.shop, "members")
        if User.objects.filter(email__iexact=data["email"]).exists():
            raise ProblemError(
                409,
                "account_exists",
                "Cette adresse a déjà un compte Akwaba. Utilisez une autre adresse pour cette personne.",
            )

        password = temporary_password()
        with transaction.atomic():
            user = User.objects.create_user(
                email=data["email"],
                password=password,
                first_name=data["first_name"],
                last_name=data["last_name"],
                must_change_password=True,
                temporary_password_expires_at=timezone.now() + TEMPORARY_PASSWORD_LIFETIME,
            )
            membership = Membership.objects.create(user=user, shop=self.shop, role=data["role"])
        record("member_added", request, actor=request.user, shop=self.shop, target=("user", user.pk, user.email), role=data["role"])
        return Response(
            {
                "member": member_payload(membership, with_email=True),
                # Affiché une seule fois : Akwaba ne le garde qu'en empreinte, comme tout mot de passe.
                "temporary_password": password,
            },
            status=status.HTTP_201_CREATED,
        )


class MemberDetailView(ShopScopedView):
    """
    PATCH (propriétaire) : le poste et, pour un gérant, les droits accordés en plus des siens.
    DELETE : le propriétaire, ou un gérant à qui l'on a confié l'équipe (vendeurs seulement).
    """

    permission_by_method = {"PATCH": "shop.manage", "DELETE": "team.manage_sellers"}

    def patch(self, request, slug, user_id):
        membership = staff_membership(self.shop, user_id, self.membership)
        if not {"role", "grants", "discount_cap_percent"} & set(request.data):
            raise ValidationError({"role": [ErrorDetail("Indiquez le poste ou les droits.", code="required")]})
        role = request.data.get("role", membership.role)
        if role not in (Role.MANAGER, Role.SELLER):
            raise ValidationError({"role": [ErrorDetail("Rôle attendu : manager ou seller.", code="invalid_choice")]})
        grants = request.data.get("grants")
        if grants is not None:
            if not isinstance(grants, list) or not all(isinstance(code, str) for code in grants):
                raise ValidationError({"grants": [ErrorDetail("Liste de droits attendue.", code="invalid")]})
            if refused := sorted(set(grants) - GRANTABLE):
                raise ValidationError(
                    {"grants": [ErrorDetail(f"Droits qui ne se confient pas : {', '.join(refused)}.", code="not_grantable")]}
                )
            if role != Role.MANAGER:
                raise ValidationError({"grants": [ErrorDetail("Seul un gérant reçoit des droits en plus.", code="manager_only")]})
        previous_grants = set(membership.grants or [])
        # Repasser vendeur retire tous les droits accordés ; sinon, les droits envoyés remplacent les anciens.
        new_grants = set() if role == Role.SELLER else set(grants) if grants is not None else previous_grants
        new_cap = self._discount_cap(request.data, membership, role, new_grants)
        require_reauth(request)

        target = ("user", membership.user.pk, membership.user.email)
        if membership.role != role:
            previous = membership.role
            membership.role = role
            record("member_role_changed", request, actor=request.user, shop=self.shop, target=target, previous_role=previous, new_role=role)
        previous_cap = membership.discount_cap_percent
        if new_grants != previous_grants or new_cap != previous_cap:
            details = {"added": sorted(new_grants - previous_grants), "removed": sorted(previous_grants - new_grants)}
            if new_cap != previous_cap:
                details["discount_cap_percent"] = {"previous": previous_cap, "new": new_cap}
            record("member_grants_changed", request, actor=request.user, shop=self.shop, target=target, **details)
        membership.grants = sorted(new_grants)
        membership.discount_cap_percent = new_cap
        membership.save(update_fields=["role", "grants", "discount_cap_percent"])
        return Response(member_payload(membership, with_email=True))

    @staticmethod
    def _discount_cap(data, membership, role, new_grants):
        """
        Le plafond des remises d'un gérant (docs/chantier-p5.md §1.3) : obligatoire avec discounts.give,
        remis à zéro sans ce droit. Vérifié avant la confirmation renforcée, comme le reste du corps.
        """
        if "discount_cap_percent" in data and data["discount_cap_percent"] is not None:
            if role != Role.MANAGER:
                raise ValidationError(
                    {"discount_cap_percent": [ErrorDetail("Seul un gérant a un plafond de remise.", code="manager_only")]}
                )
            field = serializers.IntegerField(min_value=1, max_value=90)
            try:
                cap = field.run_validation(data["discount_cap_percent"])
            except serializers.ValidationError as error:
                raise ValidationError({"discount_cap_percent": error.detail}) from None
        else:
            cap = membership.discount_cap_percent
        if "discounts.give" not in new_grants:
            return None
        if cap is None:
            raise ValidationError(
                {"discount_cap_percent": [ErrorDetail("Fixez le plafond des remises de ce gérant (1 à 90 %).", code="cap_required")]}
            )
        return cap

    def delete(self, request, slug, user_id):
        membership = staff_membership(self.shop, user_id, self.membership)
        user = membership.user
        with transaction.atomic():
            membership.delete()
            # Sans autre boutique, le compte ne sert plus à rien : il est désactivé et ses sessions fermées.
            # L'accès à cette boutique, lui, est coupé tout de suite : chaque requête revérifie l'appartenance.
            if not Membership.objects.filter(user=user).exists():
                User.objects.filter(pk=user.pk).update(is_active=False)
                revoke_all(user, UserSession.RevokeReason.ACCESS_REMOVED)
        record("member_removed", request, actor=request.user, shop=self.shop, target=("user", user.pk, user.email))
        return Response(status=status.HTTP_204_NO_CONTENT)


class MemberPasswordView(ShopScopedView):
    """Nouveau mot de passe provisoire, pour un membre qui n'a jamais choisi le sien (perdu ou expiré)."""

    permission_by_method = {"POST": "team.manage_sellers"}

    def post(self, request, slug, user_id):
        membership = staff_membership(self.shop, user_id, self.membership)
        user = membership.user
        if not user.must_change_password:
            raise ProblemError(
                409,
                "password_already_chosen",
                "Cette personne a déjà choisi son mot de passe. Elle peut le réinitialiser elle-même par e-mail.",
            )
        require_reauth(request)
        password = temporary_password()
        user.set_password(password)
        user.temporary_password_expires_at = timezone.now() + TEMPORARY_PASSWORD_LIFETIME
        user.save(update_fields=["password", "temporary_password_expires_at"])
        revoke_all(user, UserSession.RevokeReason.ACCESS_REMOVED)
        record("member_password_reset", request, actor=request.user, shop=self.shop, target=("user", user.pk, user.email))
        return Response({"member": member_payload(membership, with_email=True), "temporary_password": password})


# ---------- Le mot du patron ----------


class TeamNoteSerializer(serializers.Serializer):
    body = serializers.CharField(min_length=2, max_length=1000, trim_whitespace=True)
    urgent = serializers.BooleanField(default=False)
    audience = serializers.ChoiceField(choices=NoteAudience.choices)
    recipient = serializers.UUIDField(required=False, allow_null=True)

    def validate_body(self, value):
        if CONTROL.search(value):
            raise serializers.ValidationError("Caractères de contrôle refusés.", code="invalid_characters")
        return value

    def validate(self, attrs):
        if attrs["audience"] == NoteAudience.MEMBER and not attrs.get("recipient"):
            raise serializers.ValidationError({"recipient": [ErrorDetail("Choisissez la personne.", code="required")]})
        return attrs


def recipients_for(shop, author, audience, recipient_id=None):
    members = Membership.objects.filter(shop=shop).exclude(user=author)
    if audience == NoteAudience.MANAGERS:
        members = members.filter(role=Role.MANAGER)
    elif audience == NoteAudience.SELLERS:
        members = members.filter(role=Role.SELLER)
    elif audience == NoteAudience.MEMBER:
        members = members.filter(user_id=recipient_id)
    return [membership.user_id for membership in members]


def audience_label(note):
    if note.audience == NoteAudience.MEMBER:
        return full_name(note.recipient) if note.recipient else "Une personne qui n'est plus dans l'équipe"
    return NoteAudience(note.audience).label


def note_payload(note, user, *, can_send):
    receipts = list(note.receipts.all())
    mine = next((receipt for receipt in receipts if receipt.user_id == user.pk), None)
    data = {
        "id": str(note.pk),
        "body": note.body,
        "urgent": note.urgent,
        "kind": note.kind,
        "author": {"name": note.author_name, "role": note.author_role, "is_you": note.author_id == user.pk},
        "audience": {"type": note.audience, "label": audience_label(note)},
        "created_at": note.created_at,
        "withdrawn": note.withdrawn_at is not None,
        "for_you": mine is not None,
        "read_at": mine.read_at if mine else None,
    }
    if can_send:
        data["receipts"] = [
            {"name": full_name(receipt.user), "read_at": receipt.read_at}
            for receipt in sorted(receipts, key=lambda r: (r.read_at is None, full_name(r.user).lower()))
        ]
    return data


def notes_with_receipts(queryset):
    return queryset.select_related("recipient").prefetch_related(
        Prefetch("receipts", queryset=TeamNoteReceipt.objects.select_related("user"))
    )


class TeamNoteListView(ShopScopedView):
    permission_by_method = {"GET": "team.view", "POST": "notes.send"}

    def get(self, request, slug):
        can_send = "notes.send" in self.permissions
        notes = TeamNote.objects.for_shop(self.shop)
        if request.query_params.get("unread") == "1":
            # Le bandeau en haut des pages : mes consignes pas encore lues, les urgentes d'abord.
            notes = notes.filter(
                withdrawn_at__isnull=True, receipts__user=request.user, receipts__read_at__isnull=True
            ).order_by("-urgent", "-created_at")
        elif not can_send:
            notes = notes.filter(receipts__user=request.user)
        notes = notes_with_receipts(notes)[:50]
        return Response([note_payload(note, request.user, can_send=can_send) for note in notes])

    def post(self, request, slug):
        enforce("team_note", str(request.user.pk), NOTE_SEND_LIMIT)
        serializer = TeamNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        recipients = recipients_for(self.shop, request.user, data["audience"], data.get("recipient"))
        if not recipients:
            field = "recipient" if data["audience"] == NoteAudience.MEMBER else "audience"
            raise ValidationError({field: [ErrorDetail("Personne dans l'équipe ne recevrait ce message.", code="no_recipient")]})

        with transaction.atomic():
            note = TeamNote.objects.create(
                shop=self.shop,
                author=request.user,
                author_name=full_name(request.user),
                author_role=self.membership.role,
                body=data["body"],
                urgent=data["urgent"],
                audience=data["audience"],
                recipient_id=data.get("recipient") if data["audience"] == NoteAudience.MEMBER else None,
            )
            TeamNoteReceipt.objects.bulk_create(TeamNoteReceipt(note=note, user_id=user_id) for user_id in recipients)
        record(
            "team_note_sent", request, actor=request.user, shop=self.shop, target=("note", note.pk, ""),
            audience=note.audience, urgent=note.urgent, recipients=len(recipients),
        )
        note = notes_with_receipts(TeamNote.objects.filter(pk=note.pk)).get()
        return Response(note_payload(note, request.user, can_send=True), status=status.HTTP_201_CREATED)


class TeamNoteReadView(ShopScopedView):
    """« C'est noté » : l'accusé de lecture du destinataire. Seul un destinataire peut le donner."""

    permission_by_method = {"POST": "team.view"}

    def post(self, request, slug, note_id):
        receipt = TeamNoteReceipt.objects.filter(note__shop=self.shop, note_id=note_id, user=request.user).first()
        if receipt is None:
            raise NotFound("Message introuvable.")
        if receipt.read_at is None:
            receipt.read_at = timezone.now()
            receipt.save(update_fields=["read_at"])
        return Response({"id": str(note_id), "read_at": receipt.read_at})


class TeamNoteDetailView(ShopScopedView):
    """Retirer un message : son auteur, ou le propriétaire. Il reste dans l'historique, marqué retiré."""

    permission_by_method = {"DELETE": "notes.send"}

    def delete(self, request, slug, note_id):
        note = TeamNote.objects.for_shop(self.shop).filter(pk=note_id).first()
        if note is None:
            raise NotFound("Message introuvable.")
        if note.author_id != request.user.pk and self.membership.role != Role.OWNER:
            raise PermissionDenied("Seul son auteur ou le propriétaire peut retirer ce message.")
        if note.withdrawn_at is None:
            note.withdrawn_at = timezone.now()
            note.save(update_fields=["withdrawn_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
