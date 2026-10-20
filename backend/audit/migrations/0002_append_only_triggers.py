from django.db import migrations

# Défense au niveau de la base : même une requête SQL brute (bug, injection, script mal écrit)
# ne peut ni modifier ni supprimer une ligne du journal. Triggers propres à SQLite.
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


class Migration(migrations.Migration):
    dependencies = [("audit", "0001_initial")]

    operations = [
        migrations.RunSQL(sql=create, reverse_sql=f"DROP TRIGGER IF EXISTS {name};")
        for name, create in TRIGGERS
    ]
