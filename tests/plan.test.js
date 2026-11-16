// Checks for the mission need, the site comparison and the CSV. Written with an AI tool.
// Bars set before the first run (Nov 15 2026, 3:55 PM PT): every number in the site table and the
// CSV equals the analysis it came from exactly, and the verdict is exact at the threshold.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris } from '../src/moonsky.js';
import { SITES, PRESET_START_MS } from '../src/data.js';
import { HOUR_MS } from '../src/calc.js';
import { analyzeStay, slipSeries, meetsNeed, NEED_HOURS, DEFAULT_NEED_HOURS } from '../src/slips.js';
import { verdict, siteRows, planCsv } from '../src/plan.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);
const DAY_MS = 24 * HOUR_MS;
const pairAt = (site, slip = 9, horizonDeg = 0) => ({
  original: analyzeStay(eph, site, PRESET_START_MS, { horizonDeg }),
  delayed: analyzeStay(eph, site, PRESET_START_MS + slip * DAY_MS, { horizonDeg }),
});

describe('verdict', () => {
  it('is exact at the threshold and off when no need is set', () => {
    expect(verdict(24, 24)).toBe('go');
    expect(verdict(23.999, 24)).toBe('nogo');
    expect(verdict(72, 72)).toBe('go');
    expect(verdict(0, 1)).toBe('nogo');
    expect(verdict(50, 0)).toBe(null);
    expect(DEFAULT_NEED_HOURS).toBe(24);
  });
});

describe('every site on the same plan', () => {
  const entries = Object.values(SITES).map((site) => ({ site, pair: pairAt(site) }));
  const rows = siteRows(entries, 24);

  it('has one row per site with numbers equal to the analysis', () => {
    expect(rows).toHaveLength(Object.keys(SITES).length);
    for (const { site, pair } of entries) {
      const r = rows.find((x) => x.id === site.id);
      expect(r.sun).toEqual([pair.original.bodies.sun.hours, pair.delayed.bodies.sun.hours]);
      expect(r.earth).toEqual([pair.original.bodies.earth.hours, pair.delayed.bodies.earth.hours]);
      expect(r.both).toEqual([pair.original.both.hours, pair.delayed.both.hours]);
      expect(r.change).toBe(pair.delayed.both.hours - pair.original.both.hours);
      expect(r.longest).toEqual([pair.original.stretches.longestBoth, pair.delayed.stretches.longestBoth]);
      expect(r.verdict).toEqual([verdict(r.longest[0], 24), verdict(r.longest[1], 24)]);
    }
  });

  it('puts the best delayed stay first', () => {
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].both[1]).toBeGreaterThanOrEqual(rows[i].both[1]);
  });

  it('agrees with the known reference: Athena, nine days, goes from 66.5 h to 0 h with both up', () => {
    const athena = rows.find((r) => r.id === 'athena');
    expect(athena.both[0]).toBeCloseTo(66.5, 0);
    expect(athena.both[1]).toBe(0);
    expect(athena.verdict).toEqual(['go', 'nogo']);
  });
});

describe('verdict and the backup finder agree', () => {
  it('gives go exactly when meetsNeed is true, for every slip, site and need choice', () => {
    for (const site of Object.values(SITES)) {
      const cells = slipSeries(eph, site, PRESET_START_MS, 30);
      for (const need of NEED_HOURS) {
        for (const c of cells) expect(verdict(c.longestBothHours, need) === 'go').toBe(meetsNeed(c, need));
      }
    }
  });
});

describe('CSV', () => {
  const cells = slipSeries(eph, SITES.blueGhost, PRESET_START_MS, 30);
  const sites = siteRows(Object.values(SITES).map((site) => ({ site, pair: pairAt(site) })), 24);
  const csv = planCsv({
    site: 'Blue Ghost', coords: '18.562° N, 61.810° E', touchdownUtc: '2025-03-15 00:00', slipDays: 9, marginDeg: 0, needHours: 24,
    slips: cells.map((c) => ({ ...c, touchdownUtc: new Date(c.startMs).toISOString() })), sites,
  });
  const lines = csv.trim().split('\n');

  it('holds every slip and every site', () => {
    expect(lines.filter((l) => /^\d+,\d{4}-/.test(l))).toHaveLength(31);
    for (const s of Object.values(SITES)) expect(csv).toContain(s.name);
  });

  it('writes the same hours the analysis gives, to two decimals', () => {
    const row9 = lines.find((l) => l.startsWith('9,'));
    const c9 = cells.find((c) => c.slipDays === 9);
    expect(row9.split(',').slice(2, 6)).toEqual([c9.sunHours, c9.earthHours, c9.bothHours, c9.longestBothHours].map((h) => h.toFixed(2)));
    expect(row9.split(',').at(-1)).toBe(verdict(c9.longestBothHours, 24));
  });

  it('quotes fields that contain commas', () => {
    expect(csv).toContain('"18.562° N, 61.810° E"');
  });
});
