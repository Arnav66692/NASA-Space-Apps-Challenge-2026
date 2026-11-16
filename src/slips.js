// Every slip at a glance: the same 72 hour analysis, run once per day of delay.
// Uses the same row builder and calculation contract as the main comparison, so
// a cell and the table next to it cannot disagree.
// Written with an AI tool.
import { analyze, firstAtLeast, HOUR_MS } from './calc.js';
import { buildRows, WINDOW_HOURS } from './window.js';
import { eclipseIntervals } from './eclipse.js';

const DAY_MS = 24 * HOUR_MS;

/** The numbers one strip cell shows, taken from a finished analysis. */
export function slipCell(slipDays, analysis) {
  return {
    slipDays,
    startMs: analysis.start,
    sunHours: analysis.bodies.sun.hours,
    earthHours: analysis.bodies.earth.hours,
    bothHours: analysis.both.hours,
    eclipseHours: analysis.eclipse.totalHours,
    // Continuous stretches, so the backup finder can ask for an unbroken window.
    bothRuns: analysis.both.intervals,
    longestBothHours: analysis.stretches.longestBoth,
  };
}

/** Choices for the backup finder: hours of Sun and Earth up together without a break. */
export const NEED_HOURS = [6, 12, 24, 48, 72];
export const DEFAULT_NEED_HOURS = 24;

/**
 * Backup touchdowns for a missed date: the slips (1 day or more) that give at least `needHours` of
 * Sun and Earth up together without a break, the earliest of them, the first one later than the slip
 * in the plan (`afterSlip`), and the slip with the longest unbroken stretch. Ties go to the shorter slip.
 * @returns {{needHours:number, qualifying:number[], earliest:object|null, next:object|null, longest:object|null}}
 *   earliest, next and longest are cells.
 */
export function findBackups(cells, needHours, afterSlip = 0) {
  const slipped = cells.filter((c) => c.slipDays >= 1);
  const qualifying = slipped.filter((c) => meetsNeed(c, needHours));
  const longest = slipped.reduce((a, c) => (!a || c.longestBothHours > a.longestBothHours + 1e-9 ? c : a), null);
  return {
    needHours,
    qualifying: qualifying.map((c) => c.slipDays),
    earliest: qualifying[0] ?? null,
    next: qualifying.find((c) => c.slipDays > afterSlip) ?? null,
    longest: longest && longest.longestBothHours > 0 ? longest : null,
  };
}

/** The first unbroken stretch in a cell that meets the need, as [startMs, endMs], or null. */
export const firstRun = (cell, needHours) => firstAtLeast(cell.bothRuns, needHours);

/** Does this cell meet the need on its own (any slip, the original included)? */
export const meetsNeed = (cell, needHours) => Boolean(firstAtLeast(cell.bothRuns, needHours));

/** One full analysis of a stay that starts at startMs, with eclipses counted. */
export function analyzeStay(eph, site, startMs, extra = {}) {
  const endMs = startMs + WINDOW_HOURS * HOUR_MS;
  return analyze({
    ...extra,
    rows: buildRows(eph, site, startMs),
    eclipse: eclipseIntervals(eph, site, startMs, endMs),
  });
}

/**
 * Hours for every slip from 0 to maxSlipDays. Slips whose stay runs past the
 * end of the Moon table are left out.
 * @returns {Array<{slipDays:number,startMs:number,sunHours:number,earthHours:number,bothHours:number,eclipseHours:number}>}
 */
export function slipSeries(eph, site, startMs, maxSlipDays, horizonDeg = 0, horizonProfile = null) {
  const cells = [];
  // ── terrain ── the skyline is passed only when there is one, so the smooth path is unchanged.
  const extra = horizonProfile ? { horizonDeg, horizonProfile } : { horizonDeg };
  for (let k = 0; k <= maxSlipDays; k += 1) {
    const t0 = startMs + k * DAY_MS;
    if (t0 + WINDOW_HOURS * HOUR_MS > eph.endMs) break;
    cells.push(slipCell(k, analyzeStay(eph, site, t0, extra)));
  }
  return cells;
}

/**
 * The slips (1 day or more) with the most and the fewest hours of Sun and Earth
 * up together. Ties go to the shorter slip. Null when every slip scores the same.
 * @returns {{best: number, worst: number} | null} slip days
 */
export function rankSlips(cells) {
  const slipped = cells.filter((c) => c.slipDays >= 1);
  if (slipped.length < 2) return null;
  const best = slipped.reduce((a, c) => (c.bothHours > a.bothHours + 1e-9 ? c : a));
  const worst = slipped.reduce((a, c) => (c.bothHours < a.bothHours - 1e-9 ? c : a));
  if (best.bothHours - worst.bothHours < 0.05) return null;
  return { best: best.slipDays, worst: worst.slipDays };
}
