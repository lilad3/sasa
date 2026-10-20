from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = 'accounts'

    def ready(self):
        from django.contrib import admin

        from .admin_login import AdminLoginForm

        admin.site.login_form = AdminLoginForm
