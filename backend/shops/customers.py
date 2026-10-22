"""
Clients et fidèles (docs/chantier-p4.md §C).

Un client, c'est un téléphone qui a commandé dans la boutique. Ses chiffres se calculent sur ses
commandes à chaque lecture ; la fiche `Customer` ne garde que ce qui n'en découle pas (le nom de
fidèle donné par le propriétaire) et un identifiant aléatoire : le numéro n'apparaît jamais dans
une adresse, et il ne sort en clair que sur la fiche, pour l'appeler.
"""

from collections import Counter
from datetime import timedelta

from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.response import Response

from accounts.sessions import require_reauth
from audit.services import record
from core.pagination import PagePagination
from core.ratelimit import enforce
from core.spreadsheet import excel_csv, phone_cell

from .discounts import customer_discounts
from .models import Customer, Order, OrderItem, OrderStatus
from .permissions import ShopScopedView
from .storefront import normalize_phone, plain_text
from .team import full_name

NEW_WINDOW = timedelta(days=30)
WIN_BACK_AFTER = timedelta(days=45)
ACTIVE_WINDOW = timedelta(days=30)
SEGMENTS = ("all", "loyal", "new", "win_back", "at_risk")
SORTS = ("recent", "spent")


def mask_phone(phone):
    """« +225 07 08 •• •• 11 » : assez pour reconnaître un client, pas pour l'appeler."""
    digits = phone.removeprefix("+225")
    if len(digits) != 10:
        return "•• •• •• •• ••"
    return f"+225 {digits[:2]} {digits[2:4]} •• •• {digits[8:]}"


def order_stats(shop):
    """Les chiffres de chaque téléphone, en une lecture des commandes de la boutique (les plus anciennes d'abord)."""
    stats = {}
    rows = (
        Order.objects.for_shop(shop)
        .order_by("created_at")
        .values_list("customer_phone", "customer_name", "customer_city", "customer_commune", "status", "total", "created_at")
    )
    for phone, name, city, commune, status, total, created_at in rows:
        s = stats.setdefault(
            phone,
            {"orders": 0, "delivered": 0, "cancelled": 0, "spent": 0, "counted": 0, "first": created_at, "last": created_at, "last_counted": None},
        )
        s["orders"] += 1
        if status == OrderStatus.DELIVERED:
            s["delivered"] += 1
        if status == OrderStatus.CANCELLED:
            s["cancelled"] += 1
        else:
            s["spent"] += total
            s["counted"] += 1
            s["last_counted"] = created_at
        s.update(last=created_at, name=name, city=city, commune=commune)
    return stats


def sync_customers(shop, stats):
    """Crée les fiches qui manquent (commandes passées avant les fiches, données de démo)."""
    known = set(Customer.objects.for_shop(shop).values_list("phone", flat=True))
    missing = [Customer(shop=shop, phone=phone, name=s["name"]) for phone, s in stats.items() if phone not in known]
    if missing:
        Customer.objects.bulk_create(missing, ignore_conflicts=True)


def customer_item(customer, s, threshold, now):
    s = s or {}
    delivered, cancelled, counted = s.get("delivered", 0), s.get("cancelled", 0), s.get("counted", 0)
    finished = delivered + cancelled
    reliability = round(delivered * 100 / finished) if finished else None
    flags = []
    if s.get("first") and s["first"] >= now - NEW_WINDOW:
        flags.append("new")
    if counted >= 2 and s["last"] <= now - WIN_BACK_AFTER:
        flags.append("win_back")
    if cancelled >= 2 or (finished >= 2 and reliability < 50):
        flags.append("at_risk")
    return {
        "id": customer.public_id,
        "name": customer.name or s.get("name", ""),
        "phone_masked": mask_phone(customer.phone),
        "city": s.get("city", ""),
        "commune": s.get("commune", ""),
        "orders": s.get("orders", 0),
        "delivered": delivered,
        "cancelled": cancelled,
        "spent": s.get("spent", 0),
        "average_basket": round(s["spent"] / counted) if counted else 0,
        "first_order_at": s.get("first"),
        "last_order_at": s.get("last"),
        "reliability": reliability,
        "loyal": customer.is_vip or delivered >= threshold,
        "vip": customer.is_vip,
        "flags": flags,
    }


