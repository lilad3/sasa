"""
Sujets et corps des e-mails, en texte et en HTML (contrat §6). Aucun accès réseau, aucune requête :
tout arrive déjà lu. Jamais de téléphone, de nom, d'adresse ni de note de client dans un message.
"""

import re
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

SUBJECT_MAX = 150
NBSP = " "
MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
LAST_REFS = 3

REASONS = {
    "new_order": "Nouvelle commande",
    "low_stock": "Stock bas",
    "order_cancelled": "Commande annulée",
    "daily_summary": "Résumé du jour",
}


def clean(value):
    """Du texte sur une seule ligne : un retour à la ligne dans un sujet permettrait d'injecter un en-tête."""
    return re.sub(r"[\x00-\x1f\x7f  ]+", " ", str(value)).strip()


def fcfa(amount):
    return f"{amount:,}".replace(",", NBSP) + f"{NBSP}F"


def clock(moment):
    local = timezone.localtime(moment)
    return f"{local.hour} h {local.minute:02d}"


def plural(count, one, many):
    return one if count == 1 else many


def _links(shop):
    base = f"{settings.FRONTEND_URL}/app/{shop.slug}"
    return {
        "orders": f"{base}/commandes",
        "order": lambda order_id: f"{base}/commandes/{order_id}",
        "catalog": f"{base}/produits",
        "dashboard": base,
        "manage": f"{base}/parametres/notifications",
    }


def _build(recipient, shop, event, subject, intro, lines, button_label, button_url):
    user = recipient.user
    greeting = f"Bonjour {clean(user.first_name)}," if clean(user.first_name) else "Bonjour,"
    context = {
        "greeting": greeting,
        "intro": intro,
        "lines": lines,
        "button_label": button_label,
        "button_url": button_url,
        "manage_url": _links(shop)["manage"],
        "reason": f"Vous recevez ce message parce que « {REASONS[event]} » est activé pour vous dans {clean(shop.name)}.",
    }
    text = render_to_string("notifications/email.txt", context)
    html = render_to_string("notifications/email.html", context)
    message = EmailMultiAlternatives(clean(subject)[:SUBJECT_MAX], text, None, [user.email])
    message.attach_alternative(html, "text/html")
    return message


def _who(recipient, shop, own, other):
    """Le propriétaire lit « votre boutique », les autres le nom de la boutique."""
    return own if recipient.is_owner else other.format(shop=clean(shop.name))


def orders_message(recipient, shop, event, *, order, count, refs, since):
    """
    Une commande (`count` = 1, avec `order`) ou plusieurs (rafale retenue). `event` : new_order ou order_cancelled.
    `refs` : références des commandes retenues, la plus récente en dernier.
    """
    links = _links(shop)
    name = clean(shop.name)
    if event == "new_order" and count == 1 and order is not None:
        detail = " · ".join(
            part
            for part in (
                order.reference,
                f"{order.articles} {plural(order.articles, 'article', 'articles')}",
                fcfa(order.total),
                order.get_payment_method_display(),
                order.customer_commune or order.customer_city,
            )
            if part
        )
        return _build(
            recipient, shop, event,
            f"Nouvelle commande {order.reference} · {name}",
            _who(recipient, shop, "Vous avez reçu une nouvelle commande.", "{shop} a reçu une nouvelle commande."),
            [detail], "Ouvrir la commande", links["order"](order.pk),
        )
    if event == "order_cancelled" and count == 1 and order is not None:
        return _build(
            recipient, shop, event,
            f"Commande {order.reference} annulée · {name}",
            f"La commande {order.reference} ({fcfa(order.total)}) a été annulée. Elle était « {order.previous_label} ».",
            [], "Ouvrir la commande", links["order"](order.pk),
        )
    last = ", ".join(refs[-LAST_REFS:][::-1])
    if event == "new_order":
        many = f"{count} {plural(count, 'nouvelle commande', 'nouvelles commandes')}"
        title = f"{many} · {name}"
        intro = _who(
            recipient, shop,
            f"Vous avez reçu {many} depuis {clock(since)}.",
            f"{{shop}} a reçu {many} depuis {clock(since)}.",
        )
    else:
        title = f"{count} {plural(count, 'commande annulée', 'commandes annulées')} · {name}"
        intro = f"{count} {plural(count, 'commande a été annulée', 'commandes ont été annulées')} depuis {clock(since)}."
    return _build(
        recipient, shop, event, title, intro, [f"Les dernières : {last}"] if last else [], "Voir les commandes", links["orders"]
    )


