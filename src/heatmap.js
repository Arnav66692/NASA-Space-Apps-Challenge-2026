// Where to land: the whole Moon scored for one touchdown. Every point on a lat/lon grid gets the
// same 72 hour analysis as the chosen site (analyzeStay), and keeps the longest unbroken stretch
// with the Sun and Earth both up. The grid math is pure, so the tests run it in Node. The part at
// the bottom drives the globe toggle and runs the grid in small slices so the page never freezes.
// Written with an AI tool (Claude).
import { analyzeStay } from './slips.js';
import { WINDOW_HOURS } from './window.js';
import './heatmap.css';

export const HEAT_STEP_DEG = 2;
export const HEAT_MAX_HOURS = WINDOW_HOURS;

/**
 * Grid nodes run from the south pole to the north pole (rows) and from 0° E eastward (cols).
 * Node (row, col) sits at lat -90 + row * step and lonE col * step.
 * @returns {{stepDeg:number, rows:number, cols:number}}
 */
export function heatShape(stepDeg = HEAT_STEP_DEG) {
  if (!(stepDeg > 0) || 180 % stepDeg !== 0) throw new RangeError('The grid step must divide 180 degrees.');
  return { stepDeg, rows: 180 / stepDeg + 1, cols: 360 / stepDeg };
}

export const nodeLat = (shape, row) => -90 + row * shape.stepDeg;
export const nodeLonE = (shape, col) => col * shape.stepDeg;

/** The grid node nearest a point, as {row, col, index}. Longitude may be any east-positive or signed value. */
export function nearestNode(shape, lat, lonE) {
  const row = Math.min(shape.rows - 1, Math.max(0, Math.round((lat + 90) / shape.stepDeg)));
  const lon = ((lonE % 360) + 360) % 360;
  const col = Math.round(lon / shape.stepDeg) % shape.cols;
  return { row, col, index: row * shape.cols + col };
}

/** Longest unbroken hours with both up for a stay at one point. NaN when the stay is off the Moon table. */
export function heatValue(eph, lat, lonE, startMs, horizonDeg = 0) {
  try {
    return analyzeStay(eph, { id: 'heat', name: '', lat, lonE }, startMs, { horizonDeg }).stretches.longestBoth;
  } catch {
    return NaN;
  }
}

/**
 * The order the browser fills the grid in: every other node first (a coarse map shows fast),
 * then the rest. Each pole is one point, so only its first column is computed.
 */
export function heatOrder(shape) {
  const coarse = [];
  const fine = [];
  for (let row = 0; row < shape.rows; row++) {
    const pole = row === 0 || row === shape.rows - 1;
    for (let col = 0; col < (pole ? 1 : shape.cols); col++) {
      const i = row * shape.cols + col;
      (row % 2 === 0 && col % 2 === 0 ? coarse : fine).push(i);
    }
  }
  return coarse.concat(fine);
}

/** Copy each pole's single value across its row. */
function fillPoles(shape, values) {
  for (const row of [0, shape.rows - 1]) values.fill(values[row * shape.cols], row * shape.cols, (row + 1) * shape.cols);
}

/** Holes left before the fine pass take the value of their coarse neighbour, so the map shows no gaps. */
export function fillFromCoarse(shape, values, known) {
  const out = new Float32Array(values);
  for (let row = 0; row < shape.rows; row++) {
    for (let col = 0; col < shape.cols; col++) {
      const i = row * shape.cols + col;
      if (known[i]) continue;
      const r = Math.min(row & ~1, shape.rows - 1);
      const j = r * shape.cols + (col & ~1);
      out[i] = known[j] ? values[j] : NaN;
    }
  }
  return out;
}

/** The whole grid at once. Used by the tests. */
export function computeHeatGrid(eph, startMs, horizonDeg = 0, stepDeg = HEAT_STEP_DEG) {
  const shape = heatShape(stepDeg);
  const values = new Float32Array(shape.rows * shape.cols).fill(NaN);
  for (const i of heatOrder(shape)) {
    const row = Math.floor(i / shape.cols);
    values[i] = heatValue(eph, nodeLat(shape, row), nodeLonE(shape, i % shape.cols), startMs, horizonDeg);
  }
  fillPoles(shape, values);
  return { shape, values };
}

