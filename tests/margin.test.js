// Checks for the terrain margin. Written with an AI tool.
// Bars were fixed before the first run (Nov 15 2026, 1:55 PM PT):
//  1. Margin 0 gives exactly the same totals and crossings as before.
//  2. Crossings found against the blocked line agree within 2 minutes with an independent
//     search (moonsky.js findRiseSet, bisected to the second on 10 minute samples).
//  3. Raising the margin never adds hours, for any body, at any tested site and date.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris, findRiseSet } from '../src/moonsky.js';
import { buildRows, WINDOW_HOURS } from '../src/window.js';
import { DATASETS, SITES, PRESET_START_MS } from '../src/data.js';
import { analyze, aboveIntervals, HORIZON_MARGINS, HOUR_MS } from '../src/calc.js';
import { slipSeries } from '../src/slips.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);

const DAY_MS = 24 * HOUR_MS;
const CROSSING_BAR_MS = 2 * 60_000;
const SEARCH_STEP_MS = 10 * 60_000;
const MARGINS_ABOVE_ZERO = HORIZON_MARGINS.filter((m) => m > 0);
const SITE_IDS = ['blueGhost', 'apollo11', 'apollo17', 'chandrayaan3', 'slim'];
const STARTS = [0, 5, 9, 13, 21].map((d) => PRESET_START_MS + d * DAY_MS);
// The first run used STARTS and SITE_IDS here and found only 3 crossings, because most 72 hour
// windows hold no sunrise or sunset. The sample was widened to every day for a month and the two
// south pole sites. The 2 minute bar did not change.
const CROSSING_SITE_IDS = [...SITE_IDS, 'athena', 'odysseus'];
const CROSSING_STARTS = Array.from({ length: 30 }, (_, d) => PRESET_START_MS + d * DAY_MS);

describe('margin 0 is the smooth horizon', () => {
  it('the four reference stays keep every total and crossing', () => {
    for (const byScenario of Object.values(DATASETS)) {
      for (const ds of Object.values(byScenario)) {
        const before = analyze(ds);
        const zero = analyze({ ...ds, horizonDeg: 0 });
        expect(zero.bodies.sun.hours).toBe(before.bodies.sun.hours);
        expect(zero.bodies.earth.hours).toBe(before.bodies.earth.hours);
        expect(zero.both.hours).toBe(before.both.hours);
        expect(zero.events).toEqual(before.events);
        expect(before.horizonDeg).toBe(0);
      }
    }
  });

  it('a plain interval call matches the default level', () => {
    const rows = DATASETS.blueGhost.original.rows;
    expect(aboveIntervals(rows, 'sun', 0)).toEqual(aboveIntervals(rows, 'sun'));
  });
});

describe('crossings against the blocked line', () => {
  it('agree with an independent search within 2 minutes', { timeout: 60_000 }, () => {
    let compared = 0;
    let worst = 0;
    for (const id of CROSSING_SITE_IDS) {
      const site = SITES[id];
      for (const startMs of CROSSING_STARTS) {
        const endMs = startMs + WINDOW_HOURS * HOUR_MS;
        for (const margin of MARGINS_ABOVE_ZERO) {
          const a = analyze({ rows: buildRows(eph, site, startMs), horizonDeg: margin });
          for (const body of ['sun', 'earth']) {
            const ours = a.bodies[body].events;
            const theirs = findRiseSet(eph, { lat: site.lat, lon: site.lonE }, body, startMs, endMs, margin, SEARCH_STEP_MS);
            // Crossings in the first or last minute can fall either side of the window edge.
            const inside = theirs.filter((e) => e.timeMs - startMs > 60_000 && endMs - e.timeMs > 60_000);
            expect(ours.map((e) => e.type)).toEqual(inside.map((e) => e.kind));
            ours.forEach((e, i) => {
              const gap = Math.abs(e.t - inside[i].timeMs);
              worst = Math.max(worst, gap);
              expect(gap).toBeLessThan(CROSSING_BAR_MS);
            });
            compared += ours.length;
          }
        }
      }
    }
    // The check means nothing if there were no crossings to compare.
    expect(compared).toBeGreaterThanOrEqual(20);
    console.info(`margin crossings compared: ${compared}, worst gap ${(worst / 1000).toFixed(0)} s`);
  });
});

describe('raising the margin', () => {
  it('never adds hours', () => {
    for (const id of SITE_IDS) {
      for (const startMs of STARTS) {
        const rows = buildRows(eph, SITES[id], startMs);
        let prev = null;
        for (const margin of HORIZON_MARGINS) {
          const a = analyze({ rows, horizonDeg: margin });
          const now = { sun: a.bodies.sun.hours, earth: a.bodies.earth.hours, both: a.both.hours };
          if (prev) for (const k of Object.keys(now)) expect(now[k]).toBeLessThanOrEqual(prev[k] + 1e-9);
          prev = now;
        }
      }
    }
  });

  it('a margin above the highest Sun leaves no sunlight', () => {
    const rows = buildRows(eph, SITES.athena, PRESET_START_MS);
    const highest = Math.max(...rows.map((r) => r.sunEl));
    const a = analyze({ rows, horizonDeg: Math.ceil(highest) + 1 });
    expect(a.bodies.sun.hours).toBe(0);
    expect(a.bodies.sun.whole).toBe('below');
  });

  it('flows through the slip strip', () => {
    const smooth = slipSeries(eph, SITES.athena, PRESET_START_MS, 30, 0);
    const blocked = slipSeries(eph, SITES.athena, PRESET_START_MS, 30, 2);
    expect(blocked).toHaveLength(smooth.length);
    blocked.forEach((c, i) => expect(c.bothHours).toBeLessThanOrEqual(smooth[i].bothHours + 1e-9));
    expect(blocked.some((c, i) => c.bothHours < smooth[i].bothHours - 0.05)).toBe(true);
  });
});
