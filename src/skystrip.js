// 2D horizon strip: azimuth across, elevation up. The elevation axis is fitted
// to the active window's actual range (always including 0°), so delayed Blue
// Ghost's −71° Sun is on-scale; an off-scale arrow remains as a safeguard.
import { fmtDeg } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const M = { l: 44, r: 14, t: 14, b: 26 };

function niceStep(span) {
  const raw = span / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

export function createSkyStrip(root) {
  let W = 600;
  let H = 230;
  let dom = [-10, 10];
  let analysis = null;
  let markers = {};
  let lastSample = null;

  const x = (az) => M.l + (az / 360) * (W - M.l - M.r);
  const y = (el) => M.t + ((dom[1] - el) / (dom[1] - dom[0])) * (H - M.t - M.b);

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  function fitDomain(a) {
    let [lo, hi] = a.elRange;
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    const span = Math.max(hi - lo, 4);
    const pad = span * 0.12;
    const step = niceStep(span + 2 * pad);
    return [Math.max(Math.floor((lo - pad) / step) * step, -90), Math.min(Math.ceil((hi + pad) / step) * step, 90), step];
  }

  function trail(rows, key, cls, g) {
    let d = '';
    let prevAz = null;
    for (const r of rows) {
      const az = r[`${key}Az`];
      const e = r[`${key}El`];
      const jump = prevAz !== null && Math.abs(az - prevAz) > 180;
      d += `${d === '' || jump ? 'M' : 'L'}${x(az).toFixed(1)},${y(e).toFixed(1)}`;
      prevAz = az;
    }
    el('path', { d, class: `trail ${cls}` }, g);
  }

  function marker(kind, g) {
    const m = el('g', { class: `mk mk-${kind}` }, g);
    el('circle', { r: 11, class: 'mk-halo' }, m);
    el('circle', { r: 7, class: 'mk-ring' }, m);
    if (kind === 'sun') el('circle', { r: 2.2, class: 'mk-dot' }, m);
    else el('path', { d: 'M0,-7V7M-7,0H7', class: 'mk-cross' }, m);
    const off = el('path', { d: 'M-6,0 0,8 6,0z', class: 'mk-off' }, m);
    off.style.display = 'none';
    const label = el('text', { class: 'mk-label', x: 13, y: 4 }, m);
    return { g: m, label, off };
  }

  function render(a) {
    analysis = a;
    W = Math.max(root.clientWidth || 600, 280);
    H = W < 480 ? 210 : 240;
    const [lo, hi, step] = fitDomain(a);
    dom = [lo, hi];

    const svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`,
      width: W,
      height: H,
      role: 'img',
      'aria-label': `Horizon strip. Elevation axis from ${fmtDeg(lo, 0)} to ${fmtDeg(hi, 0)}.`,
      class: 'strip-svg',
    });
    const defs = el('defs', {}, svg);
    const pat = el('pattern', { id: 'below-hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 7, class: 'hatch-line' }, pat);

    // Below-horizon ground band
    el('rect', { x: M.l, y: y(0), width: W - M.l - M.r, height: Math.max(0, y(lo) - y(0)), class: 'ground' }, svg);
    el('rect', { x: M.l, y: y(0), width: W - M.l - M.r, height: Math.max(0, y(lo) - y(0)), fill: 'url(#below-hatch)' }, svg);

    // Grid
    const grid = el('g', { class: 'grid' }, svg);
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' };
    for (let az = 0; az <= 360; az += 45) {
      el('line', { x1: x(az), x2: x(az), y1: M.t, y2: H - M.b, class: az % 90 ? 'g-minor' : 'g-major' }, grid);
      if (W >= 420 || az % 90 === 0) {
        const t = el('text', { x: x(az), y: H - 8, class: 'ax-x' }, grid);
        t.textContent = names[az] ? `${names[az]}` : `${az}°`;
      }
    }
    for (let e = Math.ceil(lo / step) * step; e <= hi + 1e-9; e += step) {
      if (Math.abs(e) > 1e-9) el('line', { x1: M.l, x2: W - M.r, y1: y(e), y2: y(e), class: 'g-minor' }, grid);
      const t = el('text', { x: M.l - 6, y: y(e) + 4, class: 'ax-y' }, grid);
      t.textContent = fmtDeg(Math.round(e * 100) / 100, 0);
    }
    // Horizon reference
    el('line', { x1: M.l, x2: W - M.r, y1: y(0), y2: y(0), class: 'horizon' }, svg);
    const hl = el('text', { x: M.l + 5, y: y(0) - 6, class: 'horizon-label' }, svg);
    hl.textContent = 'Horizon 0°';
    const bl = el('text', { x: M.l + 5, y: y(0) + 14, class: 'below-label' }, svg);
    bl.textContent = 'below';

    // Full-window paths
    const trails = el('g', {}, svg);
    trail(a.rows, 'sun', 'sun', trails);
    trail(a.rows, 'earth', 'earth', trails);

    const mg = el('g', {}, svg);
    markers = { earth: marker('earth', mg), sun: marker('sun', mg) };

    root.replaceChildren(svg);
    if (lastSample) update(lastSample);
  }

  function update(sample) {
    lastSample = sample;
    if (!analysis) return;
    for (const body of ['sun', 'earth']) {
      const { el: e, az } = sample[body];
      const m = markers[body];
      const offLow = e < dom[0];
      const offHigh = e > dom[1];
      const ec = Math.min(Math.max(e, dom[0]), dom[1]);
      const px = x(az);
      m.g.setAttribute('transform', `translate(${px.toFixed(1)},${y(ec).toFixed(1)})`);
      m.off.style.display = offLow || offHigh ? '' : 'none';
      m.off.setAttribute('transform', offHigh ? 'translate(0,-12) rotate(180)' : 'translate(0,12)');
      const flip = px > W - 120;
      m.label.setAttribute('x', flip ? -13 : 13);
      m.label.setAttribute('text-anchor', flip ? 'end' : 'start');
      m.label.textContent = `${body === 'sun' ? 'Sun' : 'Earth'} ${fmtDeg(e)}${offLow || offHigh ? ' (off scale)' : ''}`;
      m.g.classList.toggle('below', e <= 0);
    }
    // Keep labels from colliding when bodies are close (Athena).
    const sy = y(Math.min(Math.max(sample.sun.el, dom[0]), dom[1]));
    const ey = y(Math.min(Math.max(sample.earth.el, dom[0]), dom[1]));
    const close = Math.abs(x(sample.sun.az) - x(sample.earth.az)) < 110 && Math.abs(sy - ey) < 16;
    markers.sun.label.setAttribute('y', close ? (sy <= ey ? -6 : 14) : 4);
    markers.earth.label.setAttribute('y', close ? (ey < sy ? -6 : 14) : 4);
  }

  return { render, update };
}
