// Checks for the eclipse flag and the slip strip. Written with an AI tool.
// Bars were fixed before the first run (research note C-winner-features, Nov 15 2026):
// eclipse edges within 2 minutes of the pilot's 06:18 and 08:34 UTC, strip cells
// within 0.2 h of the Horizons preset files.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris } from '../src/moonsky.js';
import { buildRows, WINDOW_HOURS } from '../src/window.js';
import { DATASETS, SITES, PRESET_START_MS, PRESET_SLIP_DAYS } from '../src/data.js';
import { analyze, subtractIntervals, eclipseAt, HOUR_MS } from '../src/calc.js';
import { eclipseIntervals } from '../src/eclipse.js';
import { slipSeries, rankSlips, analyzeStay } from '../src/slips.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);

const DAY_MS = 24 * HOUR_MS;
const STAY_MS = WINDOW_HOURS * HOUR_MS;
const ECLIPSE_EDGE_BAR_MS = 2 * 60_000;
const STRIP_HOURS_BAR = 0.2;
const ECLIPSE_STAY_START = Date.parse('2025-03-13T00:00:00Z');

describe('interval subtraction', () => {
  it('cuts the covered parts out and keeps the rest', () => {
    expect(subtractIntervals([[0, 10]], [[3, 5]])).toEqual([[0, 3], [5, 10]]);
    expect(subtractIntervals([[0, 10]], [[-5, 2], [8, 20]])).toEqual([[2, 8]]);
    expect(subtractIntervals([[0, 10]], [[0, 10]])).toEqual([]);
    expect(subtractIntervals([[0, 4], [6, 10]], [[3, 7]])).toEqual([[0, 3], [7, 10]]);
    expect(subtractIntervals([[0, 10]], [])).toEqual([[0, 10]]);
  });
});

describe('Earth in front of the Sun, Mar 14 2025 at the Blue Ghost site', () => {
  const found = eclipseIntervals(eph, SITES.blueGhost, ECLIPSE_STAY_START, ECLIPSE_STAY_START + STAY_MS);

  it('finds one total stretch within 2 minutes of the pilot result, 06:18 to 08:34 UTC', () => {
    expect(found.total).toHaveLength(1);
    const [start, end] = found.total[0];
    expect(Math.abs(start - Date.parse('2025-03-14T06:18:00Z'))).toBeLessThan(ECLIPSE_EDGE_BAR_MS);
    expect(Math.abs(end - Date.parse('2025-03-14T08:34:00Z'))).toBeLessThan(ECLIPSE_EDGE_BAR_MS);
  });

  it('covers the reported whole-Moon totality, 06:26 to 07:31 UTC', () => {
    const [start, end] = found.total[0];
    expect(start).toBeLessThan(Date.parse('2025-03-14T06:26:00Z'));
    expect(end).toBeGreaterThan(Date.parse('2025-03-14T07:31:00Z'));
  });

  it('partial cover starts before and ends after the total stretch', () => {
    expect(found.any).toHaveLength(1);
    expect(found.any[0][0]).toBeLessThan(found.total[0][0]);
    expect(found.any[0][1]).toBeGreaterThan(found.total[0][1]);
  });

  it('sunlight drops by the eclipse length and nothing else changes', () => {
    const rows = buildRows(eph, SITES.blueGhost, ECLIPSE_STAY_START);
    const plain = analyze({ rows });
    const withEclipse = analyzeStay(eph, SITES.blueGhost, ECLIPSE_STAY_START);
    const eclipseHours = withEclipse.eclipse.totalHours;
    expect(eclipseHours).toBeGreaterThan(2);
    expect(eclipseHours).toBeLessThan(2.5);
    expect(plain.bodies.sun.hours - withEclipse.bodies.sun.hours).toBeCloseTo(eclipseHours, 6);
    expect(withEclipse.bodies.sun.horizonHours).toBeCloseTo(plain.bodies.sun.hours, 9);
    expect(withEclipse.bodies.earth.hours).toBe(plain.bodies.earth.hours);
    expect(withEclipse.events).toEqual(plain.events);
    const mid = (withEclipse.eclipse.total[0][0] + withEclipse.eclipse.total[0][1]) / 2;
    expect(eclipseAt(withEclipse, mid)).toBe('total');
    expect(eclipseAt(withEclipse, withEclipse.eclipse.any[0][0] + 60_000)).toBe('partial');
    expect(eclipseAt(withEclipse, ECLIPSE_STAY_START)).toBe(null);
  });
});

