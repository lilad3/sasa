"""
Copie une base SQLite vers PostgreSQL (contrat A2 fondations §5.6).

`dumpdata`/`loaddata` est exclu : le JSON de Django coupe les dates à la milliseconde, or `created_at` entre dans
l'empreinte HMAC du journal. Ici, les lignes passent d'une base à l'autre telles quelles (clés primaires, dates, images).
"""

from collections import defaultdict
from pathlib import Path

from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.core.management.color import no_style
from django.db import connection, connections, models, transaction

from audit.services import verify_chain
from core import backup

SOURCE = "source_sqlite"
APP_LABELS = ("accounts", "audit", "shops", "core")
BATCH = 500
MAX_PROBLEMS = 20
# Régénérées par `migrate` sur la cible ; une liaison vers elles demanderait de traduire des identifiants.
REGENERATED = {("auth", "permission"), ("auth", "group"), ("contenttypes", "contenttype")}


class Command(BaseCommand):
    help = "Copie la base SQLite vers PostgreSQL (cible : DATABASE_URL, déjà migrée et vide). Voir docs/exploitation.md."

    def add_arguments(self, parser):
        parser.add_argument("--source", required=True, help="Chemin du fichier SQLite à copier (ouvert en lecture seule)")
        parser.add_argument("--check-only", action="store_true", help="Contrôle les données sans rien écrire")

    def handle(self, *args, source, check_only, **options):
        path = Path(source).resolve()
        if not path.is_file():
            raise CommandError(f"{source} est introuvable.")
        if connection.vendor != "postgresql":
            raise CommandError("La cible doit être PostgreSQL : définissez DATABASE_URL.")
        try:
            self._declare_source(path)
            models_in_order = self._models()
            self._ensure_target_ready(models_in_order)
            problems = self._check(models_in_order)
            if problems:
                for problem in problems:
                    self.stderr.write(problem)
                raise CommandError("Des lignes ne passeraient pas sur PostgreSQL : rien n'a été écrit.")
            self.stdout.write("Contrôle des longueurs et des caractères NUL : OK.")
            if check_only:
                return
            self._copy(models_in_order)
        finally:
            backup.drop_alias(SOURCE)

    def _declare_source(self, path):
        backup.temporary_alias(
            SOURCE, {"ENGINE": "django.db.backends.sqlite3", "NAME": f"file:{path}?mode=ro", "OPTIONS": {"uri": True}}
        )

    # --- Quoi copier, dans quel ordre ---------------------------------------------------------------------------

    def _models(self):
        found = []
        for label in APP_LABELS:
            found += [m for m in apps.get_app_config(label).get_models(include_auto_created=True) if not m._meta.proxy]
        # Ordre des dépendances : un modèle passe après ceux vers lesquels il pointe.
        index = {m: i for i, m in enumerate(found)}
        needs = defaultdict(set)
        for model in found:
            for field in model._meta.concrete_fields:
                target = field.remote_field.model if field.is_relation else None
                if target in index and target is not model:
                    needs[model].add(target)
        ordered, done = [], set()
        while len(ordered) < len(found):
            ready = [m for m in found if m not in done and needs[m] <= done]
            if not ready:
                raise CommandError("Dépendances circulaires entre les modèles : copie impossible.")
            ordered += ready
            done.update(ready)
        return ordered

    def _ensure_target_ready(self, ordered):
        for model in ordered:
            if model.objects.using("default").exists():
                raise CommandError(f"La cible n'est pas vide ({model._meta.db_table}) : copie refusée.")
        for model in self._skipped():
            if model.objects.using(SOURCE).exists():
                raise CommandError(
                    f"La source contient des lignes dans {model._meta.db_table}, que cette commande ne sait pas traduire."
                )

    def _skipped(self):
        """Les liaisons du compte vers groupes et permissions : régénérées sur la cible, donc à refuser si utilisées."""
        found = []
        for model in apps.get_app_config("accounts").get_models(include_auto_created=True):
            if model._meta.auto_created and any(
                (f.related_model._meta.app_label, f.related_model._meta.model_name) in REGENERATED
                for f in model._meta.concrete_fields
                if f.is_relation
            ):
                found.append(model)
        return found

    # --- Contrôles avant d'écrire -------------------------------------------------------------------------------

    def _check(self, ordered):
        problems = []
        for model in ordered:
            if model in self._skipped():
                continue
            checks = [
                f for f in model._meta.concrete_fields if isinstance(f, (models.CharField, models.TextField, models.JSONField))
            ]
            if not checks:
                continue
            for row in model.objects.using(SOURCE).only(*[f.name for f in checks], model._meta.pk.name).iterator(chunk_size=BATCH):
                for field in checks:
                    value = getattr(row, field.attname)
                    if value is None:
                        continue
                    text = value if isinstance(value, str) else repr(value)
                    where = f"{model._meta.db_table} {row.pk} champ {field.name}"
                    if isinstance(field, models.CharField) and field.max_length and isinstance(value, str) and len(value) > field.max_length:
                        problems.append(f"Trop long ({len(value)} > {field.max_length}) : {where}")
                    elif "\x00" in text or "\\x00" in text or "\\u0000" in text:
                        problems.append(f"Caractère NUL : {where}")
                    if len(problems) >= MAX_PROBLEMS:
                        return problems + ["… (liste tronquée)"]
        return problems

    # --- Copie --------------------------------------------------------------------------------------------------

    def _copy(self, ordered):
        skipped = set(self._skipped())
        copied = {}
        with transaction.atomic(using="default"):
            for model in ordered:
                if model in skipped:
                    continue
                copied[model] = self._copy_model(model)
            self._reset_sequences(list(copied))
            self.stdout.write("Lignes par table (source → cible) :")
            for model, rows in copied.items():
                target = model.objects.using("default").count()
                self.stdout.write(f"  {model._meta.db_table}: {rows} → {target}")
                if target != rows:
                    raise CommandError(f"Écart de lignes dans {model._meta.db_table} ({rows} → {target}) : copie annulée.")
            report = verify_chain()
            if not report.ok:
                raise CommandError(f"Chaîne du journal rompue sur la cible (événement {report.broken_id}) : copie annulée.")
            self.stdout.write(f"Chaîne du journal : OK ({report.checked} événements vérifiés).")
        self.stdout.write("Copie terminée.")

    def _copy_model(self, model):
        # auto_now / auto_now_add réécriraient les dates à l'insertion : on les suspend le temps de la copie.
        stamped = [f for f in model._meta.concrete_fields if getattr(f, "auto_now", False) or getattr(f, "auto_now_add", False)]
        flags = [(f.auto_now, f.auto_now_add) for f in stamped]
        for field in stamped:
            field.auto_now = field.auto_now_add = False
        total, batch = 0, []
        try:
            for row in model._base_manager.using(SOURCE).order_by("pk").iterator(chunk_size=BATCH):
                batch.append(row)
                if len(batch) == BATCH:
                    model._base_manager.using("default").bulk_create(batch)
                    total += len(batch)
                    batch = []
            if batch:
                model._base_manager.using("default").bulk_create(batch)
                total += len(batch)
        finally:
            for field, (auto_now, auto_now_add) in zip(stamped, flags):
                field.auto_now, field.auto_now_add = auto_now, auto_now_add
        return total

    def _reset_sequences(self, copied):
        statements = connection.ops.sequence_reset_sql(no_style(), copied)
        with connection.cursor() as cursor:
            for sql in statements:
                cursor.execute(sql)
