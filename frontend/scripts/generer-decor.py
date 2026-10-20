"""Génère le décor « verre cannelé » d'Akwaba : nuit chaude, traînée orange et ocre, lueur indigo."""
import sys
import numpy as np
from PIL import Image

W, H = 1920, 1200
rng = np.random.default_rng(7)

def hexrgb(h):
    h = h.lstrip("#"); return np.array([int(h[i:i+2], 16) / 255 for i in (0, 2, 4)])

NUIT, NUIT2 = hexrgb("0E0C0A"), hexrgb("231A13")
ORANGE, OCRE, CORAIL = hexrgb("FF7A1F"), hexrgb("F2B33D"), hexrgb("E8553F")
INDIGO, INDIGO_C = hexrgb("3F4BC9"), hexrgb("8F9BFF")

def smooth_noise(cells, seed):
    g = np.random.default_rng(seed).random((cells, int(cells * W / H) + 1))
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255

N1, N2 = smooth_noise(4, 1), smooth_noise(9, 2)
fbm = 0.65 * N1 + 0.35 * N2

def mix(a, b, t):
    t = t[..., None]; return a * (1 - t) + b * t

def scene(X, Y):
    cx, cy = (X - W / 2) / H, (Y - H / 2) / H
    yi = np.clip(Y.astype(int), 0, H - 1); xi = np.clip(X.astype(int), 0, W - 1)
    n = fbm[yi, xi] - 0.5
    ang = 0.9
    d = cx * -np.sin(ang) + cy * np.cos(ang) + 0.12 * n
    along = cx * np.cos(ang) + cy * np.sin(ang)          # position le long de la traînée
    b = d - 0.02
    glow = np.exp(-b * b * 11.0)
    core = np.exp(-(b + 0.05) ** 2 * 48)
    rim = np.exp(-(b - 0.10) ** 2 * 80)
    # fond : nuit chaude, plus claire au centre
    base = mix(NUIT[None, None], NUIT2[None, None], np.clip(0.55 - 0.5 * np.hypot(cx, cy), 0, 1))
    # la traînée passe de l'ocre (haut) à l'orange puis au corail (bas)
    t = np.clip(along * 0.9 + 0.62, 0, 1)
    band = mix(mix(OCRE[None, None], ORANGE[None, None], np.clip(t * 1.6, 0, 1)), CORAIL[None, None], np.clip(t * 2 - 1.1, 0, 1))
    col = mix(base, band, glow * 0.86)
    col = mix(col, NUIT[None, None] * 0.6 + NUIT2[None, None] * 0.4, core * 0.85)
    col = col + OCRE * (rim * 0.35)[..., None]
    # lueur indigo de l'autre côté, plus discrète
    b2 = d + 0.55
    ind = np.exp(-b2 * b2 * 12) * np.clip(0.9 - along, 0, 1)
    col = mix(col, INDIGO[None, None], ind * 0.62)
    col = col + INDIGO_C * (np.exp(-(b2 - 0.06) ** 2 * 90) * 0.12 * np.clip(0.9 - along, 0, 1))[..., None]
    return col

Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
RIB = 160.0
f = (X / RIB) % 1.0
ri = np.floor(X / RIB)
col = scene(X + (f - 0.5) * RIB * 1.5, Y)
rnd = np.random.default_rng(3).random(int(W / RIB) + 2)[ri.astype(int)]
col *= (1 - 0.16 * f)[..., None]
col += ((np.exp(-((f - 0.0) / 0.012) ** 2) * 0.10 + np.exp(-((f - 1.0) / 0.02) ** 2) * 0.05) * (0.5 + rnd))[..., None]
# bas assombri, comme l'ancien décor
fade = np.clip((Y / H - 0.72) / 0.28, 0, 1) ** 1.4
col = mix(col, NUIT[None, None], fade * 0.85)
# vignette + grain
vig = np.clip(1.15 - 0.55 * np.hypot((X / W - 0.5) * 1.3, Y / H - 0.45), 0, 1)
col *= vig[..., None]
col += rng.normal(0, 0.022, (H, W, 1))
img = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8))
img.save(sys.argv[1], quality=86, optimize=True, progressive=True)
img.resize((480, 300)).save(sys.argv[1].replace(".jpg", "-apercu.png"))
print("ok")
