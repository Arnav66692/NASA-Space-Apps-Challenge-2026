import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

import { DATASETS, SITES, SCENARIOS } from './data.js';
import { analyze, delayImpact, sampleAt, nextCrossing, aboveAt, HOUR_MS } from './calc.js';
import { fmtHours, fmtUtc, fmtDuration, fmtElapsed, fmtDeg, fmtChange, compass, EVENT_NAME } from './format.js';
import { createTimelines } from './timeline.js';
import { createSkyStrip } from './skystrip.js';
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);
const MAX_MIN = 72 * 60;

// ───────────── Pre-compute all four presets ─────────────
const A = {};
for (const site of Object.keys(DATASETS)) {
  A[site] = {};
  for (const sc of Object.keys(DATASETS[site])) A[site][sc] = analyze(DATASETS[site][sc]);
}

const state = { site: 'athena', scenario: 'original', elapsedMin: 0 };
const active = () => A[state.site][state.scenario];
const selectedT = () => active().start + state.elapsedMin * 60_000;

// ───────────── Answer + metrics ─────────────
function answerHtml(siteId) {
  const o = A[siteId].original;
  const d = A[siteId].delayed;
  const ch = delayImpact(o, d);
  const name = SITES[siteId].name;
  const parts = [];
  if (d.bodies.sun.hours === 0 && o.bodies.sun.hours > 0) {
    parts.push(`<span class="hl-sun">the Sun never rises</span> (${fmtHours(o.bodies.sun.hours)} → 0 h)`);
  } else if (fmtHours(ch.sun) !== '0') parts.push(`<span class="hl-sun">${fmtChange(ch.sun)} of Sun</span>`);
  if (fmtHours(ch.earth) !== '0') parts.push(`<span class="hl-earth">${fmtChange(ch.earth)} of Earth visibility</span>`);
  else parts.push(`<span class="hl-earth">Earth stays up all 72 h</span>`);

  let explain;
  if (d.bodies.sun.hours === 0 && d.bodies.earth.hours > 0) {
    explain =
      d.bodies.earth.whole === 'above'
        ? `After the delay, Earth is above the horizon for all 72 hours, all during modeled darkness.`
        : `After the delay, Earth is above the horizon for ${fmtHours(d.bodies.earth.hours)} hours, all during modeled darkness.`;
  } else {
    explain = `After the delay, Earth is above the horizon for ${fmtHours(d.bodies.earth.hours)} hours.`;
  }
  const earlier = `The original touchdown offers ${fmtHours(o.both.hours)} hours with both above the horizon.`;
  return `<strong>At ${name}, a nine-day slip means ${parts.join(' and ')}.</strong> ${explain} ${earlier}`;
}

function metricsHtml(siteId) {
  const o = A[siteId].original;
  const d = A[siteId].delayed;
  const ch = delayImpact(o, d);
  const rows = [
    { k: 'sun', label: 'Sun above horizon', note: 'solar power', o: o.bodies.sun.hours, d: d.bodies.sun.hours, c: ch.sun },
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
          <span class="m-mini" aria-hidden="true"><i style="width:${(r.o / 72) * 100}%"></i></span></td>
        <td class="num"><span class="m-val">${fmtHours(r.d)}</span><span class="m-u">h</span>
          <span class="m-mini" aria-hidden="true"><i style="width:${(r.d / 72) * 100}%"></i></span></td>
        <td class="num m-change ${cls}"><span>${changeText}</span><span class="sr">, ${fmtChange(r.c)}</span></td>
      </tr>`;
    })
    .join('');
}

// ───────────── Site picker, scenario switches ─────────────
function buildSitePicker() {
  const el = $('#site-picker');
  el.innerHTML = Object.values(SITES)
    .map(
      (s) => `<button type="button" role="radio" data-site="${s.id}" aria-checked="false">
        <span class="sp-name">${s.name}</span><span class="sp-sub">${s.id === 'athena' ? 'South pole' : 'Mare Crisium'}</span>
      </button>`,
    )
    .join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-site]');
    if (b) setState({ site: b.dataset.site });
  });
  radioKeys(el, '[data-site]', (b) => setState({ site: b.dataset.site }));
}

function buildScenarioSwitch() {
  const el = $('#scn-switch');
  el.innerHTML = Object.values(SCENARIOS)
    .map(
      (s) => `<button type="button" role="radio" data-scenario="${s.id}" aria-checked="false">
        <span>${s.id === 'original' ? 'Original' : 'Delayed'}</span><span class="num">${s.id === 'original' ? 'Mar 15' : 'Mar 24'}</span>
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

// ───────────── Blue Ghost replay ─────────────
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
  setState({ site: 'blueGhost', scenario: 'original' });
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
  setState({ site: 'blueGhost', scenario: 'original', elapsedMin: sunsetMin() });
});
const stepBy = (d) => {
  stopAnim();
  if (state.site !== 'blueGhost' || state.scenario !== 'original') setState({ site: 'blueGhost', scenario: 'original', elapsedMin: sunsetMin() });
  setState({ elapsedMin: Math.min(Math.max(state.elapsedMin + d, 0), MAX_MIN) });
};
$('#step-back').addEventListener('click', () => stepBy(-60));
$('#step-fwd').addEventListener('click', () => stepBy(60));

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

