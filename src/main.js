import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import './unseen.css';
import './additions.css';

import { DATASETS, SITES, FEATURED, PRESET_START_MS, PRESET_SLIP_DAYS, customSite, scenarioLabel } from './data.js';
import { analyze, delayImpact, sampleAt, nextCrossing, aboveAt, eclipseAt, HOUR_MS, HORIZON_MARGINS } from './calc.js';
import {
  fmtHours, fmtUtc, fmtUtcTime, fmtDuration, fmtElapsed, fmtDeg, fmtChange, fmtDay, fmtClock, slipWords, slipShort,
  compass, EVENT_NAME,
} from './format.js';
import { createTimelines } from './timeline.js';
import { createSkyStrip } from './skystrip.js';
import { createSlipStrip } from './slipstrip.js';
import { icon } from './icons.js';
import { WINDOW_HOURS } from './window.js';
import { loadEphemeris } from './ephemeris.js';
import { initChrome } from './chrome.js';
import { initSound } from './sound.js'; // ── sound ──
import { createDatePicker } from './datepicker.js';
import { eclipseIntervals } from './eclipse.js';
import {
  analyzeStay, slipSeries, rankSlips, slipCell, findBackups, meetsNeed, firstRun, NEED_HOURS, DEFAULT_NEED_HOURS,
} from './slips.js';
import { verdict, siteRows, planCsv } from './plan.js';
import { profileFor, TERRAIN_NOT_AVAILABLE } from './terrain.js'; // ── terrain ──
import { createCalendar } from './calendar.js'; // ── calendar ──
import { mountHeatmap } from './heatmap.js'; // ── heatmap ──

const $ = (s) => document.querySelector(s);
const MAX_MIN = WINDOW_HOURS * 60;
const DAY_MS = 24 * HOUR_MS;
const STAY_MS = WINDOW_HOURS * HOUR_MS;
const MAX_SLIP_DAYS = 30;
const MAX_CACHED_PAIRS = 64;
const MAX_CACHED_SERIES = 16;

// ───────────── Scenario pairs: Horizons presets, or the bundled Moon table ─────────────
// The four reference scenarios read the Horizons CSVs directly. Any other site,
// touchdown or slip is computed from the Moon table once it has loaded.
let eph = null;
const pairCache = new Map();

const isPreset = (site, startMs, slipDays) =>
  Boolean(DATASETS[site.id]) && startMs === PRESET_START_MS && slipDays === PRESET_SLIP_DAYS;

const pairKey = (site, startMs, slipDays, horizonDeg, profile = null) =>
  `${site.id}|${site.lat}|${site.lonE}|${startMs}|${slipDays}|${horizonDeg}${profile ? '|lola' : ''}`; // ── terrain ──

// ── terrain ── the site's LOLA skyline when terrain is on and the site has one, else null (smooth).
const terrainProfile = (site, terrain) => (terrain && site.id !== 'custom' ? profileFor(site.id) : null);

/** Original and delayed analyses for a plan, or null while the table is still loading. */
function pairFor(site, startMs, slipDays, horizonDeg = 0, terrain = false) {
  const profile = terrainProfile(site, terrain); // ── terrain ──
  const tx = profile ? { horizonProfile: profile } : {};
  const key = pairKey(site, startMs, slipDays, horizonDeg, profile);
  if (pairCache.has(key)) return pairCache.get(key);
  let pair;
  if (isPreset(site, startMs, slipDays)) {
    const ds = DATASETS[site.id];
    // The Horizons files carry no eclipse data. Once the Moon table is in, check them too.
    const eclipseFor = (rows) => (eph ? { eclipse: eclipseIntervals(eph, site, rows[0].t, rows[0].t + STAY_MS) } : {});
    pair = {
      key,
      source: 'horizons',
      original: analyze({ ...ds.original, slipDays, horizonDeg, ...tx, ...eclipseFor(ds.original.rows) }),
      delayed: analyze({ ...ds.delayed, slipDays, horizonDeg, ...tx, ...eclipseFor(ds.delayed.rows) }),
    };
  } else {
    if (!eph) return null;
    const build = (scenario, t0) => analyzeStay(eph, site, t0, { site: site.id, scenario, file: null, slipDays, horizonDeg, ...tx });
    pair = {
      key,
      source: 'table',
      original: build('original', startMs),
      delayed: build('delayed', startMs + slipDays * DAY_MS),
    };
  }
  if (pairCache.size >= MAX_CACHED_PAIRS) pairCache.clear();
  pairCache.set(key, pair);
  return pair;
}

// The reference pairs, kept for the Blue Ghost replay and for QA in the console.
const A = Object.fromEntries(
  Object.keys(DATASETS).map((id) => [id, pairFor(SITES[id], PRESET_START_MS, PRESET_SLIP_DAYS)]),
);

const state = {
  site: 'athena',
  custom: null,
  startMs: PRESET_START_MS,
  slipDays: PRESET_SLIP_DAYS,
  horizonDeg: 0,
  terrain: false, // ── terrain ──
  needHours: DEFAULT_NEED_HOURS,
  scenario: 'original',
  elapsedMin: 0,
};
const siteIn = (s) => (s.site === 'custom' ? s.custom : SITES[s.site]);
const currentSite = () => siteIn(state);
const pair = () => pairFor(currentSite(), state.startMs, state.slipDays, state.horizonDeg, state.terrain);
const active = () => pair()[state.scenario];
const selectedT = () => active().start + state.elapsedMin * 60_000;

/** Why a plan cannot be shown, or null when it can. */
function planProblem(startMs, slipDays) {
  if (!Number.isFinite(startMs)) return 'Enter a touchdown date and time.';
  if (!Number.isInteger(slipDays) || slipDays < 1 || slipDays > MAX_SLIP_DAYS) {
    return `The slip must be 1 to ${MAX_SLIP_DAYS} days.`;
  }
  if (!eph) return null;
  const tail = slipDays * DAY_MS + WINDOW_HOURS * HOUR_MS;
  if (startMs < eph.startMs || startMs + tail > eph.endMs) {
    return `Pick a touchdown from ${fmtDay(eph.startMs, { year: true })} to ${fmtDay(eph.endMs - tail, { year: true })}.`;
  }
  return null;
}

