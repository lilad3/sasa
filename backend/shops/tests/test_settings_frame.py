import json
import pathlib
from datetime import timedelta
from unittest import mock

from django.urls import get_resolver
from django.utils import timezone

from audit.models import AuditEvent
from core.testing import ApiTestCase, enable_mfa, make_member, make_order, make_shop
from shops import settings_summary
from shops.models import ApiKey, Membership, Product, Shop, ShopLogo
from shops.permissions import ANY_MEMBER, GRANTABLE, PERMISSION_ORDER, ROLE_PERMISSIONS, ShopScopedView, effective_permissions

SUMMARY = "/api/v1/shops/maison-adjoua/settings/summary"
PERMS = "/api/v1/shops/maison-adjoua/permissions"
HISTORY = "/api/v1/shops/maison-adjoua/plan/history"
SETTINGS = "/api/v1/shops/maison-adjoua/settings"


def reauth(client, password="pirogue-lagune-mangue"):
    return client.post("/api/v1/auth/reauth", {"password": password})


class FrameTestCase(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-adjoua", "Maison Adjoua")
        self.shop.plan = "pro"
        self.shop.city = "Cocody"
        self.shop.save()
        self.owner = make_member("adjoua@exemple.ci", self.shop, "owner", first_name="Adjoua", last_name="Konan")
        self.manager = make_member("fatou@exemple.ci", self.shop, "manager", first_name="Fatou")
        self.seller = make_member("koffi@exemple.ci", self.shop, "seller", first_name="Koffi")
        ShopLogo.objects.create(shop=self.shop, image=b"png", version="v1")

    def entries(self, user, url=SUMMARY):
        self.authenticate(user)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.content)
        return {row["id"]: row for row in response.json()["entries"]}


class SummaryAccessTests(FrameTestCase):
    def test_who_sees_what(self):
        self.assertEqual(list(self.entries(self.owner)), ["general", "forfait", "utilisateurs", "clients", "securite", "avance"])
        manager = self.entries(self.manager)
        self.assertEqual(list(manager), ["utilisateurs", "clients", "securite"])
        self.assertEqual(manager["securite"]["scope"], "account")
        self.assertEqual(list(self.entries(self.seller)), ["securite"])

    def test_scopes_for_the_owner(self):
        rows = self.entries(self.owner)
        self.assertEqual((rows["general"]["scope"], rows["securite"]["scope"]), ("full", "full"))

    def test_a_manager_with_storefront_edit_sees_the_logo_only(self):
        Membership.objects.filter(user=self.manager).update(grants=["storefront.edit"])
        rows = self.entries(self.manager)
        self.assertEqual(list(rows), ["general", "utilisateurs", "clients", "securite"])
        self.assertEqual(rows["general"]["scope"], "logo")
        self.assertEqual(rows["general"]["state"], {"text": "Logo en place", "tone": "normal"})
        ShopLogo.objects.all().delete()
        self.assertEqual(self.entries(self.manager)["general"]["state"], {"text": "Logo manquant", "tone": "attention"})

    def test_non_member_gets_404_like_a_missing_shop(self):
        stranger = make_member("autre@exemple.ci", make_shop("autre"), "owner")
        self.authenticate(stranger)
        self.assertProblem(self.client.get(SUMMARY), 404, "not_found")
        self.assertProblem(self.client.get(PERMS), 404, "not_found")
        self.assertProblem(self.client.get(HISTORY), 404, "not_found")

    def test_unready_entries_never_leave_even_for_the_owner(self):
        self.assertNotIn("paiements", self.entries(self.owner))
        with mock.patch.object(settings_summary, "IMPLEMENTED", settings_summary.IMPLEMENTED + ("paiements",)):
            # La règle d'accès de « paiements » n'existe pas encore : elle sort seulement quand son chantier l'ajoute.
            self.assertNotIn("paiements", self.entries(self.owner))

    def test_limited_to_120_a_minute(self):
        self.authenticate(self.owner)
        for _ in range(120):
            self.assertEqual(self.client.get(SUMMARY).status_code, 200)
        self.assertProblem(self.client.get(SUMMARY), 429, "too_many_requests")

    def test_queries_are_bounded_and_do_not_grow_with_the_team(self):
        self.authenticate(self.owner)
        self.client.get(SUMMARY)
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as before:
            self.client.get(SUMMARY)
        for index in range(8):
            make_member(f"m{index}@exemple.ci", self.shop, "seller")
        with CaptureQueriesContext(connection) as after:
            self.client.get(SUMMARY)
        self.assertEqual(len(before), len(after))
        self.assertLessEqual(len(after), 16)


