// Camera fitting for the surface view. The camera always orbits the lander and
// looks straight at it. To show a high Sun or Earth without leaving the lander,
// the frame is lens-shifted upward (the lander moves into the lower part of the
// picture, verticals stay vertical) and the field of view widens only as far as
// the sky needs. Pure math (no three.js) so it can be checked in Node.
// Written with an AI tool (Claude).

const D2R = Math.PI / 180;

/** Same frame as geo.js azElToLocal: +x east, +y up, −z north. */
export const azElDir = (azDeg, elDeg) => {
  const az = azDeg * D2R, el = elDeg * D2R;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
};

export const FIT = {
  minFov: 50, // vertical, degrees: the view's normal look
  maxFov: 80, // vertical, degrees: wider than this distorts the lander
  maxHFov: 104, // horizontal cap on narrow (portrait) panels
  margin: 0.08, // fraction of the half-screen kept clear at each edge
  maxShift: 0.68, // lens shift, in half-heights: 0.68 puts the lander centre 16% above the bottom
  targetY: 1.6, // the orbit centre: middle of the lander body
  elevs: [-2, 2, 6, 10, 14], // camera heights above the lander centre, degrees
  homeElev: 6, // preferred camera elevation when the sky allows any
};

// Points on the lander that must stay on screen: footpads, solar wing tip, dish, deck.
const LANDER_PTS = [
  [1.42, 0.05, 1.42], [-1.42, 0.05, 1.42], [1.42, 0.05, -1.42], [-1.42, 0.05, -1.42],
  [2.75, 2.35, -0.2], [-0.45, 3.55, -0.35], [0, 3.45, 0], [1.05, 1.5, 0], [-1.05, 1.5, 0],
];

/** Vertical field-of-view range for a panel shape. Portrait panels may go taller while the width stays sane. */
export function fovRange(aspect) {
  if (aspect >= 1) return { minFov: FIT.minFov, maxFov: FIT.maxFov };
  const hCapV = (2 * Math.atan(Math.tan((FIT.maxHFov / 2) * D2R) / aspect)) / D2R;
  return { minFov: 62, maxFov: Math.max(62, Math.min(92, hCapV)) };
}

/** Camera position and basis for a heading (azimuth looked toward), elevation and distance. */
export function poseBasis({ yaw, elev, dist }) {
  const h = azElDir(yaw, 0);
  const ce = Math.cos(elev * D2R), se = Math.sin(elev * D2R);
  const pos = [-h[0] * ce * dist, FIT.targetY + se * dist, -h[2] * ce * dist];
  const f = [h[0] * ce, -se, h[2] * ce]; // toward the lander
  const r = [-h[2], 0, h[0]];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { pos, f, r, u };
}

/** Normalised device coordinates of a world point for a fitted view (x, y in −1..1 when on screen). */
export function projectFit(view, aspect, dist, p) {
  const { pos, f, r, u } = poseBasis({ ...view, dist });
  const d = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
  const z = dot(d, f);
  if (z <= 0) return null;
  const t = Math.tan((view.fov / 2) * D2R);
  return { x: dot(d, r) / z / (t * aspect), y: dot(d, u) / z / t - view.shift };
}

/**
 * @param {object} p
 * @param {Array<{az:number, el:number, priority:number}>} p.bodies directions to keep on screen;
 *   lower priority numbers are dropped first if everything cannot fit
 * @param {number} p.aspect panel width / height
 * @param {number} p.dist camera distance from the lander centre
 * @param {number} [p.skyR] distance of the sky bodies in the scene
 * @param {number} [p.topReserve] fraction of the panel height at the top kept free of
 *   bodies (room for their labels and the HUD)
 * @param {{yaw:number, elev:number}} [p.pose] keep this heading and elevation; fit only the lens
 * @returns {{yaw:number, elev:number, fov:number, shift:number, fits:boolean, kept:number}}
 */
