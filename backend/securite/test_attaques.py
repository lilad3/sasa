"""
Tests d'attaque ciblés : chaque test joue le rôle d'un attaquant et vérifie que le serveur résiste.

Huit familles, celles qu'un scanner automatique ne voit pas parce qu'elles dépendent des règles
d'Akwaba (qui a le droit de quoi, dans quelle boutique) :
  1. séparation des boutiques      5. panier et paiement
  2. droits par rôle               6. fichiers envoyés
  3. relais Vercel (BFF)           7. journal infalsifiable
  4. connexion et sessions         8. vitrine publique

Lancer :  python manage.py test securite -v 2
Une faille connue et pas encore corrigée est marquée @faille_connue : elle apparaît dans le
rapport sans bloquer les autres développements. Le jour où elle est corrigée, le test « réussit
par surprise » et échoue : il faut alors retirer la marque.
"""

import io
import time
import unittest
import uuid
from datetime import timedelta

import jwt
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.utils import timezone
from PIL import Image

from audit.models import AppendOnlyError, AuditEvent
from audit.services import record, verify_chain
from core.testing import (
    PASSWORD,
    ApiTestCase,
    enable_mfa,
    make_member,
    make_order,
    make_shop,
    totp,
    without_request_id,
    wrong_code,
)
from shops.models import REFERENCE_ALPHABET, Customer, Discount, Membership, Order, Product, Shop

A = "/api/v1/shops/boutique-a"
B = "/api/v1/shops/boutique-b"
VITRINE_A = "/api/v1/storefront/boutique-a"
TEL_AYA = "+2250707123456"
TEL_AUTRE = "+2250505987654"


def faille_connue(raison):
    """Faille repérée, pas encore corrigée : le test documente l'attaque qui passe aujourd'hui."""

    def marquer(test):
        test.faille_connue = raison
        return unittest.expectedFailure(test)

    return marquer


def jpeg(taille=(300, 300), couleur=(255, 122, 31)):
    out = io.BytesIO()
    Image.new("RGB", taille, couleur).save(out, format="JPEG")
    return out.getvalue()


class DeuxBoutiques(ApiTestCase):
    """Deux boutiques complètes, chacune avec son équipe, ses produits, ses clients et ses commandes."""

    def setUp(self):
        self.shop_a = make_shop("boutique-a", "Boutique A")
        self.shop_b = make_shop("boutique-b", "Boutique B")
        # Plan Pro : clés API et import ouverts, pour attaquer la logique et non la limite du plan.
        Shop.objects.filter(pk__in=[self.shop_a.pk, self.shop_b.pk]).update(plan="pro")
        self.owner_a = make_member("patron-a@example.ci", self.shop_a, "owner")
        self.manager_a = make_member("gerant-a@example.ci", self.shop_a, "manager")
        self.seller_a = make_member("vendeur-a@example.ci", self.shop_a, "seller")
        self.owner_b = make_member("patron-b@example.ci", self.shop_b, "owner")

        self.produit_a = Product.objects.create(shop=self.shop_a, sku="KAR", slug="karite", name="Karité", price=2500, stock=10)
        self.produit_b = Product.objects.create(shop=self.shop_b, sku="PAG", slug="pagne", name="Pagne", price=35000, stock=3)
        self.cache_a = Product.objects.create(shop=self.shop_a, sku="OLD", slug="ancien", name="Ancien", price=1000, stock=5, is_active=False)

        self.client_a = Customer.objects.create(shop=self.shop_a, phone=TEL_AYA, name="Aya Koné")
        self.client_b = Customer.objects.create(shop=self.shop_b, phone=TEL_AUTRE, name="Moussa Traoré")
        self.commande_a = make_order(self.shop_a, phone=TEL_AYA)
        self.commande_b = make_order(self.shop_b, phone=TEL_AUTRE)
        self.reduction_b = Discount.objects.create(
            shop=self.shop_b, customer=self.client_b, code="MOU-7K2Q", kind="percent", value=15,
            ends_on=timezone.localdate() + timedelta(days=30),
        )

    def en_tant_que(self, user, confirmer=True):
        """Ouvre une session ; confirmer=True refait le mot de passe, comme avant une action sensible."""
        self.authenticate(user)
        if confirmer:
            self.assertEqual(self.client.post("/api/v1/auth/reauth", {"password": PASSWORD}).status_code, 200)


