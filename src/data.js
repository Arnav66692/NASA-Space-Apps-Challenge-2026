// Data adapter: parses the bundled JPL Horizons CSVs (kept verbatim in /data for
// reproducibility) and validates them before any calculation touches them.
import blueGhostOriginal from '../data/blue-ghost-original.csv?raw';
import blueGhostDelayed from '../data/blue-ghost-delayed.csv?raw';
import athenaOriginal from '../data/athena-original.csv?raw';
import athenaDelayed from '../data/athena-delayed.csv?raw';

const HOUR_MS = 3_600_000;
const FIELDS = [
  'timeUtc',
  'sunElevationDeg',
  'earthElevationDeg',
  'sunAzimuthDeg',
  'earthAzimuthDeg',
  'latitudeDeg',
  'longitudeEastDeg',
];

/** Split one CSV line, honouring double-quoted fields. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse and validate a Horizons CSV.
 * Throws if the header, timestamps, grid span or numeric values are wrong.
 */
export function parseHorizonsCsv(text, label = 'csv') {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  for (const f of FIELDS) {
    if (!header.includes(f)) throw new Error(`${label}: missing column ${f}`);
  }
  const idx = Object.fromEntries(FIELDS.map((f) => [f, header.indexOf(f)]));

  const rows = lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line);
    const iso = cells[idx.timeUtc].trim();
    if (!/Z$|[+-]\d\d:?\d\d$/.test(iso)) throw new Error(`${label}: row ${i + 1} timestamp is not UTC`);
    const t = Date.parse(iso);
    const row = {
      t,
      sunEl: Number(cells[idx.sunElevationDeg]),
      earthEl: Number(cells[idx.earthElevationDeg]),
      sunAz: Number(cells[idx.sunAzimuthDeg]),
      earthAz: Number(cells[idx.earthAzimuthDeg]),
      lat: Number(cells[idx.latitudeDeg]),
      lonE: Number(cells[idx.longitudeEastDeg]),
    };
    for (const [k, v] of Object.entries(row)) {
      if (!Number.isFinite(v)) throw new Error(`${label}: row ${i + 1} ${k} is not finite`);
    }
    return row;
  });

  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i].t > rows[i - 1].t)) throw new Error(`${label}: timestamps must increase (row ${i + 1})`);
  }
  const span = rows.at(-1).t - rows[0].t;
  if (span !== 72 * HOUR_MS) throw new Error(`${label}: grid spans ${span / HOUR_MS} h, expected 72 h`);
  return rows;
}

export const SITES = {
  athena: {
    id: 'athena',
    name: 'Athena',
    mission: 'Intuitive Machines IM-2',
    sub: 'South pole',
    featured: true,
    lat: -84.7906,
    lonE: 29.1957,
    coordLabel: '84.7906° S, 29.1957° E',
    region: 'Mons Mouton plateau, lunar south pole',
    blurb: 'Near the pole the Sun and Earth skim the horizon, so a few degrees decide everything.',
  },
  blueGhost: {
    id: 'blueGhost',
    name: 'Blue Ghost',
    mission: 'Firefly Blue Ghost Mission 1',
    sub: 'Mare Crisium',
    featured: true,
    lat: 18.562,
    lonE: 61.81,
    coordLabel: '18.562° N, 61.810° E',
    region: 'Mare Crisium, near Mons Latreille',
    blurb: 'A mid-latitude near-side site: Earth hangs high all stay, the Sun follows the lunar day.',
  },
  // The sites below use the bundled Moon table (see src/window.js). Coordinates are from
  // the NASA NSSDCA table of lunar landing sites, the same source as the two presets.
  odysseus: {
    id: 'odysseus',
    name: 'Odysseus',
    mission: 'Intuitive Machines IM-1',
    lat: -80.13,
    lonE: 1.44,
    coordLabel: '80.13° S, 1.44° E',
    region: 'Near Malapert A crater, south polar region',
  },
  chandrayaan3: {
    id: 'chandrayaan3',
    name: 'Chandrayaan-3',
    mission: 'ISRO Chandrayaan-3',
    lat: -69.3741,
    lonE: 32.32,
    coordLabel: '69.3741° S, 32.32° E',
    region: 'Southern highlands, near side',
  },
  slim: {
    id: 'slim',
    name: 'SLIM',
    mission: 'JAXA SLIM',
    lat: -13.316,
    lonE: 25.251,
    coordLabel: '13.3160° S, 25.2510° E',
    region: 'Near Shioli crater',
  },
  apollo11: {
    id: 'apollo11',
    name: 'Apollo 11',
    mission: 'NASA Apollo 11',
    lat: 0.67416,
    lonE: 23.47314,
    coordLabel: '0.67416° N, 23.47314° E',
    region: 'Mare Tranquillitatis',
  },
  apollo17: {
    id: 'apollo17',
    name: 'Apollo 17',
    mission: 'NASA Apollo 17',
    lat: 20.1911,
    lonE: 30.7723,
    coordLabel: '20.1911° N, 30.7723° E',
    region: 'Taurus-Littrow valley',
  },
  change4: {
    id: 'change4',
    name: "Chang'e 4",
    mission: "CNSA Chang'e 4",
    lat: -45.4561,
    lonE: 177.5885,
    coordLabel: '45.4561° S, 177.5885° E',
    region: 'Von Kármán crater, far side',
  },
  change6: {
    id: 'change6',
    name: "Chang'e 6",
    mission: "CNSA Chang'e 6",
    lat: -41.6385,
    lonE: 206.0148,
    coordLabel: '41.6385° S, 153.9852° W',
    region: 'Apollo basin, far side',
  },
};