/** RGBA bytes for the globe: red holds hours as a share of 72, alpha says the node has a value. */
export function heatBytes(shape, values) {
  const out = new Uint8Array(shape.rows * shape.cols * 4);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    out[i * 4] = Math.round((Math.min(Math.max(v, 0), HEAT_MAX_HOURS) / HEAT_MAX_HOURS) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

export const heatKey = ({ startMs, horizonDeg }, stepDeg = HEAT_STEP_DEG) => `${startMs}|${horizonDeg}|${stepDeg}`;

// ───────────── Browser side: the toggle, the slices, the legend ─────────────

const SLICE_MS = 7; // compute per slice, so a 60 fps frame still has room to draw
const CACHE_SIZE = 6;

/** Run the grid in slices. Calls onProgress(values, done, total) after each slice. Returns cancel(). */
function runSliced({ eph, startMs, horizonDeg, shape }, onProgress, onDone) {
  const order = heatOrder(shape);
  const values = new Float32Array(shape.rows * shape.cols).fill(NaN);
  const known = new Uint8Array(values.length);
  const coarseCount = order.findIndex((i) => {
    const row = Math.floor(i / shape.cols);
    return row % 2 !== 0 || (i % shape.cols) % 2 !== 0;
  });
  let k = 0;
  let timer = 0;
  let cancelled = false;
  const t0 = performance.now();
  const step = () => {
    if (cancelled) return;
    const end = performance.now() + SLICE_MS;
    while (k < order.length && performance.now() < end) {
      const i = order[k++];
      const row = Math.floor(i / shape.cols);
      values[i] = heatValue(eph, nodeLat(shape, row), nodeLonE(shape, i % shape.cols), startMs, horizonDeg);
      known[i] = 1;
      if (row === 0 || row === shape.rows - 1) {
        values.fill(values[i], row * shape.cols, (row + 1) * shape.cols);
        known.fill(1, row * shape.cols, (row + 1) * shape.cols);
      }
    }
    if (k >= order.length) {
      onDone(values, performance.now() - t0);
      return;
    }
    if (k >= coarseCount) onProgress(fillFromCoarse(shape, values, known), k, order.length);
    timer = setTimeout(step, 0);
  };
  timer = setTimeout(step, 0);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

const fmtH = (v) => `${Math.round(v)} h`;

function legendHtml(needHours, status) {
  const needPct = (Math.min(needHours, HEAT_MAX_HOURS) / HEAT_MAX_HOURS) * 100;
  return `<div class="hl-title">Longest stretch with Sun and Earth both up</div>
    <div class="hl-bar"><span class="hl-need" style="left:${needPct}%"></span></div>
    <div class="hl-ticks"><span>0 h</span><span class="hl-need-lbl" style="left:${Math.min(Math.max(needPct, 30), 70)}%">need ${fmtH(needHours)}</span><span>${fmtH(HEAT_MAX_HOURS)}</span></div>
    <div class="hl-status" aria-live="polite">${status}</div>`;
}

/**
 * Wire the globe's Heatmap toggle. Off by default. `inputs()` returns {eph, startMs, horizonDeg, needHours}
 * or null while the Moon table loads. `globe()` returns the globe or null before it exists.
 * Call refresh() whenever the plan may have changed. It only recomputes when the key changes.
 */
export function mountHeatmap({ button, legend, inputs, globe }) {
  if (!button || !legend) return { refresh() {} };
  let on = false;
  let cancel = null;
  let runningKey = null;
  let shownKey = null;
  let lastMs = null;
  let shownNeed = null;
  const cache = new Map();
  const shape = heatShape();
  let current = null; // the values on screen, for the hover readout
  let hoverBound = null;
  const tip = document.createElement('div');
  tip.className = 'heat-tip';
  tip.hidden = true;
  legend.parentElement?.appendChild(tip);

  function hover(p) {
    const v = p && current ? current[nearestNode(shape, p.lat, p.lonE).index] : NaN;
    if (!p || !on || !Number.isFinite(v)) {
      tip.hidden = true;
      return;
    }
    const need = inputs()?.needHours ?? 0;
    const ns = `${Math.abs(p.lat).toFixed(1)}° ${p.lat < -0.05 ? 'S' : 'N'}`;
    const lonSigned = p.lonE > 180 ? p.lonE - 360 : p.lonE;
    const ew = `${Math.abs(lonSigned).toFixed(1)}° ${lonSigned < -0.05 ? 'W' : 'E'}`;
    const meets = need > 0 ? (v + 1e-9 >= need ? `, meets the ${need} h need` : `, short of the ${need} h need`) : '';
    tip.innerHTML = `<span class="ht-pos">${ns}, ${ew}</span><b>${v.toFixed(1)} h</b> both up${meets}`;
    const flip = p.x > (tip.parentElement?.clientWidth ?? 0) - 200;
    tip.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)${flip ? ' translateX(calc(-100% - 28px))' : ''}`;
    tip.hidden = false;
  }

  const push = (values, needHours) => {
    if (values) current = values;
    return globe()?.setHeatmap?.({ on, bytes: values ? heatBytes(shape, values) : null, rows: shape.rows, cols: shape.cols, needHours, maxHours: HEAT_MAX_HOURS });
  };
  const show = (status, needHours) => {
    legend.innerHTML = legendHtml(needHours, status);
    legend.classList.toggle('is-busy', status.startsWith('Computing'));
  };

  function stop() {
    cancel?.();
    cancel = null;
    runningKey = null;
  }

  function refresh() {
    const g = globe();
    const p = inputs();
    if (g && hoverBound !== g) {
      hoverBound = g;
      g.onHeatHover?.(hover);
    }
    if (!on) return;
    if (!g || !p) {
      show(p ? 'Waiting for the 3D globe.' : 'Waiting for the Moon table.', p?.needHours ?? 24);
      return;
    }
    const key = heatKey(p);
    if (key === shownKey) {
      if (runningKey) {
        // Back to the map already on screen while another one was computing.
        stop();
        shownNeed = null;
        push(cache.get(shownKey), p.needHours);
      }
      if (p.needHours === shownNeed) return;
      shownNeed = p.needHours;
      g.setHeatmap?.({ on, needHours: p.needHours });
      show(doneText(), p.needHours);
      return;
    }
    shownNeed = null;
    if (key === runningKey) return;
    if (cache.has(key)) {
      stop();
      shownKey = key;
      lastMs = null;
      shownNeed = p.needHours;
      push(cache.get(key), p.needHours);
      show(doneText(), p.needHours);
      return;
    }
    stop();
    runningKey = key;
    show('Computing…', p.needHours);
    cancel = runSliced(
      { eph: p.eph, startMs: p.startMs, horizonDeg: p.horizonDeg, shape },
      (values, done, total) => {
        push(values, inputs()?.needHours ?? p.needHours);
        show(`Computing… ${Math.round((done / total) * 100)}%`, inputs()?.needHours ?? p.needHours);
      },
      (values, ms) => {
        cancel = null;
        runningKey = null;
        cache.set(key, values);
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
        shownKey = key;
        lastMs = ms;
        const need = inputs()?.needHours ?? p.needHours;
        shownNeed = need;
        push(values, need);
        show(doneText(), need);
        button.dataset.heatMs = String(Math.round(ms));
      },
    );
  }

  const doneText = () =>
    shownKey && !cache.get(shownKey)?.some(Number.isFinite)
      ? 'This touchdown is outside the Moon table, so there is nothing to map.'
      : `Every ${shape.stepDeg}° of the Moon for this touchdown${lastMs ? `, worked out in ${(lastMs / 1000).toFixed(1)} s` : ''}. Outline marks the need.`;

  function setOn(next) {
    on = next;
    button.setAttribute('aria-checked', String(on));
    legend.hidden = !on;
    shownNeed = null;
    if (!on) {
      tip.hidden = true;
      stop();
      globe()?.setHeatmap?.({ on: false });
      return;
    }
    refresh();
  }

  button.addEventListener('click', () => setOn(!on));
  // For QA in the console, like window.__longShadow.
  window.__heatmap = { globe, setOn, refresh, isOn: () => on };
  return { refresh, setOn, isOn: () => on };
}