# ---------------------------------------------------------------------------------------------
# 1. Séparation des boutiques : le patron de A tente d'atteindre les données de B.
# ---------------------------------------------------------------------------------------------
class Attaque1SeparationDesBoutiques(DeuxBoutiques):
    def test_produit_de_b_par_l_adresse_de_a(self):
        self.en_tant_que(self.owner_a)
        url = f"{A}/products/{self.produit_b.pk}"
        for methode, corps in (("get", None), ("patch", {"price": 1}), ("delete", None)):
            with self.subTest(methode=methode):
                reponse = getattr(self.client, methode)(url, corps) if corps else getattr(self.client, methode)(url)
                self.assertProblem(reponse, 404, "not_found")
        self.produit_b.refresh_from_db()
        self.assertEqual((self.produit_b.price, self.produit_b.shop_id), (35000, self.shop_b.pk))

    def test_ecrire_directement_dans_la_boutique_b(self):
        self.en_tant_que(self.owner_a)
        reponse = self.client.post(f"{B}/products", {"sku": "PIR", "name": "Piraté", "price": 1, "stock": 1})
        self.assertProblem(reponse, 404, "not_found")
        self.assertFalse(Product.objects.filter(sku="PIR").exists())

    def test_deplacer_son_produit_dans_la_boutique_b_par_le_corps(self):
        self.en_tant_que(self.owner_a)
        self.client.patch(f"{A}/products/{self.produit_a.pk}", {"shop": str(self.shop_b.pk), "shop_id": str(self.shop_b.pk)})
        self.produit_a.refresh_from_db()
        self.assertEqual(self.produit_a.shop_id, self.shop_a.pk)

    def test_client_de_b_par_l_adresse_de_a(self):
        self.en_tant_que(self.owner_a)
        self.assertProblem(self.client.get(f"{A}/customers/{self.client_b.public_id}"), 404, "not_found")
        reponse = self.client.post(f"{A}/customers/{self.client_b.public_id}/discounts", {"kind": "percent", "value": 50, "ends_on": str(timezone.localdate())})
        self.assertProblem(reponse, 404, "not_found")

    def test_annuler_une_reduction_de_b(self):
        self.en_tant_que(self.owner_a)
        self.assertProblem(self.client.delete(f"{A}/discounts/{self.reduction_b.pk}"), 404, "not_found")
        self.reduction_b.refresh_from_db()
        self.assertIsNone(self.reduction_b.revoked_at)

    def test_note_sur_une_commande_de_b(self):
        self.en_tant_que(self.owner_a)
        reponse = self.client.post(f"{A}/orders/{self.commande_b.pk}/notes", {"body": "piraté"})
        self.assertProblem(reponse, 404, "not_found")

    def test_photo_sur_un_produit_de_b(self):
        self.en_tant_que(self.owner_a)
        fichier = SimpleUploadedFile("p.jpg", jpeg(), content_type="image/jpeg")
        reponse = self.client.post(f"{A}/products/{self.produit_b.pk}/photos", {"photo": fichier}, format="multipart")
        self.assertProblem(reponse, 404, "not_found")

    def test_retirer_le_patron_de_b(self):
        self.en_tant_que(self.owner_a)
        url = f"{A}/members/{self.owner_b.pk}"
        self.assertProblem(self.client.patch(url, {"role": "seller"}), 404, "not_found")
        self.assertProblem(self.client.delete(url), 404, "not_found")
        self.assertTrue(Membership.objects.filter(user=self.owner_b, shop=self.shop_b, role="owner").exists())

    def test_revoquer_une_cle_api_de_b(self):
        self.en_tant_que(self.owner_b)
        cle = self.client.post(f"{B}/api-keys", {"name": "Caisse", "scopes": ["catalog:read"]}).json()
        self.en_tant_que(self.owner_a)
        self.assertProblem(self.client.delete(f"{A}/api-keys/{cle['id']}"), 404, "not_found")

    def test_une_boutique_etrangere_ressemble_a_une_boutique_inexistante(self):
        self.en_tant_que(self.owner_a)
        etrangere = self.client.get(f"{B}/customers")
        inexistante = self.client.get("/api/v1/shops/n-existe-pas/customers")
        self.assertEqual(without_request_id(etrangere), without_request_id(inexistante))


