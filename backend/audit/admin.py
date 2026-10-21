import csv
from datetime import timedelta

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q
from django.http import HttpResponse
from django.shortcuts import redirect
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html

from core.spreadsheet import csv_safe

from .actions import Severity
from .models import AuditEvent
from .services import record, verify_chain

# Classes du thème (static/akwaba_admin/akwaba-admin.css).
SEVERITY_CLASSES = {
    Severity.INFO: "akw-sev--info",
    Severity.WARNING: "akw-sev--watch",
    Severity.CRITICAL: "akw-sev--critical",
}
EXPORT_COLUMNS = [
    ("Date", lambda e: timezone.localtime(e.created_at).strftime("%d/%m/%Y %H:%M:%S")),
    ("Gravité", lambda e: e.get_severity_display()),
    ("Catégorie", lambda e: e.get_category_display()),
    ("Événement", lambda e: e.get_action_display()),
    ("Compte", lambda e: e.actor_email),
    ("Boutique", lambda e: e.shop_slug),
    ("Cible", lambda e: e.target_label),
    ("Adresse IP", lambda e: e.ip),
    ("Appareil", lambda e: e.device_label),
    ("Détails", lambda e: e.metadata),
    ("Identifiant de requête", lambda e: e.request_id),
]


class ShopFilter(admin.SimpleListFilter):
    title = "boutique"
    parameter_name = "boutique"

    def lookups(self, request, model_admin):
        slugs = AuditEvent.objects.exclude(shop_slug="").values_list("shop_slug", flat=True).distinct()
        return [(slug, slug) for slug in sorted(slugs)]

    def queryset(self, request, queryset):
        return queryset.filter(shop_slug=self.value()) if self.value() else queryset


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    """Lecture seule : personne, pas même un superutilisateur, ne modifie ou n'efface le journal."""

    change_list_template = "admin/audit/auditevent/change_list.html"
    list_display = ("created_at", "severity_badge", "action", "actor", "shop_slug", "target_label", "ip", "device_label")
    list_display_links = ("created_at", "action")
    list_filter = ("severity", "category", "action", ShopFilter, "created_at")
    search_fields = ("actor_email", "ip", "shop_slug", "target_label", "request_id")
    date_hierarchy = "created_at"
    list_per_page = 50
    actions = ["export_csv"]
    readonly_fields = [field.name for field in AuditEvent._meta.fields]
    fieldsets = (
        (None, {"fields": ("created_at", "severity", "category", "action")}),
        ("Qui", {"fields": ("actor_email", "actor_id", "ip", "device_label")}),
        ("Sur quoi", {"fields": ("shop_slug", "target_type", "target_label", "target_id", "metadata")}),
        ("Traçabilité", {"fields": ("request_id", "public_id", "previous_hash", "hash")}),
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="gravité", ordering="severity")
    def severity_badge(self, event):
        return format_html(
            '<span class="akw-sev {}">{}</span>', SEVERITY_CLASSES[event.severity], event.get_severity_display()
        )

    @admin.display(description="compte", ordering="actor_email")
    def actor(self, event):
        if not event.actor_id:
            return event.actor_email or "—"
        url = reverse("admin:accounts_user_change", args=[event.actor_id])
        return format_html('<a href="{}">{}</a>', url, event.actor_email)

    def get_urls(self):
        verify = self.admin_site.admin_view(self.verify_view)
        return [path("verifier/", verify, name="audit_auditevent_verify"), *super().get_urls()]

    def changelist_view(self, request, extra_context=None):
        since = timezone.now() - timedelta(hours=24)
        counts = AuditEvent.objects.filter(created_at__gte=since).aggregate(
            critical=Count("id", filter=Q(severity=Severity.CRITICAL)),
            warning=Count("id", filter=Q(severity=Severity.WARNING)),
            failed_logins=Count("id", filter=Q(action__in=["login_failed", "admin_login_failed"])),
            mfa_failed=Count("id", filter=Q(action="mfa_failed")),
            locked=Count("id", filter=Q(action="account_locked")),
        )
        return super().changelist_view(request, {**(extra_context or {}), "audit_summary": counts})

    def verify_view(self, request):
        if not self.has_view_permission(request):
            raise PermissionDenied
        report = verify_chain()
        record("audit_verified", request, actor=request.user, ok=report.ok, checked=report.checked)
        if report.ok:
            messages.success(request, f"Journal intact : {report.checked} événements vérifiés, aucune modification.")
        else:
            messages.error(
                request,
                f"Journal altéré à l'événement n° {report.broken_id} ({report.reason}). "
                f"{report.checked} événements vérifiés avant la rupture.",
            )
        return redirect("admin:audit_auditevent_changelist")

    @admin.action(description="Exporter la sélection en CSV", permissions=["view"])
    def export_csv(self, request, queryset):
        events = list(queryset.order_by("id"))
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        stamp = timezone.localtime().strftime("%Y-%m-%d-%H%M")
        response["Content-Disposition"] = f'attachment; filename="journal-akwaba-{stamp}.csv"'
        response.write("﻿")  # BOM : Excel lit les accents correctement
        writer = csv.writer(response, delimiter=";")  # Excel en français attend « ; »
        writer.writerow([title for title, _ in EXPORT_COLUMNS])
        for event in events:
            writer.writerow([csv_safe(read(event)) for _, read in EXPORT_COLUMNS])
        record("audit_exported", request, actor=request.user, rows=len(events))
        return response