class SummaryStateTests(FrameTestCase):
    def state(self, user, entry):
        return self.entries(user)[entry]["state"]

    def test_general(self):
        self.assertEqual(self.state(self.owner, "general"), {"text": "Maison Adjoua · Cocody", "tone": "normal"})
        self.shop.city = ""
        self.shop.save()
        self.assertEqual(self.state(self.owner, "general")["text"], "Maison Adjoua")
        ShopLogo.objects.all().delete()
        self.assertEqual(self.state(self.owner, "general"), {"text": "Logo manquant", "tone": "attention"})
        # La première anomalie l'emporte : les vacances avant le logo.
        self.shop.vacation_active = True
        self.shop.vacation_until = timezone.localdate() + timedelta(days=5)
        self.shop.save()
        text = self.state(self.owner, "general")
        self.assertEqual(text["tone"], "attention")
        self.assertTrue(text["text"].startswith("En vacances jusqu'au "))

    def test_forfait_prices_match_the_front_format(self):
        self.assertEqual(self.state(self.owner, "forfait"), {"text": "Pro · 9 900 F par mois", "tone": "normal"})
        self.shop.plan = "business"
        self.shop.save()
        self.assertEqual(self.state(self.owner, "forfait")["text"], "Business · 29 900 F par mois")
        self.shop.plan = "free"
        self.shop.save()
        self.assertEqual(self.state(self.owner, "forfait"), {"text": "Gratuit", "tone": "normal"})

    def test_forfait_warns_at_ninety_percent_of_a_limit(self):
        self.shop.plan = "free"  # 25 produits
        self.shop.save()
        for index in range(23):
            Product.objects.create(shop=self.shop, sku=f"P{index}", slug=f"p{index}", name=f"P{index}", price=100)
        self.assertEqual(self.state(self.owner, "forfait"), {"text": "Gratuit · 23 produits sur 25", "tone": "attention"})

    def test_forfait_is_not_flagged_for_a_one_person_plan(self):
        # Le plan gratuit n'a qu'une place : « 1 sur 1 » serait un faux signal permanent.
        self.shop.plan = "free"
        self.shop.save()
        Membership.objects.filter(role__in=["manager", "seller"]).delete()
        self.assertEqual(self.state(self.owner, "forfait")["tone"], "normal")

    def test_utilisateurs_agreement_and_pending_only_for_the_owner(self):
        self.assertEqual(self.state(self.owner, "utilisateurs"), {"text": "3 personnes", "tone": "normal"})
        Membership.objects.filter(role="seller").delete()
        Membership.objects.filter(role="manager").delete()
        self.assertEqual(self.state(self.owner, "utilisateurs")["text"], "1 personne")
        newcomer = make_member("nouvelle@exemple.ci", self.shop, "seller", must_change_password=True)
        self.assertEqual(
            self.state(self.owner, "utilisateurs"),
            {"text": "2 personnes · 1 n'a pas encore choisi son mot de passe", "tone": "attention"},
        )
        make_member("autre@exemple.ci", self.shop, "seller", must_change_password=True)
        self.assertEqual(self.state(self.owner, "utilisateurs")["text"], "3 personnes · 2 n'ont pas encore choisi leur mot de passe")
        manager = make_member("g@exemple.ci", self.shop, "manager")
        self.assertEqual(self.state(manager, "utilisateurs")["tone"], "normal")  # le gérant ne le voit pas
        self.assertNotIn("mot de passe", self.state(manager, "utilisateurs")["text"])
        self.assertIsNotNone(newcomer)

    def test_clients_agreement(self):
        self.assertEqual(self.state(self.owner, "clients"), {"text": "Fidèle dès 3 commandes", "tone": "normal"})
        self.shop.loyalty_threshold = 1
        self.shop.save()
        self.assertEqual(self.state(self.owner, "clients")["text"], "Fidèle dès 1 commande")

    def test_securite_speaks_of_the_reader_only(self):
        self.assertEqual(self.state(self.owner, "securite"), {"text": "Activez la double authentification", "tone": "attention"})
        enable_mfa(self.owner)
        self.assertEqual(self.state(self.owner, "securite"), {"text": "Double authentification active", "tone": "normal"})
        # Celle d'un autre ne change rien à ce que lit le gérant.
        self.assertEqual(self.state(self.manager, "securite")["tone"], "attention")

    def test_avance(self):
        self.assertEqual(self.state(self.owner, "avance"), {"text": "Aucune clé", "tone": "normal"})
        ApiKey.objects.create(shop=self.shop, name="Compta", key_id="abcd1234", secret_hash="x" * 64)
        ApiKey.objects.create(shop=self.shop, name="Autre", key_id="abcd5678", secret_hash="y" * 64)
        ApiKey.objects.create(shop=self.shop, name="Morte", key_id="abcd9999", secret_hash="z" * 64, revoked_at=timezone.now())
        self.assertEqual(self.state(self.owner, "avance")["text"], "2 clés actives")
        self.shop.plan = "free"
        self.shop.save()
        self.assertEqual(self.state(self.owner, "avance"), {"text": "Réservé au plan Pro", "tone": "normal"})

    def test_nothing_sensitive_leaves_the_summary(self):
        shop_order = make_order(self.shop, total=123_457, phone="+2250707654321", customer_name="Zanzibar Quidam")
        ApiKey.objects.create(shop=self.shop, name="Clé secrète compta", key_id="zzzz1111", secret_hash="s" * 64)
        for user in (self.owner, self.manager, self.seller):
            self.authenticate(user)
            body = json.dumps(self.client.get(SUMMARY).json(), ensure_ascii=False)
            for forbidden in ("123457", "123 457", "123 457", "0707654321", "Zanzibar", "Clé secrète", "zzzz1111", "exemple.ci", str(shop_order.pk), str(self.owner.pk)):
                self.assertNotIn(forbidden, body)
        self.assertEqual(set(self.client.get(SUMMARY).json()), {"entries"})