# ---------------------------------------------------------------------------------------------
# 2. Droits par rôle : un vendeur ou un gérant appelle l'API directement, sans passer par les boutons.
# ---------------------------------------------------------------------------------------------
class Attaque2DroitsParRole(DeuxBoutiques):
    INTERDIT_AU_VENDEUR = [
        ("get", f"{A}/orders/export"),
        ("get", f"{A}/customers"),
        ("get", f"{A}/customers/export"),
        ("post", f"{A}/products"),
        ("post", f"{A}/members"),
        ("post", f"{A}/plan"),
        ("post", f"{A}/api-keys"),
        ("patch", f"{A}/settings"),
        ("post", f"{A}/storefront/publish"),
        ("get", f"{A}/activity"),
        ("get", f"{A}/security-overview"),
        ("put", f"{A}/goal"),
    ]

    def test_le_vendeur_ne_passe_aucune_porte_interdite(self):
        self.en_tant_que(self.seller_a)
        for methode, url in self.INTERDIT_AU_VENDEUR:
            with self.subTest(methode=methode, url=url):
                self.assertProblem(getattr(self.client, methode)(url, {}), 403, "permission_denied")

    def test_le_vendeur_ne_cree_pas_de_produit_meme_avec_un_corps_valide(self):
        self.en_tant_que(self.seller_a)
        self.client.post(f"{A}/products", {"sku": "VND", "name": "Créé par le vendeur", "price": 100, "stock": 1})
        self.assertFalse(Product.objects.filter(sku="VND").exists())

    def test_le_vendeur_n_offre_pas_de_reduction(self):
        self.en_tant_que(self.seller_a)
        reponse = self.client.post(f"{A}/customers/{self.client_a.public_id}/discounts", {"kind": "percent", "value": 50, "ends_on": str(timezone.localdate())})
        self.assertProblem(reponse, 403, "permission_denied")
        self.assertFalse(Discount.objects.filter(shop=self.shop_a).exists())

    def test_le_gerant_sans_droit_supplementaire_ne_touche_ni_plan_ni_cles_ni_exports(self):
        self.en_tant_que(self.manager_a)
        for methode, url in [("post", f"{A}/plan"), ("post", f"{A}/api-keys"), ("get", f"{A}/customers/export"), ("patch", f"{A}/settings")]:
            with self.subTest(url=url):
                self.assertProblem(getattr(self.client, methode)(url, {}), 403, "permission_denied")

    def test_le_gerant_ne_se_donne_pas_de_droits(self):
        self.en_tant_que(self.manager_a)
        reponse = self.client.patch(f"{A}/members/{self.manager_a.pk}", {"grants": ["customers.export", "discounts.give"], "discount_cap_percent": 90})
        self.assertEqual(reponse.status_code, 403, reponse.content)
        self.assertEqual(Membership.objects.get(user=self.manager_a).grants or [], [])

    def test_le_gerant_ne_promeut_pas_un_vendeur(self):
        Membership.objects.filter(user=self.manager_a).update(grants=["team.manage_sellers"])
        self.en_tant_que(self.manager_a)
        reponse = self.client.patch(f"{A}/members/{self.seller_a.pk}", {"role": "manager"})
        self.assertEqual(reponse.status_code, 403, reponse.content)
        self.assertEqual(Membership.objects.get(user=self.seller_a).role, "seller")

    def test_le_gerant_charge_de_l_equipe_n_ajoute_pas_de_gerant(self):
        Membership.objects.filter(user=self.manager_a).update(grants=["team.manage_sellers"])
        self.en_tant_que(self.manager_a)
        reponse = self.client.post(f"{A}/members", {"email": "complice@example.ci", "first_name": "Com", "last_name": "Plice", "role": "manager"})
        self.assertProblem(reponse, 403, "permission_denied")
        self.assertFalse(Membership.objects.filter(user__email="complice@example.ci").exists())

    def test_le_gerant_charge_de_l_equipe_ne_retire_pas_le_patron(self):
        Membership.objects.filter(user=self.manager_a).update(grants=["team.manage_sellers"])
        self.en_tant_que(self.manager_a)
        self.assertEqual(self.client.delete(f"{A}/members/{self.owner_a.pk}").status_code, 403)
        self.assertTrue(Membership.objects.filter(user=self.owner_a, role="owner").exists())

    def test_le_gerant_ne_depasse_pas_son_plafond_de_remise(self):
        Membership.objects.filter(user=self.manager_a).update(grants=["discounts.give"], discount_cap_percent=10)
        self.en_tant_que(self.manager_a)
        url = f"{A}/customers/{self.client_a.public_id}/discounts"
        fin = str(timezone.localdate() + timedelta(days=5))
        self.assertProblem(self.client.post(url, {"kind": "percent", "value": 50, "ends_on": fin}), 403, "discount_cap_exceeded")
        self.assertProblem(self.client.post(url, {"kind": "amount", "value": 50000, "ends_on": fin}), 403, "discount_kind_forbidden")
        self.assertFalse(Discount.objects.filter(shop=self.shop_a).exists())

    def test_une_action_grave_exige_le_mot_de_passe_meme_pour_le_patron(self):
        self.en_tant_que(self.owner_a, confirmer=False)
        reponse = self.client.post(f"{A}/api-keys", {"name": "Caisse", "scopes": ["orders:read"]})
        self.assertEqual(reponse.status_code, 403, reponse.content)
        self.assertNotIn("secret", reponse.json())


