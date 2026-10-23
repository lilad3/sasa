"""
Sauvegardes chiffrées de la base (contrat docs/chantier-a2-fondations.md §2).

Rien n'est écrit en clair sur le disque : la base est copiée en mémoire, vérifiée, compressée, chiffrée (Fernet,
clé BACKUP_ENCRYPTION_KEY) puis écrite d'un coup. Deux moteurs, choisis selon `connection.vendor`.
"""

import gzip
import hashlib
import os
import re
import sqlite3
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import connection, connections
from django.utils import timezone

PREFIX = "akwaba"
SUFFIXES = {"sqlite": ".sqlite.gz.fernet", "postgresql": ".pgdump.fernet"}
NAME_RE = re.compile(r"^akwaba-(\d{8})-(\d{6})(\.sqlite\.gz\.fernet|\.pgdump\.fernet)$")
KEEP_DAYS = 7
KEEP_SUNDAYS = 4
PG_TIMEOUT = 600


class BackupError(Exception):
    """Un message clair pour l'exploitant, jamais de donnée de la base."""


@dataclass
class BackupResult:
    path: Path
    size: int
    seconds: float
    sha256: str
    removed: list


def get_fernet():
    key = getattr(settings, "BACKUP_ENCRYPTION_KEY", "")
    if not key:
        raise BackupError("BACKUP_ENCRYPTION_KEY est absente : définissez une clé Fernet dans le .env.")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError):
        raise BackupError("BACKUP_ENCRYPTION_KEY n'est pas une clé Fernet valide.") from None


def backup_dir(create=True):
    path = Path(settings.BACKUP_DIR).expanduser().resolve()
    forbidden = [Path(settings.BASE_DIR).resolve()]
    if getattr(settings, "STATIC_ROOT", None):
        forbidden.append(Path(settings.STATIC_ROOT).resolve())
    for root in forbidden:
        if path == root or root in path.parents:
            raise BackupError(f"BACKUP_DIR ({path}) ne doit pas se trouver dans le dépôt ni dans les fichiers statiques.")
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def _stamp(now=None):
    return timezone.localtime(now or timezone.now()).strftime("%Y%m%d-%H%M%S")


def _write_private(path, data):
    part = path.with_name(path.name + ".part")
    fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(part, path)


# --- SQLite ---------------------------------------------------------------------------------------------------


def _sqlite_snapshot(source=None):
    """Instantané cohérent de la base en service, dans une base en mémoire (ne bloque pas les écritures)."""
    if source is not None:
        mem = sqlite3.connect(":memory:")
        source.backup(mem, pages=-1)
        return mem
    if connection.in_atomic_block:
        # Dans une transaction ouverte, l'API `backup` de SQLite attend sans fin : mieux vaut refuser.
        raise BackupError("La sauvegarde ne peut pas tourner dans une transaction ouverte.")
    connection.ensure_connection()
    mem = sqlite3.connect(":memory:")
    connection.connection.backup(mem, pages=-1)
    return mem


def _sqlite_dump(mem):
    problems = mem.execute("PRAGMA integrity_check").fetchall()
    if problems != [("ok",)]:
        raise BackupError("La base en service échoue à PRAGMA integrity_check : sauvegarde abandonnée.")
    raw = bytearray(mem.serialize())
    # Une base en WAL garde ses octets 18-19 à 2 : sans fichier -wal, elle ne se rouvrirait plus. La copie est complète,
    # on la range au format « journal classique » (1) pour qu'elle se recharge seule.
    raw[18] = raw[19] = 1
    return gzip.compress(bytes(raw), compresslevel=6)


# --- PostgreSQL -----------------------------------------------------------------------------------------------


def pg_args(db, tool):
    """Ligne de commande et environnement d'un outil PostgreSQL. Le mot de passe passe par l'environnement."""
    argv = [tool]
    if db.get("HOST"):
        argv += ["--host", str(db["HOST"])]
    if db.get("PORT"):
        argv += ["--port", str(db["PORT"])]
    if db.get("USER"):
        argv += ["--username", str(db["USER"])]
    env = {**os.environ}
    if db.get("PASSWORD"):
        env["PGPASSWORD"] = str(db["PASSWORD"])
    return argv, env


def pg_dump_command(db):
    argv, env = pg_args(db, "pg_dump")
    return argv + ["--format=custom", "--no-owner", "--dbname", str(db["NAME"])], env


def db_from_url(url):
    """Réglages (HOST, USER…) d'une URL postgres://, sans dépendre de dj_database_url."""
    parsed = urlparse(url)
    if parsed.scheme not in ("postgres", "postgresql"):
        raise BackupError("L'URL cible doit commencer par postgres:// ou postgresql://.")
    return {
        "HOST": parsed.hostname or "",
        "PORT": parsed.port or "",
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "NAME": parsed.path.lstrip("/"),
    }


def _run(argv, env, data=None):
    try:
        done = subprocess.run(argv, env=env, input=data, capture_output=True, timeout=PG_TIMEOUT)
    except FileNotFoundError:
        raise BackupError(f"{argv[0]} est introuvable : installez les outils clients PostgreSQL.") from None
    except subprocess.TimeoutExpired:
        raise BackupError(f"{argv[0]} dépasse {PG_TIMEOUT} s.") from None
    if done.returncode != 0:
        # stderr peut citer des noms d'objets, jamais de lignes de la base.
        raise BackupError(f"{argv[0]} a échoué (code {done.returncode}) : {done.stderr.decode(errors='replace').strip()[:300]}")
    return done.stdout