// ───────────── Answer + metrics ─────────────
function answerHtml(p, site, slipDays) {
  const o = p.original;
  const d = p.delayed;
  const ch = delayImpact(o, d);
  const sunO = o.bodies.sun.hours, sunD = d.bodies.sun.hours;
  const earthO = o.bodies.earth, earthD = d.bodies.earth;

  let sunPart;
  if (sunD === 0 && sunO > 0) sunPart = `<span class="hl-sun">the Sun never rises</span> (${fmtHours(sunO)} → 0 h)`;
  else if (sunO === 0 && sunD > 0) sunPart = `<span class="hl-sun">the Sun comes up</span> (0 → ${fmtHours(sunD)} h)`;
  else if (fmtHours(ch.sun) !== '0') sunPart = `<span class="hl-sun">${fmtChange(ch.sun)} of Sun</span>`;
  else if (sunO === 0) sunPart = `<span class="hl-sun">the Sun stays down</span> in both stays`;
  else sunPart = `<span class="hl-sun">the same ${fmtHours(sunO)} h of Sun</span>`;

  let earthPart;
  if (fmtHours(ch.earth) !== '0') earthPart = `<span class="hl-earth">${fmtChange(ch.earth)} of Earth visibility</span>`;
  else if (earthO.whole === 'above' && earthD.whole === 'above') earthPart = `<span class="hl-earth">Earth stays up all 72 h</span>`;
  else if (earthO.whole === 'below' && earthD.whole === 'below') earthPart = `<span class="hl-earth">Earth never rises here</span>`;
  else earthPart = `<span class="hl-earth">the same ${fmtHours(earthO.hours)} h of Earth visibility</span>`;

  let explain;
  if (earthD.hours === 0) {
    explain = `After the delay, Earth never clears the horizon, so there is no direct radio line in this model.`;
  } else {
    const span = earthD.whole === 'above' ? 'all 72 hours' : `${fmtHours(earthD.hours)} hours`;
    explain = `After the delay, Earth is above the horizon for ${span}${sunD === 0 ? ', all during modeled darkness' : ''}.`;
  }
  const earlier = `The original touchdown offers ${fmtHours(o.both.hours)} hours with both above the horizon.`;
  const where = site.id === 'custom' ? 'this custom site' : site.name;
  let blocked = o.horizonDeg > 0 ? `, with the lowest ${o.horizonDeg}° of sky blocked by terrain,` : ',';
  // ── terrain ──
  if (o.horizonProfile) blocked = o.horizonDeg > 0 ? `, with the LOLA terrain skyline plus a ${o.horizonDeg}° margin,` : ', with the LOLA terrain skyline,';
  const eclipse = [['original', o], ['delayed', d]]
    .filter(([, a]) => a.eclipse.any.length)
    .map(([name, a]) =>
      a.eclipse.totalHours > 0
        ? ` In the ${name} stay Earth fully covers the Sun for ${fmtDuration(a.eclipse.totalHours * HOUR_MS)}, counted as no sunlight.`
        : ` In the ${name} stay Earth partly covers the Sun for a while.`,
    )
    .join('');
  const need = state.needHours;
  const vo = verdict(o.stretches.longestBoth, need), vd = verdict(d.stretches.longestBoth, need);
  const verdictLine = !need
    ? ''
    : vo === 'go' && vd === 'nogo'
      ? ` <strong class="v-line">Against a need of ${need} h with both up without a break, the slip turns a go into a no go.</strong>`
      : vo === 'nogo' && vd === 'go'
        ? ` <strong class="v-line">Against a need of ${need} h with both up without a break, the slip turns a no go into a go.</strong>`
        : vo === 'go'
          ? ` <strong class="v-line">Both touchdowns meet a need of ${need} h with both up without a break.</strong>`
          : ` <strong class="v-line">Neither touchdown meets a need of ${need} h with both up without a break.</strong>`;
  return `<strong>At ${where}${blocked} a ${slipWords(slipDays).replace(/ days?$/, '')}-day slip means ${sunPart} and ${earthPart}.</strong> ${explain} ${earlier}${eclipse}${verdictLine}`;
}

function metricsHtml(p) {
  const o = p.original;
  const d = p.delayed;
  const ch = delayImpact(o, d);
  const sunNote = o.eclipse.totalHours > 0 || d.eclipse.totalHours > 0 ? 'solar power, less time behind Earth' : 'solar power';
  const rows = [
    { k: 'sun', label: 'Sun above horizon', note: sunNote, o: o.bodies.sun.hours, d: d.bodies.sun.hours, c: ch.sun },
    { k: 'earth', label: 'Earth above horizon', note: 'direct radio', o: o.bodies.earth.hours, d: d.bodies.earth.hours, c: ch.earth },
    { k: 'both', label: 'Both above horizon', note: 'power + radio', o: o.both.hours, d: d.both.hours, c: ch.both },
  ];
  return rows
    .map((r) => {
      const cs = fmtHours(r.c);
      const cls = cs === '0' ? 'zero' : r.c < 0 ? 'neg' : 'pos';
      const changeText = cs === '0' ? 'No change' : `${r.c < 0 ? '−' : '+'}${cs.replace('-', '')} h`;
      return `<tr class="m-${r.k}">
        <th scope="row">${icon(r.k)}<span class="m-label">${r.label}<span class="m-note">${r.note}</span></span></th>
        <td class="num"><span class="m-val">${fmtHours(r.o)}</span><span class="m-u">h</span>
          <span class="m-mini" aria-hidden="true"><i style="width:${(r.o / WINDOW_HOURS) * 100}%"></i></span></td>
        <td class="num"><span class="m-val">${fmtHours(r.d)}</span><span class="m-u">h</span>
          <span class="m-mini" aria-hidden="true"><i style="width:${(r.d / WINDOW_HOURS) * 100}%"></i></span></td>
        <td class="num m-change ${cls}"><span>${changeText}</span><span class="sr">, ${fmtChange(r.c)}</span></td>
      </tr>`;
    })
    .join('');
}

/** Change text and colour class for a metric. `better` is +1 when more hours are good, −1 when fewer are. */
function changeCell(c, better = 1) {
  const cs = fmtHours(c);
  const cls = cs === '0' ? 'zero' : c * better < 0 ? 'neg' : 'pos';
  const text = cs === '0' ? 'No change' : `${c < 0 ? '−' : '+'}${cs.replace('-', '')} h`;
  return `<td class="num m-change ${cls}"><span>${text}</span></td>`;
}

/** Continuous stretches: the longest unbroken time with both up, without sunlight and without Earth. */
function stretchHtml(p, needHours) {
  const o = p.original, d = p.delayed;
  const rows = [
    { k: 'both', label: 'Sun and Earth up together', key: 'longestBoth', better: 1 },
    { k: 'sun', label: 'Without sunlight', key: 'longestDark', better: -1 },
    { k: 'earth', label: 'Without Earth in the sky', key: 'longestNoEarth', better: -1 },
  ];
  const valueCell = (h) => `<td class="num"><span class="st-val">${fmtHours(h)}</span><span class="m-u">h</span></td>`;
  const body = rows
    .map((r) => {
      const ov = o.stretches[r.key], dv = d.stretches[r.key];
      return `<tr class="st-${r.k}"><th scope="row">${icon(r.k)}<span>${r.label}</span></th>${valueCell(ov)}${valueCell(dv)}${changeCell(dv - ov, r.better)}</tr>`;
    })
    .join('');
  // When does the first stretch long enough for the need begin? Elapsed time from touchdown.
  const firstCell = (a) => {
    const run = firstRun({ bothRuns: a.both.intervals }, needHours);
    return run
      ? `<td class="num"><span class="st-at">${fmtElapsed(run[0] - a.start)}</span></td>`
      : `<td class="num"><span class="st-none">None</span></td>`;
  };
  return (
    body +
    `<tr class="st-first"><th scope="row">${icon('both')}<span>First ${needHours} h with both up starts at</span></th>${firstCell(o)}${firstCell(d)}<td class="num m-change zero"><span></span></td></tr>`
  );
}

// ───────────── Site picker, scenario switches ─────────────
const siteMore = $('#site-more');
const customForm = $('#custom-site');

