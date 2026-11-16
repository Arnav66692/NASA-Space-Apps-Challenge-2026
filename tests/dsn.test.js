import { describe, it, expect } from 'vitest';
import { DATASETS } from '../src/data.js';
import { analyze, HOUR_MS, sumHours } from '../src/calc.js';
import { DSN_STATIONS, DSN_MIN_EL, moonGeocentric, moonElevation, dsnCoverage, dsnSentence } from '../src/dsn.js';

// JPL Horizons reference, fetched 2026-11-15 with:
// curl -G https://ssd.jpl.nasa.gov/api/horizons.api --data-urlencode "format=text"
//   --data-urlencode "COMMAND='301'" --data-urlencode "CENTER='-14@399'"   (also '-43@399', '-63@399')
//   --data-urlencode "EPHEM_TYPE='OBSERVER'" --data-urlencode "QUANTITIES='4'"
//   --data-urlencode "START_TIME='2025-03-15 00:00'" --data-urlencode "STOP_TIME='2025-03-15 20:00'"
//   --data-urlencode "STEP_SIZE='5h'" --data-urlencode "CSV_FORMAT='YES'"   (and the same for 2025-03-24)
// Values are apparent airless elevation (deg) at 00, 05, 10, 15 and 20 h UT.
// Horizons site headers: DSS-14 243.1104618 E, 35.4259009 N, 1.00139 km.
// DSS-43 148.9812673 E, -35.4024242 N, 0.688867 km. DSS-63 355.7519915 E, 40.4312097 N, 0.86482 km.
const JPL = {
  goldstone: {
    '2025-03-15': [-30.453786, 26.680537, 45.923343, -6.132736, -58.477661],
    '2025-03-24': [-47.887326, -68.497103, -11.334744, 28.003137, 7.1944],
  },
  canberra: {
    '2025-03-15': [-38.095658, -41.849339, 14.144232, 59.130939, 17.591635],
    '2025-03-24': [57.060668, -0.007535, -30.141866, 0.668482, 57.618852],
  },
  madrid: {
    '2025-03-15': [45.728508, 20.015464, -34.552513, -48.422356, 1.500154],
    '2025-03-24': [-37.241862, 10.945714, 18.471440, -23.903994, -72.468804],
  },
};

const A = {};
for (const site of ['athena', 'blueGhost']) {
  A[site] = { original: analyze(DATASETS[site].original), delayed: analyze(DATASETS[site].delayed) };
}

describe('DSN Moon elevation', () => {
  it('matches the Meeus worked example 47.a (1992 April 12, 0h TD)', () => {
    const g = moonGeocentric(Date.UTC(1992, 3, 12) - 69_184);
    expect(Math.abs(g.ra - 134.68847)).toBeLessThan(0.01);
    expect(Math.abs(g.dec - 13.768368)).toBeLessThan(0.01);
    // The truncated distance series is about 10 km off here. That moves the elevation by under 0.002 degrees.
    expect(Math.abs(g.distKm - 368409.7)).toBeLessThan(20);
  });

  it('matches JPL Horizons within 0.5 degrees at all three complexes', () => {
    let worst = 0;
    for (const s of DSN_STATIONS) {
      for (const [day, list] of Object.entries(JPL[s.id])) {
        list.forEach((el, i) => {
          const t = Date.parse(`${day}T00:00:00Z`) + i * 5 * HOUR_MS;
          const err = Math.abs(moonElevation(s, t) - el);
          worst = Math.max(worst, err);
          expect(err).toBeLessThan(0.5);
        });
      }
    }
    expect(worst).toBeLessThan(0.5);
    if (process.env.DSN_REPORT) console.log('worst DSN elevation error vs JPL (deg):', worst.toFixed(4));
  });
});

describe('DSN coverage', () => {
  it('keeps every interval inside the stay', () => {
    for (const site of Object.values(A)) {
      for (const a of Object.values(site)) {
        const c = dsnCoverage(a);
        const all = [...c.stations.flatMap((s) => s.intervals), ...c.any.intervals, ...c.link.intervals];
        for (const [s, e] of all) {
          expect(s).toBeGreaterThanOrEqual(a.start);
          expect(e).toBeLessThanOrEqual(a.end);
          expect(e).toBeGreaterThan(s);
        }
      }
    }
  });

  it('has at least one complex on the Moon for close to 24 hours a day', () => {
    for (const site of Object.values(A)) {
      for (const a of Object.values(site)) {
        const c = dsnCoverage(a);
        expect(c.any.hours / c.totalHours).toBeGreaterThan(0.85);
        for (const s of c.stations) {
          expect(s.hours).toBeGreaterThan(0);
          expect(s.hours).toBeLessThan(c.totalHours);
        }
      }
    }
  });

  it('gives link hours no more than Earth-up hours', () => {
    for (const site of Object.values(A)) {
      for (const a of Object.values(site)) {
        const c = dsnCoverage(a);
        expect(c.link.hours).toBeLessThanOrEqual(c.earthHours + 1e-9);
        expect(c.link.hours).toBeLessThanOrEqual(c.any.hours + 1e-9);
        expect(c.earthHours).toBeCloseTo(sumHours(a.bodies.earth.intervals), 9);
      }
    }
  });

  it('follows a.start and a.end for a longer stay', () => {
    const a = A.athena.original;
    const long = { ...a, end: a.start + 7 * 24 * HOUR_MS, bodies: { earth: { intervals: [[a.start, a.start + 7 * 24 * HOUR_MS]] } } };
    const c = dsnCoverage(long);
    expect(c.totalHours).toBeCloseTo(168, 9);
    expect(c.link.hours).toBeCloseTo(c.any.hours, 9);
    expect(c.any.hours).toBeGreaterThan(0.85 * 168);
  });

  it('writes one plain sentence', () => {
    const c = dsnCoverage(A.athena.original);
    expect(dsnSentence(c)).toMatch(/^A DSN station can receive the lander for [\d.]+ of the [\d.]+ hours with Earth up\.$/);
    expect(DSN_MIN_EL).toBe(10);
  });
});

describe.runIf(process.env.DSN_REPORT)('DSN report', () => {
  it('prints numbers', () => {
    const errs = [];
    for (const s of DSN_STATIONS) for (const [day, list] of Object.entries(JPL[s.id])) list.forEach((el, i) => {
      const t = Date.parse(`${day}T00:00:00Z`) + i * 5 * HOUR_MS;
      errs.push(moonElevation(s, t) - el);
    });
    const rms = Math.sqrt(errs.reduce((x, e) => x + e * e, 0) / errs.length);
    console.log('n', errs.length, 'rms', rms.toFixed(4), 'max', Math.max(...errs.map(Math.abs)).toFixed(4), 'mean', (errs.reduce((x, e) => x + e, 0) / errs.length).toFixed(4));
    for (const [name, site] of Object.entries(A)) for (const [k, a] of Object.entries(site)) {
      const c = dsnCoverage(a);
      console.log(name, k, new Date(a.start).toISOString(), 'total', c.totalHours, 'earth', c.earthHours.toFixed(2), 'any', c.any.hours.toFixed(2), 'link', c.link.hours.toFixed(2), c.stations.map((s) => `${s.name} ${s.hours.toFixed(2)}`).join(', '), '|', dsnSentence(c));
    }
  });
});
