"""
Genera todos los iconos de MARICHE POS a partir de `public/logo.png`.

La imagen se usa TAL CUAL (sin recortes ni cambios de color): solo se
redimensiona a cada tamano y, cuando la plataforma lo exige, se rellena
la transparencia con el mismo azul del logo.

Fuente:  public/logo.png  (PNG cuadrado con esquinas transparentes)

Salidas: public/icon.png                (icono PWA 512, purpose "any")
         public/icon-192.png            (icono PWA 192)
         public/icon-maskable-512.png   (icono adaptativo Android)
         public/apple-icon.png          (iOS 180, sin transparencia)
         public/favicon.ico             (16/24/32/48)
         src/app/favicon.ico            (convencion de Next.js)

Uso:  python scripts/generate-brand-assets.py
Requiere: Pillow, numpy
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SRC = PUBLIC / "logo.png"

# Azul de fondo del logo (zonas transparentes).
BG = (23, 26, 31)

# Radio de la zona segura de un icono "maskable" (80 % del ancho).
SAFE_RADIUS = 0.4 * 512


def bleed_colors(img: Image.Image, iterations: int = 8) -> Image.Image:
    """Extiende el color del dibujo hacia los pixeles semitransparentes.

    Los PNG exportados suelen traer el borde con un color de relleno
    (blanco o verde). Al aplanarlos sobre azul eso se ve como un halo.
    Esto copia el color de los pixeles opacos vecinos sin tocar el alpha.
    """
    arr = np.asarray(img.convert("RGBA")).astype(np.float64)
    rgb = arr[..., :3].copy()
    alpha = arr[..., 3]
    known = alpha > 250

    for _ in range(iterations):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(alpha.shape)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            acc += np.roll(rgb, (dy, dx), axis=(0, 1)) * np.roll(known, (dy, dx), axis=(0, 1))[..., None]
            cnt += np.roll(known, (dy, dx), axis=(0, 1))
        fill = (~known) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][..., None]
        known |= fill

    out = arr.copy()
    out[..., :3] = rgb
    return Image.fromarray(np.round(out).astype(np.uint8), "RGBA")


def white_radius(img: Image.Image) -> float:
    """Radio maximo del dibujo blanco respecto al centro de la imagen."""
    arr = np.asarray(img.convert("RGBA")).astype(int)
    h, w = arr.shape[:2]
    luminance = arr[..., :3].mean(axis=2)
    white = (luminance > 235) & (arr[..., 3] > 128)
    yy, xx = np.mgrid[0:h, 0:w]
    radius = np.sqrt((xx - (w - 1) / 2) ** 2 + (yy - (h - 1) / 2) ** 2)
    return float(radius[white].max()) if white.any() else 0.0


def on_background(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Aplana la transparencia sobre el azul del logo y redimensiona."""
    base = Image.new("RGBA", img.size, BG + (255,))
    base.alpha_composite(img)
    return base.convert("RGB").resize(size, Image.LANCZOS)


def main() -> None:
    logo = Image.open(SRC).convert("RGBA")
    # Version con el borde "limpio" para aplanar sobre azul sin halo.
    clean = bleed_colors(logo)

    # Icono PWA 512 (el manifest lo declara 512x512).
    icon = logo.resize((512, 512), Image.LANCZOS) if logo.size != (512, 512) else logo
    icon.save(PUBLIC / "icon.png", optimize=True)
    clean.resize((192, 192), Image.LANCZOS).save(PUBLIC / "icon-192.png", optimize=True)

    # iOS no admite transparencia en el icono (pinta negro detras).
    on_background(clean, (180, 180)).save(PUBLIC / "apple-icon.png", optimize=True)

    # Android recorta el icono con la forma del lanzador. Si el dibujo no
    # cabe en la zona segura, se escala lo justo para que no se corte.
    radius = white_radius(logo) * 512 / logo.width
    scale = min(1.0, SAFE_RADIUS / radius) if radius else 1.0
    side = round(512 * scale)
    canvas = Image.new("RGBA", (512, 512), BG + (255,))
    canvas.alpha_composite(
        clean.resize((side, side), Image.LANCZOS),
        ((512 - side) // 2, (512 - side) // 2),
    )
    canvas.convert("RGB").save(PUBLIC / "icon-maskable-512.png", optimize=True)

    # Favicon con todos los tamanos que piden los navegadores.
    favicon = PUBLIC / "favicon.ico"
    clean.resize((256, 256), Image.LANCZOS).save(
        favicon, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48)]
    )
    (ROOT / "src" / "app" / "favicon.ico").write_bytes(favicon.read_bytes())

    print(f"listo: icon, icon-192, icon-maskable-512 (escala {scale:.2f}), apple-icon, favicon.ico")


if __name__ == "__main__":
    main()
