// Far-side relay. On the Moon's far side Earth never rises, so a lander talks to Earth
// through a relay satellite. This module puts an ILLUSTRATIVE relay orbit around the Moon,
// works out how high the relay stands above the site's smooth horizon through the stay, and
// shows the hours it is in view. Exact orbits are not public, so the numbers are a sketch.
// The model assumes that the relay always sees Earth. That is true for the halo orbit by design.
// Written with an AI tool.
//
// Sources for each number:
// Queqiao (Chang'e 4, 2019): halo orbit around Earth-Moon L2, about 65,000 km from the Moon.
//   https://www.planetary.org/articles/20180615-queqiao-orbit-explainer
//   "nearly continuous contact between both lunar farside and Earth":
//   https://www.planetary.org/articles/0519-change-4-relay-satellite
// Queqiao-2 (Chang'e 6, 2024): 24 hour elliptical frozen orbit, 200 km by 16,000 km.
//   https://www.universetoday.com/166339/chinas-relay-satellite-is-in-lunar-orbit/
//   Inclined 55 degrees, closest approach over the northern hemisphere (so apolune is over the south).
//   https://spacenews.com/?p=356862
// Not public, so ASSUMED here: the halo size (13,000 km circle) and its 14 day period, both
// orbit phases, and the node of the Queqiao-2 orbit. Wikipedia lists a measured Queqiao-2 orbit
// that differs (https://en.wikipedia.org/wiki/Queqiao_2), so treat every hour count as illustrative.
import './relay.css';
import { subPointsAt, MOON_RADIUS_KM } from './moonsky.js';
import { mergeIntervals, sumHours, HOUR_MS } from './calc.js';
import { fmtHours } from './format.js';

const DEG = Math.PI / 180;
const DAY_MS = 24 * HOUR_MS;
const STEP_MS = 10 * 60_000; // 10 minute samples, so a short pass near perilune is not missed.
const SIDEREAL_MONTH_MS = 27.321661 * DAY_MS; // Moon's spin relative to the stars.
const MIN_EARTH_HOURS = 1; // A custom point with less Earth time than this gets the relay panel.

export const RELAYS = Object.freeze({
  queqiao: Object.freeze({
    id: 'queqiao',
    name: 'Queqiao',
    kind: 'halo',
    distanceKm: 65_000, // planetary.org, see above
    amplitudeKm: 13_000, // assumed
    periodMs: 14 * DAY_MS, // assumed
    epochMs: Date.UTC(2019, 0, 3, 2, 26), // Chang'e 4 touchdown, used as the phase origin (assumed)
  }),
  queqiao2: Object.freeze({
    id: 'queqiao2',
    name: 'Queqiao-2',
    kind: 'ellipse',
    perilAltKm: 200, // universetoday.com, see above
    apoAltKm: 16_000, // universetoday.com, see above
    periodMs: 24 * HOUR_MS, // universetoday.com, see above
    inclinationDeg: 55, // spacenews.com, see above
    argPeriDeg: 90, // perilune over the north, apolune over the south (spacenews.com)
    nodeDeg: 270, // assumed: apolune faces the far-side meridian (180 E) at the epoch
    epochMs: Date.UTC(2024, 5, 1, 22, 23), // Chang'e 6 touchdown, used as the phase origin (assumed)
  }),
});

const unit = (lonDeg, latDeg) => {
  const lon = lonDeg * DEG, lat = latDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => a.map((v) => v * k);
const add = (...vs) => [0, 1, 2].map((k) => vs.reduce((s, v) => s + v[k], 0));
const norm = (a) => scale(a, 1 / Math.hypot(...a));

/**
 * Halo relay position in the Moon-fixed frame (km from the Moon's centre). The orbit circles the
 * anti-Earth point, so it needs Earth's direction, which comes from the sub-Earth point.
 * @param {number[]} earthDir unit vector from the Moon's centre toward Earth, Moon-fixed
 */
export function haloPosition(relay, earthDir, t) {
  const x = scale(earthDir, -1);
  const z = norm(add([0, 0, 1], scale(x, -x[2]))); // lunar north, made square to x
  const y = cross(z, x);
  const phi = (2 * Math.PI * (t - relay.epochMs)) / relay.periodMs;
  return add(scale(x, relay.distanceKm), scale(y, relay.amplitudeKm * Math.sin(phi)), scale(z, relay.amplitudeKm * Math.cos(phi)));
}

/**
 * Elliptical relay position in the Moon-fixed frame (km). The orbit plane is fixed to the stars,
 * so in the Moon-fixed frame its node turns west once per sidereal month.
 */
export function ellipsePosition(relay, t) {
  const rp = MOON_RADIUS_KM + relay.perilAltKm;
  const ra = MOON_RADIUS_KM + relay.apoAltKm;
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const dt = t - relay.epochMs;
  const M = (2 * Math.PI * dt) / relay.periodMs;
  let E = M;
  for (let k = 0; k < 12; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));
  const node = (relay.nodeDeg - (360 * dt) / SIDEREAL_MONTH_MS) * DEG;
  const inc = relay.inclinationDeg * DEG;
  const n = [Math.cos(node), Math.sin(node), 0];
  const m = [-Math.cos(inc) * Math.sin(node), Math.cos(inc) * Math.cos(node), Math.sin(inc)];
  const u = relay.argPeriDeg * DEG + nu;
  return scale(add(scale(n, Math.cos(u)), scale(m, Math.sin(u))), r);
}

