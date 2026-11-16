// Every date at one site: the same 72 hour analysis for a touchdown at 00:00 UTC on every day
// the Moon table covers, drawn as a calendar. A cell holds the longest unbroken stretch with the
// Sun and Earth both up. The numbers come from analyzeStay and the go marks from meetsNeed, so a
// cell cannot disagree with the plan above it.
// Written with an AI tool.
import './calendar.css';
import { HOUR_MS } from './calc.js';
import { WINDOW_HOURS } from './window.js';
import { analyzeStay, slipCell, meetsNeed } from './slips.js';

export const DAY_MS = 24 * HOUR_MS;
const STAY_MS = WINDOW_HOURS * HOUR_MS;
const SLICE_MS = 12;
const MAX_CACHED = 8;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Midnight UTC of the day that holds ms. */
export const dayStart = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * Every touchdown day (00:00 UTC) whose full 72 hour stay fits inside the Moon table.
 * @param {{startMs:number, endMs:number}} eph
 * @returns {number[]} UTC milliseconds, one per day, in order
 */
export function calendarDays(eph) {
  const first = Math.ceil(eph.startMs / DAY_MS) * DAY_MS;
  const days = [];
  for (let t = first; t + STAY_MS <= eph.endMs; t += DAY_MS) days.push(t);
  return days;
}

/** The numbers one calendar cell holds, from a full analysis of the stay that starts at dayMs. */
export function calendarCell(eph, site, dayMs, horizonDeg = 0, horizonProfile = null) {
  return slipCell(0, analyzeStay(eph, site, dayMs, horizonProfile ? { horizonDeg, horizonProfile } : { horizonDeg }));
}

/** Every cell for a site and margin, computed in one go. For tests and Node. */
export function calendarCells(eph, site, horizonDeg = 0, horizonProfile = null) {
  return calendarDays(eph).map((d) => calendarCell(eph, site, d, horizonDeg, horizonProfile));
}

/** How many days meet the need, and the first one later than afterMs. */
export function calendarSummary(cells, needHours, afterMs) {
  let count = 0;
  let next = null;
  for (const c of cells) {
    if (!meetsNeed(c, needHours)) continue;
    count += 1;
    if (!next && c.startMs > afterMs) next = c;
  }
  return { count, total: cells.length, next };
}

const cacheKey = (site, horizonDeg, profile) => `${site.id}|${site.lat}|${site.lonE}|${horizonDeg}|${profile ? 'lola' : 'smooth'}`;
const dateWords = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const hoursText = (h) => (Math.round(h * 10) / 10).toString();
const later = (fn) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 200 }) : setTimeout(fn, 0);

/**
 * The calendar section. Call render() whenever the plan changes. Work runs in short slices so the
 * page stays responsive, and finished sites are cached per site and margin.
 * @param {HTMLElement} root the container inside the section
 * @param {{onPick: (dayMs: number) => void}} opts
 */
