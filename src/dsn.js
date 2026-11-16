// Deep Space Network coverage. A lander with Earth above its horizon still
// needs a DSN antenna on Earth that sees the Moon. This module computes the
// Moon's apparent topocentric elevation from each DSN complex with the
// low-precision lunar theory of Meeus, Astronomical Algorithms, chapter 47
// (truncated ELP-2000/82 series), plus nutation and sidereal time. No data
// files and no network calls. Checked against JPL Horizons in tests/dsn.test.js.
// Written with an AI tool.
import './dsn.css';
import { intersect, mergeIntervals, sumHours, HOUR_MS } from './calc.js';
import { fmtHours } from './format.js';

/** Minimum antenna elevation for a link, in degrees. */
export const DSN_MIN_EL = 10;

/** 70 m antennas at each complex. Coordinates are the JPL Horizons site values (DSS-14, DSS-63, DSS-43). */
export const DSN_STATIONS = [
  { id: 'goldstone', name: 'Goldstone', dss: 'DSS-14', lat: 35.4259009, lonE: -116.8895382, heightM: 1001.39 },
  { id: 'madrid', name: 'Madrid', dss: 'DSS-63', lat: 40.4312097, lonE: -4.2480085, heightM: 864.82 },
  { id: 'canberra', name: 'Canberra', dss: 'DSS-43', lat: -35.4024242, lonE: 148.9812673, heightM: 688.87 },
];

const RAD = Math.PI / 180;
const TT_MINUS_UTC_S = 69.184; // 37 leap seconds plus 32.184 s, valid since 2017.
const STEP_MS = 5 * 60_000;

// Meeus table 47.A: D, M, M', F, sum-l coefficient (1e-6 deg), sum-r coefficient (1e-3 km).
const LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
];

// Meeus table 47.B: D, M, M', F, sum-b coefficient (1e-6 deg).
const B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

const norm = (d) => ((d % 360) + 360) % 360;

/**
 * Geocentric apparent Moon position, true equator and equinox of date.
 * @param {number} t UTC milliseconds
 * @returns {{ ra: number, dec: number, distKm: number, gast: number }} degrees and km
 */
export function moonGeocentric(t) {
  const jdUtc = t / 86_400_000 + 2440587.5;
  const T = (jdUtc + TT_MINUS_UTC_S / 86400 - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, cl, cr] of LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * RAD;
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += cl * e * Math.sin(arg);
    sr += cr * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, cb] of B) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += cb * e * Math.sin((d * D + m * M + mp * Mp + f * F) * RAD);
  }
  sl += 3958 * Math.sin(A1 * RAD) + 1962 * Math.sin((Lp - F) * RAD) + 318 * Math.sin(A2 * RAD);
  sb += -2235 * Math.sin(Lp * RAD) + 382 * Math.sin(A3 * RAD) + 175 * Math.sin((A1 - F) * RAD) +
    175 * Math.sin((A1 + F) * RAD) + 127 * Math.sin((Lp - Mp) * RAD) - 115 * Math.sin((Lp + Mp) * RAD);

  // Nutation (Meeus chapter 22, low precision, arcseconds).
  const om = (125.04452 - 1934.136261 * T) * RAD;
  const Ls = (280.4665 + 36000.7698 * T) * RAD;
  const Lm = Lp * RAD;
  const dpsi = (-17.2 * Math.sin(om) - 1.32 * Math.sin(2 * Ls) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * om)) / 3600;
  const deps = (9.2 * Math.cos(om) + 0.57 * Math.cos(2 * Ls) + 0.1 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * om)) / 3600;
  const eps0 = 23.4392911111 - (46.815 * T + 0.00059 * T * T - 0.001813 * T ** 3) / 3600;
  const eps = (eps0 + deps) * RAD;

  const lam = (Lp + sl / 1e6 + dpsi) * RAD;
  const bet = (sb / 1e6) * RAD;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam)) / RAD;
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam)) / RAD;

  // Sidereal time from UTC (UT1 minus UTC stays under 0.9 s, about 0.004 degrees).
  const Tu = (jdUtc - 2451545) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jdUtc - 2451545) + 0.000387933 * Tu * Tu - Tu ** 3 / 38710000;
  const gast = norm(gmst + dpsi * Math.cos(eps));
  return { ra: norm(ra), dec, distKm: 385000.56 + sr / 1000, gast };
}

const WGS_A = 6378.137;
const WGS_F = 1 / 298.257223563;

/**
 * Apparent topocentric elevation of the Moon (no refraction) from a site on Earth.
 * @param {{ lat: number, lonE: number, heightM?: number }} site
 * @param {number} t UTC milliseconds
 * @param {ReturnType<typeof moonGeocentric>} [geo] precomputed geocentric position
 * @returns {number} degrees
 */
