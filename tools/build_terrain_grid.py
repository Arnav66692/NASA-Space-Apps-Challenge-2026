"""Build terrain skylines for every node of the where-to-land heatmap grid from NASA LOLA elevation.

The grid matches src/heatmap.js exactly: STEP_DEG = 2, rows from 90 S to 90 N (91 rows), columns
from 0 E eastward (180 columns). The method is tools/build_terrain.py (great-circle march, bilinear
height, Moon curvature, observer 2 m above ground), made coarser so the whole Moon fits in a small
file: N_AZ azimuths instead of 360, and STEP_KM steps out to MAX_RANGE_KM.

Encoding (little-endian), read by decodeTerrainGrid in src/heatmap.js:
  20-byte header: 'LSHG', u16 version, u16 rows, u16 cols, u16 nAz,
                  i16 offset in hundredths of a degree, u16 fine scale in thousandths of a degree,
                  u16 knee byte, u16 coarse scale in thousandths of a degree
  then rows * cols * nAz bytes, node-major (index = row * cols + col), azimuth clockwise from north.
  Two linear pieces keep 0.1 degree steps where the Sun and Earth graze the ground:
  byte < knee: degrees = offset + byte * fine; else offset + knee * fine + (byte - knee) * coarse.
  With the values below that is -6.0 to 13.9 in 0.1 steps, then 14.0 to 47.0 in 0.6 steps.

Put ldem_16_uint.tif in data/raw/moon/ (not tracked), then run from the repo root:
  uv run --offline --with numpy --with pillow python tools/build_terrain_grid.py

Writes data/terrain-grid.bin.
Written with an AI tool (Claude).
"""
import json
import struct
import time
from pathlib import Path

import numpy as np

from build_terrain import MOON_RADIUS_M, OBSERVER_M, bilinear, load_height, read_sites

OUT = Path("data/terrain-grid.bin")
STEP_DEG = 2
ROWS = 180 // STEP_DEG + 1
COLS = 360 // STEP_DEG
N_AZ = 72
MAX_RANGE_KM = 150.0
STEP_KM = 1.0
OFFSET_DEG = -6.0
SCALE_DEG = 0.1
KNEE = 200
COARSE_DEG = 0.6
VERSION = 1


def skylines(h: np.ndarray, lat_deg: np.ndarray, lon_deg: np.ndarray) -> np.ndarray:
    """Skyline for many points at once: returns (len(points), N_AZ) degrees."""
    phi1 = np.radians(lat_deg)[:, None, None]
    lam1 = np.radians(lon_deg)[:, None, None]
    az = np.radians(np.arange(N_AZ) * (360.0 / N_AZ))[None, :, None]
    dist_m = np.arange(STEP_KM, MAX_RANGE_KM + 1e-9, STEP_KM)[None, None, :] * 1000.0
    delta = dist_m / MOON_RADIUS_M
    sin_phi2 = np.sin(phi1) * np.cos(delta) + np.cos(phi1) * np.sin(delta) * np.cos(az)
    phi2 = np.arcsin(np.clip(sin_phi2, -1, 1))
    lam2 = lam1 + np.arctan2(np.sin(az) * np.sin(delta) * np.cos(phi1), np.cos(delta) - np.sin(phi1) * sin_phi2)
    ground = bilinear(h, np.degrees(phi2), np.degrees(lam2))
    observer = bilinear(h, lat_deg, lon_deg)[:, None, None] + OBSERVER_M
    r_target = MOON_RADIUS_M + ground
    r_obs = MOON_RADIUS_M + observer
    elev = np.degrees(np.arctan2(r_target * np.cos(delta) - r_obs, r_target * np.sin(delta)))
    return elev.max(axis=2)


def encode(deg: np.ndarray) -> tuple[np.ndarray, int, int]:
    knee_deg = OFFSET_DEG + KNEE * SCALE_DEG
    fine = np.round((deg - OFFSET_DEG) / SCALE_DEG)
    coarse = KNEE + np.round((deg - knee_deg) / COARSE_DEG)
    q = np.where(fine < KNEE, fine, coarse)
    low = int((q < 0).sum())
    high = int((q > 255).sum())
    return np.clip(q, 0, 255).astype(np.uint8), low, high


def decode(q: np.ndarray) -> np.ndarray:
    q = q.astype(np.float64)
    return np.where(q < KNEE, OFFSET_DEG + q * SCALE_DEG, OFFSET_DEG + KNEE * SCALE_DEG + (q - KNEE) * COARSE_DEG)


def main() -> None:
    t0 = time.time()
    h = load_height()
    grid = np.zeros((ROWS, COLS, N_AZ), dtype=np.float32)
    lon = np.arange(COLS, dtype=np.float64) * STEP_DEG
    for row in range(ROWS):
        lat = -90.0 + row * STEP_DEG
        grid[row] = skylines(h, np.full(COLS, lat), lon)
    flat = grid.reshape(-1, N_AZ)
    q, low, high = encode(flat)
    header = b"LSHG" + struct.pack(
        "<HHHHhHHH", VERSION, ROWS, COLS, N_AZ, int(round(OFFSET_DEG * 100)), int(round(SCALE_DEG * 1000)), KNEE, int(round(COARSE_DEG * 1000))
    )
    OUT.write_bytes(header + q.tobytes())
    print(f"built in {time.time() - t0:.1f} s, {OUT} {OUT.stat().st_size / 1e6:.3f} MB")
    print(f"range {flat.min():.2f} to {flat.max():.2f} deg, clamped low {low}, high {high} of {flat.size}")
    err = np.abs(decode(q) - flat)
    print(f"round trip error: max {err.max():.3f} deg, below 14 deg max {err[flat < 13.9].max():.3f} deg")
    print("percentiles 0.1/50/99.9:", np.percentile(flat, [0.1, 50, 99.9]).round(2))

    # Spot check against the per-site skylines (360 azimuths, 0.25 km steps).
    per_site = json.loads(Path("data/terrain-horizons.json").read_text())["sites"]
    for sid, (lat, lone) in read_sites().items():
        if sid not in per_site:
            continue
        row = int(round((lat + 90) / STEP_DEG))
        col = int(round((lone % 360) / STEP_DEG)) % COLS
        node = grid[row, col]
        here = skylines(h, np.array([lat]), np.array([lone]))[0]
        ref = np.array(per_site[sid])
        ref_at = ref[(np.arange(N_AZ) * (360 // N_AZ))]
        print(
            f"{sid:12s} site max {ref.max():5.2f} at az {int(ref.argmax()):3d} | coarse same point max {here.max():5.2f} at az {int(here.argmax()) * 360 // N_AZ:3d}"
            f" (mean abs diff {np.abs(here - ref_at).mean():.2f}) | node {-90 + row * STEP_DEG},{col * STEP_DEG} max {node.max():5.2f} at az {int(node.argmax()) * 360 // N_AZ:3d}"
        )


if __name__ == "__main__":
    main()
