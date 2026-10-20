from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from . import mfa
from .models import User, UserSession

# Les secrets 2FA, les codes de secours et les appareils connus ne sont pas exposés dans l'admin.


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "has_2fa", "is_demo", "is_staff", "is_active")
    search_fields = ("email", "first_name", "last_name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Identité", {"fields": ("first_name", "last_name")}),
        ("Droits", {"fields": ("is_active", "is_demo", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )

    @admin.display(description="2FA", boolean=True)
    def has_2fa(self, user):
        return mfa.is_enabled(user)


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    list_display = ("user", "device_label", "ip", "shared_device", "created_at", "last_seen_at", "revoked_reason")
    list_filter = ("shared_device", "revoked_reason")
    search_fields = ("user__email",)
    exclude = ("refresh_jti", "previous_refresh_jti")
    readonly_fields = [
        f.name for f in UserSession._meta.fields if f.name not in ("refresh_jti", "previous_refresh_jti")
    ]
