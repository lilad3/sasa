from django.db import migrations

# Défense au niveau de la base : même une requête SQL brute (bug, injection, script mal écrit)
# ne peut ni modifier ni supprimer une ligne du journal. Triggers propres à SQLite ; sur PostgreSQL,
# c'est la migration 0010 qui s'en charge (cette syntaxe n'y existe pas).
TRIGGERS = [
    (
        "audit_auditevent_no_update",
        "CREATE TRIGGER audit_auditevent_no_update BEFORE UPDATE ON audit_auditevent "
        "BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;",
    ),
    (
        "audit_auditevent_no_delete",
        "CREATE TRIGGER audit_auditevent_no_delete BEFORE DELETE ON audit_auditevent "
        "BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;",
    ),
]


def create_triggers(apps, schema_editor):
    if schema_editor.connection.vendor != "sqlite":
        return
    for _, create in TRIGGERS:
        schema_editor.execute(create)


def drop_triggers(apps, schema_editor):
    if schema_editor.connection.vendor != "sqlite":
        return
    for name, _ in TRIGGERS:
        schema_editor.execute(f"DROP TRIGGER IF EXISTS {name};")


class Migration(migrations.Migration):
    dependencies = [("audit", "0001_initial")]

    operations = [migrations.RunPython(create_triggers, drop_triggers)]
