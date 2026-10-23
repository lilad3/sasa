"""
Verrous de ligne pour PostgreSQL (contrat A2 fondations §5.2).

Sur SQLite, `transaction_mode: IMMEDIATE` fait déjà passer toutes les écritures l'une après l'autre, et
`select_for_update` n'y fait rien. Sur PostgreSQL (READ COMMITTED), chaque endroit qui lit puis écrit prend son verrou.
`no_key` : FOR NO KEY UPDATE, qui ne bloque pas les insertions qui pointent vers la ligne (commande, produit…).
À appeler dans un `transaction.atomic()`.
"""

from .models import Product, Shop


def lock_shop(shop):
    """Les écritures d'une même boutique (commandes, limites du plan) passent l'une après l'autre ; les autres boutiques non."""
    return Shop.objects.select_for_update(no_key=True).get(pk=shop.pk)


def lock_product(product):
    return Product.objects.select_for_update(no_key=True).get(pk=product.pk)