export function createCalendar(root, { onPick }) {
  const cache = new Map();
  let job = null;
  let view = null; // { eph, site, horizonDeg, needHours, startMs }
  let year = null;
  let lastStartMs = null;
  let lastMs = null;

  root.innerHTML = `
    <div class="cal-top">
      <div class="cal-years" role="radiogroup" aria-label="Year"></div>
      <div class="cal-legend" aria-hidden="true">
        <span class="cal-scale"><span>0 h</span><i></i><span>72 h</span></span>
        <span class="cal-key"><i class="cal-key-go"></i><span class="cal-need-label">Meets need</span></span>
        <span class="cal-key"><i class="cal-key-now"></i>Current touchdown</span>
      </div>
    </div>
    <p class="cal-sum" aria-live="polite">Loading the Moon table.</p>
    <div class="cal-grid-wrap">
      <table class="cal-grid" role="grid" aria-label="Longest stretch with Sun and Earth both up, by touchdown day">
        <thead><tr><th scope="col"><span class="sr">Month</span></th>${Array.from(
          { length: 31 },
          (_, i) => `<th scope="col" class="cal-dnum">${(i + 1) % 5 === 0 || i === 0 ? i + 1 : `<span class="sr">${i + 1}</span>`}</th>`,
        ).join('')}</tr></thead>
        <tbody></tbody>
      </table>
      <div class="cal-tip" role="status" hidden></div>
    </div>
    <p class="cal-read">Pick a day to make it the original touchdown at 00:00 UTC.</p>`;
  const yearsEl = root.querySelector('.cal-years');
  const sumEl = root.querySelector('.cal-sum');
  const body = root.querySelector('tbody');
  const tip = root.querySelector('.cal-tip');
  const wrap = root.querySelector('.cal-grid-wrap');

  function compute(eph, site, horizonDeg, horizonProfile) {
    const key = cacheKey(site, horizonDeg, horizonProfile);
    if (cache.has(key)) return;
    if (job && job.key === key) return;
    if (job) job.cancelled = true;
    const days = calendarDays(eph);
    const cells = [];
    const t0 = performance.now();
    const me = { key, cancelled: false };
    job = me;
    root.dataset.computing = key;
    const step = (deadline) => {
      if (me.cancelled) return;
      const until = performance.now() + (deadline?.timeRemaining ? Math.max(4, Math.min(SLICE_MS, deadline.timeRemaining())) : SLICE_MS);
      while (cells.length < days.length && performance.now() < until) {
        cells.push(calendarCell(eph, site, days[cells.length], horizonDeg, horizonProfile));
      }
      if (cells.length < days.length) {
        sumEl.textContent = `Working through ${days.length.toLocaleString('en-US')} touchdown days, ${Math.floor((cells.length / days.length) * 100)} percent done.`;
        later(step);
        return;
      }
      lastMs = performance.now() - t0;
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
      cache.set(key, cells);
      job = null;
      root.dataset.computeMs = String(Math.round(lastMs));
      draw();
    };
    later(step);
  }

  function yearsOf(cells) {
    const ys = [];
    for (const c of cells) {
      const y = new Date(c.startMs).getUTCFullYear();
      if (ys.at(-1) !== y) ys.push(y);
    }
    return ys;
  }

  function drawYears(cells, needHours) {
    const counts = new Map();
    for (const c of cells) {
      const y = new Date(c.startMs).getUTCFullYear();
      counts.set(y, (counts.get(y) ?? 0) + (meetsNeed(c, needHours) ? 1 : 0));
    }
    yearsEl.innerHTML = yearsOf(cells)
      .map(
        (y) =>
          `<button type="button" role="radio" data-year="${y}" aria-checked="${y === year}" tabindex="${y === year ? 0 : -1}"><span class="num">${y}</span><span class="cal-yc"><span class="num">${counts.get(y)}</span> go</span></button>`,
      )
      .join('');
  }

  function cellHtml(c, needHours, nowDay) {
    const d = new Date(c.startMs);
    const go = needHours > 0 && meetsNeed(c, needHours);
    const isNow = c.startMs === nowDay;
    const label = `${dateWords(c.startMs)}, ${hoursText(c.longestBothHours)} hours with both up without a break, ${go ? 'go' : 'no go'}${isNow ? ', current touchdown' : ''}`;
    return `<td role="gridcell"><button type="button" class="cal-c${go ? ' go' : ''}${isNow ? ' now' : ''}" data-day="${c.startMs}" data-d="${d.getUTCDate()}" tabindex="-1" style="--v:${(c.longestBothHours / WINDOW_HOURS).toFixed(3)}" aria-label="${label}"></button></td>`;
  }

  function drawGrid(cells, needHours, nowDay) {
    const byDay = new Map();
    for (const c of cells) if (new Date(c.startMs).getUTCFullYear() === year) byDay.set(c.startMs, c);
    let html = '';
    for (let m = 0; m < 12; m += 1) {
      const dim = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      html += `<tr><th scope="row" class="cal-mon">${MONTHS[m]}</th>`;
      for (let day = 1; day <= 31; day += 1) {
        const ms = Date.UTC(year, m, day);
        const c = day <= dim ? byDay.get(ms) : null;
        html += c ? cellHtml(c, needHours, nowDay) : `<td role="gridcell" class="${day > dim ? 'cal-none' : 'cal-out'}"></td>`;
      }
      html += '</tr>';
    }
    body.innerHTML = html;
    tip.hidden = true;
    const all = body.querySelectorAll('.cal-c');
    const start = body.querySelector('.cal-c.now') ?? all[0];
    if (start) start.tabIndex = 0;
  }

  function draw() {
    if (!view) return;
    const { eph, site, horizonDeg, needHours, startMs, horizonProfile = null } = view;
    const cells = cache.get(cacheKey(site, horizonDeg, horizonProfile));
    root.querySelector('.cal-need-label').textContent = `Meets need of ${needHours} h`;
    if (!cells) {
      compute(eph, site, horizonDeg, horizonProfile);
      return;
    }
    // A site or margin the page has already left. Stop it so its progress does not show here.
    if (job) {
      job.cancelled = true;
      job = null;
    }
    const nowDay = dayStart(startMs);
    const ys = yearsOf(cells);
    if (year === null || lastStartMs !== startMs || !ys.includes(year)) {
      const y = new Date(startMs).getUTCFullYear();
      year = ys.includes(y) ? y : ys[0];
    }
    lastStartMs = startMs;
    const s = calendarSummary(cells, needHours, startMs);
    const name = site.id === 'custom' ? 'this custom site' : site.name;
    const first = new Date(cells[0].startMs).getUTCFullYear();
    const lastY = new Date(cells.at(-1).startMs).getUTCFullYear();
    sumEl.innerHTML = `<b class="num">${s.count.toLocaleString('en-US')}</b> of <span class="num">${s.total.toLocaleString('en-US')}</span> days from ${first} to ${lastY} meet a need of ${needHours} h at ${name}${horizonProfile ? ' with the LOLA terrain horizon' : ''}${horizonDeg > 0 ? ` with a ${horizonDeg}° margin` : ''}. ${
      s.next ? `Next one after the current touchdown: <button type="button" class="cal-next" data-day="${s.next.startMs}">${dateWords(s.next.startMs)}</button>.` : 'None after the current touchdown.'
    }`;
    drawYears(cells, needHours);
    drawGrid(cells, needHours, nowDay);
  }

  function showTip(btn) {
    const c = btn.getAttribute('aria-label');
    if (!c) return;
    const [date, hours, go, now] = c.split(', ');
    tip.innerHTML = `<b>${date}</b><span class="num">${hours.replace(' hours with both up without a break', ' h both up')}</span><span class="verdict ${go === 'go' ? 'go' : 'nogo'}">${go === 'go' ? 'Go' : 'No go'}</span>${now ? '<span class="cal-tip-now">Current</span>' : ''}`;
    tip.hidden = false;
    const w = wrap.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const left = Math.min(Math.max(b.left - w.left + b.width / 2 - tw / 2, 0), w.width - tw);
    tip.style.left = `${left}px`;
    tip.style.top = `${b.top - w.top - tip.offsetHeight - 6}px`;
  }
  const hideTip = () => {
    tip.hidden = true;
  };

  body.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.cal-c');
    if (b) showTip(b);
  });
  body.addEventListener('pointerleave', hideTip);
  body.addEventListener('focusin', (e) => {
    const b = e.target.closest('.cal-c');
    if (b) showTip(b);
  });
  body.addEventListener('focusout', hideTip);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (b) {
      hideTip();
      onPick(Number(b.dataset.day));
      return;
    }
    const y = e.target.closest('[data-year]');
    if (y) {
      year = Number(y.dataset.year);
      draw();
      root.querySelector(`[data-year="${year}"]`)?.focus();
    }
  });
  yearsEl.addEventListener('keydown', (e) => {
    const btns = [...yearsEl.querySelectorAll('[data-year]')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    year = Number(btns[(i + d + btns.length) % btns.length].dataset.year);
    draw();
    yearsEl.querySelector(`[data-year="${year}"]`)?.focus();
  });
  // Arrow keys move day by day and month by month. Enter or Space picks the day.
  body.addEventListener('keydown', (e) => {
    const b = e.target.closest('.cal-c');
    if (!b) return;
    const all = [...body.querySelectorAll('.cal-c')];
    const i = all.indexOf(b);
    let target = null;
    if (e.key === 'ArrowRight') target = all[i + 1];
    else if (e.key === 'ArrowLeft') target = all[i - 1];
    else if (e.key === 'Home') target = all[0];
    else if (e.key === 'End') target = all.at(-1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const row = b.closest('tr');
      const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      const cands = next ? [...next.querySelectorAll('.cal-c')] : [];
      const day = Number(b.dataset.d);
      target = cands.filter((c) => Number(c.dataset.d) <= day).at(-1) ?? cands[0];
    } else return;
    e.preventDefault();
    if (!target) return;
    b.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  });

  return {
    /** @param {{eph: object|null, site: object, horizonDeg: number, needHours: number, startMs: number}} next */
    render(next) {
      if (!next.eph) {
        sumEl.textContent = 'Loading the Moon table.';
        return;
      }
      view = next;
      draw();
    },
    /** Milliseconds the last full compute took, or null. */
    lastComputeMs: () => lastMs,
  };
}
