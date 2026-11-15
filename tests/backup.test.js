// Checks for the continuous-window metrics and the backup-window finder. Written with an AI tool (Claude).
// The preset expectations follow from the reference totals in docs/HANDOFF.md: each preset stay has at
// most one stretch per body, so the longest stretch equals the total and the gaps are 72 h minus it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris } from '../src/moonsky.js';
import { DATASETS, SITES, PRESET_START_MS, PRESET_SLIP_DAYS } from '../src/data.js';
import { analyze, gapsIn, longestHours, firstAtLeast, HOUR_MS } from '../src/calc.js';
import { slipSeries, findBackups, meetsNeed, firstRun } from '../src/slips.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);

const H = HOUR_MS;
const close = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('interval helpers', () => {
  it('finds the gaps a list leaves in a window', () => {
    expect(gapsIn([[2, 4], [6, 8]], 0, 10)).toEqual([[0, 2], [4, 6], [8, 10]]);
    expect(gapsIn([], 0, 10)).toEqual([[0, 10]]);
    expect(gapsIn([[0, 10]], 0, 10)).toEqual([]);
  });

  it('measures the longest interval in hours', () => {
    expect(longestHours([])).toBe(0);
    expect(longestHours([[0, 2 * H], [3 * H, 8 * H]])).toBe(5);
  });

  it('picks the first interval that is long enough, not the longest', () => {
    const list = [[0, 5 * H], [10 * H, 40 * H], [50 * H, 72 * H]];
    expect(firstAtLeast(list, 6)).toEqual([10 * H, 40 * H]);
    expect(firstAtLeast(list, 20)).toEqual([10 * H, 40 * H]);
    expect(firstAtLeast(list, 31)).toBe(null);
    expect(firstAtLeast(list, 5)).toEqual([0, 5 * H]); // exactly long enough counts
  });
});

describe('continuous stretches in the four reference stays', () => {
  const s = (id, scn) => analyze(DATASETS[id][scn]).stretches;

  it('Athena original: one 66.5 h stretch with both up, no darkness, Earth gone for the last 5.5 h', () => {
    const x = s('athena', 'original');
    close(x.longestBoth, 66.497844255);
    expect(x.longestDark).toBe(0);
    close(x.longestNoEarth, 72 - 66.497844255);
  });

  it('Athena delayed: dark all 72 h, and no Earth for the first 54.2 h', () => {
    const x = s('athena', 'delayed');
    expect(x.longestBoth).toBe(0);
    close(x.longestDark, 72);
    close(x.longestNoEarth, 72 - 17.750254565);
  });

  it('Blue Ghost original: 44.2 h with both up, then 27.8 h of dark, Earth never sets', () => {
    const x = s('blueGhost', 'original');
    close(x.longestBoth, 44.177521847);
    close(x.longestDark, 72 - 44.177521847);
    expect(x.longestNoEarth).toBe(0);
  });

  it('Blue Ghost delayed: dark all 72 h with Earth up throughout', () => {
    const x = s('blueGhost', 'delayed');
    expect(x.longestBoth).toBe(0);
    close(x.longestDark, 72);
    expect(x.longestNoEarth).toBe(0);
  });

  it('splits a stretch that an eclipse cuts in two', () => {
    const rows = DATASETS.blueGhost.original.rows;
    const t0 = rows[0].t;
    // Earth fully covers the Sun from hour 10 to hour 12. Both-up time drops by 2 h and splits.
    const a = analyze({ ...DATASETS.blueGhost.original, eclipse: { total: [[t0 + 10 * H, t0 + 12 * H]], any: [[t0 + 10 * H, t0 + 12 * H]] } });
    close(a.both.hours, 44.177521847 - 2);
    close(a.stretches.longestBoth, 44.177521847 - 12);
    close(a.stretches.longestDark, 72 - 44.177521847);
  });
});

describe('backup finder', () => {
  const athena = slipSeries(eph, SITES.athena, PRESET_START_MS, 30);
  const blueGhost = slipSeries(eph, SITES.blueGhost, PRESET_START_MS, 30);

  it('never reports a stretch longer than the total', () => {
    for (const c of [...athena, ...blueGhost]) expect(c.longestBothHours).toBeLessThanOrEqual(c.bothHours + 1e-9);
  });

  it('Athena, 24 h: earliest is +1 day, the next after the +9 day slip is +18 days, longest is +20 days', () => {
    const b = findBackups(athena, 24, PRESET_SLIP_DAYS);
    expect(b.earliest.slipDays).toBe(1);
    expect(b.next.slipDays).toBe(18);
    expect(b.longest.slipDays).toBe(20);
    close(b.longest.longestBothHours, 72, 1e-6);
    // The slip in the plan itself has no overlap, so it does not qualify.
    expect(b.qualifying).not.toContain(PRESET_SLIP_DAYS);
  });

  it('Athena, all 72 h: the first slip that qualifies is +20 days', () => {
    const b = findBackups(athena, 72, PRESET_SLIP_DAYS);
    expect(b.earliest.slipDays).toBe(20);
    expect(b.next.slipDays).toBe(20);
  });

  it('Blue Ghost, 24 h: nothing until +15 days, whose stretch starts after hour 24', () => {
    const b = findBackups(blueGhost, 24, PRESET_SLIP_DAYS);
    expect(b.earliest.slipDays).toBe(15);
    const run = firstRun(b.earliest, 24);
    expect(run[1] - run[0]).toBeGreaterThanOrEqual(24 * H - 1);
    expect(run[0] - b.earliest.startMs).toBeGreaterThan(24 * H);
  });

  it('a far-side site has no backup and no longest', () => {
    const b = findBackups(slipSeries(eph, SITES.change4, PRESET_START_MS, 30), 6, PRESET_SLIP_DAYS);
    expect(b.qualifying).toEqual([]);
    expect(b.earliest).toBe(null);
    expect(b.next).toBe(null);
    expect(b.longest).toBe(null);
  });

  it('a higher need never adds slips', () => {
    let prev = Infinity;
    for (const need of [6, 12, 24, 48, 72]) {
      const n = findBackups(athena, need).qualifying.length;
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
  });

  it('judges the original touchdown the same way, for the strip marks', () => {
    expect(meetsNeed(athena[0], 24)).toBe(true);
    expect(meetsNeed(athena[0], 72)).toBe(false);
  });
});