export function fitSurfaceCamera({ bodies, aspect, dist, skyR = 1400, topReserve = 0, pose = null }) {
  const order = [...bodies].sort((a, b) => b.priority - a.priority);
  // Whatever fits, face the sky's bodies: a dropped one then sits just above the frame.
  let ex = 0, ez = 0;
  for (const b of bodies) {
    const w = b.priority * Math.cos(b.el * D2R) + 0.05;
    ex += w * Math.sin(b.az * D2R);
    ez += w * Math.cos(b.az * D2R);
  }
  const faceAz = bodies.length ? Math.atan2(ex, ez) / D2R : null;
  // Before giving up a body, let it sit closer to the top edge.
  const reserves = [topReserve, topReserve * 0.6, Math.min(topReserve, 0.04)];
  for (let n = order.length; n >= 0; n--) {
    for (const reserve of n ? reserves : [0]) {
      const best = search(order.slice(0, n), aspect, dist, skyR, reserve, pose, faceAz);
      if (best) return { ...best, fits: true, kept: n };
    }
  }
  // The lander alone always fits at the allowed distances; this is a guard.
  return { yaw: pose?.yaw ?? 0, elev: pose?.elev ?? FIT.homeElev, fov: fovRange(aspect).minFov, shift: 0, fits: false, kept: 0 };
}

function search(bodies, aspect, dist, skyR, reserve, pose, faceAz) {
  const sky = bodies.map((b) => azElDir(b.az, b.el).map((v) => v * skyR));
  const { minFov, maxFov } = fovRange(aspect);
  const m = FIT.margin;
  const yaws = pose ? [pose.yaw] : Array.from({ length: 90 }, (_, i) => i * 4);
  const elevs = pose ? [pose.elev] : FIT.elevs;
  let best = null;
  for (const yaw of yaws) {
    for (const elev of elevs) {
      const { pos, f, r, u } = poseBasis({ yaw, elev, dist });
      let lTop = -Infinity, yMin = Infinity, sTop = -Infinity, xMax = 0, ok = true;
      let lxMin = Infinity, lxMax = -Infinity;
      const skyXY = [];
      const take = (p, isSky) => {
        const d = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
        const z = dot(d, f);
        if (z <= 0.05) return (ok = false);
        const x = dot(d, r) / z, y = dot(d, u) / z;
        xMax = Math.max(xMax, Math.abs(x));
        yMin = Math.min(yMin, y);
        if (isSky) {
          sTop = Math.max(sTop, y);
          skyXY.push([x, y]);
        } else {
          lTop = Math.max(lTop, y);
          lxMin = Math.min(lxMin, x);
          lxMax = Math.max(lxMax, x);
        }
        return true;
      };
      for (const p of LANDER_PTS) if (!take(p, false)) break;
      if (ok) for (const p of sky) if (!take(p, true)) break;
      if (!ok) continue;
      // A body (and its label above it) hidden behind the lander is a poor view.
      const padX = 0.07 + 0.25 * (lxMax - lxMin);
      const hidden = skyXY.filter(([x, y]) => x > lxMin - padX && x < lxMax + padX && y < lTop + 0.12).length;
      // Narrowest field of view that fits, with the smallest lens shift that fits.
      for (let fov = minFov; fov <= maxFov + 1e-9; fov += 1) {
        const t = Math.tan((fov / 2) * D2R);
        if (xMax > t * aspect * (1 - m)) continue;
        const sLow = Math.max(0, lTop / t - (1 - m), sky.length ? sTop / t - (1 - 2 * reserve) : 0);
        const sHigh = Math.min(FIT.maxShift, yMin / t + (1 - m));
        if (sLow > sHigh) continue;
        const off = faceAz === null ? 0 : Math.abs(((yaw - faceAz + 540) % 360) - 180);
        const score = fov + 12 * sLow + 0.25 * Math.abs(elev - FIT.homeElev) + 0.02 * off + 9 * hidden;
        if (!best || score < best.score) best = { score, yaw, elev, fov, shift: sLow };
        break;
      }
    }
  }
  return best && { yaw: best.yaw, elev: best.elev, fov: best.fov, shift: best.shift };
}

// ───────────── Overhead shot ─────────────
// When the Sun or Earth is too high to frame with the whole lander (≳ 55°), the
// camera drops to eye height beside the lander and tilts up past it: the top of
// the lander rises from the bottom of the frame and the high sky fills the rest.

