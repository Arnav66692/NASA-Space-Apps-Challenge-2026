// Checks for the far-side relay model (src/relay.js). Written with an AI tool.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEphemeris, subPointsAt } from '../src/moonsky.js';
import { buildRows } from '../src/window.js';
import { SITES, PRESET_START_MS, PRESET_SLIP_DAYS } from '../src/data.js';
import { analyze, HOUR_MS } from '../src/calc.js';
import { RELAYS, elevationFrom, relayWindows, relayFor, relayElevation } from '../src/relay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'ephemeris.json'), 'utf8'));
const file = readFileSync(join(ROOT, 'data', 'ephemeris.f32'));
const eph = createEphemeris(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), meta);
const DELAYED_MS = PRESET_START_MS + PRESET_SLIP_DAYS * 24 * HOUR_MS;

const stay = (site, startMs) => analyze({ rows: buildRows(eph, site, startMs) });

describe('relay geometry', () => {
  it('a relay over the anti-Earth point is up at the far-side centre and down at the near-side centre', () => {
    const p = subPointsAt(eph, PRESET_START_MS);
    const lon = p.earthLon * Math.PI / 180, lat = p.earthLat * Math.PI / 180;
    const earthDir = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const relayPos = earthDir.map((v) => -v * RELAYS.queqiao.distanceKm);
    const near = { lat: p.earthLat, lonE: p.earthLon };
    const far = { lat: -p.earthLat, lonE: p.earthLon + 180 };
    expect(elevationFrom(far, relayPos)).toBeGreaterThan(80);
    expect(elevationFrom(near, relayPos)).toBeLessThan(-80);
  });

  it('the halo relay is above the far-side centre and below the near-side centre through a stay', () => {
    for (let h = 0; h <= 72; h += 6) {
      const t = PRESET_START_MS + h * HOUR_MS;
      expect(relayElevation(eph, RELAYS.queqiao, { lat: 0, lonE: 180 }, t)).toBeGreaterThan(0);
      expect(relayElevation(eph, RELAYS.queqiao, { lat: 0, lonE: 0 }, t)).toBeLessThan(0);
    }
  });
});

describe('relay hours', () => {
  for (const [id, relay] of [['change4', RELAYS.queqiao], ['change6', RELAYS.queqiao2]]) {
    for (const startMs of [PRESET_START_MS, DELAYED_MS]) {
      it(`${id} from ${new Date(startMs).toISOString()}: hours in range, intervals inside the stay`, () => {
        const a = stay(SITES[id], startMs);
        const w = relayWindows(eph, relay, SITES[id], a.start, a.end);
        expect(w.hours).toBeGreaterThanOrEqual(0);
        expect(w.hours).toBeLessThanOrEqual((a.end - a.start) / HOUR_MS + 1e-9);
        for (const [s, e] of w.intervals) {
          expect(s).toBeGreaterThanOrEqual(a.start);
          expect(e).toBeLessThanOrEqual(a.end);
          expect(e).toBeGreaterThan(s);
        }
      });
    }
  }

  it("Chang'e 4 gets nonzero relay hours", () => {
    const a = stay(SITES.change4, PRESET_START_MS);
    expect(relayWindows(eph, RELAYS.queqiao, SITES.change4, a.start, a.end).hours).toBeGreaterThan(0);
  });

  it('uses the stay length it is given, not a fixed 72 hours', () => {
    const start = PRESET_START_MS;
    const end = start + 200 * HOUR_MS;
    const w = relayWindows(eph, RELAYS.queqiao2, SITES.change6, start, end);
    expect(w.stayHours).toBe(200);
    expect(w.hours).toBeLessThanOrEqual(200);
  });
});

describe('which sites get a relay', () => {
  it("Chang'e 4 and 6 get one, Athena does not", () => {
    const a = stay(SITES.athena, PRESET_START_MS);
    expect(relayFor(SITES.change4, [a])).toBe(RELAYS.queqiao);
    expect(relayFor(SITES.change6, [a])).toBe(RELAYS.queqiao2);
    expect(relayFor(SITES.athena, [a])).toBeNull();
  });
  it('a custom point gets one only when Earth is up less than 1 hour', () => {
    const farA = stay({ lat: 0, lonE: 180 }, PRESET_START_MS);
    const nearA = stay({ lat: 0, lonE: 0 }, PRESET_START_MS);
    expect(relayFor({ id: 'custom' }, [farA])).toBe(RELAYS.queqiao2);
    expect(relayFor({ id: 'custom' }, [nearA])).toBeNull();
  });
});
