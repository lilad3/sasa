"""Libellé lisible d'un appareil (« Chrome · Android ») à partir du User-Agent."""

# L'ordre compte : un User-Agent Chrome contient aussi « Safari », un iPhone « Mac OS X ».
BROWSERS = (
    ("Edg", "Edge"),
    ("OPR/", "Opera"),
    ("SamsungBrowser", "Samsung Internet"),
    ("FxiOS", "Firefox"),
    ("Firefox/", "Firefox"),
    ("CriOS", "Chrome"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)
SYSTEMS = (
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Windows", "Windows"),
    ("CrOS", "ChromeOS"),
    ("Mac OS X", "macOS"),
    ("Linux", "Linux"),
)


def device_label(user_agent):
    if not user_agent:
        return ""
    browser = next((name for marker, name in BROWSERS if marker in user_agent), "Navigateur inconnu")
    system = next((name for marker, name in SYSTEMS if marker in user_agent), "système inconnu")
    return f"{browser} · {system}"
