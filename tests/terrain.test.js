// Checks for the LOLA terrain horizon. Written with an AI tool (Claude).
// Bars set before the first run (Nov 15 2026, 7:30 PM PT): with no profile the analysis is exactly the
// smooth one, a flat profile of k degrees equals a k degree margin, a skyline only blocks the azimuths
// it covers, and every built-in site has 360 finite values.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris } from '../src/moonsky.js';
import { SITES, PRESET_START_MS } from '../src/data.js';
import { analyze, aboveIntervals, horizonAt, sumHours, HOUR_MS } from '../src/calc.js';
import { analyzeStay, slipSeries } from '../src/slips.js';
import { profileFor, hasTerrain, maxHorizon } from '../src/terrain.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);
const flat = (k) => Array(360).fill(k);
const summary = (a) => ({ sun: a.bodies.sun.hours, earth: a.bodies.earth.hours, both: a.both.hours });

describe('terrain profile data', () => {
  it('has 360 finite values for every built-in site', () => {
    for (const id of Object.keys(SITES)) {
      const p = profileFor(id);
      expect(p, id).not.toBeNull();
      expect(p.length).toBe(360);
      expect(p.every(Number.isFinite)).toBe(true);
    }
    expect(profileFor('custom')).toBeNull();
    expect(hasTerrain('custom')).toBe(false);
  });

  it('is plausible: Athena reaches a few degrees, Blue Ghost stays under 1 degree', () => {
    expect(maxHorizon('athena')).toBeGreaterThan(2);
    expect(maxHorizon('athena')).toBeLessThan(10);
    expect(maxHorizon('blueGhost')).toBeLessThan(1);
  });

  it('interpolates between whole degrees and wraps at north', () => {
    const p = flat(0);
    p[359] = 2;
    p[10] = 4;
    expect(horizonAt(p, 359.5)).toBeCloseTo(1);
    expect(horizonAt(p, -0.5)).toBeCloseTo(1);
    expect(horizonAt(p, 9.25)).toBeCloseTo(1);
    expect(horizonAt(p, 370)).toBeCloseTo(4);
  });
});

describe('analysis with a terrain profile', () => {
  const athena = SITES.athena;
  const stay = (extra) => analyzeStay(eph, athena, PRESET_START_MS, extra);

  it('leaves the default path unchanged when no profile is given', () => {
    const a = stay({});
    const b = stay({ horizonProfile: undefined });
    expect(b).toEqual(a);
    expect(summary(stay({ horizonProfile: null }))).toEqual(summary(a));
    expect(slipSeries(eph, athena, PRESET_START_MS, 3, 0, null)).toEqual(slipSeries(eph, athena, PRESET_START_MS, 3, 0));
  });

  it('gives the same answer for a flat profile of k degrees as a k degree margin', () => {
    for (const k of [0, 1, 2.5]) {
      const margin = stay({ horizonDeg: k });
      const prof = stay({ horizonProfile: flat(k) });
      expect(prof.bodies.sun.intervals).toEqual(margin.bodies.sun.intervals);
      expect(prof.bodies.earth.intervals).toEqual(margin.bodies.earth.intervals);
      expect(prof.both.hours).toBeCloseTo(margin.both.hours, 9);
    }
  });

  it('adds the margin on top of the skyline', () => {
    const a = stay({ horizonDeg: 1, horizonProfile: flat(1) });
    const b = stay({ horizonDeg: 2 });
    expect(a.bodies.sun.intervals).toEqual(b.bodies.sun.intervals);
  });

  it('blocks only the azimuths the skyline covers', () => {
    const rows = [
      { t: 0, sunEl: 3, sunAz: 90, earthEl: 3, earthAz: 270 },
      { t: HOUR_MS, sunEl: 3, sunAz: 91, earthEl: 3, earthAz: 271 },
    ];
    const wall = flat(0).map((_, az) => (az >= 80 && az <= 100 ? 10 : 0));
    expect(sumHours(aboveIntervals(rows, 'sun', 0, wall))).toBe(0);
    expect(sumHours(aboveIntervals(rows, 'earth', 0, wall))).toBe(1);
    const res = analyze({ rows, horizonProfile: wall });
    expect(res.bodies.sun.hours).toBe(0);
    expect(res.bodies.earth.hours).toBe(1);
  });

  it('interpolates a crossing against the skyline at both samples', () => {
    // Elevation 1 → 3 while the skyline under the Sun goes 2 → 2: the crossing is halfway.
    const rows = [
      { t: 0, sunEl: 1, sunAz: 0 },
      { t: HOUR_MS, sunEl: 3, sunAz: 0 },
    ];
    expect(sumHours(aboveIntervals(rows, 'sun', 0, flat(2)))).toBeCloseTo(0.5);
    // Skyline 0 at the first sample's azimuth and 4 at the second: differences +1 and -1, crossing halfway.
    const p = flat(0);
    p[10] = 4;
    const rows2 = [
      { t: 0, sunEl: 1, sunAz: 0 },
      { t: HOUR_MS, sunEl: 3, sunAz: 10 },
    ];
    expect(sumHours(aboveIntervals(rows2, 'sun', 0, p))).toBeCloseTo(0.5);
  });

  it('prints Athena smooth against LOLA terrain for reporting', () => {
    const report = (label, t0) => {
      const smooth = analyzeStay(eph, athena, t0, {});
      const terrain = analyzeStay(eph, athena, t0, { horizonProfile: profileFor('athena') });
      const f = (x) => x.toFixed(2);
      console.log(
        `${label} ${new Date(t0).toISOString().slice(0, 16)}Z  smooth: Sun ${f(smooth.bodies.sun.hours)} h, Earth ${f(smooth.bodies.earth.hours)} h, both ${f(smooth.both.hours)} h | ` +
          `terrain: Sun ${f(terrain.bodies.sun.hours)} h, Earth ${f(terrain.bodies.earth.hours)} h, both ${f(terrain.both.hours)} h`,
      );
      return { smooth, terrain };
    };
    report('Athena preset', PRESET_START_MS);
    const { smooth, terrain } = report('Athena', Date.parse('2025-03-15T00:00:00Z'));
    expect(Number.isFinite(terrain.both.hours)).toBe(true);
    expect(smooth.both.hours).toBeGreaterThanOrEqual(0);
    for (const id of Object.keys(SITES)) {
      const p = profileFor(id);
      console.log(`${id}: horizon max ${Math.max(...p).toFixed(2)} deg at az ${p.indexOf(Math.max(...p))}, min ${Math.min(...p).toFixed(2)}`);
    }
  });
});
