// Any site, any date. Builds the hourly samples of a stay (73 for the default
// 72 hours) from the bundled Moon table, in the same row shape the Horizons CSVs
// parse to, so the calculation contract in calc.js runs unchanged on both.
// Written with an AI tool.
import { skyAt } from './moonsky.js';
import { analyze } from './calc.js';
import { eclipseIntervals } from './eclipse.js';

export const WINDOW_HOURS = 72;
const HOUR_MS = 3_600_000;

// ── stay length ── 72 hours, 7 days, or one lunar day (a synodic month, 29.53 days, rounded to 709 hours).
export const STAY_CHOICES = [72, 168, 709];
const STAY_NAMES = { 72: '72 hours', 168: '7 days', 709: 'lunar day' };
const STAY_BUTTONS = { 72: '72 h', 168: '7 days', 709: 'Lunar day' };
/** Words for the stay in a sentence: "the first 72 hours", "the first 7 days", "the first lunar day". */
export const stayName = (hours) => STAY_NAMES[hours] ?? `${hours} hours`;
/** Short button text for the stay picker. */
export const stayButton = (hours) => STAY_BUTTONS[hours] ?? `${hours} h`;
export const isStayChoice = (hours) => STAY_CHOICES.includes(hours);

/**
 * @param {object} eph table from createEphemeris()
 * @param {{lat: number, lonE: number}} site degrees, east longitude positive
 * @param {number} startMs touchdown, UTC milliseconds
 * @param {number} [hours] stay length in whole hours, 72 by default
 * @returns {Array<{t:number,sunEl:number,earthEl:number,sunAz:number,earthAz:number,lat:number,lonE:number}>}
 */
export function buildRows(eph, site, startMs, hours = WINDOW_HOURS) {
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lonE)) {
    throw new TypeError('Site needs numeric lat and lonE in degrees');
  }
  if (!Number.isInteger(hours) || hours < 1) throw new RangeError('The stay needs a whole number of hours');
  const endMs = startMs + hours * HOUR_MS;
  if (!Number.isFinite(startMs) || startMs < eph.startMs || endMs > eph.endMs) {
    throw new RangeError(`The ${hours} hour stay is outside the Moon table (2024 to 2030)`);
  }
  const point = { lat: site.lat, lon: site.lonE };
  return Array.from({ length: hours + 1 }, (_, i) => {
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

// ── stay length ── one full analysis of a stay of any length, with eclipses counted.
// For 72 hours this is the same work as analyzeStay in slips.js.
export function analyzeWindow(eph, site, startMs, hours = WINDOW_HOURS, extra = {}) {
  return analyze({
    ...extra,
    rows: buildRows(eph, site, startMs, hours),
    eclipse: eclipseIntervals(eph, site, startMs, startMs + hours * HOUR_MS),
  });
}