export const OVERHEAD = {
  eyeY: 0.75, // camera height above the ground
  dists: [4.5, 6, 8, 11], // horizontal distance from the lander
  maxFov: 100, // vertical
  maxHFov: 124,
};
// The lander's top must stay in frame: dish, deck rim, tanks.
const LANDER_TOP = [
  [-0.45, 3.55, -0.35], [0, 3.45, 0], [1.08, 2.23, 0], [-1.08, 2.23, 0], [0, 2.23, 1.08], [0, 2.23, -1.08],
];

/** Camera position and basis for an overhead shot: heading, upward pitch, distance. */
export function overheadBasis({ yaw, pitch, dist }) {
  const h = azElDir(yaw, 0);
  const cp = Math.cos(pitch * D2R), sp = Math.sin(pitch * D2R);
  const pos = [-h[0] * dist, OVERHEAD.eyeY, -h[2] * dist];
  const f = [h[0] * cp, sp, h[2] * cp];
  const r = [-h[2], 0, h[0]];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { pos, f, r, u };
}

/**
 * Overhead framing: keeps the top of the lander and the given bodies in view.
 * Same inputs as fitSurfaceCamera (no pose). Returns null if nothing sensible fits.
 * @returns {{yaw:number, pitch:number, dist:number, fov:number, kept:number, pos:number[], f:number[]} | null}
 */
export function fitOverhead({ bodies, aspect, skyR = 1400, topReserve = 0 }) {
  const order = [...bodies].sort((a, b) => b.priority - a.priority);
  for (let n = order.length; n >= 1; n--) {
    for (const reserve of [topReserve, topReserve * 0.6]) {
      const best = searchOverhead(order.slice(0, n), aspect, skyR, reserve);
      if (best) return { ...best, kept: n };
    }
  }
  return null;
}

function searchOverhead(bodies, aspect, skyR, reserve) {
  const m = FIT.margin;
  const maxT = Math.min(Math.tan((OVERHEAD.maxFov / 2) * D2R), Math.tan((OVERHEAD.maxHFov / 2) * D2R) / aspect);
  const sky = bodies.map((b) => azElDir(b.az, b.el).map((v) => v * skyR));
  // Look toward the bodies, give or take; their mean heading weighted toward the high one.
  let ex = 0, ez = 0;
  for (const b of bodies) {
    const w = b.priority + 0.2;
    ex += w * Math.sin(b.az * D2R);
    ez += w * Math.cos(b.az * D2R);
  }
  const mean = Math.atan2(ex, ez) / D2R;
  let best = null;
  for (let dy = -60; dy <= 60; dy += 4) {
    const yaw = (mean + dy + 360) % 360;
    for (const dist of OVERHEAD.dists) {
      for (let pitch = 8; pitch <= 72; pitch += 2) {
        const { pos, f, r, u } = overheadBasis({ yaw, pitch, dist });
        let need = 0, ok = true;
        const proj = (p) => {
          const d = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
          const z = dot(d, f);
          return z <= 0.05 ? null : [dot(d, r) / z, dot(d, u) / z];
        };
        for (const p of LANDER_TOP) {
          const q = proj(p);
          if (!q) { ok = false; break; }
          need = Math.max(need, Math.abs(q[0]) / (aspect * (1 - m)), -q[1] / (1 - m), q[1] / (1 - m));
        }
        if (!ok) continue;
        for (const p of sky) {
          const q = proj(p);
          if (!q) { ok = false; break; }
          need = Math.max(need, Math.abs(q[0]) / (aspect * (1 - m)), q[1] / (1 - 2 * reserve), -q[1] / (1 - m));
        }
        if (!ok || need > maxT) continue;
        const t = Math.max(need, Math.tan(30 * D2R)); // never narrower than 60°
        // Prefer: more of the lander in view, a narrower lens, then the lander a bit closer.
        let whole = 0;
        for (const p of LANDER_PTS) {
          const q = proj(p);
          if (q && Math.abs(q[0]) <= t * aspect && Math.abs(q[1]) <= t) whole++;
        }
        const fov = (2 * Math.atan(t)) / D2R;
        const score = fov - 2.2 * whole + 0.4 * dist + 0.03 * Math.abs(dy);
        if (!best || score < best.score) best = { score, yaw, pitch, dist, fov, pos, f };
      }
    }
  }
  return best && { yaw: best.yaw, pitch: best.pitch, dist: best.dist, fov: best.fov, pos: best.pos, f: best.f };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
