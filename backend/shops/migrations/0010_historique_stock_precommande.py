import uuid

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

BATCH = 500


def start_history(apps, schema_editor):
    """
    Les commandes existantes ont toutes été prélevées sur le stock. Chaque produit au stock > 0 reçoit un
    mouvement « initial » : l'historique commence ici, et stock == somme des delta à partir de là.
    """
    OrderItem = apps.get_model("shops", "OrderItem")
    Product = apps.get_model("shops", "Product")
    StockMovement = apps.get_model("shops", "StockMovement")
    OrderItem.objects.update(from_stock=models.F("quantity"))
    batch = []
    for product in Product.objects.filter(stock__gt=0).only("id", "shop_id", "stock").iterator(chunk_size=BATCH):
        batch.append(
            StockMovement(shop_id=product.shop_id, product_id=product.pk, delta=product.stock, stock_after=product.stock, reason="initial")
        )
        if len(batch) == BATCH:
            StockMovement.objects.bulk_create(batch)
            batch = []
    if batch:
        StockMovement.objects.bulk_create(batch)


class Migration(migrations.Migration):

    dependencies = [
        ("shops", "0009_produits_fiche_complete"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(model_name="orderitem", name="from_stock", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="orderitem", name="backorder_days", field=models.PositiveSmallIntegerField(default=0)),
        migrations.CreateModel(
            name="StockMovement",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("variant_id", models.UUIDField(blank=True, null=True)),
                ("delta", models.IntegerField()),
                ("stock_after", models.PositiveIntegerField()),
                (
                    "reason",
                    models.CharField(
                        choices=[
                            ("initial", "Stock de départ"),
                            ("received", "Réception"),
                            ("sold", "Vendu"),
                            ("cancelled", "Annulation"),
                            ("returned", "Retour client"),
                            ("damaged", "Casse ou perte"),
                            ("correction", "Correction"),
                            ("import", "Import"),
                        ],
                        max_length=12,
                    ),
                ),
                ("order_reference", models.CharField(blank=True, max_length=7)),
                ("actor_name", models.CharField(blank=True, max_length=160)),
                ("note", models.CharField(blank=True, max_length=200)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("order", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="stock_movements", to="shops.order")),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="movements", to="shops.product")),
                ("shop", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="stock_movements", to="shops.shop")),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.AddIndex(
            model_name="stockmovement",
            index=models.Index(fields=["shop", "product", "-created_at"], name="movement_product_date"),
        ),
        migrations.AddConstraint(
            model_name="stockmovement",
            constraint=models.CheckConstraint(condition=models.Q(("delta", 0), _negated=True), name="movement_delta_not_zero"),
        ),
        migrations.AddConstraint(
            model_name="stockmovement",
            constraint=models.UniqueConstraint(
                condition=models.Q(("reason__in", ["sold", "cancelled"])),
                fields=("order", "product", "reason"),
                name="unique_order_product_reason",
            ),
        ),
        migrations.RunPython(start_history, migrations.RunPython.noop),
    ]