function buildSitePicker() {
  const el = $('#site-picker');
  el.innerHTML = Object.values(FEATURED)
    .map(
      (s) => `<button type="button" role="radio" data-site="${s.id}" aria-checked="false">
        <span class="sp-name">${s.name}</span><span class="sp-sub">${s.sub}</span>
      </button>`,
    )
    .join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-site]');
    if (b) setState({ site: b.dataset.site });
  });
  radioKeys(el, '[data-site]', (b) => setState({ site: b.dataset.site }));

  const others = Object.values(SITES).filter((s) => !s.featured);
  siteMore.innerHTML =
    `<option value="">More sites</option>` +
    others.map((s) => `<option value="${s.id}">${s.name} · ${s.region}</option>`).join('') +
    `<option value="custom">Custom coordinates</option>`;
  siteMore.addEventListener('change', () => {
    const v = siteMore.value;
    if (v === 'custom') {
      customForm.hidden = false;
      $('#custom-lat').focus();
      return;
    }
    customForm.hidden = true;
    if (v) setState({ site: v });
  });
  customForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const latText = $('#custom-lat').value.trim();
    const lonText = $('#custom-lon').value.trim();
    if (latText === '' || lonText === '') return planMessage('Enter both a latitude and a longitude.', true);
    try {
      setState({ site: 'custom', custom: customSite(Number(latText), Number(lonText)) });
    } catch (err) {
      planMessage(err instanceof Error ? err.message : 'Those coordinates are not valid.', true);
    }
  });
}

function buildScenarioSwitch() {
  const el = $('#scn-switch');
  el.innerHTML = ['original', 'delayed']
    .map(
      (id) => `<button type="button" role="radio" data-scenario="${id}" aria-checked="false">
        <span>${id === 'original' ? 'Original' : 'Delayed'}</span><span class="num" data-scn-date="${id}"></span>
      </button>`,
    )
    .join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scenario]');
    if (b) setState({ scenario: b.dataset.scenario, transition: true });
  });
  radioKeys(el, '[data-scenario]', (b) => setState({ scenario: b.dataset.scenario, transition: true }));
}

/** Arrow-key roving for radio groups. */
function radioKeys(group, sel, pick) {
  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const items = [...group.querySelectorAll(sel)];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
    n.focus();
    pick(n);
  });
}

// ───────────── Plan controls: touchdown date and slip ─────────────
const startInput = $('#start-input');
// The browser's own date-time pop-up cannot be styled, so a themed picker drives the hidden field.
const datePicker = createDatePicker(startInput, $('#start-picker'), { slipDays: () => state.slipDays });
const slipRange = $('#slip-range');
const READY_MSG = 'Any site, any touchdown from 2024 through 2030, any slip up to 30 days.';

function planMessage(text, isError = false) {
  const el = $('#plan-msg');
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}
const toInputValue = (ms) => new Date(ms).toISOString().slice(0, 16);

startInput.addEventListener('change', () => {
  // The field has no time zone. The value is read as UTC.
  const ms = Date.parse(`${startInput.value}:00Z`);
  const problem = planProblem(ms, state.slipDays);
  if (problem) {
    planMessage(problem, true);
    startInput.value = toInputValue(state.startMs);
    return;
  }
  stopAnim();
  setState({ startMs: ms });
});
slipRange.addEventListener('input', () => {
  const days = Number(slipRange.value);
  const problem = planProblem(state.startMs, days);
  if (problem) {
    planMessage(problem, true);
    slipRange.value = String(state.slipDays);
    return;
  }
  stopAnim();
  setState({ slipDays: days });
});
// Terrain margin: the lowest N degrees of sky count as blocked. A stand-in for ridges and crater rims.
const marginPicker = $('#margin-picker');
marginPicker.innerHTML = HORIZON_MARGINS.map(
  (m) => `<button type="button" role="radio" data-margin="${m}" aria-checked="false"><span class="sp-name num">${m}°</span>${m === 0 ? '<span class="sp-sub">smooth</span>' : ''}</button>`,
).join('');
marginPicker.addEventListener('click', (e) => {
  const b = e.target.closest('[data-margin]');
  if (!b) return;
  stopAnim();
  setState({ horizonDeg: Number(b.dataset.margin) });
});
radioKeys(marginPicker, '[data-margin]', (b) => setState({ horizonDeg: Number(b.dataset.margin) }));
// ── terrain ── Smooth or LOLA terrain horizon. Only built-in sites have a skyline.
const terrainPicker = $('#terrain-picker');
terrainPicker?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-terrain]');
  if (!b || b.disabled) return;
  stopAnim();
  setState({ terrain: b.dataset.terrain === '1' });
});
if (terrainPicker) radioKeys(terrainPicker, '[data-terrain]', (b) => !b.disabled && setState({ terrain: b.dataset.terrain === '1' }));

// ───────────── Every site on the same plan ─────────────
let lastSiteRows = [];
const fmtPair = ([a, b]) => `<span class="num">${fmtHours(a)}</span><span class="sites-to" aria-hidden="true">→</span><span class="num">${fmtHours(b)}</span>`;
function renderSites(o, d) {
  const body = $('#sites-body');
  $('#sites-sub').textContent =
    `Touchdown ${fmtUtc(o.start, { year: true })} and the same slip of ${slipShort(state.slipDays)} at every landing site${
      state.horizonDeg > 0 ? `, with a ${state.horizonDeg}° terrain margin` : ''
    }${state.terrain ? ', with each site\'s LOLA terrain skyline' : ''}. Original → delayed, best delayed stay first. The verdict is the delayed stay against a need of ${state.needHours} h with both up without a break. Pick a row to open that site.`;
  if (!eph) {
    body.innerHTML = '<tr><td colspan="6" class="sites-wait">Loading the Moon table.</td></tr>';
    return;
  }
  const list = [...Object.values(SITES), ...(state.site === 'custom' && state.custom ? [state.custom] : [])];
  const entries = list
    .map((site) => ({ site, pair: pairFor(site, state.startMs, state.slipDays, state.horizonDeg, state.terrain) }))
    .filter((e) => e.pair);
  lastSiteRows = siteRows(entries, state.needHours);
  body.innerHTML = lastSiteRows
    .map((r) => {
      const change = fmtHours(r.change);
      const changeCls = change === '0' ? 'zero' : r.change < 0 ? 'neg' : 'pos';
      const v = r.verdict[1];
      const verdictCell = v ? `<span class="verdict ${v}">${v === 'go' ? 'Go' : 'No go'}</span>` : '<span class="muted">No need set</span>';
      return `<tr class="${r.id === state.site ? 'is-current' : ''}" data-site-row="${r.id}">
        <th scope="row"><button type="button" class="sites-pick" data-pick-site="${r.id}">${r.name}<span class="sites-region">${r.region}</span></button></th>
        <td class="num col-sun">${fmtPair(r.sun)}</td>
        <td class="num col-earth">${fmtPair(r.earth)}</td>
        <td class="num">${fmtPair(r.both)}</td>
        <td class="num m-change ${changeCls}"><span>${change === '0' ? '0' : `${r.change < 0 ? '−' : '+'}${change.replace('-', '')}`}</span></td>
        <td>${verdictCell}</td>
      </tr>`;
    })
    .join('');
}
$('#sites-body').addEventListener('click', (e) => {
  // The whole row opens its site. The name is a real button, so keyboards reach it.
  const row = e.target.closest('[data-site-row]');
  if (!row) return;
  stopAnim();
  setState({ site: row.dataset.siteRow, transition: true });
  document.getElementById('navigator').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
});

