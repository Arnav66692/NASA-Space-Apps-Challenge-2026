// Where the Sun and Earth are in the sky at any point on the Moon, at any time.
// Works in the browser and in Node. Reads the table built by tools/build_ephemeris.py.
// Model: smooth sphere, site at altitude 0, no terrain.
// Written with an AI tool (Claude). Acknowledge in the SI field.

export const MOON_RADIUS_KM = 1737.4;
export const EARTH_RADIUS_KM = 6378.137;
export const SUN_RADIUS_KM = 695700;
export const AU_KM = 149597870.7;

const DEG = Math.PI / 180;
const HOUR_MS = 3600 * 1000;
const VALUES_PER_ROW = 6;
const CROSSING_TOLERANCE_MS = 1000;

/** Wrap a table file and its metadata into a lookup. */
export function createEphemeris(arrayBuffer, meta) {
  const values = new Float32Array(arrayBuffer);
  if (values.length !== meta.rows * VALUES_PER_ROW) {
    throw new Error(`Table has ${values.length} values, expected ${meta.rows * VALUES_PER_ROW}`);
  }
  const startMs = Date.parse(meta.start_utc);
  const stepMs = meta.step_hours * HOUR_MS;
  const endMs = startMs + (meta.rows - 1) * stepMs;
  return Object.freeze({ values, startMs, stepMs, endMs, rows: meta.rows });
}

function lerpAngle(a, b, f) {
  const diff = ((b - a + 540) % 360) - 180;
  return a + diff * f;
}

/** Sub-Earth and sub-solar points and distances at a time, by linear interpolation. */
export function subPointsAt(eph, timeMs) {
  if (!Number.isFinite(timeMs) || timeMs < eph.startMs || timeMs > eph.endMs) {
    throw new RangeError("Date is outside the table (2024 to 2030)");
  }
  const pos = (timeMs - eph.startMs) / eph.stepMs;
  const i = Math.min(Math.floor(pos), eph.rows - 2);
  const f = pos - i;
  const a = i * VALUES_PER_ROW;
  const b = a + VALUES_PER_ROW;
  const v = eph.values;
  return {
    earthLon: lerpAngle(v[a], v[b], f),
    earthLat: v[a + 1] + (v[b + 1] - v[a + 1]) * f,
    sunLon: lerpAngle(v[a + 2], v[b + 2], f),
    sunLat: v[a + 3] + (v[b + 3] - v[a + 3]) * f,
    sunDistKm: (v[a + 4] + (v[b + 4] - v[a + 4]) * f) * AU_KM,
    earthDistKm: (v[a + 5] + (v[b + 5] - v[a + 5]) * f) * AU_KM,
  };
}

