// Touchdown picker: a month calendar and a 24-hour UTC hour grid, styled like the rest of the site.
// It replaces the browser's own date-time pop-up, which cannot be styled. The original
// <input type="datetime-local"> stays in the page, hidden, as the single source of truth: the picker
// writes its value and fires "change", so the plan logic in main.js is unchanged.
// Written with an AI tool.

const DAY_MS = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pad = (n) => String(n).padStart(2, '0');

/** "2025-03-15T00:00" (UTC) to milliseconds, or NaN. */
const parse = (v) => (v ? Date.parse(`${v}:00Z`) : NaN);
const toValue = (ms) => new Date(ms).toISOString().slice(0, 16);
const dayStart = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;
const label = (ms) => {
  const d = new Date(ms);
  return `${SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:00 UTC`;
};
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CAL =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';

/**
 * @param {HTMLInputElement} input the hidden datetime-local field (UTC, hourly steps)
 * @param {HTMLElement} host where the trigger and the pop-up go
 * @param {{slipDays: () => number}} opts the slip in the plan, to mark where the delayed touchdown lands
 */
export function createDatePicker(input, host, { slipDays }) {
  const labelledBy = host.dataset.labelledby;
  host.innerHTML = `
    <button type="button" class="dp-trigger" aria-haspopup="dialog" aria-expanded="false" ${labelledBy ? `aria-describedby="${labelledBy}"` : ''}>
      <span class="dp-trigger-v num"></span>${CAL}
    </button>
    <div class="dp-pop" role="dialog" aria-modal="false" aria-label="Choose the original touchdown, in UTC" hidden>
      <div class="dp-head">
        <p class="dp-month" aria-live="polite"></p>
        <div class="dp-nav">
          <button type="button" class="dp-arrow" data-step="-1" aria-label="Previous month">${ARROW}</button>
          <button type="button" class="dp-arrow dp-next" data-step="1" aria-label="Next month">${ARROW}</button>
        </div>
      </div>
      <div class="dp-years" role="group" aria-label="Year"></div>
      <div class="dp-week" aria-hidden="true">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="dp-days" role="grid" aria-label="Days"></div>
      <p class="dp-k">Hour, UTC</p>
      <div class="dp-hours" role="group" aria-label="Hour, UTC"></div>
      <div class="dp-foot">
        <p class="dp-note"><i class="dp-dot" aria-hidden="true"></i><span class="dp-note-t"></span></p>
        <div class="dp-actions">
          <button type="button" class="dp-cancel">Cancel</button>
          <button type="button" class="dp-set">Set touchdown</button>
        </div>
      </div>
    </div>`;

  const trigger = host.querySelector('.dp-trigger');
  const pop = host.querySelector('.dp-pop');
  const monthEl = host.querySelector('.dp-month');
  const yearsEl = host.querySelector('.dp-years');
  const daysEl = host.querySelector('.dp-days');
  const hoursEl = host.querySelector('.dp-hours');
  const noteEl = host.querySelector('.dp-note-t');

  // What the pop-up is showing and what is picked, before Set touchdown.
  let view = { y: 2025, m: 2 };
  let pickDay = NaN;
  let pickHour = 0;
  let focusDay = NaN;

  const bounds = () => {
    const min = parse(input.min);
    const max = parse(input.max);
    return { min: Number.isFinite(min) ? min : -Infinity, max: Number.isFinite(max) ? max : Infinity };
  };
  // A day can be picked when at least one of its hours is inside the allowed range.
  const dayOk = (d) => {
    const { min, max } = bounds();
    return d + DAY_MS - 3_600_000 >= min && d <= max;
  };
  const hourOk = (d, h) => {
    const { min, max } = bounds();
    const t = d + h * 3_600_000;
    return t >= min && t <= max;
  };

  function sync() {
    const ms = parse(input.value);
    trigger.querySelector('.dp-trigger-v').textContent = Number.isFinite(ms) ? label(ms) : 'Pick a date';
    trigger.disabled = input.disabled;
  }

  function renderYears() {
    const { min, max } = bounds();
    const y0 = Number.isFinite(min) ? new Date(min).getUTCFullYear() : view.y - 3;
    const y1 = Number.isFinite(max) ? new Date(max).getUTCFullYear() : view.y + 3;
    let html = '';
    for (let y = y0; y <= y1; y += 1) {
      html += `<button type="button" data-year="${y}" aria-pressed="${y === view.y}">${y}</button>`;
    }
    yearsEl.innerHTML = html;
  }

  function renderMonth() {
    monthEl.innerHTML = `<em>${MONTHS[view.m]}</em> <span class="num">${view.y}</span>`;
    const first = Date.UTC(view.y, view.m, 1);
    const lead = (new Date(first).getUTCDay() + 6) % 7; // Monday first
    const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    const delayed = Number.isFinite(pickDay) ? pickDay + slipDays() * DAY_MS : NaN;
    let html = '<span></span>'.repeat(lead);
    for (let n = 1; n <= count; n += 1) {
      const d = first + (n - 1) * DAY_MS;
      const ok = dayOk(d);
      const on = d === pickDay;
      const wd = (lead + n - 1) % 7;
      const name = `${WEEKDAY_NAMES[wd]}, ${MONTHS[view.m]} ${n}, ${view.y}`;
      const cls = ['dp-day', on ? 'is-on' : '', d === delayed ? 'is-delayed' : ''].join(' ');
      html += `<button type="button" role="gridcell" class="${cls}" data-day="${d}" tabindex="${d === focusDay ? 0 : -1}"
        aria-pressed="${on}" aria-label="${name}${d === delayed ? ', delayed touchdown' : ''}" ${ok ? '' : 'disabled'}><span class="num">${n}</span></button>`;
    }
    daysEl.innerHTML = html;
    // Keep one day reachable by Tab even when the focused day is in another month.
    if (!daysEl.querySelector('[tabindex="0"]')) daysEl.querySelector('.dp-day:not([disabled])')?.setAttribute('tabindex', '0');
    yearsEl.querySelectorAll('[data-year]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.year) === view.y)));
    const { min, max } = bounds();
    host.querySelector('[data-step="-1"]').disabled = first <= dayStart(min);
    host.querySelector('[data-step="1"]').disabled = Date.UTC(view.y, view.m + 1, 1) > max;
  }

  function renderHours() {
    let html = '';
    for (let h = 0; h < 24; h += 1) {
      const ok = !Number.isFinite(pickDay) || hourOk(pickDay, h);
      html += `<button type="button" data-hour="${h}" aria-pressed="${h === pickHour}" ${ok ? '' : 'disabled'}><span class="num">${pad(h)}</span></button>`;
    }
    hoursEl.innerHTML = html;
  }

  function renderNote() {
    const slip = slipDays();
    if (!Number.isFinite(pickDay)) return (noteEl.textContent = '');
    const d = new Date(pickDay + slip * DAY_MS);
    noteEl.textContent = `+${slip} ${slip === 1 ? 'day' : 'days'} lands on ${SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }

  const renderAll = () => {
    renderMonth();
    renderHours();
    renderNote();
  };

  function moveView(step) {
    const t = new Date(Date.UTC(view.y, view.m + step, 1));
    view = { y: t.getUTCFullYear(), m: t.getUTCMonth() };
    renderMonth();
  }

  function open() {
    if (input.disabled) return;
    const ms = parse(input.value);
    pickDay = Number.isFinite(ms) ? dayStart(ms) : NaN;
    pickHour = Number.isFinite(ms) ? new Date(ms).getUTCHours() : 0;
    focusDay = pickDay;
    const d = new Date(Number.isFinite(ms) ? ms : Date.now());
    view = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    renderYears();
    renderAll();
    pop.hidden = false;
    host.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => daysEl.querySelector('[tabindex="0"]')?.focus({ preventScroll: true }));
  }

  function close({ restore = true } = {}) {
    if (pop.hidden) return;
    pop.hidden = true;
    host.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus({ preventScroll: true });
  }

  function commit() {
    if (!Number.isFinite(pickDay)) return close();
    let h = pickHour;
    if (!hourOk(pickDay, h)) h = [...Array(24).keys()].find((x) => hourOk(pickDay, x)) ?? h;
    const value = toValue(pickDay + h * 3_600_000);
    close();
    if (value !== input.value) {
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync();
  }

  trigger.addEventListener('click', () => (pop.hidden ? open() : close()));
  host.querySelector('.dp-cancel').addEventListener('click', () => close());
  host.querySelector('.dp-set').addEventListener('click', commit);
  host.querySelectorAll('.dp-arrow').forEach((b) => b.addEventListener('click', () => moveView(Number(b.dataset.step))));
  yearsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]');
    if (!b) return;
    view = { ...view, y: Number(b.dataset.year) };
    // Stay inside the range when a year is only partly covered.
    const { min, max } = bounds();
    if (Date.UTC(view.y, view.m, 1) < dayStart(min)) view.m = new Date(min).getUTCMonth();
    if (Date.UTC(view.y, view.m, 1) > max) view.m = new Date(max).getUTCMonth();
    renderMonth();
  });
  daysEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b || b.disabled) return;
    pickDay = Number(b.dataset.day);
    focusDay = pickDay;
    renderAll();
    daysEl.querySelector(`[data-day="${pickDay}"]`)?.focus({ preventScroll: true });
  });
  daysEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-day]:not([disabled])')) commit();
  });
  hoursEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hour]');
    if (!b || b.disabled) return;
    pickHour = Number(b.dataset.hour);
    hoursEl.querySelectorAll('[data-hour]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.hour) === pickHour)));
  });

  // Arrow keys move through the days, across months; Enter picks, Escape closes.
  daysEl.addEventListener('keydown', (e) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -30, PageDown: 30 };
    if (e.key === 'Enter' && e.target.closest('[data-day]')) {
      e.preventDefault();
      pickDay = Number(e.target.closest('[data-day]').dataset.day);
      focusDay = pickDay;
      commit();
      return;
    }
    if (!(e.key in steps)) return;
    e.preventDefault();
    const from = Number(e.target.closest('[data-day]')?.dataset.day ?? focusDay);
    const next = from + steps[e.key] * DAY_MS;
    if (!dayOk(next)) return;
    focusDay = next;
    const nd = new Date(next);
    if (nd.getUTCFullYear() !== view.y || nd.getUTCMonth() !== view.m) view = { y: nd.getUTCFullYear(), m: nd.getUTCMonth() };
    renderMonth();
    daysEl.querySelector(`[data-day="${next}"]`)?.focus();
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !host.contains(e.target)) close({ restore: false });
  });
  host.addEventListener('focusout', (e) => {
    if (!pop.hidden && e.relatedTarget && !host.contains(e.relatedTarget)) close({ restore: false });
  });

  sync();
  return { sync, close };
}
