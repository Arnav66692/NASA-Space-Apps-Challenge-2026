// The where-to-land grid: same numbers as the per-site analysis, laid out the way the globe reads them.
// Written with an AI tool (Claude).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris } from '../src/moonsky.js';
import { SITES, PRESET_START_MS } from '../src/data.js';
import { analyzeStay } from '../src/slips.js';
import {
  heatShape,
  nodeLat,
  nodeLonE,
  nearestNode,
  heatOrder,
  computeHeatGrid,
  heatBytes,
  fillFromCoarse,
  HEAT_MAX_HOURS,
} from '../src/heatmap.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);

// One full grid for the reference touchdown, shared by the tests below (about a second in Node).
const grid = computeHeatGrid(eph, PRESET_START_MS, 0);
const longest = (lat, lonE, startMs = PRESET_START_MS, horizonDeg = 0) =>
  analyzeStay(eph, { id: 'x', lat, lonE }, startMs, { horizonDeg }).stretches.longestBoth;

describe('heatmap grid layout', () => {
  it('has one row per step from pole to pole and one column per step around', () => {
    const s = heatShape(2);
    expect(s).toEqual({ stepDeg: 2, rows: 91, cols: 180 });
    expect(nodeLat(s, 0)).toBe(-90);
    expect(nodeLat(s, 90)).toBe(90);
    expect(nodeLat(s, 45)).toBe(0);
    expect(nodeLonE(s, 0)).toBe(0);
    expect(nodeLonE(s, 179)).toBe(358);
    expect(grid.values).toHaveLength(91 * 180);
    expect(() => heatShape(7)).toThrow(RangeError);
  });

  it('finds the nearest node, wrapping longitude', () => {
    const s = heatShape(2);
    expect(nearestNode(s, 0, 0)).toEqual({ row: 45, col: 0, index: 45 * 180 });
    expect(nearestNode(s, 18.562, 61.81)).toMatchObject({ row: 54, col: 31 });
    expect(nearestNode(s, 10, 359.4).col).toBe(0);
    expect(nearestNode(s, 10, -1.2).col).toBe(179);
    expect(nearestNode(s, -95, 0).row).toBe(0);
  });

  it('visits every node off the poles once, coarse nodes first', () => {
    const s = heatShape(2);
    const order = heatOrder(s);
    expect(new Set(order).size).toBe(order.length);
    expect(order).toHaveLength((s.rows - 2) * s.cols + 2);
    const firstFine = order.findIndex((i) => Math.floor(i / s.cols) % 2 !== 0 || (i % s.cols) % 2 !== 0);
    expect(order.slice(0, firstFine).every((i) => Math.floor(i / s.cols) % 2 === 0 && (i % s.cols) % 2 === 0)).toBe(true);
  });
});

describe('heatmap values', () => {
  it('equal the per-site analysis at sampled nodes', () => {
    const s = grid.shape;
    for (const [row, col] of [[5, 15], [20, 100], [45, 0], [45, 90], [60, 31], [80, 170], [88, 3], [2, 140]]) {
      const v = grid.values[row * s.cols + col];
      expect(v).toBeCloseTo(longest(nodeLat(s, row), nodeLonE(s, col)), 4);
    }
  });

  it('fill each pole row with one value', () => {
    const s = grid.shape;
    const south = grid.values.slice(0, s.cols);
    expect(new Set(south).size).toBe(1);
    expect(south[0]).toBeCloseTo(longest(-90, 0), 4);
  });

  it('stay between 0 and 72 hours', () => {
    for (const v of grid.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(HEAT_MAX_HOURS + 1e-6);
    }
  });

  it('match the reference sites near their markers', () => {
    // The site's own analysis: Athena 66.5 h, Blue Ghost 44.2 h, Chang'e 4 none (far side, no Earth).
    expect(longest(SITES.athena.lat, SITES.athena.lonE)).toBeCloseTo(66.5, 1);
    expect(longest(SITES.blueGhost.lat, SITES.blueGhost.lonE)).toBeCloseTo(44.2, 1);
    const at = (site) => grid.values[nearestNode(grid.shape, site.lat, site.lonE).index];
    expect(Math.abs(at(SITES.blueGhost) - 44.2)).toBeLessThan(3);
    expect(Math.abs(at(SITES.athena) - 66.5)).toBeLessThan(8);
    expect(at(SITES.change4)).toBe(0);
  });

  it('follow the terrain margin and the touchdown', () => {
    const s = heatShape(30);
    const a = computeHeatGrid(eph, PRESET_START_MS, 5, 30);
    expect(a.values[3 * s.cols + 2]).toBeCloseTo(longest(0, 60, PRESET_START_MS, 5), 4);
    const later = PRESET_START_MS + 9 * 86_400_000;
    const b = computeHeatGrid(eph, later, 0, 30);
    expect(b.values[3 * s.cols + 2]).toBeCloseTo(longest(0, 60, later), 4);
  });

  it('give NaN, not a crash, when the stay is off the Moon table', () => {
    const g = computeHeatGrid(eph, eph.endMs, 0, 90);
    expect(g.values.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('heatmap texture bytes', () => {
  it('store hours as a share of 72 in red and mark known nodes in alpha', () => {
    const s = { stepDeg: 90, rows: 3, cols: 4 };
    const values = new Float32Array([0, 36, 72, NaN, 80, -1, 18, 54, 0, 0, 0, 0]);
    const b = heatBytes(s, values);
    expect(b.length).toBe(48);
    expect([b[0], b[3]]).toEqual([0, 255]);
    expect(b[4]).toBe(128);
    expect(b[8]).toBe(255);
    expect([b[12], b[15]]).toEqual([0, 0]);
    expect(b[16]).toBe(255);
    expect(b[20]).toBe(0);
  });

  it('fill holes from the coarse neighbour while the fine pass runs', () => {
    const s = { stepDeg: 90, rows: 3, cols: 4 };
    const values = new Float32Array(12).fill(NaN);
    const known = new Uint8Array(12);
    values[4] = 10; known[4] = 0; // row 1 is fine, not computed yet
    values[0] = 5; known[0] = 1;
    values[2] = 7; known[2] = 1;
    const out = fillFromCoarse(s, values, known);
    expect(out[1]).toBe(5);
    expect(out[3]).toBe(7);
    expect(out[5]).toBe(5);
    expect(out[0]).toBe(5);
  });
});
