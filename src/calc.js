// Calculation contract (see docs/HANDOFF.md → "Calculation contract").
// Everything is computed in UTC milliseconds at full precision; rounding only
// happens in format.js when values reach the screen.

export const HOUR_MS = 3_600_000;
export const BODIES = ['sun', 'earth'];
const EL_KEY = { sun: 'sunEl', earth: 'earthEl' };
const AZ_KEY = { sun: 'sunAz', earth: 'earthAz' };

/** Step 1 — an object's centre is above the modelled horizon when elevation > level (0° by default). */
export const isAbove = (el, level = 0) => el > level;

/** Margins the app offers: the lowest N degrees of sky blocked by terrain. 0 is the smooth horizon. */
export const HORIZON_MARGINS = [0, 1, 2, 5];

/**
 * Steps 2–3 — above-horizon intervals for one body, with linear interpolation
 * of each crossing. Touching intervals are merged so an exact 0° sample does
 * not create a spurious gap.
 * @returns {Array<[number, number]>} [startMs, endMs] pairs
 */
export function aboveIntervals(rows, body, level = 0) {
  const k = EL_KEY[body];
  const raw = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const { t: t0 } = rows[i];
    const { t: t1 } = rows[i + 1];
    // Elevations are measured from the blocked line, so the crossing is interpolated against it.
    const e0 = rows[i][k] - level;
    const e1 = rows[i + 1][k] - level;
    const a0 = isAbove(e0);
    const a1 = isAbove(e1);
    if (a0 && a1) raw.push([t0, t1]);
    else if (a0 !== a1) {
      const f = e0 / (e0 - e1);
      const tc = t0 + f * (t1 - t0);
      if (a0) raw.push([t0, tc]); // setting
      else raw.push([tc, t1]); // rising
    }
  }
  return mergeIntervals(raw);
}