export function moonElevation(site, t, geo = moonGeocentric(t)) {
  const phi = site.lat * RAD;
  const e2 = WGS_F * (2 - WGS_F);
  const N = WGS_A / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const h = (site.heightM ?? 0) / 1000;
  // Observer and Moon in the frame that turns with the Earth (x toward longitude 0).
  const lon = site.lonE * RAD;
  const ox = (N + h) * Math.cos(phi) * Math.cos(lon);
  const oy = (N + h) * Math.cos(phi) * Math.sin(lon);
  const oz = (N * (1 - e2) + h) * Math.sin(phi);
  const ha = (geo.gast - geo.ra) * RAD; // Greenwich hour angle
  const dec = geo.dec * RAD;
  const mx = geo.distKm * Math.cos(dec) * Math.cos(-ha);
  const my = geo.distKm * Math.cos(dec) * Math.sin(-ha);
  const mz = geo.distKm * Math.sin(dec);
  const dx = mx - ox, dy = my - oy, dz = mz - oz;
  const up = dx * Math.cos(phi) * Math.cos(lon) + dy * Math.cos(phi) * Math.sin(lon) + dz * Math.sin(phi);
  return Math.asin(up / Math.hypot(dx, dy, dz)) / RAD;
}

/** Times when f(t) - level > 0, from samples every 5 minutes with linear crossing times. */
function intervalsAbove(start, end, elevAt) {
  const out = [];
  let t0 = start, e0 = elevAt(start), open = e0 > 0 ? start : null;
  while (t0 < end) {
    const t1 = Math.min(t0 + STEP_MS, end);
    const e1 = elevAt(t1);
    if ((e0 > 0) !== (e1 > 0)) {
      const tc = t0 + ((t1 - t0) * e0) / (e0 - e1);
      if (e1 > 0) open = tc;
      else { out.push([open, tc]); open = null; }
    }
    t0 = t1; e0 = e1;
  }
  if (open !== null && end > open) out.push([open, end]);
  return out;
}

const cache = new Map();

/**
 * DSN coverage for one analysis. Uses a.start, a.end and the Earth-up intervals.
 * @param {{ start: number, end: number, bodies: { earth: { intervals: number[][], hours: number } } }} a
 */
export function dsnCoverage(a, minEl = DSN_MIN_EL) {
  const key = `${a.start}|${a.end}|${minEl}`;
  let base = cache.get(key);
  if (!base) {
    const geoCache = new Map();
    const geoAt = (t) => {
      let g = geoCache.get(t);
      if (!g) { g = moonGeocentric(t); geoCache.set(t, g); }
      return g;
    };
    const stations = DSN_STATIONS.map((s) => {
      const intervals = intervalsAbove(a.start, a.end, (t) => moonElevation(s, t, geoAt(t)) - minEl);
      return { ...s, intervals, hours: sumHours(intervals) };
    });
    const any = mergeIntervals(stations.flatMap((s) => s.intervals));
    base = { stations, any: { intervals: any, hours: sumHours(any) } };
    if (cache.size > 40) cache.clear();
    cache.set(key, base);
  }
  const link = intersect(a.bodies.earth.intervals, base.any.intervals);
  return {
    ...base,
    minEl,
    start: a.start,
    end: a.end,
    totalHours: (a.end - a.start) / HOUR_MS,
    earthHours: sumHours(a.bodies.earth.intervals),
    link: { intervals: link, hours: sumHours(link) },
  };
}

const pct = (t, c) => ((t - c.start) / (c.end - c.start)) * 100;

function barHtml(intervals, c, cls) {
  const segs = intervals
    .map(([s, e]) => `<span style="left:${pct(s, c).toFixed(3)}%;width:${(pct(e, c) - pct(s, c)).toFixed(3)}%"></span>`)
    .join('');
  return `<span class="dsn-track ${cls}" aria-hidden="true">${segs}</span>`;
}

function rowHtml(name, intervals, hours, c, cls) {
  return `<div class="dsn-row ${cls}"><span class="dsn-name">${name}</span>${barHtml(intervals, c, cls)}` +
    `<span class="dsn-h num">${fmtHours(hours)} h</span></div>`;
}

/** One sentence about the link hours. */
export function dsnSentence(c) {
  const link = fmtHours(c.link.hours), earth = fmtHours(c.earthHours);
  if (c.earthHours < 1e-9) return 'Earth stays below the horizon at this site, so no direct link is possible.';
  return `A DSN station can receive the lander for ${link} of the ${earth} hours with Earth up.`;
}

function blockHtml(label, a) {
  const c = dsnCoverage(a);
  const rows = c.stations.map((s) => rowHtml(s.name, s.intervals, s.hours, c, 'station')).join('');
  return `<div class="dsn-block"><p class="dsn-scn">${label}</p>${rows}` +
    rowHtml('Earth up', a.bodies.earth.intervals, c.earthHours, c, 'earth') +
    rowHtml('DSN link', c.link.intervals, c.link.hours, c, 'link') +
    `<p class="dsn-read">${dsnSentence(c)}</p></div>`;
}

/**
 * Fill the panel for the original and delayed plans.
 * @param {HTMLElement | null} el
 * @param {Array<[string, object]>} scenarios label and analysis pairs
 */
export function renderDsn(el, scenarios) {
  if (!el) return;
  try {
    el.innerHTML =
      `<p class="dsn-cap">Deep Space Network link <span class="cap-note">A complex must see the Moon at ${DSN_MIN_EL}° elevation or more. ` +
      'The link needs Earth above the site horizon at the same time.</span></p>' +
      scenarios.map(([label, a]) => blockHtml(label, a)).join('');
    el.hidden = false;
  } catch (err) {
    el.hidden = true;
    console.error('DSN panel failed', err);
  }
}