/** Elevation in degrees of a point (Moon-fixed, km) seen from a site on the smooth sphere. */
export function elevationFrom(site, posKm) {
  const up = unit(site.lonE, site.lat);
  const rel = add(posKm, scale(up, -MOON_RADIUS_KM));
  return Math.asin(Math.min(1, Math.max(-1, dot(rel, up) / Math.hypot(...rel)))) / DEG;
}

/** Relay elevation above the site's smooth horizon at one instant. */
export function relayElevation(eph, relay, site, t) {
  if (relay.kind === 'halo') {
    const p = subPointsAt(eph, t);
    return elevationFrom(site, haloPosition(relay, unit(p.earthLon, p.earthLat), t));
  }
  return elevationFrom(site, ellipsePosition(relay, t));
}

/**
 * Hours the relay is above the smooth horizon between start and end. Crossings are found by
 * linear interpolation between samples, as calc.js does for the Sun and Earth.
 * @returns {{intervals: Array<[number, number]>, hours: number, stayHours: number}}
 */
export function relayWindows(eph, relay, site, start, end) {
  const times = [];
  for (let t = start; t < end; t += STEP_MS) times.push(t);
  times.push(end);
  const els = times.map((t) => relayElevation(eph, relay, site, t));
  const raw = [];
  for (let i = 0; i < times.length - 1; i++) {
    const [t0, t1, e0, e1] = [times[i], times[i + 1], els[i], els[i + 1]];
    if (e0 > 0 && e1 > 0) raw.push([t0, t1]);
    else if (e0 > 0 !== e1 > 0) {
      const tc = t0 + (e0 / (e0 - e1)) * (t1 - t0);
      raw.push(e0 > 0 ? [t0, tc] : [tc, t1]);
    }
  }
  const intervals = mergeIntervals(raw);
  return { intervals, hours: sumHours(intervals), stayHours: (end - start) / HOUR_MS };
}

/** Which relay a site needs, or null when Earth is in view. */
export function relayFor(site, analyses) {
  if (site?.id === 'change4') return RELAYS.queqiao;
  if (site?.id === 'change6') return RELAYS.queqiao2;
  if (site?.id === 'custom' && analyses.some((a) => a.bodies.earth.hours < MIN_EARTH_HOURS)) return RELAYS.queqiao2;
  return null;
}

const pct = (v) => `${(Math.min(Math.max(v, 0), 1) * 100).toFixed(3)}%`;

function trackHtml(win, a) {
  const span = a.end - a.start;
  return win.intervals
    .map(([s, e]) => `<span style="left:${pct((s - a.start) / span)};width:${pct((e - s) / span)}"></span>`)
    .join('');
}

function blockHtml(label, win, a) {
  return `<div class="relay-block">
    <p class="relay-scn">${label}</p>
    <div class="relay-row"><span class="relay-name">Relay up</span><div class="relay-track" aria-hidden="true">${trackHtml(win, a)}</div><span class="relay-h">${fmtHours(win.hours)} h</span></div>
  </div>`;
}

/**
 * Fill the relay panel. Safe to call before the Moon table loads: the halo needs it, so the
 * panel stays hidden until then.
 * @param {{original: object, delayed: object}} p the plan pair from main.js
 */
export function renderRelay(p, site, eph) {
  const el = typeof document !== 'undefined' ? document.getElementById('relay-panel') : null;
  if (!el) return;
  try {
    const relay = relayFor(site, [p.original, p.delayed]);
    if (!relay) {
      el.hidden = false;
      el.innerHTML = '<p class="relay-none">Earth is in view, so this site needs no relay.</p>';
      return;
    }
    if (!eph) {
      el.hidden = true;
      return;
    }
    const o = relayWindows(eph, relay, site, p.original.start, p.original.end);
    const d = relayWindows(eph, relay, site, p.delayed.start, p.delayed.end);
    el.hidden = false;
    el.innerHTML = `<p class="relay-cap">Far-side relay, ${relay.name}, illustrative orbit
      <span class="relay-note">Earth does not rise here. The lander talks to Earth through a relay satellite. The model assumes that the relay always sees Earth.</span></p>
      ${blockHtml('Original', o, p.original)}
      ${blockHtml('Delayed', d, p.delayed)}
      <p class="relay-read">Through ${relay.name}, the lander can reach Earth for ${fmtHours(o.hours)} of ${fmtHours(o.stayHours)} hours after the original touchdown and ${fmtHours(d.hours)} of ${fmtHours(d.stayHours)} hours after the delayed touchdown. The orbit is illustrative.</p>`;
  } catch (err) {
    // Never break the page for an extra panel.
    console.warn('Relay panel skipped:', err);
    el.hidden = true;
  }
}