// ── calendar ── Every touchdown day at this site. Picking a day makes it the original touchdown.
const calendar = createCalendar($('#cal-root'), {
  onPick: (dayMs) => {
    stopAnim();
    const problem = planProblem(dayMs, state.slipDays);
    if (problem) planMessage(problem, true);
    else setState({ startMs: dayMs, transition: true });
    document.getElementById('navigator').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  },
});

// ───────────── Download the plan as CSV ─────────────
$('#download-csv').addEventListener('click', () => {
  const site = currentSite();
  const csv = planCsv({
    site: site.id === 'custom' ? 'Custom site' : site.name,
    coords: site.coordLabel,
    touchdownUtc: new Date(state.startMs).toISOString().slice(0, 16).replace('T', ' '),
    slipDays: state.slipDays,
    marginDeg: state.horizonDeg,
    needHours: state.needHours,
    slips: (slipCells ?? []).map((c) => ({ ...c, touchdownUtc: new Date(c.startMs).toISOString().slice(0, 16).replace('T', ' ') })),
    sites: lastSiteRows,
  });
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `long-shadow-${site.id}-${toInputValue(state.startMs).slice(0, 10)}-slip-${state.slipDays}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  planMessage(eph ? 'Downloaded every slip and every site for this plan.' : 'Downloaded. The site list fills in once the Moon table loads.');
});

// Backup finder: how many unbroken hours of Sun and Earth together the plan needs.
const needPicker = $('#need-picker');
needPicker.innerHTML = NEED_HOURS.map(
  (h) => `<button type="button" role="radio" data-need="${h}" aria-checked="false"><span class="sp-name num">${h} h</span></button>`,
).join('');
needPicker.addEventListener('click', (e) => {
  const b = e.target.closest('[data-need]');
  if (b) setState({ needHours: Number(b.dataset.need) });
});
radioKeys(needPicker, '[data-need]', (b) => setState({ needHours: Number(b.dataset.need) }));
$('#backup-go').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  stopAnim();
  const slipDays = Number(b.dataset.go);
  const problem = planProblem(state.startMs, slipDays);
  if (problem) return planMessage(problem, true);
  setState({ slipDays, scenario: 'delayed', transition: true });
});

$('#plan-reset').addEventListener('click', () => {
  stopAnim();
  setState({ startMs: PRESET_START_MS, slipDays: PRESET_SLIP_DAYS });
});
$('#copy-link').addEventListener('click', async () => {
  syncUrl();
  try {
    await navigator.clipboard.writeText(window.location.href);
    planMessage('Link copied. It reopens this site, date, slip and time.');
  } catch {
    planMessage('Copy the address bar. It reopens this site, date, slip and time.');
  }
});

// ───────────── Shareable address ─────────────
function stateQuery() {
  const isDefault =
    state.site === 'athena' && state.startMs === PRESET_START_MS && state.slipDays === PRESET_SLIP_DAYS &&
    state.horizonDeg === 0 && !state.terrain && state.needHours === DEFAULT_NEED_HOURS && state.scenario === 'original' &&
    Math.round(state.elapsedMin) === 0;
  if (isDefault) return '';
  const q = new URLSearchParams();
  q.set('site', state.site);
  if (state.site === 'custom') {
    q.set('lat', String(state.custom.lat));
    q.set('lon', String(state.custom.lonE));
  }
  q.set('start', toInputValue(state.startMs));
  q.set('slip', String(state.slipDays));
  if (state.horizonDeg > 0) q.set('h', String(state.horizonDeg));
  if (state.terrain) q.set('terrain', '1'); // ── terrain ──
  if (state.needHours !== DEFAULT_NEED_HOURS) q.set('need', String(state.needHours));
  q.set('view', state.scenario);
  q.set('t', String(Math.round(state.elapsedMin)));
  return `?${q}`;
}
let urlTimer = null;
function syncUrl() {
  clearTimeout(urlTimer);
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${stateQuery()}${window.location.hash}`);
  } catch {
    // Some embedded or file:// contexts refuse history changes. The app works without it.
  }
}
const scheduleUrlSync = () => {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(syncUrl, 400);
};

/** Read a shared address into a state patch. Unknown or invalid values are dropped. */
function patchFromUrl() {
  const q = new URLSearchParams(window.location.search);
  if (![...q.keys()].length) return null;
  const patch = {};
  const siteId = q.get('site');
  if (siteId === 'custom') {
    try {
      patch.custom = customSite(Number(q.get('lat')), Number(q.get('lon')));
      patch.site = 'custom';
    } catch {
      // ignore bad coordinates
    }
  } else if (siteId && Object.hasOwn(SITES, siteId)) patch.site = siteId;
  const start = q.get('start');
  if (start && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(start)) {
    const ms = Date.parse(`${start}:00Z`);
    if (Number.isFinite(ms)) patch.startMs = ms;
  }
  const slip = Number(q.get('slip'));
  if (Number.isInteger(slip) && slip >= 1 && slip <= MAX_SLIP_DAYS) patch.slipDays = slip;
  const h = Number(q.get('h'));
  if (q.has('h') && HORIZON_MARGINS.includes(h)) patch.horizonDeg = h;
  if (q.get('terrain') === '1') patch.terrain = true; // ── terrain ──
  const need = Number(q.get('need'));
  if (q.has('need') && NEED_HOURS.includes(need)) patch.needHours = need;
  if (['original', 'delayed'].includes(q.get('view'))) patch.scenario = q.get('view');
  const t = Number(q.get('t'));
  if (q.has('t') && Number.isFinite(t)) patch.elapsedMin = Math.min(Math.max(t, 0), MAX_MIN);
  return Object.keys(patch).length ? patch : null;
}

// ───────────── Scrubber ─────────────
const scrubber = $('#scrubber');
function buildScrubTicks() {
  $('#scrub-ticks').innerHTML = [0, 12, 24, 36, 48, 60, 72]
    .map((h) => `<span style="left:${(h / 72) * 100}%">${h}</span>`)
    .join('');
}
scrubber.addEventListener('input', () => {
  stopAnim();
  setState({ elapsedMin: Number(scrubber.value) });
});
scrubber.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 60, ArrowUp: 60, ArrowLeft: -60, ArrowDown: -60, PageUp: 360, PageDown: -360 }[e.key];
  let v = null;
  if (step !== undefined) v = state.elapsedMin + (e.shiftKey && Math.abs(step) === 60 ? Math.sign(step) * 10 : step);
  if (e.key === 'Home') v = 0;
  if (e.key === 'End') v = MAX_MIN;
  if (v === null) return;
  e.preventDefault();
  stopAnim();
  setState({ elapsedMin: Math.min(Math.max(v, 0), MAX_MIN) });
});

