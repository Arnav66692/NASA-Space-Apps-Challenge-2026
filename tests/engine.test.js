// Checks for the "any site, any date" engine: the bundled Moon table plus
// moonsky.js, compared with direct JPL Horizons answers. Written with an AI tool (Claude).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris, skyAt, separationDeg } from '../src/moonsky.js';
import { buildRows, WINDOW_HOURS } from '../src/window.js';
import { DATASETS, SITES, PRESET_START_MS, customSite } from '../src/data.js';
import { analyze, HOUR_MS } from '../src/calc.js';
import { slipWords } from '../src/format.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);
const DAY_MS = 24 * HOUR_MS;

// Bars. The 0.5 degree bar was fixed before the first comparison ran.
const P1_BAR_DEG = 0.5;
const PRESET_BAR_DEG = 0.01;
const PRESET_HOURS_BAR = 0.02;
const PRESET_CROSSING_BAR_MS = 2 * 60_000;

describe('10 sites x 10 dates against direct JPL Horizons queries', () => {
  it('all 200 Sun and Earth directions are within 0.5 degrees', () => {
    const reference = JSON.parse(readFileSync(join(ROOT, 'tests', 'reference', 'p1_horizons.json'), 'utf8'));
    const seps = [];
    for (const { site, sun, earth } of reference) {
      for (let i = 0; i < sun.length; i += 1) {
        const sky = skyAt(eph, site, Date.parse(sun[i].date));
        seps.push(separationDeg(sky.sun, sun[i]), separationDeg(sky.earth, earth[i]));
      }
    }
    expect(seps).toHaveLength(200);
    expect(Math.max(...seps)).toBeLessThan(P1_BAR_DEG);
    // Observed worst case, recorded so a regression is loud.
    expect(Math.max(...seps)).toBeLessThan(0.006);
  });
});

describe('table engine reproduces the four Horizons preset files', () => {
  const cases = [];
  for (const [siteId, byScenario] of Object.entries(DATASETS)) {
    for (const [scenario, ds] of Object.entries(byScenario)) cases.push({ siteId, scenario, ds });
  }
  it('covers 584 directions (73 rows x 4 files x 2 bodies) within 0.01 degrees', () => {
    let count = 0;
    let worst = 0;
    for (const { siteId, ds } of cases) {
      const rows = buildRows(eph, SITES[siteId], ds.rows[0].t);
      expect(rows).toHaveLength(ds.rows.length);
      rows.forEach((r, i) => {
        const ref = ds.rows[i];
        expect(r.t).toBe(ref.t);
        worst = Math.max(
          worst,
          separationDeg({ az: r.sunAz, el: r.sunEl }, { az: ref.sunAz, el: ref.sunEl }),
          separationDeg({ az: r.earthAz, el: r.earthEl }, { az: ref.earthAz, el: ref.earthEl }),
        );
        count += 2;
      });
    }
    expect(count).toBe(584);
    expect(worst).toBeLessThan(PRESET_BAR_DEG);
  });
  for (const { siteId, scenario, ds } of cases) {
    it(`${siteId} ${scenario}: same totals and crossings as the Horizons file`, () => {
      const ref = analyze(ds);
      const got = analyze({ site: siteId, scenario, rows: buildRows(eph, SITES[siteId], ds.rows[0].t) });
      expect(Math.abs(got.bodies.sun.hours - ref.bodies.sun.hours)).toBeLessThan(PRESET_HOURS_BAR);
      expect(Math.abs(got.bodies.earth.hours - ref.bodies.earth.hours)).toBeLessThan(PRESET_HOURS_BAR);
      expect(Math.abs(got.both.hours - ref.both.hours)).toBeLessThan(PRESET_HOURS_BAR);
      expect(got.events.map((e) => `${e.body}:${e.type}`)).toEqual(ref.events.map((e) => `${e.body}:${e.type}`));
      got.events.forEach((e, i) => expect(Math.abs(e.t - ref.events[i].t)).toBeLessThan(PRESET_CROSSING_BAR_MS));
    });
  }
});

describe('window builder', () => {
  it('returns 73 hourly rows that start at touchdown', () => {
    const rows = buildRows(eph, SITES.apollo11, PRESET_START_MS);
    expect(rows).toHaveLength(WINDOW_HOURS + 1);
    expect(rows[0].t).toBe(PRESET_START_MS);
    expect(rows.at(-1).t - rows[0].t).toBe(WINDOW_HOURS * HOUR_MS);
    for (const r of rows) for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
  });
  it('rejects stays outside the 2024 to 2030 table and bad sites', () => {
    expect(() => buildRows(eph, SITES.athena, Date.parse('2023-12-31T00:00:00Z'))).toThrow(RangeError);
    expect(() => buildRows(eph, SITES.athena, Date.parse('2030-12-30T00:00:00Z'))).toThrow(RangeError);
    expect(() => buildRows(eph, { lat: 'x', lonE: 0 }, PRESET_START_MS)).toThrow(TypeError);
    expect(() => buildRows(eph, { lat: 95, lonE: 0 }, PRESET_START_MS)).toThrow(RangeError);
  });
  it('accepts the last full stay in the table', () => {
    expect(buildRows(eph, SITES.athena, eph.endMs - WINDOW_HOURS * HOUR_MS)).toHaveLength(73);
  });
});

describe('sites and wording', () => {
  it('far-side sites never see Earth, near-side mare sites always do', () => {
    for (const startMs of [PRESET_START_MS, PRESET_START_MS + 9 * DAY_MS, Date.parse('2028-06-01T00:00:00Z')]) {
      expect(analyze({ rows: buildRows(eph, SITES.change4, startMs) }).bodies.earth.whole).toBe('below');
      expect(analyze({ rows: buildRows(eph, SITES.apollo11, startMs) }).bodies.earth.whole).toBe('above');
    }
  });
  it('custom coordinates normalise west longitudes and reject bad input', () => {
    const s = customSite(-41.6385, -153.9852);
    expect(s.lonE).toBeCloseTo(206.0148, 4);
    expect(s.coordLabel).toBe('41.6385° S, 153.9852° W');
    expect(() => customSite(91, 0)).toThrow(RangeError);
    expect(() => customSite(Number.NaN, 0)).toThrow(RangeError);
    expect(() => customSite(0, 400)).toThrow(RangeError);
  });
  it('slip wording', () => {
    expect(slipWords(9)).toBe('nine days');
    expect(slipWords(1)).toBe('one day');
    expect(slipWords(21)).toBe('21 days');
  });
});
