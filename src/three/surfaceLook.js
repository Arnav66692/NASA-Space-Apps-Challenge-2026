// How the surface view looks: detailed ground with boulders and pebbles, a fine regolith normal map,
// gold foil that reflects the grey ground, a true-size Sun with glare, Earth with an atmosphere rim,
// the Milky Way, and a light grain and vignette. Everything is generated in code, no images.
// The Sun and Earth positions, the camera and the framing stay in surface.js and are unchanged.
// Written with an AI tool (Claude).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { rng, makeNoise3, fbm3 } from './textures.js';

const PAD_R = 3.5; // flat pad under the lander, metres
const DETAIL_END = 60; // terrain detail fades out from here
const FLAT_FROM = 95; // and is gone by here: the smooth reference horizon the model uses

// ───────────── Ground ─────────────

/** A crater field with sharp rims and ejecta, hummocky regolith, a flat pad and a smooth far horizon. */
export function detailedGround(groundR) {
  const r = rng(9);
  const noise = makeNoise3(17);
  const craters = [];
  // Many small craters, a few large ones: a power law, like the real surface.
  for (let i = 0; i < 260; i++) {
    const d = 5 + Math.pow(r(), 0.75) * 80;
    const a = r() * Math.PI * 2;
    const rad = 0.35 + Math.pow(r(), 4) * 11;
    craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rad, depth: 0.14 + r() * 0.2, fresh: r() });
  }
  const height = (x, z) => {
    const dist = Math.hypot(x, z);
    if (dist > FLAT_FROM) return 0;
    let h = 0;
    for (const c of craters) {
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx) > c.rad * 2.6 || Math.abs(dz) > c.rad * 2.6) continue;
      const d = Math.hypot(dx, dz) / c.rad;
      if (d < 1) h += c.depth * c.rad * 0.42 * (d * d - 1); // bowl
      const rim = c.depth * c.rad * (0.12 + 0.12 * c.fresh);
      h += rim * Math.exp(-((d - 1) ** 2) / 0.018); // sharp raised rim
      if (d > 1) h += rim * 0.35 * Math.exp(-(d - 1) * 2.2); // ejecta apron
    }
    // Hummocky regolith at two scales.
    h += (fbm3(noise, x * 0.07, 0.5, z * 0.07, 4) - 0.5) * 0.38;
    h += (fbm3(noise, x * 0.5 + 40, 1.5, z * 0.5, 3) - 0.5) * 0.06;
    const fadeIn = THREE.MathUtils.smoothstep(dist, PAD_R, PAD_R + 3);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(dist, DETAIL_END, FLAT_FROM);
    return h * fadeIn * fadeOut;
  };

  const rings = 190, segs = 340;
  const pos = new Float32Array((1 + rings * segs) * 3);
  const uv = new Float32Array((1 + rings * segs) * 2);
  let p = 3, q = 2;
  for (let i = 1; i <= rings; i++) {
    const rad = groundR * Math.pow(i / rings, 2.6);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      pos[p++] = x;
      pos[p++] = height(x, z);
      pos[p++] = z;
      uv[q++] = x / 7;
      uv[q++] = z / 7;
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, a1 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, height };
}

