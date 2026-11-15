// Coordinate helpers shared by the 3D views.
import * as THREE from 'three';

const D2R = Math.PI / 180;

/**
 * Moon body-fixed (X → 0°E on equator, Z → north pole) mapped to three.js
 * (x = X, y = Z, z = −Y). This matches SphereGeometry's equirectangular UVs
 * when the texture's centre column is 0° longitude.
 */
export function bodyToThree(X, Y, Z) {
  return new THREE.Vector3(X, Z, -Y);
}

export function latLonToThree(latDeg, lonDeg, r = 1) {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  return bodyToThree(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)).multiplyScalar(r);
}

/** Local az/el at a surface site → unit direction in the Moon-fixed three frame. */
export function azElToMoonFixed(latDeg, lonDeg, azDeg, elDeg) {
  const la = latDeg * D2R, lo = lonDeg * D2R, az = azDeg * D2R, el = elDeg * D2R;
  const E = [-Math.sin(lo), Math.cos(lo), 0];
  const N = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const e = Math.cos(el) * Math.sin(az), n = Math.cos(el) * Math.cos(az), u = Math.sin(el);
  const v = [0, 1, 2].map((i) => e * E[i] + n * N[i] + u * U[i]);
  return bodyToThree(v[0], v[1], v[2]).normalize();
}

/** Local scene frame for the surface view: +x east, +y up, −z north. */
export function azElToLocal(azDeg, elDeg) {
  const az = azDeg * D2R, el = elDeg * D2R;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Spherical interpolation between unit vectors. */
export function slerpVec(a, b, t, out = new THREE.Vector3()) {
  const dot = Math.min(Math.max(a.dot(b), -1), 1);
  const th = Math.acos(dot);
  if (th < 1e-5) return out.copy(b);
  const s = Math.sin(th);
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * th) / s)
    .addScaledVector(b, Math.sin(t * th) / s)
    .normalize();
}

/** On-demand render loop that idles when nothing changes or when offscreen. */
export function renderLoop(container, draw) {
  let dirty = true;
  let visible = true;
  let anims = 0;
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) dirty = true;
  });
  io.observe(container);
  const tick = (now) => {
    requestAnimationFrame(tick);
    if (!visible) return;
    if (dirty || anims > 0) {
      dirty = false;
      draw(now);
    }
  };
  requestAnimationFrame(tick);
  return {
    invalidate: () => (dirty = true),
    hold: () => anims++,
    release: () => (anims = Math.max(0, anims - 1)),
  };
}