function unitVector(lonDeg, latDeg) {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Direction of a body from a site, as azimuth (from north, through east) and elevation in degrees. */
function directionFromSite(site, bodyLon, bodyLat, bodyDistKm, bodyRadiusKm) {
  const up = unitVector(site.lon, site.lat);
  const lon = site.lon * DEG;
  const lat = site.lat * DEG;
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const body = unitVector(bodyLon, bodyLat);
  const rel = [0, 1, 2].map((k) => body[k] * bodyDistKm - up[k] * MOON_RADIUS_KM);
  const range = Math.hypot(rel[0], rel[1], rel[2]);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const e = dot(rel, east);
  const n = dot(rel, north);
  const u = dot(rel, up);
  return {
    az: (Math.atan2(e, n) / DEG + 360) % 360,
    el: Math.asin(u / range) / DEG,
    rangeKm: range,
    radiusDeg: Math.asin(bodyRadiusKm / range) / DEG,
  };
}

/** Angle on the sky between two directions given as azimuth and elevation in degrees. */
export function separationDeg(a, b) {
  const cosSep =
    Math.sin(a.el * DEG) * Math.sin(b.el * DEG) +
    Math.cos(a.el * DEG) * Math.cos(b.el * DEG) * Math.cos((a.az - b.az) * DEG);
  return Math.acos(Math.max(-1, Math.min(1, cosSep))) / DEG;
}

function validateSite(site) {
  if (!site || !Number.isFinite(site.lon) || !Number.isFinite(site.lat)) {
    throw new TypeError("Site needs numeric lon and lat in degrees");
  }
  if (site.lat < -90 || site.lat > 90) {
    throw new RangeError("Latitude must be between -90 and 90");
  }
}

/**
 * The sky at a site and time.
 * eclipse is "none", "partial" (Earth covers part of the Sun) or "total" (Sun fully behind Earth).
 */
export function skyAt(eph, site, timeMs) {
  validateSite(site);
  const p = subPointsAt(eph, timeMs);
  const sun = directionFromSite(site, p.sunLon, p.sunLat, p.sunDistKm, SUN_RADIUS_KM);
  const earth = directionFromSite(site, p.earthLon, p.earthLat, p.earthDistKm, EARTH_RADIUS_KM);
  const sep = separationDeg(sun, earth);
  const eclipse =
    sep < earth.radiusDeg - sun.radiusDeg ? "total" : sep < earth.radiusDeg + sun.radiusDeg ? "partial" : "none";
  return { timeMs, sun, earth, separationDeg: sep, eclipse };
}

function refine(valueAt, loMs, hiMs) {
  let lo = loMs;
  let hi = hiMs;
  const loSign = valueAt(lo) > 0;
  while (hi - lo > CROSSING_TOLERANCE_MS) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) > 0 === loSign) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Rise and set times of the Sun or Earth center between two times.
 * body is "sun" or "earth". levelDeg is the elevation that counts as the horizon.
 */
export function findRiseSet(eph, site, body, startMs, endMs, levelDeg = 0, stepMs = HOUR_MS) {
  validateSite(site);
  if (body !== "sun" && body !== "earth") throw new TypeError('body must be "sun" or "earth"');
  const valueAt = (t) => skyAt(eph, site, t)[body].el - levelDeg;
  const events = [];
  let prevT = startMs;
  let prevV = valueAt(prevT);
  for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
    const v = valueAt(t);
    if (prevV > 0 !== v > 0) {
      events.push({ timeMs: refine(valueAt, prevT, t), kind: v > 0 ? "rise" : "set" });
    }
    prevT = t;
    prevV = v;
  }
  return events;
}

/** Stretches of time when the Sun is fully behind Earth, as seen from the site. */
export function totalEclipseIntervals(eph, site, startMs, endMs, stepMs = 60 * 1000) {
  validateSite(site);
  const intervals = [];
  let openedAt = null;
  for (let t = startMs; t <= endMs; t += stepMs) {
    const total = skyAt(eph, site, t).eclipse === "total";
    if (total && openedAt === null) openedAt = t;
    if (!total && openedAt !== null) {
      intervals.push({ startMs: openedAt, endMs: t - stepMs });
      openedAt = null;
    }
  }
  if (openedAt !== null) intervals.push({ startMs: openedAt, endMs });
  return intervals;
}

/** Hours the Sun and Earth are above the horizon in a window, sampled every stepMs. */
export function visibilityHours(eph, site, startMs, endMs, stepMs = 10 * 60 * 1000) {
  validateSite(site);
  let sun = 0;
  let earth = 0;
  let both = 0;
  let samples = 0;
  for (let t = startMs; t < endMs; t += stepMs) {
    const sky = skyAt(eph, site, t);
    const sunUp = sky.sun.el > 0 && sky.eclipse !== "total";
    const earthUp = sky.earth.el > 0;
    if (sunUp) sun += 1;
    if (earthUp) earth += 1;
    if (sunUp && earthUp) both += 1;
    samples += 1;
  }
  const hours = (count) => (count * stepMs) / HOUR_MS;
  return { sunHours: hours(sun), earthHours: hours(earth), bothHours: hours(both), windowHours: hours(samples) };
}
