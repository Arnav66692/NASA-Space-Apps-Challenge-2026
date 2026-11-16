// The where-to-land grid: same numbers as the per-site analysis, laid out the way the globe reads them.
// Written with an AI tool.
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
  decodeTerrainGrid,
  gridProfile,
  heatKey,
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

// ── terrain heatmap ── LOLA skylines for every node (data/terrain-grid.bin).
describe('heatmap with the LOLA terrain horizon', () => {
  const bin = readFileSync(join(ROOT, 'data', 'terrain-grid.bin'));
  const tg = decodeTerrainGrid(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const s = heatShape();

  it('decodes one skyline per heatmap node and stays small', () => {
    expect(bin.byteLength).toBeLessThan(1.5e6);
    expect([tg.rows, tg.cols]).toEqual([s.rows, s.cols]);
    expect(360 % tg.nAz).toBe(0);
    expect(tg.bytes.length).toBe(s.rows * s.cols * tg.nAz);
    expect(tg.deg[0]).toBeCloseTo(-6, 5);
    expect(tg.deg[1] - tg.deg[0]).toBeCloseTo(0.1, 5);
    expect(() => decodeTerrainGrid(new ArrayBuffer(20))).toThrow();
    expect(() => decodeTerrainGrid(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength - 1))).toThrow();
  });

  it('upsamples a node skyline to 360 values that pass through the stored azimuths', () => {
    const i = nearestNode(s, SITES.athena.lat, SITES.athena.lonE).index;
    const p = gridProfile(tg, i);
    const per = 360 / tg.nAz;
    expect(p).toHaveLength(360);
    for (let k = 0; k < tg.nAz; k++) expect(p[k * per]).toBeCloseTo(tg.deg[tg.bytes[i * tg.nAz + k]], 5);
    expect(p.every(Number.isFinite)).toBe(true);
  });

  it('looks like the per-site skyline at the same place', () => {
    // A flat mare site: the node skyline and the site skyline both stay low.
    const flat = gridProfile(tg, nearestNode(s, SITES.blueGhost.lat, SITES.blueGhost.lonE).index);
    expect(Math.max(...flat)).toBeLessThan(2);
    // The polar node near Athena has hills in view, as the site skyline does.
    const polar = gridProfile(tg, nearestNode(s, SITES.athena.lat, SITES.athena.lonE).index);
    expect(Math.max(...polar)).toBeGreaterThan(2);
  });

  it('equal analyzeStay with that node skyline at sampled nodes', () => {
    const nodes = [[3, 15], [8, 100], [20, 40], [45, 90], [54, 31], [86, 170]];
    const only = nodes.map(([r, c]) => r * s.cols + c);
    const g = computeHeatGrid(eph, PRESET_START_MS, 0, 2, tg, only);
    for (const i of only) {
      const row = Math.floor(i / s.cols);
      const want = analyzeStay(eph, { id: 'x', lat: nodeLat(s, row), lonE: nodeLonE(s, i % s.cols) }, PRESET_START_MS, {
        horizonDeg: 0,
        horizonProfile: gridProfile(tg, i),
      }).stretches.longestBoth;
      expect(g.values[i]).toBeCloseTo(want, 4);
    }
    // At least one polar node loses hours to the terrain.
    const smooth = computeHeatGrid(eph, PRESET_START_MS, 0, 2, null, only);
    expect(only.some((i) => g.values[i] < smooth.values[i] - 0.5)).toBe(true);
  });

  it('leave terrain-off values and keys unchanged', () => {
    const only = [45 * s.cols + 90, 5 * s.cols + 15];
    const g = computeHeatGrid(eph, PRESET_START_MS, 0, 2, null, only);
    for (const i of only) expect(g.values[i]).toBe(grid.values[i]);
    expect(heatKey({ startMs: 1, horizonDeg: 0 })).toBe('1|0|2');
    expect(heatKey({ startMs: 1, horizonDeg: 0, terrain: false })).toBe('1|0|2');
    expect(heatKey({ startMs: 1, horizonDeg: 0, terrain: true })).toBe('1|0|2|lola');
  });
});
