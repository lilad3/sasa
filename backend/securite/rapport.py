"""
Lance les tests d'attaque (securite/test_attaques.py) et écrit un rapport lisible en Markdown.

    cd backend
    python securite/rapport.py                      # affiche le rapport et l'écrit dans rapport-securite.md
    python securite/rapport.py --sortie autre.md

Code de sortie : 0 si tout tient (failles connues comprises), 1 si une attaque passe alors qu'elle
devrait échouer, ou si une faille connue a été corrigée sans retirer sa marque.
"""

import argparse
import os
import re
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.test.runner import DiscoverRunner  # noqa: E402

FAMILLES = {
    "Attaque1SeparationDesBoutiques": "1. Séparation des boutiques",
    "Attaque2DroitsParRole": "2. Droits par rôle",
    "Attaque3RelaisVercel": "3. Relais Vercel (BFF)",
    "Attaque4ConnexionEtSessions": "4. Connexion et sessions",
    "Attaque5PanierEtPaiement": "5. Panier et paiement",
    "Attaque6FichiersEnvoyes": "6. Fichiers envoyés",
    "Attaque7JournalInfalsifiable": "7. Journal infalsifiable",
    "Attaque8VitrinePublique": "8. Vitrine publique",
}
TIENT, FAILLE, CASSE, CORRIGE = "✅ tient", "⚠️ faille connue", "❌ l'attaque passe", "🎉 corrigée (retirer la marque)"


class Releve(unittest.TestResult):
    """Retient le verdict de chaque test, sous-tests compris."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.verdicts = {}

    def _noter(self, test, verdict, detail=""):
        cle = test.id()
        # Un sous-test raté rend tout le test « cassé ».
        if self.verdicts.get(cle, (TIENT,))[0] != CASSE:
            self.verdicts[cle] = (verdict, detail)

    def addSuccess(self, test):
        self._noter(test, TIENT)

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._noter(test, CASSE, self._exc_info_to_string(err, test).strip().splitlines()[-1])

    def addError(self, test, err):
        super().addError(test, err)
        self._noter(test, CASSE, "erreur : " + self._exc_info_to_string(err, test).strip().splitlines()[-1])

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self.verdicts[test.id()] = (CASSE, f"{subtest._subDescription()} : {self._exc_info_to_string(err, test).strip().splitlines()[-1]}")

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        methode = getattr(test, test._testMethodName)
        self._noter(test, FAILLE, getattr(methode, "faille_connue", ""))

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._noter(test, CORRIGE, "la faille ne se reproduit plus : retirer @faille_connue")


ELISIONS = re.compile(r"\b(l|d|n|s|qu|j) (?=[aeiouhéè])")
BOUTIQUES = re.compile(r"\b(de|par|boutique) ([ab])\b")


def lisible(nom_methode):
    """« test_client_de_b_par_l_adresse_de_a » → « Client de B par l'adresse de A »."""
    texte = nom_methode.removeprefix("test_").replace("_", " ")
    texte = ELISIONS.sub(r"\1'", texte)
    texte = BOUTIQUES.sub(lambda m: f"{m.group(1)} {m.group(2).upper()}", texte)
    return texte[:1].upper() + texte[1:]


def rapport(releve, duree):
    lignes_par_famille = {}
    for cle, (verdict, detail) in sorted(releve.verdicts.items()):
        _, _, classe, methode = cle.split(".")
        lignes_par_famille.setdefault(FAMILLES.get(classe, classe), []).append((lisible(methode), verdict, detail))

    compte = {v: sum(1 for verdict, _ in releve.verdicts.values() if verdict == v) for v in (TIENT, FAILLE, CASSE, CORRIGE)}
    date = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    sortie = [
        "# Rapport des tests d'attaque — Akwaba",
        "",
        f"_{date} · {len(releve.verdicts)} attaques en {duree:.1f} s_",
        "",
        f"**{compte[TIENT]}** tiennent · **{compte[FAILLE]}** failles connues · **{compte[CASSE]}** attaques qui passent"
        + (f" · **{compte[CORRIGE]}** failles corrigées" if compte[CORRIGE] else ""),
        "",
    ]
    if compte[FAILLE] or compte[CASSE] or compte[CORRIGE]:
        sortie += ["## À traiter", ""]
        for famille, lignes in lignes_par_famille.items():
            for nom, verdict, detail in lignes:
                if verdict != TIENT:
                    sortie.append(f"- {verdict} — **{famille}** — {nom}. {detail}")
        sortie.append("")
    for famille, lignes in lignes_par_famille.items():
        sortie += [f"## {famille}", "", "| Attaque | Résultat |", "|---|---|"]
        sortie += [f"| {nom} | {verdict} |" for nom, verdict, _ in lignes]
        sortie.append("")
    return "\n".join(sortie), compte


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sortie", default="rapport-securite.md")
    args = parser.parse_args()

    runner = DiscoverRunner(verbosity=0, interactive=False)
    runner.setup_test_environment()
    suite = runner.build_suite(["securite"])
    anciennes_bases = runner.setup_databases()
    debut = datetime.now()
    try:
        releve = Releve()
        suite.run(releve)
    finally:
        runner.teardown_databases(anciennes_bases)
        runner.teardown_test_environment()

    texte, compte = rapport(releve, (datetime.now() - debut).total_seconds())
    Path(args.sortie).write_text(texte + "\n", encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(texte)
    return 1 if compte[CASSE] or compte[CORRIGE] else 0


if __name__ == "__main__":
    sys.exit(main())
