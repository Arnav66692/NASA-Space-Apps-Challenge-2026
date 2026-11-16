// Decisions on top of the numbers: does a stay meet the mission's need, how every site compares
// on the same plan, and the plan as a CSV file. Pure functions, so they run in Node for the tests.
// Written with an AI tool.

// The need itself (the hour choices and the default) lives in slips.js with the backup finder,
// so the verdict, the site table and the finder all ask the same question.
const EPS = 1e-9;

/**
 * Does a stay give the mission enough hours with the Sun and Earth both up, without a break?
 * Same test as meetsNeed in slips.js: the longest unbroken stretch has to reach the need.
 * @param {number} longestBothHours the longest unbroken stretch with both up, in hours
 * @param {number} needHours the mission's need. 0 means no need is set.
 * @returns {'go' | 'nogo' | null}
 */
export function verdict(longestBothHours, needHours) {
  if (!(needHours > 0)) return null;
  return longestBothHours + EPS >= needHours ? 'go' : 'nogo';
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
      longest: [o.stretches.longestBoth, d.stretches.longestBoth],
      change: d.both.hours - o.both.hours,
      verdict: [verdict(o.stretches.longestBoth, needHours), verdict(d.stretches.longestBoth, needHours)],
    };
  });
  return rows.sort((a, b) => b.both[1] - a.both[1] || b.both[0] - a.both[0] || a.name.localeCompare(b.name));
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
 *   slips: Array<{slipDays:number, touchdownUtc:string, sunHours:number, earthHours:number, bothHours:number, longestBothHours:number, eclipseHours:number}>,
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
    line(['Mission need, hours with Sun and Earth both up without a break', p.needHours > 0 ? p.needHours : 'not set']),
    line(['Source', 'NASA JPL Horizons, smooth-horizon model, first 72 hours after touchdown']),
    '',
    line(['Every slip at this site']),
    line(['Slip (days)', 'Touchdown (UTC)', 'Sun up (h)', 'Earth up (h)', 'Both up (h)', 'Longest unbroken both up (h)', 'Sun behind Earth (h)', 'Meets need']),
    ...p.slips.map((c) =>
      line([c.slipDays, c.touchdownUtc, h2(c.sunHours), h2(c.earthHours), h2(c.bothHours), h2(c.longestBothHours), h2(c.eclipseHours), verdict(c.longestBothHours, p.needHours) ?? '']),
    ),
    '',
    line([`Every site, touchdown ${p.touchdownUtc}, slip ${p.slipDays} days`]),
    line(['Site', 'Region', 'Sun original (h)', 'Sun delayed (h)', 'Earth original (h)', 'Earth delayed (h)', 'Both original (h)', 'Both delayed (h)', 'Change in both (h)', 'Longest unbroken original (h)', 'Longest unbroken delayed (h)', 'Original meets need', 'Delayed meets need']),
    ...p.sites.map((r) =>
      line([r.name, r.region, h2(r.sun[0]), h2(r.sun[1]), h2(r.earth[0]), h2(r.earth[1]), h2(r.both[0]), h2(r.both[1]), h2(r.change), h2(r.longest[0]), h2(r.longest[1]), r.verdict[0] ?? '', r.verdict[1] ?? '']),
    ),
  ];
  return `${out.join('\n')}\n`;
}