def all_customers(shop):
    """(fiches, stats, éléments de liste) ; une fiche sans commande n'apparaît que si le propriétaire l'a nommée fidèle."""
    stats = order_stats(shop)
    sync_customers(shop, stats)
    now = timezone.now()
    customers = [c for c in Customer.objects.for_shop(shop) if c.phone in stats or c.is_vip]
    items = [customer_item(c, stats.get(c.phone), shop.loyalty_threshold, now) for c in customers]
    return customers, stats, items


def matches(item, customer, segment, query):
    if segment == "loyal" and not item["loyal"]:
        return False
    if segment in ("new", "win_back", "at_risk") and segment not in item["flags"]:
        return False
    if query:
        digits = "".join(ch for ch in query if ch.isdigit())
        if query.lower() not in item["name"].lower() and not (len(digits) >= 2 and digits in customer.phone):
            return False
    return True


class CustomerListView(ShopScopedView):
    permission_by_method = {"GET": "customers.view"}

    def get(self, request, slug):
        segment = request.query_params.get("segment", "all")
        sort = request.query_params.get("sort", "recent")
        if segment not in SEGMENTS:
            raise ValidationError({"segment": [ErrorDetail("Segment inconnu.", code="invalid_choice")]})
        if sort not in SORTS:
            raise ValidationError({"sort": [ErrorDetail("Tri attendu : recent ou spent.", code="invalid_choice")]})
        query = request.query_params.get("q", "").strip()[:60]
        customers, _, items = all_customers(self.shop)
        found = [item for item, customer in zip(items, customers, strict=True) if matches(item, customer, segment, query)]
        if sort == "spent":
            found.sort(key=lambda item: -item["spent"])
        else:
            found.sort(key=lambda item: item["last_order_at"] or timezone.now() - timedelta(days=36500), reverse=True)
        paginator = PagePagination()
        page = paginator.paginate_queryset(found, request, view=self)
        return paginator.get_paginated_response(page)


FLAG_LABELS = {"new": "nouveau", "win_back": "à relancer", "at_risk": "à risque"}
EXPORT_LIMIT = (10, 3600)  # par membre


