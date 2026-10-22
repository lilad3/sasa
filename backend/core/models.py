from django.db import models


class RateCounter(models.Model):
    """
    Un compteur de limite de débit ou d'échecs (core/ratelimit.py). Il s'incrémente en une seule
    requête SQL, donc sans perte quand des requêtes arrivent en même temps : le cache en base de
    Django, lui, lit puis réécrit la valeur, et des tentatives parallèles n'y comptaient qu'une fois.
    """

    bucket = models.CharField(max_length=200, primary_key=True)
    count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)

    def __str__(self):
        return f"{self.bucket} = {self.count}"
