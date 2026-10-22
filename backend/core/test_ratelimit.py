"""
Compteurs de limite de débit atomiques (docs/chantier-p5.md §5.3).

La concurrence elle-même se prouve sur le vrai serveur (base fichier) : la base de test en mémoire
de SQLite refuse les écritures parallèles. Voir le script de rafale décrit dans le chantier.
"""

from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from core.models import RateCounter
from core.ratelimit import hit, incr, reset


class CounterTests(TestCase):
    def test_counts_expires_and_resets(self):
        self.assertEqual([incr("essai", 60) for _ in range(3)], [1, 2, 3])
        later = timezone.now() + timedelta(seconds=61)
        with patch("django.utils.timezone.now", return_value=later):
            self.assertEqual(incr("essai", 60), 1)  # la fenêtre est passée : on repart de 1
        reset("essai")
        self.assertEqual(incr("essai", 60), 1)

    def test_long_keys_are_hashed(self):
        key = "rl:scope:" + "x" * 500
        self.assertEqual(incr(key, 60), 1)
        self.assertEqual(incr(key, 60), 2)
        self.assertTrue(RateCounter.objects.get().bucket.startswith("h:"))

    def test_hit_refuses_beyond_the_limit(self):
        self.assertIsNone(hit("scope", "ip", (2, 60)))
        self.assertIsNone(hit("scope", "ip", (2, 60)))
        self.assertIsNotNone(hit("scope", "ip", (2, 60)))
