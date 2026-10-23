from django.db import migrations

# Pendant PostgreSQL des triggers SQLite de 0002 : le journal est en ajout seul, même pour du SQL brut.
# TRUNCATE est bloqué aussi (il ne déclenche pas les triggers de ligne).
FUNCTION = """
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit log is append-only';
END;
$$ LANGUAGE plpgsql;
"""
TRIGGERS = [
    "CREATE TRIGGER audit_auditevent_no_update BEFORE UPDATE ON audit_auditevent "
    "FOR EACH ROW EXECUTE FUNCTION audit_append_only();",
    "CREATE TRIGGER audit_auditevent_no_delete BEFORE DELETE ON audit_auditevent "
    "FOR EACH ROW EXECUTE FUNCTION audit_append_only();",
    "CREATE TRIGGER audit_auditevent_no_truncate BEFORE TRUNCATE ON audit_auditevent "
    "FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();",
]
NAMES = ("audit_auditevent_no_update", "audit_auditevent_no_delete", "audit_auditevent_no_truncate")


def create(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute(FUNCTION)
    for sql in TRIGGERS:
        schema_editor.execute(sql)


def drop(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for name in NAMES:
        schema_editor.execute(f"DROP TRIGGER IF EXISTS {name} ON audit_auditevent;")
    schema_editor.execute("DROP FUNCTION IF EXISTS audit_append_only();")


class Migration(migrations.Migration):
    dependencies = [("audit", "0009_evenements_vitrine")]

    operations = [migrations.RunPython(create, drop)]
