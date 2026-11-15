// Any site, any date. Builds the 73 hourly samples of a 72 hour stay from the
// bundled Moon table, in the same row shape the Horizons CSVs parse to, so the
// calculation contract in calc.js runs unchanged on both.
// Written with an AI tool (Claude).
import { skyAt } from './moonsky.js';

export const WINDOW_HOURS = 72;
const HOUR_MS = 3_600_000;

/**
 * @param {object} eph table from createEphemeris()
 * @param {{lat: number, lonE: number}} site degrees, east longitude positive
 * @param {number} startMs touchdown, UTC milliseconds
 * @returns {Array<{t:number,sunEl:number,earthEl:number,sunAz:number,earthAz:number,lat:number,lonE:number}>}
 */
export function buildRows(eph, site, startMs) {
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lonE)) {
    throw new TypeError('Site needs numeric lat and lonE in degrees');
  }
  const endMs = startMs + WINDOW_HOURS * HOUR_MS;
  if (!Number.isFinite(startMs) || startMs < eph.startMs || endMs > eph.endMs) {
    throw new RangeError('The 72 hour stay is outside the Moon table (2024 to 2030)');
  }
  const point = { lat: site.lat, lon: site.lonE };
  return Array.from({ length: WINDOW_HOURS + 1 }, (_, i) => {
    const t = startMs + i * HOUR_MS;
    const sky = skyAt(eph, point, t);
    return {
      t,
      sunEl: sky.sun.el,
      earthEl: sky.earth.el,
      sunAz: sky.sun.az,
      earthAz: sky.earth.az,
      lat: site.lat,
      lonE: site.lonE,
    };
  });
}
