"""Build the globe's Moon textures from NASA's CGI Moon Kit.

Source: NASA's Scientific Visualization Studio, CGI Moon Kit, https://svs.gsfc.nasa.gov/4720/
  lroc_color_poles_4k.tif  LRO Camera colour mosaic, sRGB, centred on 0 degrees longitude
  ldem_16_uint.tif         LOLA elevation, 16 pixels per degree, unsigned 16-bit, half-metres

Put both files in data/raw/moon/ (not tracked), then run from the repo root:
  uv run --with numpy --with pillow python tools/build_moon_maps.py

Writes src/three/moon/moon-color.webp, moon-relief.webp, and moon-height.webp with moon-height.json.
The relief file is a tangent-space normal map: red is the slope toward east, green toward north.
Slopes are multiplied by RELIEF_GAIN before they are stored, so gentle lunar terrain survives
8-bit storage. The globe sets the final strength.
Written with an AI tool.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("data/raw/moon")
OUT = Path("src/three/moon")
COLOR_SIZE = (4096, 2048)
RELIEF_SIZE = (4096, 2048)
MOON_RADIUS_M = 1_737_400.0
HALF_METRE = 0.5
RELIEF_GAIN = 4.0
MIN_COS_LAT = 0.05  # keeps the east-west slope finite at the poles
COLOR_QUALITY = 86
RELIEF_QUALITY = 78

Image.MAX_IMAGE_PIXELS = None


def build_color() -> Path:
    image = Image.open(RAW / "lroc_color_poles_4k.tif").convert("RGB")
    if image.size != COLOR_SIZE:
        image = image.resize(COLOR_SIZE, Image.LANCZOS)
    path = OUT / "moon-color.webp"
    image.save(path, "WEBP", quality=COLOR_QUALITY, method=6)
    return path


def build_relief() -> Path:
    raw = Image.open(RAW / "ldem_16_uint.tif")
    metres = np.asarray(raw, dtype=np.float32) * HALF_METRE
    height = Image.fromarray(metres, mode="F").resize(RELIEF_SIZE, Image.LANCZOS)
    h = np.asarray(height, dtype=np.float32)
    rows, cols = h.shape

    # Ground distance of one pixel, in metres.
    north_south = np.pi * MOON_RADIUS_M / rows
    lat = (0.5 - (np.arange(rows) + 0.5) / rows) * np.pi
    east_west = (2 * np.pi * MOON_RADIUS_M / cols) * np.maximum(np.cos(lat), MIN_COS_LAT)

    # Central differences. Longitude wraps. Row index grows toward the south.
    d_east = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * east_west[:, None])
    d_south = np.gradient(h, axis=0) / north_south
    d_north = -d_south

    nx = -d_east * RELIEF_GAIN
    ny = -d_north * RELIEF_GAIN
    nz = np.ones_like(h)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / length, ny / length, nz / length], axis=-1)
    pixels = np.clip(np.round((rgb * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)

    path = OUT / "moon-relief.webp"
    Image.fromarray(pixels, mode="RGB").save(path, "WEBP", quality=RELIEF_QUALITY, method=6)
    slope_deg = np.degrees(np.arctan(np.hypot(d_east, d_north)))
    print(f"relief: median slope {np.median(slope_deg):.2f} deg, 99th percentile {np.percentile(slope_deg, 99):.2f} deg")
    return path


HEIGHT_SIZE = (2048, 1024)


def build_height() -> Path:
    """Grayscale height map for the globe's silhouette, with its range in metres beside it."""
    raw = Image.open(RAW / "ldem_16_uint.tif")
    metres = np.asarray(raw, dtype=np.float32) * HALF_METRE + (1727400.0 - MOON_RADIUS_M)
    h = np.asarray(Image.fromarray(metres, mode="F").resize(HEIGHT_SIZE, Image.LANCZOS), dtype=np.float32)
    lo, hi = float(h.min()), float(h.max())
    grey = np.round((h - lo) / (hi - lo) * 255).astype(np.uint8)
    path = OUT / "moon-height.webp"
    Image.fromarray(grey, mode="L").save(path, "WEBP", quality=90, method=6)
    (OUT / "moon-height.json").write_text(json.dumps({"minM": round(lo, 1), "maxM": round(hi, 1), "radiusM": MOON_RADIUS_M}) + "\n")
    print(f"height: {lo:.0f} m to {hi:.0f} m relative to {MOON_RADIUS_M:.0f} m")
    return path


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for path in (build_color(), build_relief(), build_height()):
        print(f"{path}  {path.stat().st_size / 1e6:.2f} MB  {Image.open(path).size}")


if __name__ == "__main__":
    main()