# ---------------------------------------------------------------------------------------------
# 3. Relais Vercel : parler au serveur sans passer par le site.
# ---------------------------------------------------------------------------------------------
class Attaque3RelaisVercel(DeuxBoutiques):
    def test_sans_la_cle_du_relais(self):
        for valeur in ["", "faux", settings.BFF_SHARED_SECRET[:-1], settings.BFF_SHARED_SECRET + "x",
                       settings.BFF_SHARED_SECRET.upper(), f" {settings.BFF_SHARED_SECRET}"]:
            with self.subTest(valeur=valeur[:6] + "…"):
                self.assertProblem(self.client.get(VITRINE_A, HTTP_X_AKWABA_BFF=valeur), 403, "bff_required")

    def test_un_jeton_valide_ne_remplace_pas_la_cle_du_relais(self):
        self.en_tant_que(self.owner_a, confirmer=False)
        self.assertProblem(self.client.get(f"{A}/dashboard", HTTP_X_AKWABA_BFF="faux"), 403, "bff_required")

    def test_detours_par_l_adresse(self):
        for chemin in ["//api/v1/storefront/boutique-a", "/API/v1/storefront/boutique-a", "/api/V1/storefront/boutique-a",
                       "/api//v1/storefront/boutique-a"]:
            with self.subTest(chemin=chemin):
                reponse = self.client.get(chemin, HTTP_X_AKWABA_BFF="faux")
                self.assertNotEqual(reponse.status_code, 200)
                self.assertNotIn(b"Boutique A", reponse.content)

    def test_api_publique_sans_cle(self):
        reponse = self.client.get("/api/public/v1/products", HTTP_X_AKWABA_BFF="")
        self.assertEqual(reponse.status_code, 401)