export const FEATURED = Object.fromEntries(Object.entries(SITES).filter(([, s]) => s.featured));

/** A point typed in by the user. Longitude is stored east-positive in [0, 360). */
export function customSite(lat, lon) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new RangeError('Latitude must be between -90 and 90.');
  if (!Number.isFinite(lon) || lon < -180 || lon > 360) throw new RangeError('Longitude must be between -180 and 360.');
  // Keep an in-range value exactly as typed. The modulo adds float noise.
  const lonE = lon >= 0 && lon < 360 ? lon : ((lon % 360) + 360) % 360;
  const lonSigned = lonE > 180 ? lonE - 360 : lonE;
  const trim = (v) => String(Math.round(Math.abs(v) * 10000) / 10000);
  return {
    id: 'custom',
    name: 'Custom site',
    mission: 'Coordinates entered by the user',
    lat,
    lonE,
    coordLabel: `${trim(lat)}° ${lat < 0 ? 'S' : 'N'}, ${trim(lonSigned)}° ${lonSigned < 0 ? 'W' : 'E'}`,
    region: 'Smooth-sphere point at zero altitude',
  };
}

export const SCENARIOS = {
  original: { id: 'original', label: 'Original', startIso: '2025-03-15T00:00:00Z' },
  delayed: { id: 'delayed', label: 'Delayed +9 d', startIso: '2025-03-24T00:00:00Z' },
};

/** The reference plan that the four Horizons CSVs cover. */
export const PRESET_START_MS = Date.parse(SCENARIOS.original.startIso);
export const PRESET_SLIP_DAYS = 9;

export const scenarioLabel = (id, slipDays) => (id === 'original' ? 'Original' : `Delayed +${slipDays} d`);

const RAW = {
  athena: { original: athenaOriginal, delayed: athenaDelayed },
  blueGhost: { original: blueGhostOriginal, delayed: blueGhostDelayed },
};

const FILES = {
  athena: { original: 'data/athena-original.csv', delayed: 'data/athena-delayed.csv' },
  blueGhost: { original: 'data/blue-ghost-original.csv', delayed: 'data/blue-ghost-delayed.csv' },
};

/** All four supported presets, parsed and validated at load. */
export const DATASETS = Object.fromEntries(
  Object.entries(RAW).map(([site, byScenario]) => [
    site,
    Object.fromEntries(
      Object.entries(byScenario).map(([sc, text]) => {
        const rows = parseHorizonsCsv(text, FILES[site][sc]);
        if (rows[0].t !== Date.parse(SCENARIOS[sc].startIso)) {
          throw new Error(`${FILES[site][sc]}: unexpected start time`);
        }
        return [sc, { site, scenario: sc, file: FILES[site][sc], rows }];
      }),
    ),
  ]),
);