describe('stays with no eclipse', () => {
  it('the four reference stays show no flag and keep their numbers', () => {
    for (const siteId of Object.keys(DATASETS)) {
      for (const startMs of [PRESET_START_MS, PRESET_START_MS + PRESET_SLIP_DAYS * DAY_MS]) {
        const plain = analyze({ rows: buildRows(eph, SITES[siteId], startMs) });
        const checked = analyzeStay(eph, SITES[siteId], startMs);
        expect(checked.eclipse.total).toEqual([]);
        expect(checked.eclipse.any).toEqual([]);
        expect(checked.bodies.sun.hours).toBe(plain.bodies.sun.hours);
        expect(checked.both.hours).toBe(plain.both.hours);
      }
    }
  });

  it('an analysis without eclipse data still has an empty eclipse record', () => {
    const a = analyze(DATASETS.athena.original);
    expect(a.eclipse).toEqual({ total: [], any: [], totalHours: 0 });
    expect(a.bodies.sun.lit).toBe(a.bodies.sun.intervals);
  });

  it('a far-side site is not flagged for an eclipse it cannot see', () => {
    const a = analyzeStay(eph, SITES.change4, ECLIPSE_STAY_START);
    expect(a.eclipse.totalHours).toBe(0);
  });
});

describe('slip strip', () => {
  for (const siteId of Object.keys(DATASETS)) {
    it(`${siteId}: slip 0 and slip 9 match the Horizons preset files within 0.2 h`, () => {
      const cells = slipSeries(eph, SITES[siteId], PRESET_START_MS, 30);
      expect(cells).toHaveLength(31);
      expect(cells.map((c) => c.slipDays)).toEqual(Array.from({ length: 31 }, (_, i) => i));
      const original = analyze(DATASETS[siteId].original);
      const delayed = analyze(DATASETS[siteId].delayed);
      const check = (cell, ref) => {
        expect(cell.startMs).toBe(ref.start);
        expect(Math.abs(cell.sunHours - ref.bodies.sun.hours)).toBeLessThan(STRIP_HOURS_BAR);
        expect(Math.abs(cell.earthHours - ref.bodies.earth.hours)).toBeLessThan(STRIP_HOURS_BAR);
        expect(Math.abs(cell.bothHours - ref.both.hours)).toBeLessThan(STRIP_HOURS_BAR);
      };
      check(cells[0], original);
      check(cells[PRESET_SLIP_DAYS], delayed);
    });
  }

  it('every cell stays inside 0 to 72 hours', () => {
    for (const c of slipSeries(eph, SITES.chandrayaan3, PRESET_START_MS, 30)) {
      for (const h of [c.sunHours, c.earthHours, c.bothHours]) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(WINDOW_HOURS);
      }
    }
  });

  it('stops at the end of the Moon table', () => {
    const lastStart = eph.endMs - STAY_MS;
    expect(slipSeries(eph, SITES.athena, lastStart - 3 * DAY_MS, 30)).toHaveLength(4);
  });

  it('ranks by hours with both up, ties to the shorter slip, and skips flat series', () => {
    const cell = (slipDays, bothHours) => ({ slipDays, bothHours });
    expect(rankSlips([cell(0, 99), cell(1, 5), cell(2, 9), cell(3, 9), cell(4, 1), cell(5, 1)])).toEqual({ best: 2, worst: 4 });
    expect(rankSlips([cell(0, 3), cell(1, 7), cell(2, 7), cell(3, 7)])).toBe(null);
    expect(rankSlips([cell(0, 3), cell(1, 7)])).toBe(null);
  });
});