class PermissionsMatrixTests(FrameTestCase):
    def rows(self, user):
        self.authenticate(user)
        response = self.client.get(PERMS)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_every_code_is_present_and_right(self):
        body = self.rows(self.owner)
        rows = {row["code"]: row for row in body["permissions"]}
        every = set(GRANTABLE).union(*ROLE_PERMISSIONS.values())
        self.assertEqual(set(rows), every)
        self.assertEqual(body["roles"], ["owner", "manager", "seller"])
        for code, row in rows.items():
            self.assertEqual(row["owner"], code in ROLE_PERMISSIONS["owner"])
            self.assertEqual(row["manager"], code in ROLE_PERMISSIONS["manager"])
            self.assertEqual(row["seller"], code in ROLE_PERMISSIONS["seller"])
            self.assertEqual(row["grantable"], code in GRANTABLE)
        self.assertTrue(rows["storefront.edit"]["grantable"] and not rows["storefront.edit"]["manager"])
        self.assertFalse(rows["shop.manage"]["grantable"])
        self.assertEqual([row["code"] for row in body["permissions"]][: len(PERMISSION_ORDER)], [c for c in PERMISSION_ORDER if c in every])

    def test_a_seller_can_read_it(self):
        body = self.rows(self.seller)
        self.assertEqual(body["you"], {"role": "seller"})
        yours = {row["code"] for row in body["permissions"] if row["yours"]}
        self.assertEqual(yours, set(effective_permissions(Membership.objects.get(user=self.seller))))

    def test_yours_counts_granted_rights(self):
        Membership.objects.filter(user=self.manager).update(grants=["storefront.edit"])
        rows = {row["code"]: row for row in self.rows(self.manager)["permissions"]}
        self.assertTrue(rows["storefront.edit"]["yours"])
        self.assertFalse(rows["shop.manage"]["yours"])

    def test_a_new_right_appears_without_other_changes_and_others_grants_stay_hidden(self):
        Membership.objects.filter(user=self.manager).update(grants=["team.presence"], discount_cap_percent=40)
        patched = {**ROLE_PERMISSIONS, "seller": ROLE_PERMISSIONS["seller"] | {"reports.view"}}
        with mock.patch("shops.permissions.ROLE_PERMISSIONS", patched):
            body = self.rows(self.seller)
        rows = {row["code"]: row for row in body["permissions"]}
        self.assertTrue(rows["reports.view"]["seller"])
        self.assertEqual(body["permissions"][-1]["code"], "reports.view")  # les codes inconnus finissent la liste
        dumped = json.dumps(body)
        self.assertNotIn("discount_cap", dumped)
        self.assertNotIn("40", [str(v) for row in body["permissions"] for v in row.values() if not isinstance(v, bool)])
        self.assertEqual(set(body), {"roles", "you", "permissions"})

    def test_every_code_has_a_label_in_the_front_when_the_file_exists(self):
        path = pathlib.Path(__file__).resolve().parents[3] / "frontend/src/features/settings/grants.ts"
        if not path.exists():
            self.skipTest("grants.ts absent")
        source = path.read_text()
        if "PERMISSION_TEXT" not in source:
            self.skipTest("PERMISSION_TEXT n'existe pas encore (étape front)")
        for code in set(GRANTABLE).union(*ROLE_PERMISSIONS.values()):
            self.assertIn(code, source)