// ───────────── Animation (play + replay) ─────────────
let anim = null;
function stopAnim() {
  if (anim) cancelAnimationFrame(anim.raf);
  anim = null;
  $('#play').classList.remove('is-playing');
  $('#play').setAttribute('aria-label', 'Play through the 72 hours');
}
function animateTo(targetMin, durMs, { from, onDone, ease = (t) => 1 - Math.pow(1 - t, 3) } = {}) {
  stopAnim();
  const start = from ?? state.elapsedMin;
  if (from !== undefined) setState({ elapsedMin: from });
  const t0 = performance.now();
  const frame = (now) => {
    const k = Math.min((now - t0) / durMs, 1);
    setState({ elapsedMin: start + (targetMin - start) * ease(k), quiet: k < 1 });
    if (k < 1) anim.raf = requestAnimationFrame(frame);
    else {
      anim = null;
      $('#play').classList.remove('is-playing');
      onDone?.();
    }
  };
  anim = { raf: requestAnimationFrame(frame) };
}
$('#play').addEventListener('click', () => {
  if (anim) return stopAnim();
  const from = state.elapsedMin >= MAX_MIN ? 0 : state.elapsedMin;
  const remaining = MAX_MIN - from;
  animateTo(MAX_MIN, (remaining / 60) * 160, { from, ease: (t) => t });
  $('#play').classList.add('is-playing');
  $('#play').setAttribute('aria-label', 'Pause');
});

// ───────────── Blue Ghost replay (always the reference plan) ─────────────
const REPLAY = { site: 'blueGhost', scenario: 'original', startMs: PRESET_START_MS, slipDays: PRESET_SLIP_DAYS, horizonDeg: 0, terrain: false }; // ── terrain ──
const onReplayPlan = () =>
  state.site === 'blueGhost' && state.scenario === 'original' &&
  state.startMs === PRESET_START_MS && state.slipDays === PRESET_SLIP_DAYS && state.horizonDeg === 0 && !state.terrain;
const bgSunset = () => A.blueGhost.original.bodies.sun.events.find((e) => e.type === 'set');
const sunsetMin = () => (bgSunset().t - A.blueGhost.original.start) / 60_000;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function showToast(html) {
  const t = $('#replay-toast');
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(showToast.h);
  showToast.h = setTimeout(() => (t.hidden = true), 7000);
}

function replay() {
  setState({ ...REPLAY });
  document.querySelector('.sky').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  const done = () => {
    setState({ elapsedMin: sunsetMin() });
    showToast(
      `<b>Model sunset</b> <span class="num">${fmtUtc(bgSunset().t, { year: true })}</span><span class="toast-sub">Firefly reported sunset imagery this day and 5+ h of operations into lunar night.</span>`,
    );
    $('#live').textContent = `Replay: model sunset at Blue Ghost, ${fmtUtc(bgSunset().t, { year: true })}.`;
  };
  if (reduceMotion) return done();
  setTimeout(() => animateTo(sunsetMin(), 5200, { from: sunsetMin() - 6 * 60, onDone: done, ease: (t) => 1 - Math.pow(1 - t, 2.2) }), 450);
}
$('#replay-btn').addEventListener('click', replay);
$('#step-sunset').addEventListener('click', () => {
  stopAnim();
  setState({ ...REPLAY, elapsedMin: sunsetMin() });
});
const stepBy = (d) => {
  stopAnim();
  if (!onReplayPlan()) setState({ ...REPLAY, elapsedMin: sunsetMin() });
  setState({ elapsedMin: Math.min(Math.max(state.elapsedMin + d, 0), MAX_MIN) });
};
$('#step-back').addEventListener('click', () => stepBy(-60));
$('#step-fwd').addEventListener('click', () => stepBy(60));

// ───────────── Eclipse replay: Mar 14, 2025 at the Blue Ghost site ─────────────
// A 72 hour window that starts on Mar 13, during Blue Ghost's mission. It needs the Moon table.
const ECLIPSE_REPLAY = {
  site: 'blueGhost',
  scenario: 'original',
  startMs: Date.parse('2025-03-13T00:00:00Z'),
  slipDays: PRESET_SLIP_DAYS,
  horizonDeg: 0,
};
const ECLIPSE_LEAD_MIN = 3 * 60;
const eclipseStay = () =>
  eph ? pairFor(SITES.blueGhost, ECLIPSE_REPLAY.startMs, ECLIPSE_REPLAY.slipDays).original : null;
const eclipseSpan = ([s, e]) => `${fmtUtcTime(s)} to ${fmtUtcTime(e)} UTC`;

function replayEclipse() {
  const stay = eclipseStay();
  const total = stay?.eclipse.total[0];
  if (!total) return planMessage('Still loading the Moon table. Try again in a moment.', true);
  stopAnim();
  setState({ ...ECLIPSE_REPLAY });
  document.querySelector('.sky').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  const startMin = (total[0] - stay.start) / 60_000;
  const midMin = ((total[0] + total[1]) / 2 - stay.start) / 60_000;
  const done = () => {
    setState({ elapsedMin: midMin });
    showToast(
      `<b>Sun behind Earth</b> <span class="num">${eclipseSpan(total)}</span><span class="toast-sub">Model, Mar 14, 2025 at the Blue Ghost site. Reported totality for the whole Moon: 06:26 to 07:31 UTC.</span>`,
    );
    $('#live').textContent = `Replay: the Sun is behind Earth at the Blue Ghost site, ${eclipseSpan(total)}, Mar 14, 2025.`;
  };
  if (reduceMotion) return done();
  setTimeout(
    () =>
      animateTo(midMin, 5200, {
        from: Math.max(startMin - ECLIPSE_LEAD_MIN, 0),
        onDone: done,
        ease: (t) => 1 - Math.pow(1 - t, 2.2),
      }),
    450,
  );
}
$('#eclipse-btn').addEventListener('click', replayEclipse);

// ───────────── Slip strip ─────────────
const seriesCache = new Map();
const slipStrip = createSlipStrip($('#slips'), {
  onPick: (slipDays) => {
    stopAnim();
    if (slipDays === 0) return setState({ scenario: 'original', transition: true });
    const problem = planProblem(state.startMs, slipDays);
    if (problem) return planMessage(problem, true);
    setState({ slipDays, scenario: 'delayed', transition: true });
  },
});

/** Hours for every slip at this site and touchdown. The cells for slip 0 and the chosen slip come from the pair on screen. */
function renderSlips(p, site) {
  if (!eph) return;
  const profile = terrainProfile(site, state.terrain); // ── terrain ──
  const key = `${site.id}|${site.lat}|${site.lonE}|${state.startMs}|${state.horizonDeg}${profile ? '|lola' : ''}`;
  if (!seriesCache.has(key)) {
    if (seriesCache.size >= MAX_CACHED_SERIES) seriesCache.clear();
    seriesCache.set(key, slipSeries(eph, site, state.startMs, MAX_SLIP_DAYS, state.horizonDeg, profile));
  }
  const cells = seriesCache.get(key).map((c) => {
    if (c.slipDays === 0) return slipCell(0, p.original);
    return c.slipDays === state.slipDays ? slipCell(c.slipDays, p.delayed) : c;
  });
  slipCells = cells;
  slipStrip.render({ cells, rank: rankSlips(cells) });
}