def low_stock_message(recipient, shop, products):
    """`products` : [(nom, stock, seuil)], relus à l'envoi."""
    name = clean(shop.name)
    lines = [
        f"{clean(product)} : épuisé" if stock == 0 else f"{clean(product)} : {stock} {plural(stock, 'restant', 'restants')} (seuil {threshold})"
        for product, stock, threshold in products
    ]
    subject = f"Stock bas · {clean(products[0][0])}" if len(products) == 1 else f"Stock bas · {name}"
    intro = _who(
        recipient, shop,
        plural(len(products), "Un produit de votre boutique passe sous son seuil d'alerte :", f"{len(products)} produits de votre boutique passent sous leur seuil d'alerte :"),
        plural(len(products), "Un produit de {shop} passe sous son seuil d'alerte :", f"{len(products)} produits de {{shop}} passent sous leur seuil d'alerte :"),
    )
    return _build(recipient, shop, "low_stock", subject, intro, lines, "Voir le catalogue", _links(shop)["catalog"])


def summary_message(recipient, shop, day, figures):
    """`figures` : received, cancelled, to_process, delivered, low_stock, revenue (le CA seulement avec dashboard.view)."""
    links = _links(shop)
    lines = [
        f"Commandes reçues : {figures['received']}"
        + (f" (dont {figures['cancelled']} {plural(figures['cancelled'], 'annulée', 'annulées')})" if figures["cancelled"] else ""),
        f"À traiter : {figures['to_process']}",
        f"Livrées aujourd'hui : {figures['delivered']}",
    ]
    if "products.view" in recipient.permissions:
        lines.append(f"Produits bientôt en rupture : {figures['low_stock']}")
    can_see_revenue = "dashboard.view" in recipient.permissions
    if can_see_revenue:
        lines.append(f"Chiffre d'affaires du jour : {fcfa(figures['revenue'])}")
    return _build(
        recipient, shop, "daily_summary",
        f"Résumé du jour · {clean(shop.name)} · {day.day} {MONTHS[day.month - 1]}",
        _who(recipient, shop, "Voici votre journée.", "Voici la journée de {shop}."),
        lines,
        "Ouvrir le tableau de bord" if can_see_revenue else "Voir les commandes",
        links["dashboard"] if can_see_revenue else links["orders"],
    )


def test_message(recipient, shop):
    """L'e-mail de test : rien de la boutique, seulement de quoi vérifier la configuration."""
    user = recipient.user
    base = settings.FRONTEND_URL
    greeting = f"Bonjour {clean(user.first_name)}," if clean(user.first_name) else "Bonjour,"
    context = {
        "greeting": greeting,
        "intro": "Ceci est un e-mail de test : si vous le lisez, les notifications Akwaba arrivent bien jusqu'à vous.",
        "lines": [],
        "button_label": "Gérer mes notifications",
        "button_url": f"{base}/app/{shop.slug}/parametres/notifications",
        "manage_url": f"{base}/app/{shop.slug}/parametres/notifications",
        "reason": "Vous recevez ce message parce que vous avez demandé un e-mail de test.",
    }
    message = EmailMultiAlternatives("E-mail de test Akwaba", render_to_string("notifications/email.txt", context), None, [user.email])
    message.attach_alternative(render_to_string("notifications/email.html", context), "text/html")
    return message


# Le lanceur de tests ne doit pas prendre cette fonction pour un test.
test_message.__test__ = False