function readoutHtml(sample, a, t) {
  return ['sun', 'earth']
    .map((b) => {
      const s = sample[b];
      const up = aboveAt(a, b, t);
      return `<div class="ro ro-${b} ${up ? 'up' : 'down'}">
        <dt>${icon(b)}${b === 'sun' ? 'Sun' : 'Earth'}</dt>
        <dd class="ro-status">${up ? '▲ Above horizon' : '▼ Below horizon'}</dd>
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
      `${SITES[state.site].name}, ${SCENARIOS[state.scenario].label}, ${fmtElapsed(t - a.start)}, ${fmtUtc(t, { year: true })}. ` +
      `Sun ${fmtDeg(sample.sun.el)}, Earth ${fmtDeg(sample.earth.el)}. ` +
      (n ? `${EVENT_NAME[n.body][n.type]} in ${fmtDuration(n.t - t)}.` : 'No further crossing in this window.');
  }, 600);
}

// ───────────── Central state update ─────────────
let renderedSite = null;
let renderedStripKey = null;
function setState(patch) {
  const { transition, quiet, ...rest } = patch;
  Object.assign(state, rest);
  state.elapsedMin = Math.min(Math.max(state.elapsedMin, 0), MAX_MIN);
  render({ transition, quiet });
}

function render({ transition, quiet } = {}) {
  const site = SITES[state.site];
  const a = active();
  const t = selectedT();
  const sample = sampleAt(a.rows, t);
  document.body.dataset.scenario = state.scenario;
  document.body.dataset.site = state.site;

  if (renderedSite !== state.site) {
    renderedSite = state.site;
    $('#answer').innerHTML = answerHtml(state.site);
    $('#metrics-body').innerHTML = metricsHtml(state.site);
    $('#site-meta').innerHTML = `<span class="num">${site.coordLabel}</span> · ${site.region}`;
    $('#surf-site').textContent = `${site.name} · ${site.coordLabel}`;
    timelines.render([A[state.site].original, A[state.site].delayed]);
    renderedStripKey = null;
  }
  const stripKey = `${state.site}/${state.scenario}`;
  if (renderedStripKey !== stripKey) {
    renderedStripKey = stripKey;
    strip.render(a);
  }

  // Controls reflect state
  document.querySelectorAll('#site-picker [data-site]').forEach((b) => {
    const on = b.dataset.site === state.site;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('#scn-switch [data-scenario]').forEach((b) => {
    const on = b.dataset.scenario === state.scenario;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('#td-original').setAttribute('aria-pressed', String(state.scenario === 'original'));
  $('#td-delayed').setAttribute('aria-pressed', String(state.scenario === 'delayed'));
  const applied = state.scenario === 'delayed';
  $('#apply-delay').classList.toggle('is-applied', applied);
  $('#apply-delay .apply-label').textContent = applied ? 'Back to original' : 'Apply +9 days';

  const elapsedMs = state.elapsedMin * 60_000;
  if (Number(scrubber.value) !== Math.round(state.elapsedMin)) scrubber.value = String(Math.round(state.elapsedMin));
  scrubber.style.setProperty('--p', `${(state.elapsedMin / MAX_MIN) * 100}%`);
  scrubber.setAttribute('aria-valuetext', `${fmtElapsed(elapsedMs)}, ${fmtUtc(t, { year: true })}`);
  $('#clock-read').innerHTML = `<span class="cr-t">${fmtElapsed(elapsedMs)}</span><span class="cr-u">${fmtUtc(t, { year: true })}</span>`;

  timelines.update({ scenario: state.scenario, elapsedMs });
  strip.update(sample);
  $('#readout').innerHTML = readoutHtml(sample, a, t);
  $('#next-crossing').innerHTML = nextHtml(a, t);
  const hud = `${SCENARIOS[state.scenario].label} · ${fmtElapsed(elapsedMs)}`;
  $('#globe-scn').textContent = `${site.name} · ${hud}`;
  $('#globe-t').textContent = fmtUtc(t, { year: true });
  $('#surf-t').textContent = `${hud} · ${fmtUtc(t)}`;
  const sUp = aboveAt(a, 'sun', t), eUp = aboveAt(a, 'earth', t);
  $('#surf-state').innerHTML = `<span class="st ${sUp ? 'on' : ''}">${icon('sun')}Sun ${sUp ? 'up' : 'down'}</span><span class="st ${eUp ? 'on' : ''}">${icon('earth')}Earth ${eUp ? 'up' : 'down'}</span>${!sUp ? '<span class="st-dark">Modeled darkness</span>' : ''}`;

  if (globe && toMoonFixed) {
    globe.update({
      siteId: state.site,
      sunDir: toMoonFixed(site.lat, site.lonE, sample.sun.az, sample.sun.el),
      earthDir: toMoonFixed(site.lat, site.lonE, sample.earth.az, sample.earth.el),
      transition,
    });
  }
  if (surface) surface.update({ siteId: state.site, sample });
  if (!quiet) announce(a, t, sample);
}

// Methods: sites list
$('#sites-list').innerHTML = Object.values(SITES)
  .map((s) => `<li><b>${s.name}</b> (${s.mission}) · <span class="num">${s.coordLabel}</span></li>`)
  .join('');

buildSitePicker();
buildScenarioSwitch();
buildScrubTicks();
render();

// Re-render the strip on resize (it's an SVG sized to its container).
let rz;
new ResizeObserver(() => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    strip.render(active());
    strip.update(sampleAt(active().rows, selectedT()));
  }, 120);
}).observe($('#strip'));

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
      globe = g.createGlobe($('#globe'), SITES);
      surface = s.createSurface($('#surface'));
      document.body.classList.add('has-3d');
      render();
    })
    .catch((err) => {
      console.error('3D views unavailable', err);
      document.body.classList.add('no-3d');
    });
} else {
  document.body.classList.add('no-3d');
}

// Expose for QA in the console.
window.__longShadow = { state, A, setState, HOUR_MS };