# ---------------------------------------------------------------------------------------------
# 4. Connexion et sessions : jetons falsifiés, sessions fermées, mots de passe devinés, 2FA contournée.
# ---------------------------------------------------------------------------------------------
class Attaque4ConnexionEtSessions(DeuxBoutiques):
    def jeton_falsifie(self, cle, algorithme="HS256"):
        maintenant = int(time.time())
        claims = {"sub": str(self.owner_a.pk), "sid": str(uuid.uuid4()), "token_type": "access", "exp": maintenant + 300, "iat": maintenant, "jti": uuid.uuid4().hex}
        return jwt.encode(claims, cle, algorithm=algorithme)

    def test_jeton_signe_avec_une_autre_cle(self):
        self.client.bearer(self.jeton_falsifie("cle-de-l-attaquant"))
        self.assertEqual(self.client.get("/api/v1/me").status_code, 401)

    def test_jeton_sans_signature(self):
        jeton = jwt.encode({"sub": str(self.owner_a.pk), "token_type": "access", "exp": int(time.time()) + 300}, None, algorithm="none")
        self.client.bearer(jeton)
        self.assertEqual(self.client.get("/api/v1/me").status_code, 401)

    def test_jeton_bien_signe_mais_session_inventee(self):
        self.client.bearer(self.jeton_falsifie(settings.SIMPLE_JWT["SIGNING_KEY"]))
        self.assertEqual(self.client.get("/api/v1/me").status_code, 401)

    def test_jeton_d_une_session_fermee(self):
        jetons = self.authenticate(self.owner_a)
        self.assertEqual(self.client.get("/api/v1/me").status_code, 200)
        self.client.post("/api/v1/auth/logout", {"refresh": jetons["refresh"]})
        self.assertEqual(self.client.get("/api/v1/me").status_code, 401)

    def test_jeton_d_un_compte_desactive(self):
        self.authenticate(self.owner_a)
        self.owner_a.is_active = False
        self.owner_a.save(update_fields=["is_active"])
        self.assertEqual(self.client.get("/api/v1/me").status_code, 401)

    def test_deviner_le_mot_de_passe_bloque_le_compte(self):
        for _ in range(5):
            self.login("patron-a@example.ci", "mauvais-mot-de-passe")
        reponse = self.login("patron-a@example.ci")  # le bon mot de passe, trop tard
        self.assertProblem(reponse, 423, "account_locked")
        self.assertNotIn("access", reponse.json())

    def test_le_mot_de_passe_seul_n_ouvre_pas_un_compte_protege_par_2fa(self):
        enable_mfa(self.owner_a)
        corps = self.login("patron-a@example.ci").json()
        self.assertNotIn("access", corps)
        self.assertNotIn("refresh", corps)

    def test_trop_de_codes_2fa_faux_annulent_l_etape(self):
        secret, _ = enable_mfa(self.owner_a)
        jeton = self.login("patron-a@example.ci").json()["mfa_token"]
        for _ in range(3):
            self.client.post("/api/v1/auth/login/2fa", {"mfa_token": jeton, "code": wrong_code(secret)})
        reponse = self.client.post("/api/v1/auth/login/2fa", {"mfa_token": jeton, "code": totp(secret)})
        self.assertNotEqual(reponse.status_code, 200)
        self.assertNotIn(b'"access"', reponse.content)


# ---------------------------------------------------------------------------------------------
# 5. Panier et paiement : un client malin modifie la commande envoyée par son navigateur.
# ---------------------------------------------------------------------------------------------
class Attaque5PanierEtPaiement(DeuxBoutiques):
    def commande(self, **changements):
        corps = {
            "items": [{"product_id": str(self.produit_a.pk), "quantity": 2}],
            "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody"},
            "payment_method": "wave",
            "website": "",
        }
        corps.update(changements)
        return self.client.post(f"{VITRINE_A}/orders", corps, HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))

    def test_le_prix_envoye_par_le_navigateur_est_ignore(self):
        reponse = self.commande(
            items=[{"product_id": str(self.produit_a.pk), "quantity": 2, "price": 1, "unit_price": 1}], total=1, subtotal=1
        )
        self.assertEqual(reponse.status_code, 201, reponse.content)
        commande = Order.objects.get(reference=reponse.json()["reference"])
        self.assertEqual(commande.subtotal, 2 * 2500)

    def test_total_attendu_trop_bas(self):
        reponse = self.commande(expected_total=1)
        self.assertEqual(reponse.status_code, 409, reponse.content)
        self.assertEqual(Order.objects.filter(shop=self.shop_a).count(), 1)  # seulement celle du décor

    def test_quantites_absurdes(self):
        for quantite in [0, -3, 10**9, "2; DROP TABLE"]:
            with self.subTest(quantite=quantite):
                reponse = self.commande(items=[{"product_id": str(self.produit_a.pk), "quantity": quantite}])
                self.assertEqual(reponse.status_code, 400, reponse.content)
        self.produit_a.refresh_from_db()
        self.assertEqual(self.produit_a.stock, 10)

    def test_plus_que_le_stock(self):
        reponse = self.commande(items=[{"product_id": str(self.produit_a.pk), "quantity": 11}])
        self.assertEqual(reponse.status_code, 409, reponse.content)
        self.produit_a.refresh_from_db()
        self.assertEqual(self.produit_a.stock, 10)

    def test_meme_article_en_deux_lignes_pour_contourner_le_stock(self):
        ligne = {"product_id": str(self.produit_a.pk), "quantity": 6}
        self.assertEqual(self.commande(items=[ligne, ligne]).status_code, 400)
        self.produit_a.refresh_from_db()
        self.assertEqual(self.produit_a.stock, 10)

    def test_article_d_une_autre_boutique_ou_masque(self):
        for produit in (self.produit_b, self.cache_a):
            with self.subTest(produit=produit.slug):
                reponse = self.commande(items=[{"product_id": str(produit.pk), "quantity": 1}])
                self.assertEqual(reponse.status_code, 400, reponse.content)

    def test_reduction_d_une_autre_boutique(self):
        self.assertNotEqual(self.commande(discount_code="MOU-7K2Q").status_code, 201)

    def test_reduction_d_un_autre_client(self):
        Discount.objects.create(shop=self.shop_a, customer=self.client_a, code="AYA-7K2Q", kind="percent", value=50,
                                ends_on=timezone.localdate() + timedelta(days=5))
        autre = {"name": "Inconnu", "phone": "01 01 01 01 01", "city": "Abidjan", "commune": "Cocody"}
        self.assertNotEqual(self.commande(discount_code="AYA-7K2Q", customer=autre).status_code, 201)

    def test_reduction_utilisee_deux_fois(self):
        Discount.objects.create(shop=self.shop_a, customer=self.client_a, code="AYA-7K2Q", kind="percent", value=50,
                                ends_on=timezone.localdate() + timedelta(days=5), max_uses=1)
        self.assertEqual(self.commande(discount_code="AYA-7K2Q").status_code, 201)
        self.assertNotEqual(self.commande(discount_code="AYA-7K2Q").status_code, 201)

    def test_une_remise_ne_rend_jamais_le_total_negatif(self):
        Discount.objects.create(shop=self.shop_a, customer=self.client_a, code="AYA-7K2Q", kind="amount", value=1_000_000,
                                ends_on=timezone.localdate() + timedelta(days=5))
        reponse = self.commande(discount_code="AYA-7K2Q")
        self.assertEqual(reponse.status_code, 201, reponse.content)
        commande = Order.objects.get(reference=reponse.json()["reference"])
        # La remise couvre au plus les articles : il reste la livraison (1 500 F à Cocody), jamais moins.
        self.assertEqual((commande.discount_amount, commande.total), (2 * 2500, 1500))

    def test_un_robot_qui_remplit_le_champ_piege_ne_cree_rien(self):
        avant = Order.objects.count()
        self.commande(website="https://spam.example")
        self.assertEqual(Order.objects.count(), avant)


