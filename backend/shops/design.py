"""
Éditeur « Ma boutique » (docs/chantier-p5.md §3) : brouillon, publication et versions de la vitrine.

La configuration est un JSON fermé : chaque valeur est prise dans une liste, les deux textes passent
par plain_text, et toute clé inconnue est refusée. Le front n'en tire que des choix dans des listes
fermées : rien de ce que le marchand écrit n'entre dans une balise, un style ou un script.
"""

from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.response import Response

from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import enforce

from . import plans
from .design_catalog import COVERS, MOTIONS, PLAN_RANK, SECTIONS, THEMES, VERSIONS_KEPT, default_config
from .models import StorefrontVersion
from .permissions import ShopScopedView
from .storefront import plain_text
from .team import full_name

SAVE_LIMIT = (120, 3600)  # par membre
Status = StorefrontVersion.Status


def refuse_unknown_keys(data, fields):
    if isinstance(data, dict) and (unknown := sorted(set(data) - set(fields))):
        raise ValidationError({key: [ErrorDetail("Champ inconnu.", code="unknown_field")] for key in unknown})


class TextsSerializer(serializers.Serializer):
    tagline = serializers.CharField(max_length=80, allow_blank=True, required=False, default="", validators=[plain_text])
    story = serializers.CharField(max_length=400, allow_blank=True, required=False, default="", validators=[plain_text])

    def to_internal_value(self, data):
        refuse_unknown_keys(data, self.fields)
        return super().to_internal_value(data)


class DesignSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1, max_value=1)
    theme = serializers.ChoiceField(choices=list(THEMES))
    motion = serializers.ChoiceField(choices=MOTIONS)
    cover = serializers.ChoiceField(choices=COVERS)
    sections = serializers.ListField(child=serializers.ChoiceField(choices=SECTIONS), min_length=1, max_length=len(SECTIONS))
    texts = TextsSerializer()

    def to_internal_value(self, data):
        refuse_unknown_keys(data, self.fields)
        return super().to_internal_value(data)

    def validate_sections(self, value):
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Chaque section une seule fois.", code="duplicate_section")
        if "collection" not in value:
            raise serializers.ValidationError("La collection est toujours sur la vitrine.", code="collection_required")
        return value


def clean_config(raw):
    if not isinstance(raw, dict):
        raise ValidationError({"config": [ErrorDetail("Configuration attendue.", code="required")]})
    serializer = DesignSerializer(data=raw)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    return {
        "version": 1,
        "theme": data["theme"],
        "motion": data["motion"],
        "cover": data["cover"],
        "sections": list(data["sections"]),
        "texts": {"tagline": data["texts"]["tagline"].strip(), "story": data["texts"]["story"].strip()},
    }


def limits(shop):
    plan = plans.spec(shop)
    rank = PLAN_RANK[plan.id]
    return {"plan": plan.id, "plan_name": plan.name, "custom_sections": rank >= 1, "story": rank >= 1, "versions_kept": VERSIONS_KEPT[plan.id]}


def check_plan(shop, config):
    """Ce que le plan ne permet pas ne s'enregistre pas (un aperçu, lui, montre tout)."""
    plan = plans.spec(shop)
    rank = PLAN_RANK[plan.id]
    theme = THEMES[config["theme"]]
    if PLAN_RANK[theme["plan"]] > rank:
        raise ProblemError(403, "plan_limit_reached", f"Le thème {theme['label']} est compris à partir du plan Pro.", feature="theme")
    if rank == 0:
        if tuple(config["sections"]) != theme["sections"]:
            raise ProblemError(403, "plan_limit_reached", "Choisir et ordonner les sections : à partir du plan Pro.", feature="sections")
        if config["texts"]["story"]:
            raise ProblemError(403, "plan_limit_reached", "« Notre histoire » : à partir du plan Pro.", feature="story")


def version_payload(version):
    if version is None:
        return None
    return {
        "number": version.number,
        "status": version.status,
        "config": version.config,
        "updated_at": version.updated_at,
        "created_by_name": version.created_by_name,
        "published_at": version.published_at,
        "published_by_name": version.published_by_name,
    }