class CustomerExportView(ShopScopedView):
    """
    Export des clients en CSV pour Excel (docs/chantier-p5.md §4.1). Tous les téléphones sortent en
    clair : droit à part (customers.export, que le propriétaire peut confier), confirmation
    renforcée, limite de débit et journal.
    """

    permission_by_method = {"GET": "customers.export"}

    def get(self, request, slug):
        segment = request.query_params.get("segment", "all")
        if segment not in SEGMENTS:
            raise ValidationError({"segment": [ErrorDetail("Segment inconnu.", code="invalid_choice")]})
        require_reauth(request)
        enforce("customers_export:member", str(self.membership.pk), EXPORT_LIMIT)

        customers, _, items = all_customers(self.shop)
        found = [(item, customer) for item, customer in zip(items, customers, strict=True) if matches(item, customer, segment, "")]
        found.sort(key=lambda pair: -pair[0]["spent"])

        def day(moment):
            return timezone.localtime(moment).strftime("%d/%m/%Y") if moment else ""

        rows = [
            [
                item["name"],
                phone_cell(customer.phone),
                item["city"],
                item["commune"],
                item["orders"],
                item["delivered"],
                item["cancelled"],
                item["spent"],
                item["average_basket"],
                day(item["first_order_at"]),
                day(item["last_order_at"]),
                "oui" if item["loyal"] else "non",
                ", ".join(FLAG_LABELS[flag] for flag in item["flags"]),
            ]
            for item, customer in found
        ]
        header = ["Nom", "Téléphone", "Ville", "Commune", "Commandes", "Livrées", "Annulées", "Total dépensé (F)",
                  "Panier moyen (F)", "Première commande", "Dernière commande", "Fidèle", "Repères"]
        record("customers_exported", request, actor=request.user, shop=self.shop, rows=len(rows), segment=segment)
        response = HttpResponse(excel_csv(header, rows), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="akwaba-{self.shop.slug}-clients-{timezone.localdate()}.csv"'
        return response


class CustomerSummaryView(ShopScopedView):
    permission_by_method = {"GET": "customers.view"}

    def get(self, request, slug):
        customers, stats, items = all_customers(self.shop)
        now = timezone.now()

        def active_between(start, end):
            phones = (
                Order.objects.for_shop(self.shop)
                .exclude(status=OrderStatus.CANCELLED)
                .filter(created_at__gte=start, created_at__lt=end)
                .order_by()
                .values_list("customer_phone", flat=True)
                .distinct()
            )
            return len(set(phones))

        loyal = sorted((item for item in items if item["loyal"]), key=lambda item: -item["spent"])[:6]
        by_id = {c.public_id: c for c in customers}
        monthly = self._monthly([by_id[item["id"]].phone for item in loyal])
        return Response(
            {
                "total": len(items),
                "active_30d": active_between(now - ACTIVE_WINDOW, now),
                "active_30d_previous": active_between(now - 2 * ACTIVE_WINDOW, now - ACTIVE_WINDOW),
                "loyal": sum(item["loyal"] for item in items),
                "new_30d": sum("new" in item["flags"] for item in items),
                "win_back": sum("win_back" in item["flags"] for item in items),
                "at_risk": sum("at_risk" in item["flags"] for item in items),
                "loyalty_threshold": self.shop.loyalty_threshold,
                "loyal_top": [{**item, "monthly": monthly.get(by_id[item["id"]].phone, [0] * 6)} for item in loyal],
            }
        )

    def _monthly(self, phones):
        """CA des 6 derniers mois (du plus ancien au plus récent) pour chaque téléphone."""
        today = timezone.localdate()
        months = []
        first = today.replace(day=1)
        for _ in range(6):
            months.insert(0, first)
            first = (first - timedelta(days=1)).replace(day=1)
        index = {(m.year, m.month): i for i, m in enumerate(months)}
        result = {phone: [0] * 6 for phone in phones}
        rows = (
            Order.objects.for_shop(self.shop)
            .exclude(status=OrderStatus.CANCELLED)
            .filter(customer_phone__in=phones, created_at__date__gte=months[0])
            .values_list("customer_phone", "created_at", "total")
        )
        for phone, created_at, total in rows:
            local = timezone.localtime(created_at)
            if (slot := index.get((local.year, local.month))) is not None:
                result[phone][slot] += total
        return result


def customer_detail(shop, customer):
    stats = order_stats(shop)
    item = customer_item(customer, stats.get(customer.phone), shop.loyalty_threshold, timezone.now())
    orders = Order.objects.for_shop(shop).filter(customer_phone=customer.phone)
    names = Counter(orders.values_list("customer_name", flat=True))
    payments = Counter(orders.values_list("payment_method", flat=True))
    places = Counter(orders.values_list("customer_city", "customer_commune", "customer_landmark"))
    products = (
        OrderItem.objects.filter(order__in=orders.exclude(status=OrderStatus.CANCELLED))
        .values("name")
        .annotate(quantity=Sum("quantity"))
        .order_by("-quantity", "name")[:5]
    )
    return {
        **item,
        # Sur la fiche, « orders » est la liste des 20 dernières (contrat) : le nombre passe dans order_count.
        "order_count": item["orders"],
        "phone": customer.phone,
        "names_used": [name for name, _ in names.most_common()],
        "payment_favorite": payments.most_common(1)[0][0] if payments else None,
        "addresses": [
            {"city": city, "commune": commune, "landmark": landmark, "orders": n}
            for (city, commune, landmark), n in places.most_common(3)
        ],
        "products": [{"name": row["name"], "quantity": row["quantity"]} for row in products],
        "orders": [
            {"id": str(o.pk), "reference": o.reference, "created_at": o.created_at, "total": o.total, "status": o.status, "payment_method": o.payment_method}
            for o in orders.order_by("-created_at")[:20]
        ],
        "vip_set_by": {"name": full_name(customer.vip_set_by)} if customer.vip_set_by else None,
        "vip_set_at": customer.vip_set_at,
    }


def with_discounts(payload, customer, view):
    """La fiche et ses réductions (docs/chantier-p5.md §1.4), écrites pour le lecteur : code masqué sans le droit."""
    return {**payload, "discounts": customer_discounts(customer, view.membership, view.permissions)}


def shop_customer(shop, customer_id):
    # Une fiche d'une autre boutique donne 404, comme une fiche inexistante.
    customer = Customer.objects.for_shop(shop).select_related("vip_set_by").filter(public_id=customer_id).first()
    if customer is None:
        raise NotFound("Client introuvable.")
    return customer


class CustomerDetailView(ShopScopedView):
    permission_by_method = {"GET": "customers.view"}

    def get(self, request, slug, customer_id):
        customer = shop_customer(self.shop, customer_id)
        return Response(with_discounts(customer_detail(self.shop, customer), customer, self))


class LoyaltySettingsView(ShopScopedView):
    permission_by_method = {"PATCH": "customers.loyalty"}

    def patch(self, request, slug):
        field = serializers.IntegerField(min_value=1, max_value=50)
        try:
            threshold = field.run_validation(request.data.get("loyalty_threshold"))
        except serializers.ValidationError as error:
            raise ValidationError({"loyalty_threshold": error.detail}) from None
        previous = self.shop.loyalty_threshold
        if threshold != previous:
            self.shop.loyalty_threshold = threshold
            self.shop.save(update_fields=["loyalty_threshold"])
            record("loyalty_threshold_changed", request, actor=request.user, shop=self.shop, previous=previous, threshold=threshold)
        return Response({"loyalty_threshold": threshold})


class VipSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=24)
    name = serializers.CharField(max_length=120, required=False, allow_blank=True, default="", validators=[plain_text])

    def validate_phone(self, value):
        return normalize_phone(value)