/** The backup finder's answer and the strip marks, for the cells on screen and the chosen need. */
let slipCells = null;
function renderBackup() {
  const read = $('#backup-read');
  const go = $('#backup-go');
  if (!slipCells) return;
  const need = state.needHours;
  const last = slipCells.at(-1).slipDays;
  const b = findBackups(slipCells, need, state.slipDays);
  slipStrip.markNeed({
    ok: new Set(slipCells.filter((c) => meetsNeed(c, need)).map((c) => c.slipDays)),
    pick: b.earliest?.slipDays ?? null,
  });

  const when = (c) => `<b>+${slipShort(c.slipDays)}</b> <span class="num">(${fmtDay(c.startMs)})</span>`;
  const runWords = (c) => {
    const r = firstRun(c, need);
    const len = (r[1] - r[0]) / HOUR_MS;
    return len >= WINDOW_HOURS - 1e-6
      ? 'all 72 h'
      : `${fmtHours(len)} h unbroken from <span class="num">${fmtElapsed(r[0] - c.startMs)}</span>`;
  };
  const planCell = slipCells.find((c) => c.slipDays === state.slipDays);
  const planOk = planCell && meetsNeed(planCell, need);
  const parts = [];
  const offer = [];
  if (!b.longest) {
    parts.push(`No slip from 1 to ${last} days has the Sun and Earth up together here, so no backup meets a ${need} h need.`);
  } else if (!b.earliest) {
    parts.push(
      `No slip from 1 to ${last} days gives ${need} h without a break. The longest unbroken stretch is ${fmtHours(b.longest.longestBothHours)} h, at ${when(b.longest)}.`,
    );
    offer.push(b.longest);
  } else {
    parts.push(`Earliest backup: ${when(b.earliest)}, ${runWords(b.earliest)}.`);
    offer.push(b.earliest);
    if (planOk && planCell !== b.earliest) {
      parts.push(`The +${state.slipDays}-day slip in the plan also meets it: ${runWords(planCell)}.`);
    } else if (!planOk && b.next && b.next !== b.earliest) {
      parts.push(`After the +${state.slipDays}-day slip in the plan, the next is ${when(b.next)}, ${runWords(b.next)}.`);
      offer.push(b.next);
    } else if (!planOk && !b.next && state.slipDays < last) {
      parts.push(`Nothing after the +${state.slipDays}-day slip in the plan meets it within ${last} days.`);
    }
    if (!offer.includes(b.longest) && b.longest !== planCell && b.longest.longestBothHours > b.earliest.longestBothHours + 0.05) {
      parts.push(`Longest: ${when(b.longest)}, ${fmtHours(b.longest.longestBothHours)} h.`);
      offer.push(b.longest);
    }
  }
  read.innerHTML = parts.join(' ');
  const showing = state.scenario === 'delayed' ? state.slipDays : null;
  go.innerHTML = offer
    .map((c) =>
      c.slipDays === showing
        ? `<span class="backup-on">Showing +${slipShort(c.slipDays)}</span>`
        : `<button type="button" class="link-btn" data-go="${c.slipDays}">Show +${slipShort(c.slipDays)}</button>`,
    )
    .join('');
}

// ───────────── Touchdown buttons ─────────────
$('#td-original').addEventListener('click', () => setState({ scenario: 'original', transition: true }));
$('#td-delayed').addEventListener('click', () => setState({ scenario: 'delayed', transition: true }));
$('#apply-delay').addEventListener('click', () => {
  const next = state.scenario === 'original' ? 'delayed' : 'original';
  setState({ scenario: next, transition: true });
});

// ───────────── Views ─────────────
const timelines = createTimelines($('#timelines'), {
  onSelect: ({ scenario, elapsedMin }) => {
    stopAnim();
    setState({ scenario, ...(elapsedMin !== undefined ? { elapsedMin } : {}), transition: scenario !== state.scenario });
  },
});
const strip = createSkyStrip($('#strip'));
let globe = null;
let surface = null;
let toMoonFixed = null;
// ── heatmap ── Where to land on the globe, for the touchdown shown (scenario start) and the margin.
const heatmap = mountHeatmap({
  button: document.querySelector('[data-heatmap-toggle]'),
  legend: document.querySelector('#heat-legend'),
  inputs: () =>
    eph && {
      eph,
      startMs: state.startMs + (state.scenario === 'delayed' ? state.slipDays * DAY_MS : 0),
      horizonDeg: state.horizonDeg,
      needHours: state.needHours,
    },
  globe: () => globe,
});

function readoutHtml(sample, a, t) {
  return ['sun', 'earth']
    .map((b) => {
      const s = sample[b];
      const up = aboveAt(a, b, t);
      const covered = b === 'sun' && up ? eclipseAt(a, t) : null;
      const status = !up
        ? s.el > 0
          ? (a.horizonProfile ? '▼ Hidden by terrain' : '▼ Hidden by terrain margin') // ── terrain ──
          : '▼ Below horizon'
        : covered === 'total'
          ? '▲ Above horizon, behind Earth'
          : covered === 'partial'
            ? '▲ Above horizon, partly behind Earth'
            : '▲ Above horizon';
      return `<div class="ro ro-${b} ${up ? 'up' : 'down'}">
        <dt>${icon(b)}${b === 'sun' ? 'Sun' : 'Earth'}</dt>
        <dd class="ro-status">${status}</dd>
        <dd class="num ro-el"><span class="ro-k">Elevation</span>${fmtDeg(s.el)}</dd>
        <dd class="num ro-az"><span class="ro-k">Azimuth</span>${s.az.toFixed(1)}° ${compass(s.az)}</dd>
      </div>`;
    })
    .join('');
}

function nextHtml(a, t) {
  // Sitting on a crossing (e.g. the replay lands exactly on the model sunset).
  const now = a.events.find((e) => Math.abs(e.t - t) < 30_000);
  if (now) {
    const after = nextCrossing(a, now.t);
    return `<p class="nx-k">Model crossing</p>
      <p class="nx-v"><b>${EVENT_NAME[now.body][now.type]}</b> at this instant</p>
      <p class="nx-d num">${fmtUtc(now.t, { year: true })} · ${fmtElapsed(now.t - a.start)}${
        after ? '' : ' · no further crossing in this window'
      }</p>`;
  }
  const n = nextCrossing(a, t);
  if (n) {
    return `<p class="nx-k">Next crossing</p>
      <p class="nx-v"><b>${EVENT_NAME[n.body][n.type]}</b> in <span class="num">${fmtDuration(n.t - t)}</span></p>
      <p class="nx-d num">${fmtUtc(n.t, { year: true })} · ${fmtElapsed(n.t - a.start)}</p>`;
  }
  const sUp = aboveAt(a, 'sun', t), eUp = aboveAt(a, 'earth', t);
  return `<p class="nx-k">Next crossing</p>
    <p class="nx-v">No further crossing in this window.</p>
    <p class="nx-d">Sun ${sUp ? 'above' : 'below'} and Earth ${eUp ? 'above' : 'below'} the horizon through hour 72.</p>`;
}

let liveTimer = null;
function announce(a, t, sample) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    const n = nextCrossing(a, t);
    $('#live').textContent =
      `${currentSite().name}, ${scenarioLabel(state.scenario, state.slipDays)}, ${fmtElapsed(t - a.start)}, ${fmtUtc(t, { year: true })}. ` +
      `Sun ${fmtDeg(sample.sun.el)}, Earth ${fmtDeg(sample.earth.el)}. ` +
      (n ? `${EVENT_NAME[n.body][n.type]} in ${fmtDuration(n.t - t)}.` : 'No further crossing in this window.');
  }, 600);
}