def _pg_dump():
    argv, env = pg_dump_command(connection.settings_dict)
    data = _run(argv, env)
    listing = _run(["pg_restore", "--list"], os.environ.copy(), data).decode(errors="replace")
    if "audit_auditevent" not in listing:
        raise BackupError("L'archive pg_dump ne contient pas les tables attendues : sauvegarde abandonnée.")
    return data


# --- Sauvegarde -----------------------------------------------------------------------------------------------


def create_backup(now=None):
    fernet = get_fernet()  # avant de lire la base
    directory = backup_dir()
    started = time.monotonic()
    vendor = connection.vendor
    if vendor == "sqlite":
        kind = "sqlite"
        mem = _sqlite_snapshot()
        try:
            payload = _sqlite_dump(mem)
        finally:
            mem.close()
    elif vendor == "postgresql":
        kind, payload = "postgresql", _pg_dump()
    else:
        raise BackupError(f"Moteur de base non pris en charge : {vendor}.")
    token = fernet.encrypt(payload)
    path = directory / f"{PREFIX}-{_stamp(now)}{SUFFIXES[kind]}"
    _write_private(path, token)
    removed = apply_retention(directory, now)
    return BackupResult(path, len(token), time.monotonic() - started, hashlib.sha256(token).hexdigest(), removed)


def _parse(name):
    match = NAME_RE.match(name)
    if match is None:
        return None
    naive = datetime.strptime(match.group(1) + match.group(2), "%Y%m%d%H%M%S")
    return timezone.make_aware(naive, timezone.get_current_timezone())


def apply_retention(directory, now=None):
    """Garde ce qui a moins de 7 jours et la dernière sauvegarde de chacun des 4 derniers dimanches. Rien d'autre n'est touché."""
    now = now or timezone.now()
    dated = sorted(
        ((when, path) for path in Path(directory).iterdir() if (when := _parse(path.name)) is not None),
        key=lambda item: item[0],
    )
    keep = {path for when, path in dated if now - when < timedelta(days=KEEP_DAYS)}
    sundays = {}
    for when, path in dated:
        if when.weekday() == 6:
            sundays[when.date()] = path  # la dernière du jour : le tri est chronologique
    for day in sorted(sundays, reverse=True)[:KEEP_SUNDAYS]:
        keep.add(sundays[day])
    removed = []
    for _, path in dated:
        if path not in keep:
            path.unlink()
            removed.append(path)
    return removed


# --- Restauration ---------------------------------------------------------------------------------------------


def read_backup(path):
    """Déchiffre un fichier de sauvegarde : (moteur, octets)."""
    path = Path(path)
    match = NAME_RE.match(path.name)
    if match is None:
        raise BackupError("Nom de fichier inattendu : attendu akwaba-AAAAMMJJ-HHMMSS.sqlite.gz.fernet ou .pgdump.fernet.")
    fernet = get_fernet()
    try:
        payload = fernet.decrypt(path.read_bytes())
    except InvalidToken:
        raise BackupError("Déchiffrement impossible : mauvaise clé BACKUP_ENCRYPTION_KEY ou fichier abîmé.") from None
    except OSError as error:
        raise BackupError(f"Lecture impossible : {error.strerror}.") from None
    if match.group(3) == ".sqlite.gz.fernet":
        try:
            return "sqlite", gzip.decompress(payload)
        except (OSError, EOFError):
            raise BackupError("Le fichier déchiffré n'est pas une archive gzip valide.") from None
    return "postgresql", payload


def load_sqlite(raw):
    mem = sqlite3.connect(":memory:")
    try:
        mem.deserialize(raw)
        problems = mem.execute("PRAGMA integrity_check").fetchall()
    except sqlite3.DatabaseError:
        mem.close()
        raise BackupError("La copie restaurée n'est pas une base SQLite lisible.") from None
    if problems != [("ok",)]:
        mem.close()
        raise BackupError("La copie restaurée échoue à PRAGMA integrity_check.")
    return mem


def write_sqlite_file(mem, destination):
    """Écrit la base en mémoire dans un fichier SQLite par l'API `backup` (respecte le WAL d'une base ouverte)."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    target = sqlite3.connect(destination)
    try:
        mem.backup(target)
    finally:
        target.close()


def row_counts_sqlite(conn):
    tables = [
        name
        for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    ]
    return {name: conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] for name in tables}


def row_counts_alias(alias):
    with connections[alias].cursor() as cursor:
        tables = [t.name for t in connections[alias].introspection.get_table_list(cursor) if t.type == "t"]
        counts = {}
        for name in sorted(tables):
            cursor.execute(f"SELECT COUNT(*) FROM {connections[alias].ops.quote_name(name)}")
            counts[name] = cursor.fetchone()[0]
    return counts


def temporary_alias(alias, settings_dict):
    """Déclare une base supplémentaire pour la durée d'un contrôle."""
    config = {**connections.databases["default"], **settings_dict}
    connections.databases[alias] = config
    return alias


def drop_alias(alias):
    if alias in connections:
        connections[alias].close()
        del connections[alias]
    connections.databases.pop(alias, None)


def restore_postgres(raw, db):
    argv, env = pg_args(db, "pg_restore")
    _run(argv + ["--clean", "--if-exists", "--no-owner", "--dbname", str(db["NAME"])], env, raw)


def default_output():
    return backup_dir() / f"restauration-{_stamp()}.sqlite3"
