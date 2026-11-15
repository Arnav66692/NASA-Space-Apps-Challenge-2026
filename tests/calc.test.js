import { describe, it, expect } from 'vitest';
import { DATASETS, parseHorizonsCsv } from '../src/data.js';
import {
  analyze,
  delayImpact,
  nextCrossing,
  sampleAt,
  aboveIntervals,
  sumHours,
  intersect,
  lerpAzimuth,
  aboveAt,
  HOUR_MS,
} from '../src/calc.js';
import { fmtHours, fmtDuration, fmtUtc, fmtChange } from '../src/format.js';

const A = {};
for (const site of ['athena', 'blueGhost']) {
  A[site] = { original: analyze(DATASETS[site].original), delayed: analyze(DATASETS[site].delayed) };
}
const close = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('data adapter', () => {
  it('loads 73 hourly samples / 72 intervals per preset', () => {
    for (const site of Object.values(DATASETS)) {
      for (const ds of Object.values(site)) {
        expect(ds.rows).toHaveLength(73);
        expect(ds.rows.at(-1).t - ds.rows[0].t).toBe(72 * HOUR_MS);
      }
    }
  });
  it('rejects non-increasing timestamps and non-finite values', () => {
    const h = '"timeUtc","sunElevationDeg","earthElevationDeg","sunAzimuthDeg","earthAzimuthDeg","latitudeDeg","longitudeEastDeg"';
    expect(() => parseHorizonsCsv(`${h}\n"2025-03-15T01:00:00Z","1","1","1","1","1","1"\n"2025-03-15T00:00:00Z","1","1","1","1","1","1"`)).toThrow(/increase/);
    expect(() => parseHorizonsCsv(`${h}\n"2025-03-15T00:00:00Z","x","1","1","1","1","1"`)).toThrow(/finite/);
  });
});

describe('reference totals (hours, full precision)', () => {
  const ref = {
    blueGhost: { original: [44.177521847, 72, 44.177521847], delayed: [0, 72, 0] },
    athena: { original: [72, 66.497844255, 66.497844255], delayed: [0, 17.750254565, 0] },
  };
  for (const [site, sc] of Object.entries(ref)) {
    for (const [scenario, [sun, earth, both]] of Object.entries(sc)) {
      it(`${site} ${scenario}`, () => {
        const a = A[site][scenario];
        close(a.bodies.sun.hours, sun);
        close(a.bodies.earth.hours, earth);
        close(a.both.hours, both);
      });
    }
  }
  it('delay impact', () => {
    const bg = delayImpact(A.blueGhost.original, A.blueGhost.delayed);
    close(bg.sun, -44.177521847);
    close(bg.earth, 0);
    close(bg.both, -44.177521847);
    const at = delayImpact(A.athena.original, A.athena.delayed);
    close(at.sun, -72);
    close(at.earth, -48.74758969);
    close(at.both, -66.497844255);
    expect(fmtHours(at.earth)).toBe('-48.7');
    expect(fmtChange(at.earth)).toBe('48.7 fewer hours');
    expect(fmtChange(bg.earth)).toBe('No change');
  });
  it('rounded UI values', () => {
    expect(fmtHours(A.blueGhost.original.bodies.sun.hours)).toBe('44.2');
    expect(fmtHours(A.athena.original.bodies.earth.hours)).toBe('66.5');
    expect(fmtHours(A.athena.delayed.bodies.earth.hours)).toBe('17.8');
    expect(fmtHours(A.athena.original.bodies.sun.hours)).toBe('72');
  });
});

describe('events and countdowns', () => {
  it('Blue Ghost original sunset ~20:10:39 UTC Mar 16, countdown 44 h 11 min', () => {
    const a = A.blueGhost.original;
    expect(a.events).toHaveLength(1);
    const e = a.events[0];
    expect(e).toMatchObject({ body: 'sun', type: 'set' });
    expect(fmtUtc(e.t, { seconds: true })).toBe('Mar 16 · 20:10:39 UTC');
    expect(fmtUtc(e.t)).toBe('Mar 16 · 20:11 UTC');
    expect(fmtDuration(nextCrossing(a, a.start).t - a.start)).toBe('44 h 11 min');
    expect(a.bodies.earth.whole).toBe('above');
  });
  it('Blue Ghost delayed: no crossings, Sun near −71.1° at hour 0', () => {
    const a = A.blueGhost.delayed;
    expect(a.events).toHaveLength(0);
    expect(nextCrossing(a, a.start)).toBeNull();
    expect(a.bodies.sun.whole).toBe('below');
    expect(sampleAt(a.rows, a.start).sun.el.toFixed(1)).toBe('-71.1');
    expect(a.elRange[0]).toBeLessThan(-71.27);
  });
  it('Athena original Earthset ~18:29:52 UTC Mar 17, countdown 66 h 30 min', () => {
    const a = A.athena.original;
    expect(a.events).toHaveLength(1);
    expect(a.events[0]).toMatchObject({ body: 'earth', type: 'set' });
    expect(fmtUtc(a.events[0].t, { seconds: true })).toBe('Mar 17 · 18:29:52 UTC');
    expect(fmtDuration(a.events[0].t - a.start)).toBe('66 h 30 min');
    expect(a.bodies.sun.whole).toBe('above');
  });
  it('Athena delayed Earthrise ~06:14:59 UTC Mar 26; 54 h 15 → 53 h 15 after one hour', () => {
    const a = A.athena.delayed;
    expect(a.events).toHaveLength(1);
    const e = a.events[0];
    expect(e).toMatchObject({ body: 'earth', type: 'rise' });
    expect(fmtUtc(e.t, { seconds: true })).toBe('Mar 26 · 06:14:59 UTC');
    expect(fmtDuration(e.t - a.start)).toBe('54 h 15 min');
    expect(fmtDuration(e.t - (a.start + HOUR_MS))).toBe('53 h 15 min');
    expect(fmtDuration(a.end - e.t)).toBe('17 h 45 min');
    expect(nextCrossing(a, e.t + 1)).toBeNull();
    expect(aboveAt(a, 'earth', e.t + 1)).toBe(true);
    expect(aboveAt(a, 'earth', e.t - 1)).toBe(false);
  });
});

describe('edge cases', () => {
  const mk = (els) =>
    els.map((e, i) => ({ t: i * HOUR_MS, sunEl: e, earthEl: 1, sunAz: 0, earthAz: 0 }));
  it('exact zero sample does not create a gap', () => {
    const iv = aboveIntervals(mk([1, 0, 1]), 'sun');
    expect(iv).toEqual([[0, 2 * HOUR_MS]]);
  });
  it('setting and rising interpolate', () => {
    expect(sumHours(aboveIntervals(mk([1, -1]), 'sun'))).toBeCloseTo(0.5);
    expect(sumHours(aboveIntervals(mk([-3, 1]), 'sun'))).toBeCloseTo(0.25);
  });
  it('intersection', () => {
    expect(intersect([[0, 10]], [[5, 20]])).toEqual([[5, 10]]);
    expect(intersect([[0, 4]], [[5, 20]])).toEqual([]);
  });
  it('azimuth interpolates across north the short way', () => {
    expect(lerpAzimuth(359, 1, 0.5)).toBeCloseTo(0);
    expect(lerpAzimuth(359.056693, 0.63955, 0.5)).toBeCloseTo((359.056693 + 360.63955) / 2);
    expect(lerpAzimuth(10, 350, 0.25)).toBeCloseTo(5);
  });
});
