// Availability timelines: two scenarios × (Sun, Earth, Both) bars on a shared
// 0–72 h axis with a shared elapsed-time cursor. Plain HTML so it reflows
// cleanly down to phone widths and stays readable without colour.
import { HOUR_MS } from './calc.js';
import { fmtHours, fmtUtc, fmtUtcTime, fmtElapsed, EVENT_NAME } from './format.js';
import { SCENARIOS } from './data.js';
import { icon } from './icons.js';

const WINDOW_H = 72;
const pct = (t, start) => ((t - start) / HOUR_MS / WINDOW_H) * 100;

const ROWS = [
  { key: 'sun', label: 'Sun', cls: 'sun' },
  { key: 'earth', label: 'Earth', cls: 'earth' },
  { key: 'both', label: 'Both', cls: 'both' },
];

export function createTimelines(root, { onSelect }) {
  let current = null;

  function rowIntervals(a, key) {
    return key === 'both' ? a.both.intervals : a.bodies[key].intervals;
  }
  function rowHours(a, key) {
    return key === 'both' ? a.both.hours : a.bodies[key].hours;
  }

  function trackHtml(a, key) {
    const iv = rowIntervals(a, key);
    const hours = rowHours(a, key);
    let html = '';
    for (const [s, e] of iv) {
      const l = pct(s, a.start);
      const w = pct(e, a.start) - l;
      html += `<span class="seg-bar ${key}" style="left:${l}%;width:${w}%"></span>`;
    }
    if (hours === 0) html += `<span class="tl-whole below">Below for all 72 h</span>`;
    else if (Math.abs(hours - 72) < 1e-9) html += `<span class="tl-whole above">Above for all 72 h</span>`;

    if (key !== 'both') {
      for (const ev of a.bodies[key].events) {
        const x = pct(ev.t, a.start);
        const side = x > 60 ? 'left' : 'right';
        const name = EVENT_NAME[ev.body][ev.type];
        html += `<span class="tl-ev ${ev.type} ${side}" style="left:${x}%">
          <span class="tl-ev-tick" aria-hidden="true"></span>
          <span class="tl-ev-label"><b>${name}</b> <span class="num">${fmtElapsed(ev.t - a.start)}</span><span class="tl-ev-utc num"> · ${fmtUtcTime(ev.t)} UTC</span></span>
        </span>`;
      }
    }
    return html;
  }

  function panelHtml(a) {
    const sc = SCENARIOS[a.scenario];
    const rows = ROWS.map(
      (r) => `<div class="tl-row ${r.cls}">
        <span class="tl-label">${icon(r.key)}<span>${r.label}</span></span>
        <span class="tl-track" data-scenario="${a.scenario}">${trackHtml(a, r.key)}<span class="tl-tcur" aria-hidden="true"></span></span>
        <span class="tl-total num"><b>${fmtHours(rowHours(a, r.key))}</b> h</span>
      </div>`,
    ).join('');
    const evText = a.events.length
      ? a.events.map((e) => `${EVENT_NAME[e.body][e.type]} ~${fmtUtc(e.t)}`).join(' · ')
      : 'No horizon crossings';
    return `<div class="tl-panel" data-scenario="${a.scenario}">
      <button type="button" class="tl-head" data-scenario="${a.scenario}">
        <span class="tl-scn">${a.scenario === 'original' ? 'Original' : 'Delayed +9 days'}</span>
        <span class="tl-date num">Touchdown ${fmtUtc(a.start, { year: true })}</span>
        <span class="tl-head-ev num">${evText}</span>
        <span class="tl-active" aria-hidden="true"></span>
      </button>
      <div class="tl-rows">${rows}</div>
    </div>`;
  }

  function axisHtml() {
    let ticks = '';
    for (let h = 0; h <= WINDOW_H; h += 6) {
      const major = h % 12 === 0;
      ticks += `<span class="tl-tick ${major ? 'major' : ''} ${h % 24 === 0 ? 'day' : ''}" style="left:${(h / WINDOW_H) * 100}%">${
        major ? `<span>${h}${h === 72 ? ' h' : ''}</span>` : ''
      }</span>`;
    }
    return `<div class="tl-axis" aria-hidden="true"><span></span><span class="tl-axis-track">${ticks}<span class="tl-cursor"><span class="tl-cursor-tag num"></span></span></span><span></span></div>`;
  }

  function srTable(analyses) {
    const lines = analyses
      .map((a) => {
        const evs = a.events.length
          ? a.events.map((e) => `${EVENT_NAME[e.body][e.type]} at ${fmtUtc(e.t, { year: true })} (${fmtElapsed(e.t - a.start)})`).join('; ')
          : 'No horizon crossings';
        return `<tr><th scope="row">${SCENARIOS[a.scenario].label}, touchdown ${fmtUtc(a.start, { year: true })}</th>
          <td>${fmtHours(a.bodies.sun.hours)} h</td><td>${fmtHours(a.bodies.earth.hours)} h</td><td>${fmtHours(a.both.hours)} h</td><td>${evs}</td></tr>`;
      })
      .join('');
    return `<div class="sr"><table><caption>Above-horizon hours and crossings in the first 72 hours</caption>
      <thead><tr><th>Scenario</th><th>Sun above</th><th>Earth above</th><th>Both above</th><th>Crossings (UTC)</th></tr></thead>
      <tbody>${lines}</tbody></table></div>`;
  }

  function render(analyses) {
    current = analyses;
    root.innerHTML = `
      <div class="tl-grid">
        ${axisHtml()}
        ${analyses.map(panelHtml).join('')}
      </div>
      ${srTable(analyses)}`;

    root.querySelectorAll('.tl-head').forEach((b) =>
      b.addEventListener('click', () => onSelect({ scenario: b.dataset.scenario })),
    );
    // Click / drag on a track to pick scenario and time.
    root.querySelectorAll('.tl-track').forEach((track) => {
      const pick = (ev) => {
        const r = track.getBoundingClientRect();
        const f = Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1);
        onSelect({ scenario: track.dataset.scenario, elapsedMin: Math.round(f * WINDOW_H * 60) });
      };
      track.addEventListener('pointerdown', (ev) => {
        track.setPointerCapture(ev.pointerId);
        pick(ev);
        const move = (e) => pick(e);
        const up = () => {
          track.removeEventListener('pointermove', move);
          track.removeEventListener('pointerup', up);
          track.removeEventListener('pointercancel', up);
        };
        track.addEventListener('pointermove', move);
        track.addEventListener('pointerup', up);
        track.addEventListener('pointercancel', up);
      });
    });
  }

  function update({ scenario, elapsedMs }) {
    if (!current) return;
    root.querySelectorAll('.tl-panel').forEach((p) => p.classList.toggle('is-active', p.dataset.scenario === scenario));
    root.querySelectorAll('.tl-head').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario)));
    const cursor = root.querySelector('.tl-cursor');
    const x = (elapsedMs / HOUR_MS / WINDOW_H) * 100;
    cursor.style.left = `${x}%`;
    root.querySelectorAll('.tl-tcur').forEach((c) => (c.style.left = `${x}%`));
    cursor.classList.toggle('flip', x > 85);
    const a = current.find((c) => c.scenario === scenario);
    cursor.querySelector('.tl-cursor-tag').textContent = `${fmtElapsed(elapsedMs)} · ${fmtUtcTime(a.start + elapsedMs)} UTC`;
  }

  return { render, update };
}
