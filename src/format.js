// Display formatting. All rounding happens here, after calculation.
import { HOUR_MS } from './calc.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const roundMinute = (t) => Math.round(t / 60_000) * 60_000;

/** "44.2", "72", "0" — one decimal, whole numbers shown without ".0". */
export function fmtHours(h) {
  const r = Math.round(h * 10) / 10;
  const z = Object.is(r, -0) ? 0 : r;
  return Number.isInteger(z) ? String(z) : z.toFixed(1);
}

/** "Mar 16, 20:11 UTC" (rounded to the nearest minute). */
export function fmtUtc(t, { year = false, seconds = false } = {}) {
  const d = new Date(seconds ? t : roundMinute(t));
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${year ? `, ${d.getUTCFullYear()}` : ''}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  return `${base} · ${time} UTC`;
}

export function fmtUtcTime(t) {
  const d = new Date(roundMinute(t));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "54 h 15 min" — duration rounded to the nearest minute. */
export function fmtDuration(ms) {
  const total = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Elapsed mission time "T+44:11". */
export function fmtElapsed(ms) {
  const total = Math.round(ms / 60_000);
  return `T+${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export const fmtDeg = (d, digits = 1) => {
  // Near the horizon one decimal can read "0.0°" while above; show two.
  const dg = digits === 1 && Math.abs(d) < 0.95 ? 2 : digits;
  const s = Math.abs(d).toFixed(dg);
  return `${d < 0 && Number(s) !== 0 ? '−' : ''}${s}°`;
};

export function compass(az) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(az / 22.5) % 16];
}

export const EVENT_NAME = {
  sun: { rise: 'Sunrise', set: 'Sunset' },
  earth: { rise: 'Earthrise', set: 'Earthset' },
};

export const BODY_NAME = { sun: 'Sun', earth: 'Earth' };

/** Delay phrasing: "48.7 fewer hours", "44.2 more hours", "No change". */
export function fmtChange(deltaH) {
  const s = fmtHours(deltaH);
  if (s === '0') return 'No change';
  const n = s.replace('-', '');
  const unit = n === '1' ? 'hour' : 'hours';
  return deltaH < 0 ? `${n} fewer ${unit}` : `${n} more ${unit}`;
}

export const hoursFromStart = (t, start) => (t - start) / HOUR_MS;