// ───────────── Central state update ─────────────
let renderedKey = null;
let renderedStripKey = null;
let renderedNeedKey = null;
function setState(patch) {
  const { transition, quiet, ...rest } = patch;
  const next = { ...state, ...rest };
  next.elapsedMin = Math.min(Math.max(next.elapsedMin, 0), MAX_MIN);
  const site = siteIn(next);
  if (!site || !pairFor(site, next.startMs, next.slipDays, next.horizonDeg, next.terrain)) {
    // Only reachable before the Moon table has loaded.
    planMessage('Still loading the Moon table. Try again in a moment.', true);
    return;
  }
  Object.assign(state, next);
  render({ transition, quiet });
}

/** Everything that depends on the plan (site, touchdown, slip) but not on the clock. */
function renderPlan(p, site) {
  const o = p.original, d = p.delayed;
  $('#answer').innerHTML = answerHtml(p, site, state.slipDays);
  $('#metrics-body').innerHTML = metricsHtml(p);
  const source =
    p.source === 'horizons' ? 'Direct JPL Horizons samples' : 'Computed from the bundled JPL Horizons table';
  $('#site-meta').innerHTML =
    `<span class="num">${site.coordLabel}</span> · ${site.region}<span class="site-src">${site.mission} · ${source}</span>`;
  $('#surf-site').textContent = `${site.name} · ${site.coordLabel}`;
  timelines.render([o, d]);
  renderSlips(p, site);
  renderSites(o, d);
  calendar.render({ eph, site, horizonDeg: state.horizonDeg, horizonProfile: terrainProfile(site, state.terrain), needHours: state.needHours, startMs: state.startMs }); // ── calendar ──
  for (const [id, a] of [['original', o], ['delayed', d]]) {
    const v = verdict(a.stretches.longestBoth, state.needHours);
    const chip = $(`#td-${id}-verdict`);
    chip.hidden = !v;
    chip.className = `td-verdict ${v ?? ''}`;
    chip.textContent = v === 'go' ? 'Go' : 'No go';
  }
  document.querySelectorAll('.model-tag').forEach((tag) => {
    tag.textContent = o.horizonProfile // ── terrain ──
      ? `LOLA terrain horizon${state.horizonDeg > 0 ? ` plus ${state.horizonDeg}°` : ''}`
      : state.horizonDeg > 0 ? `Terrain margin ${state.horizonDeg}°` : 'Smooth-horizon estimate';
  });

  $('#slip-words').textContent = slipWords(state.slipDays);
  $('#td-original-date').textContent = fmtDay(o.start, { year: true });
  $('#td-original-time').textContent = fmtClock(o.start);
  $('#td-delayed-date').textContent = fmtDay(d.start, { year: true });
  $('#td-delayed-time').textContent = fmtClock(d.start);
  $('#th-original').textContent = fmtDay(o.start);
  $('#th-delayed').textContent = fmtDay(d.start);
  document.querySelector('[data-scn-date="original"]').textContent = fmtDay(o.start);
  document.querySelector('[data-scn-date="delayed"]').textContent = fmtDay(d.start);

  if (startInput.value !== toInputValue(state.startMs)) startInput.value = toInputValue(state.startMs);
  datePicker.sync();
  if (Number(slipRange.value) !== state.slipDays) slipRange.value = String(state.slipDays);
  $('#slip-out').textContent = slipShort(state.slipDays);
  $('#plan-reset').hidden = state.startMs === PRESET_START_MS && state.slipDays === PRESET_SLIP_DAYS;
  siteMore.value = site.featured ? '' : state.site;
  customForm.hidden = state.site !== 'custom';
  if (state.site === 'custom') {
    $('#custom-lat').value = String(site.lat);
    $('#custom-lon').value = String(site.lonE);
  }
  if (eph) planMessage(READY_MSG);
}

