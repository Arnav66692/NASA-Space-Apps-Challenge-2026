// Decisions on top of the numbers: does a stay meet the mission's need, how every site compares
// on the same plan, and the plan as a CSV file. Pure functions, so they run in Node for the tests.
// Written with an AI tool (Claude).

export const NEED_DEFAULT_H = 24;
export const NEED_MAX_H = 72;
const EPS = 1e-9;

/**
 * Does a stay give the mission enough hours with the Sun and Earth both up?
 * @param {number} bothHours hours with both above the horizon
 * @param {number} needHours the mission's need. 0 means no need is set.
 * @returns {'go' | 'nogo' | null}
 */
export function verdict(bothHours, needHours) {
  if (!(needHours > 0)) return null;
  return bothHours + EPS >= needHours ? 'go' : 'nogo';
}

/**
 * One row per site for the same touchdown and slip, best delayed stay first.
 * @param {Array<{site: {id: string, name: string, region: string}, pair: {original: object, delayed: object}}>} entries
 * @param {number} needHours
 */
export function siteRows(entries, needHours) {
  const rows = entries.map(({ site, pair }) => {
    const o = pair.original;
    const d = pair.delayed;
    return {
      id: site.id,
      name: site.name,
      region: site.region,
      sun: [o.bodies.sun.hours, d.bodies.sun.hours],
      earth: [o.bodies.earth.hours, d.bodies.earth.hours],
      both: [o.both.hours, d.both.hours],
      change: d.both.hours - o.both.hours,
      verdict: [verdict(o.both.hours, needHours), verdict(d.both.hours, needHours)],
    };
  });
  return rows.sort((a, b) => b.both[1] - a.both[1] || b.both[0] - a.both[0] || a.name.localeCompare(b.name));
}

/** How many slips (1 day or more) meet the need. */
export function slipsMeetingNeed(cells, needHours) {
  if (!(needHours > 0)) return null;
  const slipped = cells.filter((c) => c.slipDays >= 1);
  return { meet: slipped.filter((c) => verdict(c.bothHours, needHours) === 'go').length, of: slipped.length };
}

/** Hours to two decimals. Counts, days and degrees go in as they are. */
const h2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '');
const cell = (v) => {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (values) => values.map(cell).join(',');

/**
 * The plan, every slip and every site, as one CSV file.
 * @param {{site: string, coords: string, touchdownUtc: string, slipDays: number, marginDeg: number, needHours: number,
 *   slips: Array<{slipDays:number, touchdownUtc:string, sunHours:number, earthHours:number, bothHours:number, eclipseHours:number}>,
 *   sites: ReturnType<typeof siteRows>}} p
 */
export function planCsv(p) {
  const out = [
    line(['Long Shadow plan export']),
    line(['Site', p.site]),
    line(['Coordinates', p.coords]),
    line(['Original touchdown (UTC)', p.touchdownUtc]),
    line(['Slip (days)', p.slipDays]),
    line(['Terrain margin (degrees)', p.marginDeg]),
    line(['Mission need, hours with Sun and Earth both up', p.needHours > 0 ? p.needHours : 'not set']),
    line(['Source', 'NASA JPL Horizons, smooth-horizon model, first 72 hours after touchdown']),
    '',
    line(['Every slip at this site']),
    line(['Slip (days)', 'Touchdown (UTC)', 'Sun up (h)', 'Earth up (h)', 'Both up (h)', 'Sun behind Earth (h)', 'Meets need']),
    ...p.slips.map((c) =>
      line([c.slipDays, c.touchdownUtc, h2(c.sunHours), h2(c.earthHours), h2(c.bothHours), h2(c.eclipseHours), verdict(c.bothHours, p.needHours) ?? '']),
    ),
    '',
    line([`Every site, touchdown ${p.touchdownUtc}, slip ${p.slipDays} days`]),
    line(['Site', 'Region', 'Sun original (h)', 'Sun delayed (h)', 'Earth original (h)', 'Earth delayed (h)', 'Both original (h)', 'Both delayed (h)', 'Change in both (h)', 'Original meets need', 'Delayed meets need']),
    ...p.sites.map((r) =>
      line([r.name, r.region, h2(r.sun[0]), h2(r.sun[1]), h2(r.earth[0]), h2(r.earth[1]), h2(r.both[0]), h2(r.both[1]), h2(r.change), r.verdict[0] ?? '', r.verdict[1] ?? '']),
    ),
  ];
  return `${out.join('\n')}\n`;
}