class AnyMemberTests(FrameTestCase):
    def test_it_never_leaves_effective_permissions_nor_me_shops_even_when_injected(self):
        Membership.objects.filter(user=self.manager).update(grants=[ANY_MEMBER, "storefront.edit"])
        membership = Membership.objects.get(user=self.manager)
        self.assertNotIn(ANY_MEMBER, effective_permissions(membership))
        self.assertIn("storefront.edit", effective_permissions(membership))
        self.authenticate(self.manager)
        shops = self.client.get("/api/v1/me/shops").json()
        self.assertNotIn(ANY_MEMBER, json.dumps(shops))
        self.assertEqual(shops[0]["grants"], ["storefront.edit"])
        # Ni dans la liste de l'équipe vue par le propriétaire, ni dans la matrice.
        self.authenticate(self.owner)
        self.assertNotIn(ANY_MEMBER, self.client.get("/api/v1/shops/maison-adjoua/members").content.decode())
        self.assertNotIn(ANY_MEMBER, self.client.get(PERMS).content.decode())
        # Et il ne donne aucun accès : un gérant ainsi « accordé » reste refusé là où un droit manque.
        self.authenticate(self.manager)
        self.assertProblem(self.client.get("/api/v1/shops/maison-adjoua/plans"), 403, "permission_denied")

    def test_no_seller_or_stranger_reaches_a_guarded_route_with_it(self):
        Membership.objects.filter(user=self.seller).update(grants=[ANY_MEMBER])
        self.authenticate(self.seller)
        self.assertProblem(self.client.get("/api/v1/shops/maison-adjoua/dashboard"), 403, "permission_denied")

    def test_it_is_read_only(self):
        """Aucune méthode d'écriture (POST, PATCH, PUT, DELETE) d'aucune vue ne peut s'en servir."""
        found = []

        def walk(patterns):
            for pattern in patterns:
                if hasattr(pattern, "url_patterns"):
                    walk(pattern.url_patterns)
                    continue
                view_class = getattr(pattern.callback, "view_class", None)
                if view_class is None or not issubclass(view_class, ShopScopedView):
                    continue
                for method, required in view_class.permission_by_method.items():
                    if required == ANY_MEMBER:
                        found.append((view_class.__name__, method))

        walk(get_resolver().url_patterns)
        self.assertTrue(found)
        for name, method in found:
            self.assertEqual(method, "GET", f"{name} ouvre {method} à tout membre")


