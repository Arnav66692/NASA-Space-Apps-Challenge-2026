// Checks for the stay length: 72 hours, 7 days, or a lunar day. Written with an AI tool (Claude).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris } from '../src/moonsky.js';
import { SITES, PRESET_START_MS, PRESET_SLIP_DAYS } from '../src/data.js';
import { HOUR_MS } from '../src/calc.js';
import { buildRows, analyzeWindow, WINDOW_HOURS, STAY_CHOICES, stayName, isStayChoice } from '../src/window.js';
import { analyzeStay } from '../src/slips.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);

const DAY_MS = 24 * HOUR_MS;
const site = SITES.athena;
const delayedStart = PRESET_START_MS + PRESET_SLIP_DAYS * DAY_MS;

/** Clip a list of [a, b] intervals to [lo, hi]. */
const clip = (ivs, lo, hi) => ivs.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b > a);

describe('stay length', () => {
  it('offers 72 hours, 7 days and a lunar day, with 72 hours as the default', () => {
    expect(STAY_CHOICES).toEqual([72, 168, 709]);
    expect(WINDOW_HOURS).toBe(72);
    expect(stayName(709)).toBe('lunar day');
    expect(isStayChoice(168)).toBe(true);
    expect(isStayChoice(100)).toBe(false);
  });

  it('builds hours + 1 hourly rows for each choice', () => {
    for (const h of STAY_CHOICES) {
      const rows = buildRows(eph, site, PRESET_START_MS, h);
      expect(rows).toHaveLength(h + 1);
      expect(rows.at(-1).t - rows[0].t).toBe(h * HOUR_MS);
    }
    expect(buildRows(eph, site, PRESET_START_MS)).toHaveLength(73);
  });

  it('refuses a stay that runs past the end of the Moon table', () => {
    const late = eph.endMs - 100 * HOUR_MS;
    expect(() => buildRows(eph, site, late, 72)).not.toThrow();
    expect(() => buildRows(eph, site, late, 709)).toThrow(RangeError);
  });

  it('gives the same 72 h analysis as the slip strip uses', () => {
    const a = analyzeWindow(eph, site, delayedStart, 72);
    const b = analyzeStay(eph, site, delayedStart);
    expect(a.rows).toEqual(b.rows);
    expect(a.bodies.sun.hours).toBe(b.bodies.sun.hours);
    expect(a.bodies.earth.hours).toBe(b.bodies.earth.hours);
    expect(a.both.hours).toBe(b.both.hours);
  });

  it('agrees with the 72 h analysis inside the first 72 hours of a longer stay', () => {
    for (const t0 of [PRESET_START_MS, delayedStart]) {
      const short = analyzeWindow(eph, site, t0, 72);
      for (const h of [168, 709]) {
        const long = analyzeWindow(eph, site, t0, h);
        expect(long.rows.slice(0, 73)).toEqual(short.rows);
        const end = t0 + 72 * HOUR_MS;
        for (const body of ['sun', 'earth']) {
          const a = clip(long.bodies[body].intervals, t0, end);
          const b = short.bodies[body].intervals;
          expect(a.length).toBe(b.length);
          a.forEach(([s, e], i) => {
            expect(Math.abs(s - b[i][0])).toBeLessThan(1000);
            expect(Math.abs(e - b[i][1])).toBeLessThan(1000);
          });
        }
        expect(long.bodies.sun.hours).toBeGreaterThanOrEqual(short.bodies.sun.hours - 1e-9);
      }
    }
  });
});
