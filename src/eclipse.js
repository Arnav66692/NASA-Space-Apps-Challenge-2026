// Earth passing in front of the Sun, as seen from a site on the Moon.
// On Earth the same event is a lunar eclipse. From the surface it is the Sun
// going behind Earth, so sunlight stops even though the Sun is above the horizon.
// Model: smooth sphere, disks compared by their angular radii, no atmosphere glow.
// Written with an AI tool.
import { skyAt } from './moonsky.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Hourly samples further apart than this cannot hide an overlap between them. */
const NEAR_DEG = 3;
const EDGE_TOLERANCE_MS = 1000;

/** Positive when the Sun is fully behind Earth. */
const totalMargin = (sky) => sky.earth.radiusDeg - sky.sun.radiusDeg - sky.separationDeg;
/** Positive when any part of the Sun is behind Earth. */
const anyMargin = (sky) => sky.earth.radiusDeg + sky.sun.radiusDeg - sky.separationDeg;

function refineEdge(valueAt, loMs, hiMs) {
  let lo = loMs;
  let hi = hiMs;
  const loPositive = valueAt(lo) > 0;
  while (hi - lo > EDGE_TOLERANCE_MS) {
    const mid = (lo + hi) / 2;
    if (valueAt(mid) > 0 === loPositive) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Hour-wide windows where the Sun and Earth are close enough to overlap. */
function candidateWindows(eph, point, startMs, endMs) {
  const windows = [];
  for (let t = startMs; t <= endMs; t += HOUR_MS) {
    if (skyAt(eph, point, t).separationDeg >= NEAR_DEG) continue;
    const from = Math.max(startMs, t - HOUR_MS);
    const to = Math.min(endMs, t + HOUR_MS);
    const last = windows.at(-1);
    if (last && from <= last[1]) windows[windows.length - 1] = [last[0], Math.max(last[1], to)];
    else windows.push([from, to]);
  }
  return windows;
}

/** Stretches inside one window where margin(sky) is positive, edges refined to a second. */
function positiveStretches(eph, point, [fromMs, toMs], margin) {
  const valueAt = (t) => margin(skyAt(eph, point, t));
  const out = [];
  let openedAt = valueAt(fromMs) > 0 ? fromMs : null;
  let prevT = fromMs;
  for (let t = fromMs + MINUTE_MS; t <= toMs; t += MINUTE_MS) {
    const positive = valueAt(t) > 0;
    if (positive && openedAt === null) openedAt = refineEdge(valueAt, prevT, t);
    if (!positive && openedAt !== null) {
      out.push([openedAt, refineEdge(valueAt, prevT, t)]);
      openedAt = null;
    }
    prevT = t;
  }
  if (openedAt !== null) out.push([openedAt, toMs]);
  return out;
}

/**
 * When Earth covers the Sun between two times, whether or not the Sun is above the horizon.
 * @param {object} eph table from createEphemeris()
 * @param {{lat: number, lonE: number}} site degrees, east longitude positive
 * @param {number} startMs UTC milliseconds
 * @param {number} endMs UTC milliseconds
 * @returns {{total: Array<[number, number]>, any: Array<[number, number]>}}
 *   total: Sun fully behind Earth. any: Sun at least partly behind Earth (includes total).
 */
export function eclipseIntervals(eph, site, startMs, endMs) {
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lonE)) {
    throw new TypeError('Site needs numeric lat and lonE in degrees');
  }
  if (!(endMs > startMs) || startMs < eph.startMs || endMs > eph.endMs) {
    throw new RangeError('The eclipse search is outside the Moon table (2024 to 2030)');
  }
  const point = { lat: site.lat, lon: site.lonE };
  const windows = candidateWindows(eph, point, startMs, endMs);
  return {
    total: windows.flatMap((w) => positiveStretches(eph, point, w, totalMargin)),
    any: windows.flatMap((w) => positiveStretches(eph, point, w, anyMargin)),
  };
}
