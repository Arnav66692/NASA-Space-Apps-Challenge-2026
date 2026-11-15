"""Build the table the app reads: where the Sun and Earth are overhead on the Moon, hourly.

Source: NASA JPL Horizons API, observer table for the Moon seen from Earth's center.
Output: data/ephemeris.f32 (little-endian float32) and data/ephemeris.json (metadata).
Each row holds six numbers:
  sub-Earth E longitude, sub-Earth latitude, sub-solar E longitude, sub-solar latitude (degrees),
  Sun to Moon distance (au), Earth to Moon distance (au).

Written with an AI tool (Claude). Acknowledge in the SI field.
Run: python3 tools/build_ephemeris.py
"""
import json
import os
import struct
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "raw")
OUT_BIN = os.path.join(ROOT, "data", "ephemeris.f32")
OUT_META = os.path.join(ROOT, "data", "ephemeris.json")
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
FIRST_YEAR, LAST_YEAR = 2024, 2030
STEP_HOURS = 1
COLUMNS = ["earth_lon", "earth_lat", "sun_lon", "sun_lat", "sun_dist_au", "earth_dist_au"]


def fetch_year(year: int) -> str:
    """Return the raw Horizons reply for one year, cached on disk."""
    path = os.path.join(RAW_DIR, f"moon_subpoints_{year}.txt")
    if os.path.exists(path) and "$$EOE" in open(path).read():
        return open(path).read()
    params = {
        "format": "text", "COMMAND": "'301'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'500@399'",
        "START_TIME": f"'{year}-01-01 00:00'", "STOP_TIME": f"'{year + 1}-01-01 00:00'",
        "STEP_SIZE": f"'{STEP_HOURS} h'", "QUANTITIES": "'14,15,19,20'",
        "CSV_FORMAT": "'YES'", "ANG_FORMAT": "'DEG'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=180) as resp:
                text = resp.read().decode()
            if "$$SOE" in text and "$$EOE" in text:
                with open(path, "w") as fh:
                    fh.write(text)
                return text
            raise RuntimeError(f"no table in reply: {text[:300]}")
        except Exception as err:  # retry on network or service errors, then give up loudly
            print(f"  {year} attempt {attempt + 1} failed: {err}", file=sys.stderr)
            time.sleep(5)
    raise RuntimeError(f"Horizons failed for {year}")


def parse(text: str) -> list[tuple[datetime, list[float]]]:
    body = text.split("$$SOE")[1].split("$$EOE")[0]
    rows = []
    for line in body.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        when = datetime.strptime(parts[0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
        earth_lon, earth_lat, sun_lon, sun_lat = (float(parts[i]) for i in (3, 4, 5, 6))
        sun_dist, earth_dist = float(parts[7]), float(parts[9])
        rows.append((when, [earth_lon, earth_lat, sun_lon, sun_lat, sun_dist, earth_dist]))
    return rows


def main() -> None:
    os.makedirs(RAW_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_BIN), exist_ok=True)
    start = datetime(FIRST_YEAR, 1, 1, tzinfo=timezone.utc)
    table: dict[datetime, list[float]] = {}
    for year in range(FIRST_YEAR, LAST_YEAR + 1):
        rows = parse(fetch_year(year))
        print(f"{year}: {len(rows)} rows")
        table.update(rows)
    count = int((datetime(LAST_YEAR + 1, 1, 1, tzinfo=timezone.utc) - start) / timedelta(hours=STEP_HOURS)) + 1
    with open(OUT_BIN, "wb") as fh:
        for i in range(count):
            when = start + timedelta(hours=i * STEP_HOURS)
            if when not in table:
                raise RuntimeError(f"missing row for {when}")
            fh.write(struct.pack("<6f", *table[when]))
    meta = dict(
        source="NASA JPL Horizons API, target Moon (301), center Earth geocenter (500@399), quantities 14, 15, 19, 20",
        frame="MOON_ME, east longitude positive",
        start_utc=start.strftime("%Y-%m-%dT%H:%M:%SZ"), step_hours=STEP_HOURS, rows=count,
        columns=COLUMNS, dtype="float32 little-endian",
        built_utc=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    with open(OUT_META, "w") as fh:
        json.dump(meta, fh, indent=2)
    print(f"wrote {count} rows, {os.path.getsize(OUT_BIN)} bytes")


if __name__ == "__main__":
    main()
