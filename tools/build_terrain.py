"""Build terrain horizon profiles for the built-in landing sites from NASA LOLA elevation.

Source: NASA's Scientific Visualization Studio, CGI Moon Kit, https://svs.gsfc.nasa.gov/4720/
  ldem_16_uint.tif  LOLA elevation, 16 pixels per degree (5760 x 2880), unsigned 16-bit.

Height encoding, checked against the file: metres above the 1737.4 km reference sphere =
value * 0.5 - 10000 (half-metres above a 1727.4 km base, as tools/build_moon_maps.py reads it).
The file spans -8981.5 m to +10685.5 m, which matches LOLA's known range (Engel'gardt high
near 5.4 N 158.6 W reads +10.6 km here). Column 0 starts at 180 W: Antoniadi crater
(69.7 S, 172 W) reads -7.4 km, while 8 E at the same latitude reads +1.0 km.

For each site and each azimuth 0..359 (clockwise from north) the script walks the great circle
out to MAX_RANGE_KM in STEP_KM steps, reads bilinear height, and keeps the highest elevation
angle of terrain above the observer's local horizontal. The Moon's curvature is included, and
the observer stands OBSERVER_M above local ground. Values can be negative on a summit, where
the true horizon dips below the flat one.

Put the file in data/raw/moon/ (not tracked), then run from the repo root:
  uv run --offline --with numpy --with pillow python tools/build_terrain.py

Writes data/terrain-horizons.json.
Written with an AI tool.
"""
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

RAW = Path("data/raw/moon/ldem_16_uint.tif")
SITES_JS = Path("src/data.js")
OUT = Path("data/terrain-horizons.json")
MOON_RADIUS_M = 1_737_400.0
HALF_METRE = 0.5
BASE_OFFSET_M = 1_727_400.0 - MOON_RADIUS_M  # -10000 m
PPD = 16
MAX_RANGE_KM = 150.0
STEP_KM = 0.25
OBSERVER_M = 2.0

Image.MAX_IMAGE_PIXELS = None


def load_height() -> np.ndarray:
    raw = np.asarray(Image.open(RAW), dtype=np.float32)
    if raw.shape != (180 * PPD, 360 * PPD):
        raise SystemExit(f"unexpected size {raw.shape}")
    return raw * HALF_METRE + BASE_OFFSET_M


def read_sites() -> dict:
    """Pull id, lat and lonE for each entry of SITES in src/data.js."""
    text = SITES_JS.read_text()
    sites = {}
    pattern = r"id:\s*'(\w+)'.*?lat:\s*(-?[\d.]+),\s*lonE:\s*(-?[\d.]+)"
    for m in re.finditer(pattern, text, flags=re.S):
        if m.group(1) == "custom":
            continue
        sites[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    return sites


def bilinear(h: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    rows, cols = h.shape
    fr = np.clip((90.0 - lat) * PPD - 0.5, 0, rows - 1)
    fc = (((lon + 180.0) % 360.0) * PPD - 0.5) % cols
    r0 = np.minimum(np.floor(fr).astype(int), rows - 2)
    c0 = np.floor(fc).astype(int) % cols
    c1 = (c0 + 1) % cols
    tr = fr - r0
    tc = fc - np.floor(fc)
    top = h[r0, c0] * (1 - tc) + h[r0, c1] * tc
    bot = h[r0 + 1, c0] * (1 - tc) + h[r0 + 1, c1] * tc
    return top * (1 - tr) + bot * tr


def horizon(h: np.ndarray, lat_deg: float, lon_deg: float) -> np.ndarray:
    phi1 = np.radians(lat_deg)
    lam1 = np.radians(lon_deg)
    az = np.radians(np.arange(360.0))[:, None]
    dist_m = np.arange(STEP_KM, MAX_RANGE_KM + 1e-9, STEP_KM)[None, :] * 1000.0
    delta = dist_m / MOON_RADIUS_M
    sin_phi2 = np.sin(phi1) * np.cos(delta) + np.cos(phi1) * np.sin(delta) * np.cos(az)
    phi2 = np.arcsin(np.clip(sin_phi2, -1, 1))
    lam2 = lam1 + np.arctan2(np.sin(az) * np.sin(delta) * np.cos(phi1), np.cos(delta) - np.sin(phi1) * sin_phi2)
    ground = bilinear(h, np.degrees(phi2), np.degrees(lam2))
    observer = float(bilinear(h, np.array([lat_deg]), np.array([lon_deg]))[0]) + OBSERVER_M
    r_target = MOON_RADIUS_M + ground
    r_obs = MOON_RADIUS_M + observer
    elev = np.degrees(np.arctan2(r_target * np.cos(delta) - r_obs, r_target * np.sin(delta)))
    return elev.max(axis=1), observer


def main() -> None:
    h = load_height()
    out = {
        "meta": {
            "source": "NASA SVS CGI Moon Kit (svs.gsfc.nasa.gov/4720), LOLA ldem_16_uint.tif",
            "heightEncoding": "metres = value * 0.5 - 10000, relative to 1737.4 km",
            "pixelsPerDegree": PPD,
            "latPixelKm": round(np.pi * MOON_RADIUS_M / (180 * PPD) / 1000, 2),
            "maxRangeKm": MAX_RANGE_KM,
            "stepKm": STEP_KM,
            "observerHeightM": OBSERVER_M,
            "azimuth": "degrees clockwise from north, index 0..359",
            "values": "highest terrain elevation angle in degrees, curvature included",
        },
        "sites": {},
        "groundM": {},
    }
    for sid, (lat, lon) in read_sites().items():
        prof, ground = horizon(h, lat, lon)
        out["sites"][sid] = [round(float(v), 2) for v in prof]
        out["groundM"][sid] = round(ground - OBSERVER_M, 1)
        print(f"{sid:13s} ground {ground - OBSERVER_M:8.0f} m  horizon min {prof.min():6.2f}  max {prof.max():6.2f} at az {int(prof.argmax())}  mean {prof.mean():5.2f}")
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{OUT}  {OUT.stat().st_size / 1e3:.1f} kB")


if __name__ == "__main__":
    main()
