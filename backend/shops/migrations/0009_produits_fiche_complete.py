import uuid

import django.db.models.deletion
from django.db import migrations, models


def status_from_is_active(apps, schema_editor):
    """Deux UPDATE seulement (SQLite et PostgreSQL) : en vente → actif, masqué → brouillon (rien n'est perdu)."""
    Product = apps.get_model("shops", "Product")
    Product.objects.filter(legacy_is_active=True).update(status="active")
    Product.objects.filter(legacy_is_active=False).update(status="draft")


def is_active_from_status(apps, schema_editor):
    Product = apps.get_model("shops", "Product")
    Product.objects.filter(status="active").update(legacy_is_active=True)
    Product.objects.exclude(status="active").update(legacy_is_active=False)


class Migration(migrations.Migration):

    dependencies = [
        ("shops", "0008_versions_vitrine"),
    ]

    operations = [
        # L'ancienne colonne `is_active` reste en base, gelée : le code lit `status`. Une migration ultérieure la supprimera.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RenameField(model_name="product", old_name="is_active", new_name="legacy_is_active"),
                migrations.AlterField(
                    model_name="product",
                    name="legacy_is_active",
                    field=models.BooleanField(db_column="is_active", default=True),
                ),
            ],
            database_operations=[],
        ),
        migrations.AddField(
            model_name="product",
            name="status",
            field=models.CharField(
                choices=[("draft", "Brouillon"), ("active", "Actif"), ("archived", "Archivé")],
                default="active",
                max_length=10,
                verbose_name="statut",
            ),
        ),
        migrations.AddField(model_name="product", name="compare_at_price", field=models.PositiveIntegerField(blank=True, null=True, verbose_name="prix barré")),
        migrations.AddField(model_name="product", name="cost", field=models.PositiveIntegerField(blank=True, null=True, verbose_name="coût d'achat")),
        migrations.AddField(model_name="product", name="allow_backorder", field=models.BooleanField(default=False, verbose_name="précommande")),
        migrations.AddField(
            model_name="product",
            name="backorder_days",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="délai de précommande (jours)"),
        ),
        migrations.AddField(
            model_name="product",
            name="backorder_limit",
            field=models.PositiveIntegerField(default=20, verbose_name="plafond de précommandes"),
        ),
        migrations.AddField(
            model_name="product",
            name="condition",
            field=models.CharField(
                blank=True,
                choices=[("new", "Neuf"), ("refurbished", "Reconditionné"), ("used", "Occasion")],
                max_length=12,
                verbose_name="état",
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="warranty_months",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="garantie (mois)"),
        ),
        migrations.AddField(
            model_name="product",
            name="sold_by",
            field=models.CharField(
                choices=[("piece", "Pièce"), ("kg", "Kilo"), ("sachet", "Sachet"), ("tas", "Tas"), ("litre", "Litre")],
                default="piece",
                max_length=8,
                verbose_name="unité de vente",
            ),
        ),
        migrations.AddField(model_name="product", name="one_of_a_kind", field=models.BooleanField(default=False, verbose_name="pièce unique")),
        migrations.AddField(model_name="product", name="made_to_order", field=models.BooleanField(default=False, verbose_name="fabriqué sur commande")),
        migrations.AddField(model_name="product", name="bulky", field=models.BooleanField(default=False, verbose_name="gros colis")),
        migrations.RunPython(status_from_is_active, is_active_from_status),
        migrations.AddConstraint(
            model_name="product",
            constraint=models.CheckConstraint(
                condition=models.Q(("compare_at_price__isnull", True), ("compare_at_price__gt", models.F("price")), _connector="OR"),
                name="compare_at_above_price",
            ),
        ),
        migrations.AddIndex(model_name="product", index=models.Index(fields=["shop", "status"], name="product_shop_status")),
        migrations.CreateModel(
            name="ProductTag",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("label", models.CharField(max_length=30)),
                ("key", models.CharField(max_length=60)),
                ("product", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="tags", to="shops.product")),
                ("shop", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="product_tags", to="shops.shop")),
            ],
            options={"ordering": ["key"]},
        ),
        migrations.AddConstraint(model_name="producttag", constraint=models.UniqueConstraint(fields=("product", "key"), name="unique_product_tag")),
        migrations.AddIndex(model_name="producttag", index=models.Index(fields=["shop", "key"], name="tag_shop_key")),
    ]
