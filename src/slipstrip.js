// Slip strip: one small cell per day of delay, 0 to 30, each with three bars
// (Sun, Earth, both) on a shared 0 to 72 hour scale. Click a cell to set the slip.
// Written with an AI tool (Claude).
import { fmtHours, fmtDay, slipShort } from './format.js';
import { icon } from './icons.js';

const WINDOW_H = 72;
const LABEL_EVERY = 5;
const TIE_HOURS = 0.05;
const pctOf = (hours) => Math.min(Math.max((hours / WINDOW_H) * 100, 0), 100).toFixed(2);

const slipName = (cell) => (cell.slipDays === 0 ? 'Original' : `+${slipShort(cell.slipDays)}`);

function cellWords(cell) {
  const eclipse = cell.eclipseHours > 0 ? ` · Sun behind Earth ${fmtHours(cell.eclipseHours)} h` : '';
  return (
    `${slipName(cell)} · touchdown ${fmtDay(cell.startMs, { year: true })} · ` +
    `Sun ${fmtHours(cell.sunHours)} h · Earth ${fmtHours(cell.earthHours)} h · Both ${fmtHours(cell.bothHours)} h${eclipse}`
  );
}

function summaryWords(cells, rank) {
  if (!rank) {
    const flat = cells.length ? fmtHours(cells.at(-1).bothHours) : '0';
    return `Every slip from 1 to ${cells.length - 1} days gives ${flat} h with the Sun and Earth up together.`;
  }
  const best = cells.find((c) => c.slipDays === rank.best);
  const worst = cells.find((c) => c.slipDays === rank.worst);
  // Several slips often share the top or bottom value, so say how many and name the first.
  const describe = (cell) => {
    const tied = cells.filter((c) => c.slipDays >= 1 && Math.abs(c.bothHours - cell.bothHours) < TIE_HOURS).length;
    const when = `+${slipShort(cell.slipDays)} (${fmtDay(cell.startMs)})`;
    return tied > 1 ? `${fmtHours(cell.bothHours)} h at ${tied} slips, first ${when}` : `${fmtHours(cell.bothHours)} h at ${when}`;
  };
  return `Most hours with both up: ${describe(best)}. Fewest: ${describe(worst)}.`;
}

/**
 * @param {HTMLElement} root element holding [data-slips-grid], [data-slips-read] and [data-slips-table]
 * @param {{onPick: (slipDays: number) => void}} handlers
 */
export function createSlipStrip(root, { onPick }) {
  const grid = root.querySelector('[data-slips-grid]');
  const read = root.querySelector('[data-slips-read]');
  const table = root.querySelector('[data-slips-table]');
  let cells = [];
  let summary = '';

  const showSummary = () => {
    read.textContent = summary;
  };
  const cellFrom = (target) => {
    const button = target.closest?.('[data-slip]');
    return button ? cells.find((c) => c.slipDays === Number(button.dataset.slip)) : null;
  };
  const showCell = (event) => {
    const cell = cellFrom(event.target);
    if (cell) read.textContent = cellWords(cell);
  };

  grid.addEventListener('click', (event) => {
    const cell = cellFrom(event.target);
    if (cell) onPick(cell.slipDays);
  });
  grid.addEventListener('pointerover', showCell);
  grid.addEventListener('focusin', showCell);
  grid.addEventListener('pointerleave', showSummary);
  grid.addEventListener('focusout', showSummary);

  /** Show a plain message in place of the strip (loading, or the table failed). */
  function message(text) {
    cells = [];
    summary = text;
    grid.innerHTML = '';
    table.innerHTML = '';
    showSummary();
  }

  function render({ cells: nextCells, rank }) {
    cells = nextCells;
    summary = summaryWords(cells, rank);
    grid.innerHTML = cells
      .map((c) => {
        const mark = rank && c.slipDays === rank.best ? 'best' : rank && c.slipDays === rank.worst ? 'worst' : '';
        const labelled = c.slipDays % LABEL_EVERY === 0 ? 'has-label' : '';
        const markHtml = mark
          ? `<span class="slip-mark ${mark}" aria-hidden="true">${mark === 'best' ? '▲' : '▼'}</span>`
          : '';
        const markWords = mark === 'best' ? ' Most hours with both up.' : mark === 'worst' ? ' Fewest hours with both up.' : '';
        return `<button type="button" class="slip-cell ${labelled} ${mark ? `is-${mark}` : ''}" data-slip="${c.slipDays}" aria-label="${cellWords(c)}.${markWords}">
          ${markHtml}
          <span class="slip-bars" aria-hidden="true">
            <i class="sb sun" style="--h:${pctOf(c.sunHours)}"></i><i class="sb earth" style="--h:${pctOf(c.earthHours)}"></i><i class="sb both" style="--h:${pctOf(c.bothHours)}"></i>
          </span>
          <span class="slip-d num" aria-hidden="true">${c.slipDays}</span>
        </button>`;
      })
      .join('');
    table.innerHTML =
      `<caption>Hours above the horizon in the first 72 hours, for every slip</caption>
      <thead><tr><th>Slip</th><th>Touchdown</th><th>${icon('sun')}Sun</th><th>${icon('earth')}Earth</th><th>Both</th></tr></thead>
      <tbody>${cells
        .map(
          (c) =>
            `<tr><th scope="row">${slipName(c)}</th><td>${fmtDay(c.startMs, { year: true })}</td><td>${fmtHours(c.sunHours)} h</td><td>${fmtHours(c.earthHours)} h</td><td>${fmtHours(c.bothHours)} h</td></tr>`,
        )
        .join('')}</tbody>`;
    showSummary();
  }

  /** Mark the slip in the plan and the stay on screen. */
  function update({ slipDays, scenario }) {
    const shown = scenario === 'original' ? 0 : slipDays;
    grid.querySelectorAll('[data-slip]').forEach((button) => {
      const k = Number(button.dataset.slip);
      button.classList.toggle('is-slip', k === slipDays);
      button.classList.toggle('is-shown', k === shown);
      // A regular day label next to the highlighted one would run into it ("910").
      const marked = k === slipDays || k === shown;
      const crowded = !marked && (Math.abs(k - slipDays) === 1 || Math.abs(k - shown) === 1);
      button.classList.toggle('is-crowded', crowded);
      button.setAttribute('aria-pressed', String(k === shown));
    });
  }

  return { render, update, message };
}
