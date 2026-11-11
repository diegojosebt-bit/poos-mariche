"""
Genera todos los iconos de COBRANZA ONLINE a partir de `public/logo.png`.

La imagen se usa tal cual (sin recortes ni cambios de color): solo se
redimensiona a cada tamano. Para los iconos que la plataforma recorta
(Android/iOS) se escala un 2 % extra para que el borde del logo quede
fuera del lienzo y no se vean costuras.

Fuente:  public/logo.png  (512x512, PNG con esquinas redondeadas)

Salidas: public/icon.png                (icono PWA 512, purpose "any")
         public/icon-192.png            (icono PWA 192)
         public/icon-maskable-512.png   (icono adaptativo Android)
         public/apple-icon.png          (iOS 180, sin transparencia)
         public/favicon.ico             (16/24/32/48)
         src/app/favicon.ico            (convencion de Next.js)

Uso:  python scripts/generate-brand-assets.py
Requiere: Pillow
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SRC = PUBLIC / "logo.png"

# Azul de marca (media del fondo del logo) para rellenar las esquinas.
BG = (11, 97, 193)

# Cuanto se agranda el logo para los iconos que el sistema recorta.
OVERSCAN = 1.02


def cover(img: Image.Image, size: int) -> Image.Image:
    """Llena un cuadrado con el logo y el azul de marca de fondo."""
    box = img.getchannel("A").getbbox()
    side = max(box[2] - box[0], box[3] - box[1])
    scale = (size / side) * OVERSCAN
    dim = round(img.width * scale)
    resized = img.resize((dim, dim), Image.LANCZOS)

    base = Image.new("RGBA", (size, size), BG + (255,))
    base.alpha_composite(resized, ((size - dim) // 2, (size - dim) // 2))
    return base.convert("RGB")


def main() -> None:
    logo = Image.open(SRC).convert("RGBA")

    # Icono de la app y logo interno: la imagen original sin tocar.
    icon = logo.resize((512, 512), Image.LANCZOS) if logo.size != (512, 512) else logo
    icon.save(PUBLIC / "icon.png", optimize=True)
    logo.resize((192, 192), Image.LANCZOS).save(PUBLIC / "icon-192.png", optimize=True)

    # iOS no admite transparencia en el icono.
    cover(logo, 180).save(PUBLIC / "apple-icon.png", optimize=True)

    # Android recorta el icono con la forma del lanzador.
    cover(logo, 512).save(PUBLIC / "icon-maskable-512.png", optimize=True)

    # Favicon con todos los tamanos que piden los navegadores.
    favicon = PUBLIC / "favicon.ico"
    logo.resize((256, 256), Image.LANCZOS).save(
        favicon, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48)]
    )
    (ROOT / "src" / "app" / "favicon.ico").write_bytes(favicon.read_bytes())

    print("listo: icon, icon-192, icon-maskable-512, apple-icon, favicon.ico")


if __name__ == "__main__":
    main()