/** Tileable normal map of fine regolith: small pits, clods and grain, for raking light to catch. */
export function regolithNormal(size = 512) {
  const TAU = Math.PI * 2;
  const hgt = new Float32Array(size * size);
  const r = rng(31);
  // A sum of waves with whole-number frequencies tiles exactly and has no preferred direction.
  const waves = [];
  for (let k = 0; k < 90; k++) {
    const f = 2 + Math.floor(Math.pow(r(), 1.6) * 40);
    const a = r() * TAU;
    waves.push({ kx: Math.round(Math.cos(a) * f), ky: Math.round(Math.sin(a) * f), ph: r() * TAU, amp: 1 / Math.pow(f, 1.25) });
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let n = 0;
      for (const w of waves) n += w.amp * Math.sin(((w.kx * i + w.ky * j) / size) * TAU + w.ph);
      hgt[j * size + i] = n * 0.35;
    }
  }
  // Small pits and clods.
  for (let k = 0; k < 900; k++) {
    const cx = r() * size, cy = r() * size, rad = 1.5 + Math.pow(r(), 3) * 9, s = r() < 0.6 ? -1 : 0.7;
    const R = Math.ceil(rad * 1.4);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / rad;
        if (d > 1.4) continue;
        const x = (Math.floor(cx + dx) + size) % size, y = (Math.floor(cy + dy) + size) % size;
        hgt[y * size + x] += s * 0.05 * (d < 1 ? 1 - d * d : -0.25 * (1.4 - d) / 0.4);
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  const strength = 9;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const k = (y * size + x) * 4;
      img.data[k] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[k + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A lumpy rock, the same shape reused for every boulder at a different size and turn. */
function rockGeometry(seed, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const noise = makeNoise3(seed);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 0.72 + 0.55 * fbm3(noise, v.x * 1.3 + 4, v.y * 1.3 + 4, v.z * 1.3 + 4, 4);
    v.multiplyScalar(k);
    v.y *= 0.62; // flatter than tall, like weathered boulders
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Boulders and pebbles, half buried. At a low Sun each throws a shadow many times its height. */
export function scatterRocks(height, normalMap) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x96938c, roughness: 1, metalness: 0, normalMap, normalScale: new THREE.Vector2(0.35, 0.35) });
  const r = rng(77);
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const place = (mesh, count, near, far, minS, maxS, pow, casts = true) => {
    let n = 0;
    while (n < count) {
      const d = near + Math.pow(r(), 0.8) * (far - near);
      const a = r() * Math.PI * 2;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const s = minS + Math.pow(r(), pow) * (maxS - minS);
      euler.set(r() * 0.5, r() * Math.PI * 2, r() * 0.5);
      quat.setFromEuler(euler);
      m.compose(new THREE.Vector3(x, height(x, z) - s * 0.28, z), quat, new THREE.Vector3(s * (0.8 + r() * 0.5), s, s * (0.8 + r() * 0.5)));
      mesh.setMatrixAt(n++, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = casts;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  place(new THREE.InstancedMesh(rockGeometry(5, 2), mat, 170), 170, PAD_R + 2, 70, 0.1, 0.7, 5);
  place(new THREE.InstancedMesh(rockGeometry(8, 1), mat, 900), 900, PAD_R + 0.6, 20, 0.02, 0.08, 2, false);
  return group;
}

// ───────────── Lander materials ─────────────

/** Crinkled foil normal map: the creased gold blanket on real landers. */
function foilNormal(size = 256) {
  const r = rng(51);
  const hgt = new Float32Array(size * size);
  // Random creases: soft ridges along random lines, wrapped so the map tiles.
  for (let k = 0; k < 260; k++) {
    const x0 = r() * size, y0 = r() * size, ang = r() * Math.PI, w = 0.8 + r() * 2.2, s = (r() - 0.5) * 0.6;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let px = x - x0, py = y - y0;
        px -= size * Math.round(px / size);
        py -= size * Math.round(py / size);
        const along = px * dx + py * dy;
        if (Math.abs(along) > size * (0.04 + 0.1 * Math.abs(s))) continue;
        const across = -px * dy + py * dx;
        hgt[y * size + x] += s * Math.exp(-(across * across) / (w * w));
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * 1.6, ny = (at(x, y - 1) - at(x, y + 1)) * 1.6;
      const l = Math.hypot(nx, ny, 1);
      const k = (y * size + x) * 4;
      img.data[k] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[k + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.5, 2);
  return t;
}

/** Solar cells: a dark blue grid with thin silver lines. */
function cellTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c1630';
  ctx.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const g = ctx.createLinearGradient(x * 32, y * 32, x * 32 + 32, y * 32 + 32);
      g.addColorStop(0, '#1b2f5c');
      g.addColorStop(1, '#0f1d3d');
      ctx.fillStyle = g;
      ctx.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
    }
  }
  ctx.strokeStyle = 'rgba(200,210,225,0.35)';
  ctx.lineWidth = 0.6;
  for (let x = 0; x <= 256; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Lighting for shiny parts: a dark sky above and sunlit grey ground below, the way metal on the Moon
 * mostly reflects the ground. The Sun's own highlight comes from the scene's sunlight.
 */
function lunarEnvironment(renderer) {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD;
        void main(){
          float y = vD.y;
          vec3 ground = vec3(0.30, 0.29, 0.27) * (0.6 + 0.4 * smoothstep(-1.0, -0.05, y));
          vec3 sky = vec3(0.004, 0.005, 0.008);
          vec3 band = vec3(0.55, 0.53, 0.5) * exp(-pow(y / 0.035, 2.0)); // bright horizon line
          gl_FragColor = vec4(mix(ground, sky, smoothstep(-0.02, 0.02, y)) + band, 1.0);
        }`,
    }),
  );
  env.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

/** Materials for the lander, keyed the way buildLander in surface.js uses them. */
export function landerMaterials(renderer) {
  const envMap = lunarEnvironment(renderer);
  const foilN = foilNormal();
  return {
    foil: new THREE.MeshStandardMaterial({ color: 0xd6ad55, metalness: 1, roughness: 0.2, normalMap: foilN, normalScale: new THREE.Vector2(0.8, 0.8), envMap, envMapIntensity: 0.95 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe9e7e2, metalness: 0.05, roughness: 0.55, envMap, envMapIntensity: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.7, roughness: 0.45, envMap, envMapIntensity: 0.9 }),
    panel: new THREE.MeshStandardMaterial({ map: cellTexture(), metalness: 0.5, roughness: 0.22, envMap, envMapIntensity: 1.2 }),
    dish: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide, envMap, envMapIntensity: 0.6 }),
  };
}

// ───────────── Sky ─────────────

/** The Sun's disc at its true size, bright enough to bloom. */
export function sunDisc(skyR) {
  const r = skyR * Math.tan(THREE.MathUtils.degToRad(0.27));
  return new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(12), depthWrite: false }));
}

/** The Milky Way: a soft band of faint stars across the sky, plus a few bright ones. */
export function milkyWay(radius, seed = 5) {
  const r = rng(seed);
  const pos = [], col = [];
  // A band around a tilted great circle.
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0.4, 0.2));
  const v = new THREE.Vector3();
  for (let i = 0; i < 5500; i++) {
    const a = r() * Math.PI * 2;
    const spread = (r() + r() + r() - 1.5) * 0.11; // a bell across the band
    v.set(Math.cos(a), spread, Math.sin(a)).normalize().applyQuaternion(tilt).multiplyScalar(radius);
    if (v.y < -50) continue;
    pos.push(v.x, v.y, v.z);
    const core = Math.exp(-((a - 1.2) ** 2) / 1.5); // brighter toward the galactic centre
    const b = (0.05 + 0.22 * Math.pow(r(), 4)) * (0.5 + 0.9 * core);
    col.push(b * 1.02, b, b * 0.95);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.9, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
}

/** A thin blue rim on Earth's sunlit edge, added to the fragment shader surface.js already uses. */
export function earthShader() {
  return {
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main(){ vN = normalize(mat3(modelMatrix)*normal); vP = position;
        vec4 w = modelMatrix*vec4(position,1.0); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP; varying vec3 vV;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n3(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 n = normalize(vN);
        vec3 p = normalize(vP)*2.6;
        float land = smoothstep(0.5, 0.56, fbm(p));
        float cloud = smoothstep(0.5, 0.78, fbm(p*1.7+7.0));
        float ice = smoothstep(0.82, 0.92, abs(normalize(vP).y));
        vec3 col = mix(vec3(0.03,0.12,0.36), mix(vec3(0.36,0.33,0.22), vec3(0.2,0.3,0.16), fbm(p*3.0)), land);
        col = mix(col, vec3(0.92), max(cloud*0.9, ice));
        float d = dot(n, normalize(uSun));
        float lit = smoothstep(-0.05, 0.15, d);
        float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 3.0);
        vec3 atmo = vec3(0.35, 0.6, 1.0) * rim * smoothstep(-0.2, 0.3, d) * 1.6;
        gl_FragColor = vec4(mix(vec3(0.004,0.006,0.012), col*1.6, lit) + atmo, 1.0);
        #include <colorspace_fragment>
      }`,
  };
}

// ───────────── Post-processing ─────────────

const GRAIN = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVignette: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain; uniform float uVignette; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      c.rgb += (hash(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

/** Bloom for the Sun and bright highlights, then tone mapping, then grain and vignette. */
export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 2 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grain = new ShaderPass(GRAIN);
  composer.addPass(grain);
  let frame = 0;
  return {
    render() {
      grain.uniforms.uTime.value = (frame++ % 64) * 0.37;
      composer.render();
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
  };
}
