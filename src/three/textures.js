// Original procedural lunar textures (no external imagery).
import * as THREE from 'three';

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 3D value noise
function makeNoise3(seed) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = r();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const sm = (t) => t * t * (3 - 2 * t);
  const h = (x, y, z) => vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf),
      zf,
    );
  };
}

export function fbm3(noise, x, y, z, oct = 5) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f, z * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

/** Equirectangular albedo + bump maps for the globe. */
export function moonTextures(w = 2048, h = 1024) {
  const noise = makeNoise3(7);
  const lw = 512, lh = 256;
  const base = document.createElement('canvas');
  base.width = lw;
  base.height = lh;
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(lw, lh);
  for (let j = 0; j < lh; j++) {
    const lat = (0.5 - (j + 0.5) / lh) * Math.PI;
    for (let i = 0; i < lw; i++) {
      const lon = ((i + 0.5) / lw) * 2 * Math.PI - Math.PI;
      const cx = Math.cos(lat) * Math.cos(lon), cy = Math.cos(lat) * Math.sin(lon), cz = Math.sin(lat);
      const n = fbm3(noise, cx * 3 + 10, cy * 3 + 10, cz * 3 + 10, 5);
      const v = Math.round(118 + (n - 0.5) * 70);
      const k = (j * lw + i) * 4;
      img.data[k] = v;
      img.data[k + 1] = v - 2;
      img.data[k + 2] = v - 5;
      img.data[k + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);

  const albedo = document.createElement('canvas');
  albedo.width = w;
  albedo.height = h;
  const actx = albedo.getContext('2d');
  actx.imageSmoothingQuality = 'high';
  actx.drawImage(base, 0, 0, w, h);

  const bump = document.createElement('canvas');
  bump.width = w;
  bump.height = h;
  const hctx = bump.getContext('2d');
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, w, h);

  const r = rng(42);
  const crater = (ctx, cx, cy, rx, ry, kind) => {
    for (const dx of [-w, 0, w]) {
      ctx.save();
      ctx.translate(cx + dx, cy);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      if (kind === 'h') {
        g.addColorStop(0, 'rgba(70,70,70,0.75)');
        g.addColorStop(0.7, 'rgba(95,95,95,0.5)');
        g.addColorStop(0.86, 'rgba(185,185,185,0.6)');
        g.addColorStop(1, 'rgba(128,128,128,0)');
      } else {
        g.addColorStop(0, 'rgba(0,0,0,0.10)');
        g.addColorStop(0.8, 'rgba(0,0,0,0.04)');
        g.addColorStop(0.9, 'rgba(255,255,255,0.10)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };
  for (let n = 0; n < 4200; n++) {
    // Uniform on sphere
    const z = r() * 2 - 1;
    const lat = Math.asin(z);
    const lon = r() * 2 * Math.PI;
    const size = 0.002 + Math.pow(r(), 7) * 0.045; // radians
    const ry = (size / Math.PI) * h;
    const rx = Math.min(ry / Math.max(Math.cos(lat), 0.04), w / 4);
    const cx = (lon / (2 * Math.PI)) * w;
    const cy = (0.5 - lat / Math.PI) * h;
    crater(hctx, cx, cy, rx, ry, 'h');
    crater(actx, cx, cy, rx, ry, 'a');
  }

  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bumpMap = new THREE.CanvasTexture(bump);
  return { map, bumpMap };
}

/** Tileable regolith texture for the surface scene. */
export function regolithTexture(size = 512) {
  const noise = makeNoise3(3);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const TAU = Math.PI * 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // Map the square to a torus so the noise tiles seamlessly.
      const u = (i / size) * TAU, v = (j / size) * TAU;
      const n = fbm3(noise, Math.cos(u) * 2 + 5, Math.sin(u) * 2 + 5, Math.cos(v) * 2 + Math.sin(v) * 2, 6);
      const grain = (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1;
      const val = Math.max(0, Math.min(255, 128 + (n - 0.5) * 120 + grain * 14));
      const k = (j * size + i) * 4;
      img.data[k] = val;
      img.data[k + 1] = val;
      img.data[k + 2] = val - 3;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Soft radial glow sprite texture. */
export function glowTexture(inner = 'rgba(255,240,200,1)', mid = 'rgba(255,190,90,0.35)') {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(0.08, inner);
  g.addColorStop(0.18, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function starfield(count, radius, seed = 11, minY = -Infinity) {
  const r = rng(seed);
  const pos = [];
  const col = [];
  while (pos.length / 3 < count) {
    const z = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const p = [s * Math.cos(a) * radius, z * radius, s * Math.sin(a) * radius];
    if (p[1] < minY) continue;
    pos.push(...p);
    const b = 0.35 + Math.pow(r(), 3) * 0.65;
    const warm = r() < 0.2;
    col.push(b, b * (warm ? 0.92 : 1), b * (warm ? 0.8 : 1.04));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  return new THREE.Points(g, m);
}