function render({ transition, quiet } = {}) {
  const site = currentSite();
  const p = pair();
  const a = p[state.scenario];
  const t = selectedT();
  const sample = sampleAt(a.rows, t);
  document.body.dataset.scenario = state.scenario;
  document.body.dataset.site = state.site;

  const planKey = `${p.key}|${state.needHours}`;
  if (renderedKey !== planKey) {
    renderedKey = planKey;
    renderPlan(p, site);
    renderedStripKey = null;
  }
  const stripKey = `${p.key}/${state.scenario}`;
  if (renderedStripKey !== stripKey) {
    renderedStripKey = stripKey;
    strip.render(a);
  }
  const needKey = `${p.key}/${state.needHours}/${state.scenario}/${slipCells?.length ?? 0}`;
  if (renderedNeedKey !== needKey) {
    renderedNeedKey = needKey;
    $('#stretch-body').innerHTML = stretchHtml(p, state.needHours);
    renderBackup();
  }
  needPicker.querySelectorAll('[data-need]').forEach((b) => {
    const on = Number(b.dataset.need) === state.needHours;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });

  // Controls reflect state
  document.querySelectorAll('#site-picker [data-site]').forEach((b, i) => {
    const on = b.dataset.site === state.site;
    b.setAttribute('aria-checked', String(on));
    // Keep the group reachable by Tab when a non-featured site is active.
    b.tabIndex = on || (!site.featured && i === 0) ? 0 : -1;
  });
  marginPicker.querySelectorAll('[data-margin]').forEach((b) => {
    const on = Number(b.dataset.margin) === state.horizonDeg;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  // ── terrain ── custom points have no skyline, so LOLA terrain is disabled there with a note.
  if (terrainPicker) {
    const canTerrain = Boolean(profileFor(site.id)) && site.id !== 'custom';
    terrainPicker.querySelectorAll('[data-terrain]').forEach((b) => {
      const on = (b.dataset.terrain === '1') === (state.terrain && canTerrain);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (b.dataset.terrain === '1') b.disabled = !canTerrain;
    });
    $('#terrain-help').textContent = canTerrain
      ? 'LOLA terrain uses the real skyline around the site, from NASA elevation data. Any margin is added on top.'
      : TERRAIN_NOT_AVAILABLE;
  }
  document.querySelectorAll('#scn-switch [data-scenario]').forEach((b) => {
    const on = b.dataset.scenario === state.scenario;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('#td-original').setAttribute('aria-pressed', String(state.scenario === 'original'));
  $('#td-delayed').setAttribute('aria-pressed', String(state.scenario === 'delayed'));
  const applied = state.scenario === 'delayed';
  $('#apply-delay').classList.toggle('is-applied', applied);
  $('#apply-delay .apply-label').textContent = applied ? 'Back to original' : `Apply +${slipShort(state.slipDays)}`;

  const elapsedMs = state.elapsedMin * 60_000;
  if (Number(scrubber.value) !== Math.round(state.elapsedMin)) scrubber.value = String(Math.round(state.elapsedMin));
  scrubber.style.setProperty('--p', `${(state.elapsedMin / MAX_MIN) * 100}%`);
  scrubber.setAttribute('aria-valuetext', `${fmtElapsed(elapsedMs)}, ${fmtUtc(t, { year: true })}`);
  $('#clock-read').innerHTML = `<span class="cr-t">${fmtElapsed(elapsedMs)}</span><span class="cr-u">${fmtUtc(t, { year: true })}</span>`;

  timelines.update({ scenario: state.scenario, elapsedMs });
  strip.update(sample);
  $('#readout').innerHTML = readoutHtml(sample, a, t);
  $('#next-crossing').innerHTML = nextHtml(a, t);
  const hud = `${scenarioLabel(state.scenario, state.slipDays)} · ${fmtElapsed(elapsedMs)}`;
  $('#globe-scn').textContent = `${site.name} · ${hud}`;
  $('#globe-t').textContent = fmtUtc(t, { year: true });
  $('#surf-t').textContent = `${hud} · ${fmtUtc(t)}`;
  const sUp = aboveAt(a, 'sun', t), eUp = aboveAt(a, 'earth', t);
  const sunHidden = sUp && eclipseAt(a, t) === 'total';
  const darkNote = !sUp
    ? sample.sun.el > 0
      ? (a.horizonProfile ? 'Sun hidden by terrain' : 'Sun hidden by terrain margin') // ── terrain ──
      : 'Modeled darkness'
    : sunHidden
      ? 'Sun behind Earth'
      : '';
  $('#surf-state').innerHTML = `<span class="st ${sUp ? 'on' : ''}">${icon('sun')}Sun ${sUp ? 'up' : 'down'}</span><span class="st ${eUp ? 'on' : ''}">${icon('earth')}Earth ${eUp ? 'up' : 'down'}</span>${darkNote ? `<span class="st-dark">${darkNote}</span>` : ''}`;
  slipStrip.update({ slipDays: state.slipDays, scenario: state.scenario });

  if (globe && toMoonFixed) {
    globe.update({
      site,
      sunDir: toMoonFixed(site.lat, site.lonE, sample.sun.az, sample.sun.el),
      earthDir: toMoonFixed(site.lat, site.lonE, sample.earth.az, sample.earth.el),
      transition,
    });
  }
  heatmap.refresh(); // ── heatmap ──
  // The surface camera re-frames when the site, touchdown, slip or scenario changes,
  // and follows the Sun and Earth during playback until the user drags the view.
  if (surface) {
    surface.update({
      viewKey: `${site.id}|${site.lat}|${site.lonE}|${state.startMs}|${state.slipDays}|${state.scenario}`,
      sample,
    });
  }
  if (!quiet) {
    announce(a, t, sample);
    scheduleUrlSync();
  }
}

// Methods: sites list
$('#sites-list').innerHTML = Object.values(SITES)
  .map((s) => `<li><b>${s.name}</b> (${s.mission}) · <span class="num">${s.coordLabel}</span></li>`)
  .join('');

buildSitePicker();
buildScenarioSwitch();
buildScrubTicks();
const chrome = initChrome();
initSound(); // ── sound ──

// A shared address that points at a reference plan can open at once. Anything
// else waits for the Moon table.
const urlPatch = patchFromUrl();
const urlNeedsTable =
  urlPatch && !isPreset(siteIn({ ...state, ...urlPatch }), urlPatch.startMs ?? state.startMs, urlPatch.slipDays ?? state.slipDays);
if (urlPatch && !urlNeedsTable) Object.assign(state, urlPatch);
render({ quiet: true });

loadEphemeris()
  .then((table) => {
    eph = table;
    startInput.disabled = false;
    slipRange.disabled = false;
    siteMore.disabled = false;
    startInput.min = toInputValue(eph.startMs);
    startInput.max = toInputValue(eph.endMs - (WINDOW_HOURS * HOUR_MS + DAY_MS));
    datePicker.sync();
    planMessage(READY_MSG);
    // Pairs built before the table arrived have no eclipse check. Rebuild them and draw the slip strip.
    pairCache.clear();
    renderedKey = null;
    render({ quiet: true });
    const eclipse = eclipseStay()?.eclipse.total[0];
    if (eclipse) {
      $('#rp-eclipse-model').textContent = eclipseSpan(eclipse);
      $('#eclipse-btn').disabled = false;
    }
    if (urlNeedsTable) {
      const next = { ...state, ...urlPatch };
      if (planProblem(next.startMs, next.slipDays)) planMessage('That link is outside 2024 through 2030. Showing the reference plan.', true);
      else setState(urlPatch);
    }
  })
  .catch((err) => {
    console.error('Moon table unavailable', err);
    planMessage('Other sites and dates could not load. The four reference scenarios still work.', true);
    slipStrip.message('The slip strip needs the Moon table, which did not load.');
    $('#backup-read').textContent = 'The backup finder needs the Moon table, which did not load.';
  });

// Re-render the strip on resize (it's an SVG sized to its container).
let rz;
new ResizeObserver(() => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    strip.render(active());
    strip.update(sampleAt(active().rows, selectedT()));
  }, 120);
}).observe($('#strip'));

// ───────────── Look of the 3D views: 'real' (photographic) or 'studio' (soft, in the site's style) ─────────────
const LOOK_KEY = 'long-shadow-look';
const LOOK_NAMES = { real: 'Real', studio: 'Studio' };
let look = 'real';
try {
  look = localStorage.getItem(LOOK_KEY) || 'real';
} catch {
  // Storage refused. The default look stands.
}
const urlLook = new URLSearchParams(window.location.search).get('look');
if (urlLook && LOOK_NAMES[urlLook]) look = urlLook;
if (!LOOK_NAMES[look]) look = 'real';
const lookSwitches = [...document.querySelectorAll('[data-look-switch]')];
for (const el of lookSwitches) {
  el.innerHTML = Object.entries(LOOK_NAMES)
    .map(([id, name]) => `<button type="button" role="radio" data-look="${id}" aria-checked="false"><span class="sp-name">${name}</span></button>`)
    .join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-look]');
    if (b) setLook(b.dataset.look, true);
  });
  radioKeys(el, '[data-look]', (b) => setLook(b.dataset.look, true));
}
function setLook(next, save = false) {
  if (!LOOK_NAMES[next]) return;
  look = next;
  for (const b of document.querySelectorAll('[data-look]')) {
    const on = b.dataset.look === look;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  globe?.setLook?.(look);
  surface?.setLook?.(look);
  if (save) {
    try {
      localStorage.setItem(LOOK_KEY, look);
    } catch {
      // Storage refused. The look still changes for this visit.
    }
  }
}
setLook(look);

// ───────────── 3D (lazy, optional) ─────────────
function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
if (webglOk()) {
  Promise.all([import('./three/globe.js'), import('./three/surface.js'), import('./three/geo.js')])
    .then(([g, s, geo]) => {
      toMoonFixed = geo.azElToMoonFixed;
      globe = g.createGlobe($('#globe'), FEATURED);
      chrome.setGlobe(globe);
      surface = s.createSurface($('#surface'));
      document.body.classList.add('has-3d');
      setLook(look);
      render({ quiet: true });
    })
    .catch((err) => {
      console.error('3D views unavailable', err);
      document.body.classList.add('no-3d');
    });
} else {
  document.body.classList.add('no-3d');
}

// Expose for QA in the console.
window.__longShadow = { state, A, pair, setState, HOUR_MS };
