// Checks for the landing calendar. Written with an AI tool (Claude).
// Bars set before the first run (Nov 15 2026, 7:45 PM PT): every sampled cell equals analyzeStay
// exactly, the day list starts and ends where the Moon table allows a full 72 hour stay, and the
// go marks equal meetsNeed for every need choice.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris } from '../src/moonsky.js';
import { SITES } from '../src/data.js';
import { HOUR_MS } from '../src/calc.js';
import { analyzeStay, meetsNeed, NEED_HOURS } from '../src/slips.js';
import { calendarDays, calendarCell, calendarCells, calendarSummary, dayStart, DAY_MS } from '../src/calendar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);
const STAY_MS = 72 * HOUR_MS;
const days = calendarDays(eph);

describe('calendar days', () => {
  it('runs from the first midnight in the table to the last day whose stay fits', () => {
    expect(days[0]).toBeGreaterThanOrEqual(eph.startMs);
    expect(days[0] - DAY_MS).toBeLessThan(eph.startMs);
    expect(days.at(-1) + STAY_MS).toBeLessThanOrEqual(eph.endMs);
    expect(days.at(-1) + DAY_MS + STAY_MS).toBeGreaterThan(eph.endMs);
    for (const d of days) expect(d % DAY_MS).toBe(0);
    expect(days.length).toBe((days.at(-1) - days[0]) / DAY_MS + 1);
    expect(new Date(days[0]).getUTCFullYear()).toBe(2024);
    expect(new Date(days.at(-1)).getUTCFullYear()).toBe(2030);
  });
  it('maps any time to its midnight', () => {
    expect(dayStart(days[10] + 5 * HOUR_MS)).toBe(days[10]);
  });
});

describe('calendar cells', () => {
  const sample = [0, 1, 400, 1234, days.length - 1];
  for (const id of ['athena', Object.keys(SITES).find((k) => k !== 'athena')]) {
    for (const margin of [0, 5]) {
      it(`equal analyzeStay at ${id}, margin ${margin}`, () => {
        for (const i of sample) {
          const c = calendarCell(eph, SITES[id], days[i], margin);
          const a = analyzeStay(eph, SITES[id], days[i], { horizonDeg: margin });
          expect(c.startMs).toBe(days[i]);
          expect(c.longestBothHours).toBe(a.stretches.longestBoth);
          expect(c.bothHours).toBe(a.both.hours);
          expect(c.sunHours).toBe(a.bodies.sun.hours);
          expect(c.earthHours).toBe(a.bodies.earth.hours);
          expect(c.longestBothHours).toBeGreaterThanOrEqual(0);
          expect(c.longestBothHours).toBeLessThanOrEqual(72);
        }
      });
    }
  }
});

describe('go marks and summary', () => {
  const t0 = performance.now();
  const cells = calendarCells(eph, SITES.athena, 0);
  const ms = performance.now() - t0;

  it('computes every day for one site', () => {
    expect(cells).toHaveLength(days.length);
    console.info(`calendar: ${cells.length} analyses in ${Math.round(ms)} ms in Node`);
  });
  it('marks go exactly where meetsNeed does, for every need', () => {
    const picks = cells.filter((_, i) => i % 37 === 0);
    for (const need of NEED_HOURS) {
      const s = calendarSummary(cells, need, days[0] - 1);
      expect(s.count).toBe(cells.filter((c) => meetsNeed(c, need)).length);
      expect(s.total).toBe(cells.length);
      for (const c of picks) {
        const a = analyzeStay(eph, SITES.athena, c.startMs, { horizonDeg: 0 });
        expect(meetsNeed(c, need)).toBe(meetsNeed({ bothRuns: a.both.intervals }, need));
      }
    }
  });
  it('finds the next go day after a touchdown', () => {
    const after = days[500] + 3 * HOUR_MS;
    const s = calendarSummary(cells, 24, after);
    const want = cells.find((c) => c.startMs > after && meetsNeed(c, 24)) ?? null;
    expect(s.next).toBe(want);
  });
});
