// Fetch the JPL Horizons answers for the P1 sites and dates and save them.
// The 10 sites and 10 dates were fixed before the check ran. Written with an AI tool.
// Run: node tools/fetch_p1_reference.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://ssd.jpl.nasa.gov/api/horizons.api";

export const SITES = [
  { name: "Apollo 11 area", lon: 23.473, lat: 0.674 },
  { name: "Apollo 17 area", lon: 30.77, lat: 20.19 },
  { name: "Blue Ghost area", lon: 61.81, lat: 18.56 },
  { name: "SLIM area", lon: 25.251, lat: -13.316 },
  { name: "Chandrayaan-3 area", lon: 32.319, lat: -69.373 },
  { name: "Odysseus area", lon: 1.44, lat: -80.13 },
  { name: "Athena area", lon: 29.2, lat: -84.79 },
  { name: "Near the south pole", lon: 222.8, lat: -89.45 },
  { name: "Far side, southern", lon: -153.99, lat: -41.64 },
  { name: "Near the north pole", lon: 45.0, lat: 85.0 },
];

export const DATES = [
  "2024-02-22T23:24:00Z", "2024-08-01T00:00:00Z", "2025-03-02T08:34:00Z", "2025-03-14T06:58:00Z",
  "2026-03-03T11:33:00Z", "2026-11-14T21:00:00Z", "2027-06-15T12:00:00Z", "2028-01-01T00:00:00Z",
  "2029-07-20T20:17:00Z", "2030-12-31T12:00:00Z",
];

const julianDate = (iso) => Date.parse(iso) / 86400000 + 2440587.5;

async function horizons(target, site) {
  const params = new URLSearchParams({
    format: "text", COMMAND: `'${target}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'", SITE_COORD: `'${site.lon},${site.lat},0'`,
    TLIST: `'${DATES.map((d) => julianDate(d).toFixed(8)).join(" ")}'`, TLIST_TYPE: "'JD'", TIME_TYPE: "'UT'",
    QUANTITIES: "'4'", CSV_FORMAT: "'YES'",
  });
  const resp = await fetch(`${API}?${params}`);
  if (!resp.ok) throw new Error(`Horizons HTTP ${resp.status}`);
  const text = await resp.text();
  if (!text.includes("$$SOE")) throw new Error(`No table from Horizons: ${text.slice(0, 400)}`);
  const lines = text.split("$$SOE")[1].split("$$EOE")[0].trim().split("\n");
  if (lines.length !== DATES.length) throw new Error(`Expected ${DATES.length} rows, got ${lines.length}`);
  return lines.map((line, i) => {
    const parts = line.split(",").map((p) => p.trim());
    const nums = parts.slice(1).filter((p) => p !== "" && !Number.isNaN(Number(p))).map(Number);
    return { date: DATES[i], label: parts[0], az: nums[0], el: nums[1] };
  });
}

async function main() {
  const out = [];
  for (const site of SITES) {
    const sun = await horizons("10", site);
    const earth = await horizons("399", site);
    out.push({ site, sun, earth });
    console.log(`fetched ${site.name}`);
  }
  const outDir = join(HERE, "..", "tests", "reference");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "p1_horizons.json"), JSON.stringify(out, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