class PlanHistoryTests(FrameTestCase):
    def change(self, user, target):
        self.authenticate(user)
        reauth(self.client)
        return self.client.post("/api/v1/shops/maison-adjoua/plan", {"plan": target})

    def test_owner_reads_the_changes_newest_first_with_the_whitelist_only(self):
        self.assertEqual(self.change(self.owner, "business").status_code, 200)
        self.assertEqual(self.change(self.owner, "pro").status_code, 200)
        self.authenticate(self.owner)
        body = self.client.get(HISTORY).json()
        self.assertEqual([(r["previous_plan"], r["new_plan"]) for r in body["results"]], [("business", "pro"), ("pro", "business")])
        first = body["results"][0]
        self.assertEqual(set(first), {"id", "at", "previous_plan", "new_plan", "actor"})
        self.assertEqual(first["actor"], {"name": "Adjoua Konan", "is_you": True})
        self.assertNotIn("ip", json.dumps(body))

    def test_403_for_manager_and_seller_404_for_another_shop(self):
        for user in (self.manager, self.seller):
            self.authenticate(user)
            self.assertProblem(self.client.get(HISTORY), 403, "permission_denied")

    def test_only_this_shops_plan_changes_within_twelve_months_and_24_at_most(self):
        other = make_shop("autre", "Autre")
        other_owner = make_member("autre-owner@exemple.ci", other, "owner")
        self.change(self.owner, "business")
        self.authenticate(other_owner)
        reauth(self.client)
        self.client.post("/api/v1/shops/autre/plan", {"plan": "pro"})
        self.shop.save()
        from audit.services import record

        with mock.patch("audit.services.timezone.now", return_value=timezone.now() - timedelta(days=400)):
            record("plan_changed", None, actor=self.owner, shop=self.shop, previous_plan="free", new_plan="pro")
        for _ in range(30):
            record("plan_changed", None, actor=self.owner, shop=self.shop, previous_plan="pro", new_plan="business")
        self.authenticate(self.owner)
        results = self.client.get(HISTORY).json()["results"]
        self.assertEqual(len(results), 24)
        self.assertEqual(AuditEvent.objects.filter(action="plan_changed", shop_id=self.shop.pk).count(), 32)
        self.assertTrue(all(r["new_plan"] == "business" for r in results))

    def test_empty(self):
        self.authenticate(self.owner)
        self.assertEqual(self.client.get(HISTORY).json(), {"results": []})


class SectorTests(FrameTestCase):
    def patch(self, body, user=None):
        self.authenticate(user or self.owner)
        return self.client.patch(SETTINGS, body)

    def test_default_is_autre_and_all_eight_values_are_accepted(self):
        self.assertEqual(self.shop.sector, "autre")
        values = ["restaurant", "mode", "tech", "beaute", "epicerie", "maison", "artisanat", "autre"]
        for value in values:
            response = self.patch({"sector": value})
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()["sector"], value)
            self.shop.refresh_from_db()
            self.assertEqual(self.shop.sector, value)

    def test_unknown_or_free_text_is_refused(self):
        for bad in ("boulangerie", "<b>mode</b>", "", None, 3, "Restaurant"):
            self.assertProblem(self.patch({"sector": bad}), 400, "validation_error")
        self.shop.refresh_from_db()
        self.assertEqual(self.shop.sector, "autre")

    def test_a_manager_even_with_storefront_edit_is_refused(self):
        Membership.objects.filter(user=self.manager).update(grants=["storefront.edit"])
        self.assertProblem(self.patch({"sector": "mode"}, self.manager), 403, "permission_denied")
        self.assertProblem(self.patch({"sector": "mode"}, self.seller), 403, "permission_denied")

    def test_change_is_journaled_through_shop_updated(self):
        self.patch({"sector": "mode"})
        event = AuditEvent.objects.filter(action="shop_updated", shop_id=self.shop.pk).latest("id")
        self.assertEqual(event.metadata["fields"], ["sector"])
        self.assertNotIn("mode", json.dumps(event.metadata))

    def test_unchanged_sector_does_not_journal(self):
        self.patch({"sector": "autre"})
        self.assertFalse(AuditEvent.objects.filter(action="shop_updated").exists())

    def test_the_sector_is_not_public(self):
        self.shop.sector = "mode"
        self.shop.save()
        self.client.credentials()
        body = self.client.get("/api/v1/storefront/maison-adjoua").content.decode()
        self.assertNotIn("sector", body)
        self.assertNotIn("secteur", body)

    def test_settings_get_returns_it(self):
        self.authenticate(self.owner)
        self.assertEqual(self.client.get(SETTINGS).json()["sector"], "autre")

    def test_another_shop_is_untouched(self):
        other = make_shop("autre", "Autre")
        self.patch({"sector": "tech"})
        other.refresh_from_db()
        self.assertEqual(other.sector, "autre")
        self.assertEqual(Shop.objects.get(pk=self.shop.pk).sector, "tech")