class DesignScopedView(ShopScopedView):
    def versions(self):
        return StorefrontVersion.objects.for_shop(self.shop)

    def draft(self):
        return self.versions().filter(status=Status.DRAFT).first()

    def save_draft(self, config, request):
        """Le brouillon unique de la boutique, créé au besoin avec le numéro suivant."""
        for _ in range(3):
            draft = self.draft()
            if draft is not None:
                draft.config = config
                draft.save(update_fields=["config", "updated_at"])
                return draft
            try:
                with transaction.atomic():
                    number = (self.versions().aggregate(top=Max("number"))["top"] or 0) + 1
                    return StorefrontVersion.objects.create(
                        shop=self.shop, number=number, status=Status.DRAFT, config=config,
                        created_by=request.user, created_by_name=full_name(request.user),
                    )
            except IntegrityError:  # un autre enregistrement vient de créer le brouillon : on le met à jour
                continue
        raise ProblemError(409, "conflict", "La vitrine vient d'être modifiée ailleurs : actualisez la page.")


class DesignView(DesignScopedView):
    permission_by_method = {"GET": "storefront.edit"}

    def get(self, request, slug):
        current = limits(self.shop)
        rank = PLAN_RANK[current["plan"]]
        return Response(
            {
                "draft": version_payload(self.draft()),
                "published": version_payload(self.versions().filter(status=Status.PUBLISHED).first()),
                "default": default_config(),
                "limits": current,
                "accent": self.shop.accent,
                "themes": [
                    {"id": key, "label": theme["label"], "plan": theme["plan"], "allowed": PLAN_RANK[theme["plan"]] <= rank, "sections": list(theme["sections"])}
                    for key, theme in THEMES.items()
                ],
            }
        )


class DesignDraftView(DesignScopedView):
    permission_by_method = {"PUT": "storefront.edit", "DELETE": "storefront.edit"}

    def put(self, request, slug):
        config = clean_config(request.data.get("config"))
        check_plan(self.shop, config)
        enforce("design_save:member", str(self.membership.pk), SAVE_LIMIT)
        return Response(version_payload(self.save_draft(config, request)))

    def delete(self, request, slug):
        self.versions().filter(status=Status.DRAFT).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DesignPublishView(DesignScopedView):
    permission_by_method = {"POST": "storefront.edit"}

    def post(self, request, slug):
        draft = self.draft()
        if draft is None:
            raise ProblemError(409, "no_draft", "Rien à publier : enregistrez d'abord un brouillon.")
        # Le plan a pu baisser depuis l'enregistrement du brouillon.
        check_plan(self.shop, draft.config)
        try:
            with transaction.atomic():
                self.versions().filter(status=Status.PUBLISHED).update(status=Status.ARCHIVED)
                updated = self.versions().filter(pk=draft.pk, status=Status.DRAFT).update(
                    status=Status.PUBLISHED, published_at=timezone.now(), published_by_name=full_name(request.user)
                )
                if not updated:
                    raise IntegrityError("brouillon déjà publié")
                kept = limits(self.shop)["versions_kept"]
                old = list(self.versions().exclude(status=Status.DRAFT).order_by("-number").values_list("pk", flat=True)[kept:])
                if old:
                    StorefrontVersion.objects.filter(pk__in=old).delete()
        except IntegrityError:
            raise ProblemError(409, "conflict", "La vitrine vient d'être publiée ailleurs : actualisez la page.") from None
        draft.refresh_from_db()
        record(
            "storefront_published", request, actor=request.user, shop=self.shop,
            target=("storefront", draft.pk, f"Version {draft.number}"), number=draft.number, theme=draft.config["theme"],
        )
        return Response(version_payload(draft))


class DesignVersionsView(DesignScopedView):
    permission_by_method = {"GET": "storefront.edit"}

    def get(self, request, slug):
        return Response([version_payload(v) for v in self.versions().exclude(status=Status.DRAFT).order_by("-number")])


class DesignRestoreView(DesignScopedView):
    permission_by_method = {"POST": "storefront.edit"}

    def post(self, request, slug, number):
        version = self.versions().exclude(status=Status.DRAFT).filter(number=number).first()
        if version is None:
            raise NotFound("Version introuvable.")
        check_plan(self.shop, version.config)
        draft = self.save_draft(version.config, request)
        record(
            "storefront_restored", request, actor=request.user, shop=self.shop,
            target=("storefront", version.pk, f"Version {version.number}"), number=version.number,
        )
        return Response(version_payload(draft))
