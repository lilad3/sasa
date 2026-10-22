"""
Lot 5 de P5 : deux renouvellements simultanés avec le même refresh token (docs/chantier-p5.md §5).

Le navigateur envoie souvent plusieurs requêtes à la fois (navigation, préchargements de liens,
Server Action) : quand l'access token expire, chacune passe par le proxy Next, qui renouvelle avec
le même refresh. Django n'en laisse gagner qu'une (mise à jour conditionnelle) ; les autres passent
par la fenêtre de grâce. Ces tests rejouent la course, y compris quand la réponse gagnante se perd.
"""

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from accounts import sessions
from accounts.models import UserSession
from audit.models import AuditEvent
from core.testing import ApiTestCase, make_user


class RefreshRaceTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.r1 = self.login("awa@example.ci").json()["refresh"]

    def later(self, seconds):
        """Le temps passe : on avance l'horloge de Django."""
        moment = timezone.now() + timedelta(seconds=seconds)
        return patch("django.utils.timezone.now", return_value=moment)

    def test_the_loser_reads_the_session_before_the_winner_writes(self):
        # Les deux requêtes lisent la session au même moment (refresh_jti = R1)…
        stale = sessions.find_session(RefreshToken(self.r1)["sid"], str(self.user.pk))
        winner = self.refresh(self.r1).json()
        # …la seconde écrit après la première : sa mise à jour conditionnelle ne touche aucune ligne.
        with patch("accounts.sessions.find_session", return_value=stale):
            loser = self.refresh(self.r1)
        self.assertEqual(loser.status_code, 200, loser.content)
        session = UserSession.objects.get()
        self.assertIsNone(session.revoked_at)
        # Le gagnant a bien fait tourner le refresh, une seule fois.
        self.assertEqual(session.refresh_jti, RefreshToken(winner["refresh"])["jti"])
        # Le perdant repart avec le même refresh courant : quelle que soit la réponse qui arrive, le navigateur est à jour.
        self.assertEqual(RefreshToken(loser.json()["refresh"])["jti"], session.refresh_jti)

    def test_lost_winner_response_does_not_end_in_a_theft_alert(self):
        # Deux requêtes parallèles : la gagnante est annulée par le navigateur (l'utilisateur a changé
        # de page, le réseau mobile a coupé) ; seule la réponse de la perdante arrive.
        self.refresh(self.r1)
        loser = self.refresh(self.r1).json()
        kept = loser.get("refresh", self.r1)  # sans refresh dans la réponse, le cookie garde R1

        # 5 minutes plus tard, l'access expire : le navigateur renouvelle avec ce qu'il a gardé.
        with self.later(300):
            response = self.refresh(kept)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(UserSession.objects.get().revoked_at)
        self.assertFalse(AuditEvent.objects.filter(action="refresh_reuse_detected").exists())

    def test_old_refresh_after_the_grace_period_is_still_theft(self):
        self.refresh(self.r1)
        with self.later(11):
            self.assertProblem(self.refresh(self.r1), 401, "session_revoked")
        self.assertEqual(UserSession.objects.get().revoked_reason, "refresh_reuse")

    def test_grace_refresh_still_dies_with_the_session(self):
        self.refresh(self.r1)
        again = self.refresh(self.r1).json()["refresh"]
        UserSession.objects.update(revoked_at=timezone.now(), revoked_reason="logout")
        self.assertProblem(self.refresh(again), 401, "session_revoked")