# ---------------------------------------------------------------------------------------------
# 6. Fichiers envoyés : des « photos » et des CSV piégés.
# ---------------------------------------------------------------------------------------------
class Attaque6FichiersEnvoyes(DeuxBoutiques):
    def envoyer_photo(self, nom, contenu, type_mime="image/jpeg"):
        self.en_tant_que(self.owner_a, confirmer=False)
        fichier = SimpleUploadedFile(nom, contenu, content_type=type_mime)
        return self.client.post(f"{A}/products/{self.produit_a.pk}/photos", {"photo": fichier}, format="multipart")

    def test_page_html_deguisee_en_photo(self):
        reponse = self.envoyer_photo("photo.jpg", b"<html><script>alert(document.cookie)</script></html>")
        self.assertIn(reponse.status_code, (400, 415), reponse.content)

    def test_svg_avec_script(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        reponse = self.envoyer_photo("photo.svg", svg, "image/svg+xml")
        self.assertIn(reponse.status_code, (400, 415), reponse.content)

    def test_fichier_hybride_gif_et_script(self):
        hybride = b"GIF89a/*" + b"\x00" * 10 + b"*/=alert(1);<script>alert(1)</script>"
        reponse = self.envoyer_photo("photo.gif", hybride, "image/gif")
        self.assertIn(reponse.status_code, (400, 415), reponse.content)

    def test_photo_geante_en_poids(self):
        reponse = self.envoyer_photo("lourde.jpg", b"\xff\xd8\xff" + b"0" * (3 * 1024 * 1024))
        self.assertIn(reponse.status_code, (400, 413), reponse.content)

    def test_bombe_de_decompression(self):
        bombe = io.BytesIO()
        Image.new("1", (20000, 20000)).save(bombe, format="PNG")
        reponse = self.envoyer_photo("bombe.png", bombe.getvalue(), "image/png")
        self.assertIn(reponse.status_code, (400, 413, 415), reponse.content)

    def test_une_vraie_photo_est_reencodee(self):
        reponse = self.envoyer_photo("vraie.jpg", jpeg())
        self.assertEqual(reponse.status_code, 201, reponse.content)

    def test_logo_svg_refuse(self):
        self.en_tant_que(self.owner_a, confirmer=False)
        svg = SimpleUploadedFile("logo.svg", b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', content_type="image/svg+xml")
        reponse = self.client.post(f"{A}/logo", {"logo": svg}, format="multipart")
        self.assertIn(reponse.status_code, (400, 415), reponse.content)

    def importer(self, nom, contenu, type_mime="text/csv"):
        self.en_tant_que(self.owner_a, confirmer=False)
        fichier = SimpleUploadedFile(nom, contenu, content_type=type_mime)
        return self.client.post(f"{A}/products/import", {"file": fichier}, format="multipart")

    def test_import_csv_trop_lourd(self):
        self.assertEqual(self.importer("gros.csv", b"sku;nom;prix\n" + b"A;B;1\n" * 120_000).status_code, 413)

    def test_import_d_un_fichier_qui_n_est_pas_un_csv(self):
        self.assertEqual(self.importer("catalogue.csv", b"PK\x03\x04" + b"\x00" * 200, "application/zip").status_code, 415)

    def test_formule_excel_dans_un_nom_de_client_est_neutralisee_a_l_export(self):
        Customer.objects.filter(pk=self.client_a.pk).update(name="=HYPERLINK(\"http://pirate.example\";\"Cliquez\")")
        self.en_tant_que(self.owner_a)
        export = self.client.get(f"{A}/customers/export")
        self.assertEqual(export.status_code, 200, export.content)
        contenu = b"".join(export.streaming_content) if hasattr(export, "streaming_content") else export.content
        self.assertNotIn(b";=HYPERLINK", contenu)
        self.assertNotIn(b"\n=HYPERLINK", contenu)


# ---------------------------------------------------------------------------------------------
# 7. Journal infalsifiable : effacer ses traces.
# ---------------------------------------------------------------------------------------------
class Attaque7JournalInfalsifiable(ApiTestCase):
    def setUp(self):
        self.evenements = [record(action, email=f"{action}@example.ci") for action in ("login_failed", "login_failed", "account_locked")]

    def test_modifier_ou_supprimer_par_l_application(self):
        evenement = self.evenements[-1]
        evenement.actor_email = "innocent@example.ci"
        with self.assertRaises(AppendOnlyError):
            evenement.save()
        with self.assertRaises(AppendOnlyError):
            AuditEvent.objects.all().delete()

    def test_modifier_une_ligne_dans_le_fichier_est_detecte(self):
        with connection.cursor() as curseur:
            curseur.execute("DROP TRIGGER audit_auditevent_no_update")
            curseur.execute("UPDATE audit_auditevent SET actor_email = 'innocent@example.ci' WHERE id = %s", [self.evenements[0].pk])
        self.assertFalse(verify_chain().ok)

    @faille_connue(
        "Supprimer les DERNIÈRES lignes du journal directement dans le fichier de la base n'est pas détecté : "
        "la chaîne restante reste cohérente. Correction : garder hors de la base la dernière empreinte et le nombre "
        "de lignes (par exemple dans le résumé quotidien), et les comparer à la vérification."
    )
    def test_supprimer_les_dernieres_lignes_dans_le_fichier_est_detecte(self):
        with connection.cursor() as curseur:
            curseur.execute("DROP TRIGGER audit_auditevent_no_delete")
            curseur.execute("DELETE FROM audit_auditevent WHERE id = %s", [self.evenements[-1].pk])
        self.assertFalse(verify_chain().ok)


# ---------------------------------------------------------------------------------------------
# 8. Vitrine publique : ce que n'importe quel visiteur peut lire.
# ---------------------------------------------------------------------------------------------
class Attaque8VitrinePublique(DeuxBoutiques):
    SECRETS_PRODUIT = {"stock", "sku", "low_stock_threshold", "is_demo", "shop", "shop_id", "created_at", "updated_at"}
    SECRETS_BOUTIQUE = {"email", "owner", "members", "plan", "api_keys", "phone", "customers", "orders", "revenue"}

    def test_les_produits_publics_ne_revelent_rien_d_interne(self):
        for produit in self.client.get(f"{VITRINE_A}/products").json():
            self.assertFalse(self.SECRETS_PRODUIT & set(produit), produit)

    def test_la_fiche_boutique_ne_revele_rien_d_interne(self):
        self.assertFalse(self.SECRETS_BOUTIQUE & set(self.client.get(VITRINE_A).json()))

    def test_un_produit_masque_reste_invisible(self):
        self.assertProblem(self.client.get(f"{VITRINE_A}/products/ancien"), 404, "not_found")

    def test_suivi_de_commande_avec_de_mauvais_chiffres(self):
        reference = self.commande_a.reference
        # Une référence au bon format, mais qui n'existe pas : seul le dernier caractère change.
        autre = reference[:-1] + next(c for c in REFERENCE_ALPHABET if c != reference[-1])
        mauvais = self.client.post(f"{VITRINE_A}/track", {"reference": reference, "phone_last4": "0000"})
        inconnue = self.client.post(f"{VITRINE_A}/track", {"reference": autre, "phone_last4": "0000"})
        self.assertEqual(without_request_id(mauvais), without_request_id(inconnue))
        self.assertNotIn(self.commande_a.customer_name.encode(), mauvais.content)

    def test_deviner_les_4_chiffres_est_freine(self):
        reference = self.commande_a.reference
        codes = [f"{n:04d}" for n in range(10) if f"{n:04d}" != TEL_AYA[-4:]]
        for code in codes[:5]:
            self.client.post(f"{VITRINE_A}/track", {"reference": reference, "phone_last4": code})
        bon = self.client.post(f"{VITRINE_A}/track", {"reference": reference, "phone_last4": TEL_AYA[-4:]})
        self.assertEqual(bon.status_code, 429, bon.content)

    def test_le_suivi_ne_donne_pas_le_telephone_complet(self):
        reponse = self.client.post(f"{VITRINE_A}/track", {"reference": self.commande_a.reference, "phone_last4": TEL_AYA[-4:]})
        self.assertEqual(reponse.status_code, 200, reponse.content)
        self.assertNotIn(TEL_AYA[4:].encode(), reponse.content)

    def test_verifier_un_code_ne_dit_pas_s_il_existe_pour_quelqu_un_d_autre(self):
        Discount.objects.create(shop=self.shop_a, customer=self.client_a, code="AYA-7K2Q", kind="percent", value=50,
                                ends_on=timezone.localdate() + timedelta(days=5))
        items = [{"product_id": str(self.produit_a.pk), "quantity": 1}]
        existe = self.client.post(f"{VITRINE_A}/discounts/check", {"code": "AYA-7K2Q", "phone": "0101010101", "items": items}, format="json")
        inexistant = self.client.post(f"{VITRINE_A}/discounts/check", {"code": "ZZZ-9999", "phone": "0101010101", "items": items}, format="json")
        self.assertEqual(without_request_id(existe), without_request_id(inexistant))

    @faille_connue(
        "La photo d'un produit masqué reste accessible à qui connaît son adresse (identifiant aléatoire, "
        "donc difficile à deviner). Correction : vérifier que le produit est en vente avant de servir la photo."
    )
    def test_la_photo_d_un_produit_masque_n_est_plus_servie(self):
        self.en_tant_que(self.owner_a, confirmer=False)
        fichier = SimpleUploadedFile("p.jpg", jpeg(), content_type="image/jpeg")
        photo = self.client.post(f"{A}/products/{self.produit_a.pk}/photos", {"photo": fichier}, format="multipart").json()
        Product.objects.filter(pk=self.produit_a.pk).update(is_active=False)
        self.client.credentials()
        self.assertEqual(self.client.get(f"{VITRINE_A}/photos/{photo['id']}", HTTP_X_AKWABA_BFF=settings.BFF_SHARED_SECRET).status_code, 404)

    def test_une_cle_catalogue_ne_lit_pas_les_commandes(self):
        self.en_tant_que(self.owner_a)
        cle = self.client.post(f"{A}/api-keys", {"name": "Site", "scopes": ["catalog:read"]}).json()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {cle['key']}")
        self.assertEqual(self.client.get("/api/public/v1/orders").status_code, 403)

    def test_une_cle_revoquee_ne_marche_plus(self):
        self.en_tant_que(self.owner_a)
        cle = self.client.post(f"{A}/api-keys", {"name": "Site", "scopes": ["catalog:read"]}).json()
        self.client.delete(f"{A}/api-keys/{cle['id']}")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {cle['key']}")
        self.assertEqual(self.client.get("/api/public/v1/products").status_code, 401)