class CustomerVipView(ShopScopedView):
    """Nommer un fidèle à la main (propriétaire) : par son numéro, même s'il n'a pas encore commandé."""

    permission_by_method = {"POST": "customers.vip"}

    def post(self, request, slug):
        serializer = VipSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        customer, _ = Customer.objects.get_or_create(shop=self.shop, phone=data["phone"])
        if data["name"]:
            customer.name = data["name"]
        customer.is_vip, customer.vip_set_by, customer.vip_set_at = True, request.user, timezone.now()
        customer.save()
        record("customer_vip_set", request, actor=request.user, shop=self.shop, target=("customer", customer.public_id, customer.name))
        return Response(with_discounts(customer_detail(self.shop, customer), customer, self))


class CustomerVipRemoveView(ShopScopedView):
    permission_by_method = {"DELETE": "customers.vip"}

    def delete(self, request, slug, customer_id):
        customer = shop_customer(self.shop, customer_id)
        if customer.is_vip:
            customer.is_vip, customer.vip_set_by, customer.vip_set_at = False, None, None
            customer.save(update_fields=["is_vip", "vip_set_by", "vip_set_at"])
            record("customer_vip_removed", request, actor=request.user, shop=self.shop, target=("customer", customer.public_id, customer.name))
        return Response(with_discounts(customer_detail(self.shop, customer), customer, self))