export function mergeIntervals(list) {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const sumHours = (intervals) => intervals.reduce((s, [a, b]) => s + (b - a), 0) / HOUR_MS;

/** Step 4 — intersection of two interval lists. */
export function intersect(a, b) {
  const out = [];
  for (const [as, ae] of a) {
    for (const [bs, be] of b) {
      const s = Math.max(as, bs);
      const e = Math.min(ae, be);
      if (e > s) out.push([s, e]);
    }
  }
  return mergeIntervals(out);
}

/** The parts of `a` that `b` does not cover. */
export function subtractIntervals(a, b) {
  const cuts = mergeIntervals(b.map(([s, e]) => [s, e]));
  const out = [];
  for (const [as, ae] of a) {
    let cursor = as;
    for (const [bs, be] of cuts) {
      if (be <= cursor || bs >= ae) continue;
      if (bs > cursor) out.push([cursor, bs]);
      cursor = Math.max(cursor, be);
    }
    if (cursor < ae) out.push([cursor, ae]);
  }
  return out;
}

/** The parts of [start, end] that the intervals leave uncovered. */
export const gapsIn = (intervals, start, end) => subtractIntervals([[start, end]], intervals);

/** Length in hours of the longest interval in a list, 0 when the list is empty. */
export const longestHours = (intervals) => intervals.reduce((m, [a, b]) => Math.max(m, b - a), 0) / HOUR_MS;

/** The first interval at least `hours` long, or null. One millisecond of slack absorbs float noise at the edges. */
export function firstAtLeast(intervals, hours) {
  const need = hours * HOUR_MS - 1;
  return intervals.find(([a, b]) => b - a >= need) ?? null;
}

/**
 * Continuous stretches inside the window. Totals hide how time is split: 30 hours in one piece is a
 * different plan from 30 hours in short pieces. A stretch that runs into either edge of the window is
 * cut there, because the model only covers these 72 hours.
 */
export function stretchesOf(res) {
  return {
    longestBoth: longestHours(res.both.intervals),
    longestDark: longestHours(gapsIn(res.bodies.sun.lit, res.start, res.end)),
    longestNoEarth: longestHours(gapsIn(res.bodies.earth.intervals, res.start, res.end)),
  };
}

/** Rising / setting events derived from the merged intervals' interior edges. */
export function crossingEvents(intervals, start, end, body) {
  const ev = [];
  for (const [a, b] of intervals) {
    if (a > start) ev.push({ body, type: 'rise', t: a });
    if (b < end) ev.push({ body, type: 'set', t: b });
  }
  return ev;
}

/** Full analysis of one 72-hour scenario. */
export function analyze(dataset) {
  const { rows } = dataset;
  const start = rows[0].t;
  const end = rows.at(-1).t;
  const horizonDeg = dataset.horizonDeg ?? 0;
  const res = { ...dataset, horizonDeg, start, end, bodies: {} };
  for (const body of BODIES) {
    const intervals = aboveIntervals(rows, body, horizonDeg);
    const hours = sumHours(intervals);
    const totalH = (end - start) / HOUR_MS;
    res.bodies[body] = {
      intervals,
      hours,
      events: crossingEvents(intervals, start, end, body),
      whole: hours === 0 ? 'below' : Math.abs(hours - totalH) < 1e-9 ? 'above' : null,
    };
  }
  // Earth in front of the Sun. The Sun stays above the horizon (intervals and
  // events are unchanged) but gives no light, so sunlit hours leave it out.
  const horizonSun = res.bodies.sun.intervals;
  const eclipseTotal = intersect(dataset.eclipse?.total ?? [], horizonSun);
  const eclipseAny = intersect(dataset.eclipse?.any ?? [], horizonSun);
  const lit = eclipseTotal.length ? subtractIntervals(horizonSun, eclipseTotal) : horizonSun;
  res.bodies.sun = {
    ...res.bodies.sun,
    lit,
    hours: sumHours(lit),
    horizonHours: res.bodies.sun.hours,
  };
  res.eclipse = { total: eclipseTotal, any: eclipseAny, totalHours: sumHours(eclipseTotal) };
  const both = intersect(lit, res.bodies.earth.intervals);
  res.both = { intervals: both, hours: sumHours(both) };
  res.stretches = stretchesOf(res);
  res.events = [...res.bodies.sun.events, ...res.bodies.earth.events].sort((x, y) => x.t - y.t);
  const elRange = rows.reduce(
    (r, row) => [Math.min(r[0], row.sunEl, row.earthEl), Math.max(r[1], row.sunEl, row.earthEl)],
    [Infinity, -Infinity],
  );
  res.elRange = elRange;
  return res;
}

/** Step 5 — delayed minus original, per metric, at full precision. */
export function delayImpact(original, delayed) {
  return {
    sun: delayed.bodies.sun.hours - original.bodies.sun.hours,
    earth: delayed.bodies.earth.hours - original.bodies.earth.hours,
    both: delayed.both.hours - original.both.hours,
  };
}

/** Shortest-path angular interpolation in degrees, result in [0, 360). */
export function lerpAzimuth(a0, a1, f) {
  let d = ((a1 - a0 + 540) % 360) - 180;
  return (((a0 + d * f) % 360) + 360) % 360;
}

/** Step 7 — sky geometry at an arbitrary instant inside the window. */
export function sampleAt(rows, t) {
  const first = rows[0].t;
  const last = rows.at(-1).t;
  const tc = Math.min(Math.max(t, first), last);
  let i = Math.min(Math.floor((tc - first) / HOUR_MS), rows.length - 2);
  // Grid is hourly, but stay correct for any monotonic grid.
  while (i > 0 && rows[i].t > tc) i--;
  while (i < rows.length - 2 && rows[i + 1].t < tc) i++;
  const r0 = rows[i];
  const r1 = rows[i + 1];
  const f = (tc - r0.t) / (r1.t - r0.t);
  const lerp = (a, b) => a + (b - a) * f;
  return {
    t: tc,
    sun: { el: lerp(r0.sunEl, r1.sunEl), az: lerpAzimuth(r0.sunAz, r1.sunAz, f) },
    earth: { el: lerp(r0.earthEl, r1.earthEl), az: lerpAzimuth(r0.earthAz, r1.earthAz, f) },
  };
}

/** Is `body` above the horizon at `t`, judged from the same intervals as the bars. */
export function aboveAt(analysis, body, t) {
  return analysis.bodies[body].intervals.some(([a, b]) => t >= a && t < b) ||
    (t === analysis.end && analysis.bodies[body].intervals.some(([, b]) => b === analysis.end));
}

/** Is Earth covering the Sun at `t`: 'total', 'partial' or null. Only while the Sun is above the horizon. */
export function eclipseAt(analysis, t) {
  const inside = (list) => list.some(([a, b]) => t >= a && t <= b);
  if (inside(analysis.eclipse.total)) return 'total';
  if (inside(analysis.eclipse.any)) return 'partial';
  return null;
}

/** Step 6 — the next crossing after the selected instant, or null. */
export function nextCrossing(analysis, t) {
  return analysis.events.find((e) => e.t > t) ?? null;
}
