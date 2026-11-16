// Hero 3D Moon globe. Lighting comes from the JPL Sun direction at the selected
// instant, so the terminator is real geometry, not decoration. Two great
// circles show where the Sun (gold) and Earth (blue) sit on the horizon.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { moonTextures, glowTexture, starfield } from './textures.js';
import { latLonToThree, slerpVec, easeInOut, renderLoop } from './geo.js';
import { loadMoonMaps } from './moonmaps.js';

const VIEW = {
  athena: { lat: -50, lon: 20 },
  blueGhost: { lat: 14, lon: 52 },
};
// Sites without a hand-tuned view: look at them a little off-centre, and never
// straight down a pole, so the terminator stays readable.
const viewFor = (site) =>
  VIEW[site.id] ?? { lat: THREE.MathUtils.clamp(site.lat * 0.62, -52, 52), lon: site.lonE - 9 };
const EXTRA_PIN = '__extra';
// Home screen: the Moon seen from its night side, so the sunlit part is a crescent across the
// top of the window and the headline sits over the dark disc. The Sun direction is the real one.
const HOME = {
  widthShare: 0.62, // Moon radius as a share of the window width
  heightShare: 0.78, // or of the height, whichever is larger (tall phone screens)
  limbAt: 0.075, // the top of the Moon sits this far down the window
  phaseDeg: 137, // angle Sun, Moon, camera. Larger is a thinner crescent
  sunBoost: 1.55, // the crescent is exposed a little brighter than the navigator's globe
  ambient: 0.1, // soft light on the home screen so the night side is not pure black
  lookYaw: 3.2, // degrees the pointer turns the view
  lookPitch: 1.5,
  driftYaw: 1.6, // degrees of slow drift, so the scene is never still
  driftPitch: 0.8,
  driftMs: 48000,
};
// How strongly the relief map bends the light. The map already holds slopes times four.
const RELIEF_SCALE = 0.75;
// Two looks. 'real' aims for a photograph: lunar reflectance, real mountains on the silhouette,
// earthshine on the night side. 'studio' is a soft pearl Moon in the site's unseen style.
const LOOKS = {
  real: { lunar: 0.8, studio: 0, relief: RELIEF_SCALE, exaggeration: 3, earthshine: 0.35, ambient: 0.035 },
  studio: { lunar: 0, studio: 1, relief: 0.3, exaggeration: 1.2, earthshine: 0.18, ambient: 0.16 },
};
const SUN_LIGHT = { color: 0xfff4e2, intensity: 3.2 };
// ── heatmap ── Where to land: a lat/lon grid of hours (red = hours / 72, alpha = has a value) tints the
// surface after lighting, so the day and night sides still read. The longitude comes from the
// mesh position with the same frame as latLonToThree, so the tint sits exactly under the pins.
const HEAT_PARS = `
uniform sampler2D uHeatMap;
uniform float uHeatOn;
uniform float uHeatNeed;
uniform vec2 uHeatGrid;
varying vec3 vHeatPos;
vec3 heatRamp(float t) {
  vec3 c0 = vec3(0.24, 0.10, 0.42), c1 = vec3(0.46, 0.13, 0.52), c2 = vec3(0.74, 0.20, 0.47), c3 = vec3(0.95, 0.56, 0.23), c4 = vec3(1.0, 0.95, 0.69);
  vec3 c = t < 0.25 ? mix(c0, c1, t / 0.25) : t < 0.5 ? mix(c1, c2, (t - 0.25) / 0.25) : t < 0.75 ? mix(c2, c3, (t - 0.5) / 0.25) : mix(c3, c4, (t - 0.75) / 0.25);
  return pow(c, vec3(2.2));
}`;
const HEAT_FRAGMENT = `
if (uHeatOn > 0.001) {
  vec3 hp = normalize(vHeatPos);
  float hLat = asin(clamp(hp.y, -1.0, 1.0));
  float hLon = atan(-hp.z, hp.x);
  vec2 huv = vec2(hLon / 6.28318531 + 0.5 / uHeatGrid.x, (hLat / 3.14159265 + 0.5) * (uHeatGrid.y - 1.0) / uHeatGrid.y + 0.5 / uHeatGrid.y);
  vec4 hs = texture2D(uHeatMap, huv);
  float known = smoothstep(0.35, 0.9, hs.a);
  float hv = clamp(hs.r / max(hs.a, 0.001), 0.0, 1.0);
  vec3 hSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float hDay = smoothstep(-0.05, 0.25, dot(nonPerturbedNormal, hSun));
  float hRelief = clamp(dot(normal, hSun) / max(dot(nonPerturbedNormal, hSun), 0.2), 0.65, 1.35);
  float hShade = mix(0.3, 1.0, hDay) * mix(1.0, hRelief, hDay * 0.6);
  // Keep the maria and craters readable through the tint.
  float hAlb = clamp(sqrt(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))) / 0.42, 0.55, 1.3);
  float hAlpha = mix(0.5, 0.72, smoothstep(0.0, 0.2, hv)) * known * uHeatOn;
  outgoingLight = mix(outgoingLight, heatRamp(hv) * 0.85 * hShade * mix(1.0, hAlb, 0.7), hAlpha);
  float hW = max(fwidth(hv), 0.0005);
  float hLine = (1.0 - smoothstep(0.6, 1.6, abs(hv - uHeatNeed) / hW)) * known * step(0.001, uHeatNeed) * uHeatOn;
  outgoingLight = mix(outgoingLight, vec3(0.2, 0.92, 1.0) * mix(0.45, 1.0, hDay), hLine * 0.9);
}`;
const AMBIENT = 0.035;

function greatCircle(color, dashed) {
  const pts = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(1.022));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.035, gapSize: 0.025, transparent: true, opacity: 0.95 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const line = new THREE.Line(g, m);
  if (dashed) line.computeLineDistances();
  return line;
}

function earthMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: `varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(mat3(modelMatrix)*normal); vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        vec3 p = normalize(vP)*3.0;
        float land = smoothstep(0.52,0.6, n3(p)*0.6 + n3(p*2.3)*0.4);
        float cloud = smoothstep(0.55,0.8, n3(p*3.1+7.0)*0.6 + n3(p*6.0)*0.4);
        vec3 col = mix(vec3(0.07,0.22,0.52), vec3(0.32,0.42,0.28), land);
        col = mix(col, vec3(0.95), cloud*0.85);
        float d = dot(normalize(vN), normalize(uSun));
        float lit = smoothstep(-0.08, 0.18, d);
        vec3 night = vec3(0.012,0.02,0.04);
        gl_FragColor = vec4(mix(night, col*1.15, lit), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ───────────── Travel path between sites ─────────────
// When the landing site changes, a dotted arc lifts off the old pin and draws
// itself to the new one along the great circle, its dots marching toward the
// destination, then fades. All placement happens in the vertex shader, so the
// arc is one draw call and costs nothing between site changes.
const PATH = {
  spacing: 0.032, // radians of arc between dots
  dotSize: 0.016, // world units (Moon radius = 1)
  headSize: 0.05,
  march: 1.7, // dot spacings per second the dots travel toward the new site
  hold: 1500, // ms the finished path stays before fading
  fade: 900, // ms
};

const pathVertex = `
  uniform vec3 uA; uniform vec3 uB; uniform float uOmega; uniform float uLift;
  uniform float uProgress; uniform float uPhase; uniform float uCount;
  uniform float uSize; uniform float uPxPerUnit; uniform float uHead;
  attribute float aIndex;
  varying float vT; varying float vAlpha;
  vec3 arc(float t) {
    float s = sin(uOmega);
    vec3 p = (sin((1.0 - t) * uOmega) * uA + sin(t * uOmega) * uB) / s;
    return normalize(p) * (1.022 + uLift * sin(3.14159265 * t));
  }
  void main() {
    float t = uHead > 0.5 ? uProgress : (aIndex + uPhase) / uCount;
    vT = t;
    // Reveal up to the drawing tip; soften both ends.
    float tip = uHead > 0.5 ? 1.0 : smoothstep(uProgress, uProgress - 0.04, t);
    float tail = smoothstep(0.0, 0.05, t);
    vAlpha = tip * tail;
    vec4 mv = modelViewMatrix * vec4(arc(clamp(t, 0.0, 1.0)), 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPxPerUnit / -mv.z;
  }`;

const pathFragment = `
  uniform vec3 uColor; uniform float uOpacity; uniform float uHead;
  varying float vT; varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0 || vAlpha <= 0.001) discard;
    float core = 1.0 - smoothstep(0.55, 1.0, d);
    float glow = uHead > 0.5 ? (1.0 - d) * (1.0 - d) : 0.0;
    float a = (uHead > 0.5 ? max(core * 0.9, glow) : core) * vAlpha * uOpacity;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

function createTravelPath(scene) {
  const MAX_DOTS = 160;
  const idx = new Float32Array(MAX_DOTS).map((_, i) => i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
  geo.setAttribute('aIndex', new THREE.BufferAttribute(idx, 1));
  const uniforms = {
    uA: { value: new THREE.Vector3(1, 0, 0) },
    uB: { value: new THREE.Vector3(0, 1, 0) },
    uOmega: { value: 1 },
    uLift: { value: 0.1 },
    uProgress: { value: 0 },
    uPhase: { value: 0 },
    uCount: { value: 10 },
    uSize: { value: PATH.dotSize },
    uPxPerUnit: { value: 500 },
    uHead: { value: 0 },
    uColor: { value: new THREE.Color(0xffffff) },
    uOpacity: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: pathVertex,
    fragmentShader: pathFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dots = new THREE.Points(geo, mat);
  dots.frustumCulled = false;
  dots.visible = false;

  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  headGeo.setAttribute('aIndex', new THREE.BufferAttribute(new Float32Array(1), 1));
  const headUniforms = { ...uniforms, uHead: { value: 1 }, uSize: { value: PATH.headSize }, uOpacity: { value: 0 } };
  const head = new THREE.Points(
    headGeo,
    new THREE.ShaderMaterial({
      uniforms: headUniforms,
      vertexShader: pathVertex,
      fragmentShader: pathFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  head.frustumCulled = false;
  head.visible = false;
  scene.add(dots, head);

  let anim = null;

  /** Start a path from unit vector a to unit vector b. */
  function start(a, b, now) {
    let omega = a.angleTo(b);
    if (omega < 0.01) return stop();
    const B = b.clone();
    if (Math.PI - omega < 0.01) {
      // Antipodes: any great circle works; bend through a perpendicular.
      const perp = new THREE.Vector3(0, 1, 0).cross(a);
      if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
      B.addScaledVector(perp.normalize(), 0.02).normalize();
      omega = a.angleTo(B);
    }
    const count = Math.min(MAX_DOTS, Math.max(6, Math.round(omega / PATH.spacing)));
    uniforms.uA.value.copy(a);
    uniforms.uB.value.copy(B);
    uniforms.uOmega.value = omega;
    uniforms.uLift.value = 0.04 + 0.22 * (omega / Math.PI);
    uniforms.uCount.value = count;
    geo.setDrawRange(0, count);
    dots.visible = head.visible = true;
    anim = { t0: now, draw: 700 + 700 * (omega / Math.PI) };
  }

  function stop() {
    anim = null;
    dots.visible = head.visible = false;
  }

  /** Per-frame update. Returns true while the path is on screen. */
  function tick(now) {
    if (!anim) return false;
    const el = now - anim.t0;
    const drawT = Math.min(el / anim.draw, 1);
    uniforms.uProgress.value = easeInOut(drawT);
    // March: dots slide toward the destination; dot i moves into dot i+1's place.
    uniforms.uPhase.value = ((el / 1000) * PATH.march) % 1;
    const fadeT = (el - anim.draw - PATH.hold) / PATH.fade;
    const opacity = fadeT <= 0 ? 1 : Math.max(0, 1 - fadeT);
    uniforms.uOpacity.value = opacity * 0.95;
    // The head is a comet tip while drawing, then a soft beacon on arrival that fades first.
    headUniforms.uProgress.value = uniforms.uProgress.value;
    headUniforms.uOpacity.value = drawT < 1 ? 1 : Math.max(0, 1 - (el - anim.draw) / 500);
    if (fadeT >= 1) stop();
    return true;
  }

  function setPxPerUnit(px) {
    uniforms.uPxPerUnit.value = px;
  }

  return { start, stop, tick, setPxPerUnit };
}

export function createGlobe(container, sites) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.9;
  controls.maxDistance = 6;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.6;
  // Don't hijack page scroll on the hero; zoom with pinch / ctrl-wheel only.
  controls.enableZoom = false;
  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const d = camera.position.length() * (1 + Math.sign(e.deltaY) * 0.08);
      camera.position.setLength(Math.min(Math.max(d, controls.minDistance), controls.maxDistance));
      loop.invalidate();
    },
    { passive: false },
  );

  // Moon
  const { map, bumpMap } = moonTextures();
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 512, 256),
    new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 0.9, roughness: 1, metalness: 0 }),
  );
  // Sunlight on the Moon is added here and not by a scene light. The relief map tilts the surface,
  // and a tilted slope past the day and night line would otherwise catch light it cannot see.
  const sunUniforms = {
    uLunar: { value: LOOKS.real.lunar },
    uStudio: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunColor: { value: new THREE.Color(SUN_LIGHT.color).multiplyScalar(SUN_LIGHT.intensity) },
  };
  // ── heatmap ── uniforms. A 1 x 1 empty map until the first grid arrives.
  const heatUniforms = {
    uHeatMap: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) },
    uHeatOn: { value: 0 },
    uHeatNeed: { value: 0 },
    uHeatGrid: { value: new THREE.Vector2(1, 1) },
  };
  heatUniforms.uHeatMap.value.needsUpdate = true;
  moon.material.dithering = true; // no visible steps in the dark side's slow falloff
  moon.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sunUniforms, heatUniforms); // ── heatmap ──
    shader.vertexShader = shader.vertexShader // ── heatmap ──
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeatPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeatPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;\nuniform float uLunar;\nuniform float uStudio;\n' + HEAT_PARS)
      .replace('#include <opaque_fragment>', HEAT_FRAGMENT + '\n#include <opaque_fragment>') // ── heatmap ──
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 sunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          // Ground that faces away from the Sun is in the Moon's own shadow, whatever its slope.
          float open = smoothstep(-0.015, 0.11, dot(nonPerturbedNormal, sunView));
          float cosI = max(dot(normal, sunView), 0.0);
          float cosE = max(dot(normal, geometryViewDir), 0.02);
          // The Moon is not a matte ball. Its dust scatters light so a full Moon stays bright to the edge
          // (Lommel-Seeliger), blended with plain matte shading as real lunar photometry does.
          float lunar = mix(cosI, 2.0 * cosI / (cosI + cosE), uLunar);
          vec3 realLight = uSunColor * BRDF_Lambert(material.diffuseColor) * lunar * open;
          // Studio: a pale pearl Moon, soft wrapped light and an iridescent rim.
          float lum = dot(material.diffuseColor, vec3(0.299, 0.587, 0.114));
          vec3 pearl = lum * vec3(1.0, 0.975, 0.96) * 1.35 + vec3(0.14, 0.13, 0.135);
          float wrapLit = pow(clamp((dot(normal, sunView) + 0.35) / 1.35, 0.0, 1.0), 1.6);
          float fres = pow(1.0 - cosE, 2.6);
          // Pearl rim: blush pink into lilac into peach, the site's pastels, never green.
          vec3 iri = mix(mix(vec3(1.0, 0.8, 0.88), vec3(0.8, 0.76, 1.0), smoothstep(0.15, 0.55, fres)), vec3(1.0, 0.86, 0.74), smoothstep(0.55, 0.95, fres));
          vec3 studioLight = uSunColor * BRDF_Lambert(pearl) * wrapLit * 1.15 + iri * fres * 0.22 * (0.35 + 0.65 * wrapLit);
          reflectedLight.directDiffuse += mix(realLight, studioLight, uStudio);
        }`,
      );
  };
  scene.add(moon);
  // The drawn texture above is only a fallback. The Moon stays hidden until NASA's maps load.
  moon.visible = false;
  loadMoonMaps(renderer)
    .then((maps) => {
      const { map: realMap, normalMap } = maps;
      const m = moon.material;
      m.map = realMap;
      m.bumpMap = null;
      m.normalMap = normalMap;
      m.normalScale.set(RELIEF_SCALE, RELIEF_SCALE);
      m.displacementMap = maps.heightMap;
      heightRange = maps.heightRange;
      applyLook();
      m.needsUpdate = true;
    })
    .catch((err) => console.error('NASA Moon maps unavailable, using the drawn texture', err))
    .finally(() => {
      moon.visible = true;
      document.body.classList.add('moon-ready');
      loop.invalidate();
    });

  // Graticule
  const grat = new THREE.Group();
  const gm = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 3) pts.push(latLonToThree(lat, lon, 1.021));
    grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gm));
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(latLonToThree(lat, lon, 1.021));
    grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gm));
  }
  scene.add(grat);

  // Terminator & Earth-horizon great circles
  const term = greatCircle(0xf2b33d, false);
  const limb = greatCircle(0x6cb4ff, true);
  scene.add(term, limb);

  // Lights
  const sun = new THREE.DirectionalLight(SUN_LIGHT.color, 0); // position only, see sunUniforms
  const earthshine = new THREE.DirectionalLight(0x9cc4ff, 0.08);
  scene.add(sun, sun.target, earthshine, earthshine.target);
  const ambient = new THREE.AmbientLight(0x8899aa, AMBIENT);
  scene.add(ambient);

  // Sun glow (far away along the sun direction)
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sunSprite.scale.setScalar(5);
  scene.add(sunSprite);

  // Earth
  const earthMat = earthMaterial();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(0.16, 48, 32), earthMat);
  scene.add(earth);
  const earthLabel = labelEl('Earth', 'lbl lbl-earth');
  const earthObj = new CSS2DObject(earthLabel);
  earthObj.position.set(0, 0.26, 0);
  earth.add(earthObj);

  scene.add(starfield(1600, 60, 5));

  const travel = createTravelPath(scene);

  // Site pins
  const pins = {};
  const pinGroup = new THREE.Group();
  scene.add(pinGroup);
  const UP = new THREE.Vector3(0, 1, 0);
  function placePin(pin, s) {
    const n = latLonToThree(s.lat, s.lonE, 1);
    pin.g.position.copy(n);
    pin.g.quaternion.setFromUnitVectors(UP, n.clone().normalize());
    pin.normal = n.clone().normalize();
    pin.lab.textContent = s.name;
  }
  function makePin(s) {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0035, 0.0035, 0.09, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    );
    stem.position.set(0, 0.045, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    head.position.set(0, 0.09, 0);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.036, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    g.add(stem, head, ring);
    const lab = labelEl(s.name, 'lbl lbl-site');
    const lo = new CSS2DObject(lab);
    lo.position.set(0, 0.12, 0);
    g.add(lo);
    pinGroup.add(g);
    const pin = { g, ring, lab, normal: new THREE.Vector3() };
    placePin(pin, s);
    return pin;
  }
  for (const s of Object.values(sites)) pins[s.id] = makePin(s);
  // One movable pin for any other site (more landing sites, custom coordinates).
  pins[EXTRA_PIN] = makePin({ name: '', lat: 0, lonE: 0 });
  pins[EXTRA_PIN].g.visible = false;

  function labelEl(text, cls) {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  }

  // State
  const state = {
    site: null,
    siteKey: null,
    siteDir: null, // unit vector of the current site, for the travel path
    sunDir: new THREE.Vector3(1, 0, 0),
    earthDir: new THREE.Vector3(0, 0, 1),
  };
  let sunAnim = null;
  let camAnim = null;

  function applyDirs() {
    const s = state.sunDir, e = state.earthDir;
    sun.position.copy(s).multiplyScalar(10);
    sunUniforms.uSunDir.value.copy(s);
    sunSprite.position.copy(s).multiplyScalar(30);
    earthshine.position.copy(e).multiplyScalar(10);
    // Earth seen from the Moon is full when it sits opposite the Sun, so earthshine is brightest then.
    earthshine.intensity = LOOKS[look].earthshine * (1 - Math.cos(s.angleTo(e))) / 2;
    earth.position.copy(e).multiplyScalar(3.1);
    earthMat.uniforms.uSun.value.copy(s);
    term.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s);
    limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), e);
    if (mode === 'home') setHomeBasis();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = 32;
    camera.updateProjectionMatrix();
    // Distance that fits the sphere (plus a margin) in the narrower axis.
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    fitDist = 1.12 / Math.sin(Math.min(vHalf, hHalf));
    if (mode === 'home') {
      // Zoom in and slide the view down, so only the top of the Moon shows. The canvas stays
      // the size of the window, so the horizon is drawn at full resolution.
      const radiusPx = ((h / 2) * Math.tan(Math.asin(1 / fitDist))) / Math.tan(vHalf);
      const target = Math.max(HOME.widthShare * w, HOME.heightShare * h);
      camera.zoom = target / radiusPx;
      camera.setViewOffset(w, h, 0, -(HOME.limbAt * h + target - h / 2), w, h);
    } else {
      camera.zoom = 1;
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    travel.setPxPerUnit(renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(vHalf)));
    controls.maxDistance = fitDist * 1.8;
    if (!camAnim && state.site) camera.position.setLength(fitDist);
    loop.invalidate();
  }
  let fitDist = 3.6;
  let mode = 'site';
  let look = 'real';
  let heightRange = null;
  const camDir = new THREE.Vector3();

  const loop = renderLoop(container, (now) => {
    if (sunAnim) {
      const t = Math.min((now - sunAnim.t0) / sunAnim.dur, 1);
      const k = easeInOut(t);
      slerpVec(sunAnim.s0, sunAnim.s1, k, state.sunDir);
      slerpVec(sunAnim.e0, sunAnim.e1, k, state.earthDir);
      applyDirs();
      if (t >= 1) {
        sunAnim = null;
        loop.release();
      }
    }
    if (camAnim) {
      const t = Math.min((now - camAnim.t0) / camAnim.dur, 1);
      const k = easeInOut(t);
      const dir = slerpVec(camAnim.d0, camAnim.d1, k);
      camera.position.copy(dir.multiplyScalar(camAnim.r0 + (camAnim.r1 - camAnim.r0) * k));
      if (t >= 1) {
        camAnim = null;
        loop.release();
      }
    }
    travel.tick(now);
    const pulse = 1 + 0.25 * Math.sin(now / 380);
    for (const [id, p] of Object.entries(pins)) {
      const active = id === state.site;
      p.ring.scale.setScalar(active ? pulse : 0.7);
      p.ring.material.opacity = active ? 0.9 : 0.35;
      p.lab.classList.toggle('is-active', active);
      // Hide labels for pins on the far side of the Moon.
      const facing = p.normal.dot(camDir.copy(camera.position).normalize()) > 0.08;
      // A neighbour's label would sit on top of the active one (the south pole sites).
      const crowded = !active && state.site !== null && p.normal.dot(pins[state.site].normal) > 0.97;
      p.lab.style.visibility = facing && p.g.visible && !crowded ? 'visible' : 'hidden';
    }
    if (mode === 'home') aimHome(now);
    else if (controls.update()) loop.invalidate();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });
  loop.hold(); // keep the active-site pulse alive

  controls.addEventListener('change', () => loop.invalidate());
  new ResizeObserver(resize).observe(container);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frameSite(site, animate) {
    const v = viewFor(site);
    const d1 = latLonToThree(v.lat, v.lon, 1).normalize();
    if (!animate || reduceMotion) {
      camera.position.copy(d1).multiplyScalar(fitDist);
      camera.lookAt(0, 0, 0);
      return;
    }
    if (!camAnim) loop.hold();
    camAnim = { t0: performance.now(), dur: 1400, d0: camera.position.clone().normalize(), d1, r0: camera.position.length(), r1: fitDist };
  }

  /**
   * @param {{site: {id, name, lat, lonE}, sunDir: THREE.Vector3, earthDir: THREE.Vector3, transition?: boolean}} p
   */
  function update({ site, sunDir, earthDir, transition }) {
    const siteKey = `${site.id}|${site.lat}|${site.lonE}`;
    if (siteKey !== state.siteKey) {
      const preset = Object.hasOwn(sites, site.id);
      // Dotted travel path from the previous site to this one.
      const to = latLonToThree(site.lat, site.lonE, 1).normalize();
      if (state.siteDir && !reduceMotion) travel.start(state.siteDir, to, performance.now());
      state.siteDir = to;
      pins[EXTRA_PIN].g.visible = !preset;
      if (!preset) placePin(pins[EXTRA_PIN], site);
      state.siteObj = site;
      if (mode === 'site') frameSite(site, state.siteKey !== null);
      state.siteKey = siteKey;
      state.site = preset ? site.id : EXTRA_PIN;
    }
    if (transition && !reduceMotion) {
      if (!sunAnim) loop.hold();
      sunAnim = { t0: performance.now(), dur: 1600, s0: state.sunDir.clone(), s1: sunDir.clone(), e0: state.earthDir.clone(), e1: earthDir.clone() };
    } else {
      if (sunAnim) {
        sunAnim = null;
        loop.release();
      }
      state.sunDir.copy(sunDir);
      state.earthDir.copy(earthDir);
      applyDirs();
    }
    loop.invalidate();
  }

  // Home view: where the camera sits and which way is up, from the Sun direction.
  const homeView = { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(), px: 0, py: 0, tx: 0, ty: 0 };
  const aim = new THREE.Vector3();
  function setHomeBasis() {
    const s = state.sunDir;
    const side = new THREE.Vector3().crossVectors(UP, s);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const phase = THREE.MathUtils.degToRad(HOME.phaseDeg);
    homeView.dir.copy(s).multiplyScalar(Math.cos(phase)).addScaledVector(side, Math.sin(phase)).normalize();
    // Up points at the Sun, so the lit crescent runs across the top.
    homeView.up.copy(s).addScaledVector(homeView.dir, -s.dot(homeView.dir)).normalize();
    homeView.right.crossVectors(homeView.up, homeView.dir).normalize();
  }
  function aimHome(now) {
    homeView.px += (homeView.tx - homeView.px) * 0.045;
    homeView.py += (homeView.ty - homeView.py) * 0.045;
    const swing = reduceMotion ? 0 : (now / HOME.driftMs) * Math.PI * 2;
    const yaw = THREE.MathUtils.degToRad(HOME.lookYaw * homeView.px + HOME.driftYaw * Math.sin(swing));
    const pitch = THREE.MathUtils.degToRad(HOME.lookPitch * homeView.py + HOME.driftPitch * Math.sin(swing * 0.73 + 1.1));
    aim.copy(homeView.dir).addScaledVector(homeView.right, Math.tan(yaw)).addScaledVector(homeView.up, Math.tan(pitch)).normalize();
    camera.position.copy(aim).multiplyScalar(fitDist);
    camera.up.copy(homeView.up);
    camera.lookAt(0, 0, 0);
  }

  /** 'home' turns the globe into the opening crescent. 'site' is the navigator's whole-Moon view. */
  function setMode(next) {
    if (next === mode) return;
    mode = next;
    if (camAnim) {
      camAnim = null;
      loop.release();
    }
    const isHome = mode === 'home';
    controls.enabled = !isHome;
    ambient.intensity = isHome ? HOME.ambient : LOOKS[look].ambient;
    sunUniforms.uSunColor.value.set(SUN_LIGHT.color).multiplyScalar(SUN_LIGHT.intensity * (isHome ? HOME.sunBoost : 1));
    for (const overlay of [grat, term, limb, earth, pinGroup]) overlay.visible = !isHome;
    applyHeatOn(); // ── heatmap ── never on the home crescent
    resize();
    if (isHome) {
      setHomeBasis();
      aimHome(performance.now());
    } else {
      camera.up.set(0, 1, 0);
      if (state.siteObj) frameSite(state.siteObj, false);
    }
    loop.invalidate();
  }

  /** Switch between the photographic Moon and the studio pearl. */
  function applyLook() {
    const L = LOOKS[look];
    sunUniforms.uLunar.value = L.lunar;
    sunUniforms.uStudio.value = L.studio;
    const m = moon.material;
    if (m.normalMap) m.normalScale.set(L.relief, L.relief);
    if (m.displacementMap && heightRange) {
      const k = L.exaggeration / heightRange.radiusM;
      m.displacementScale = (heightRange.maxM - heightRange.minM) * k;
      m.displacementBias = heightRange.minM * k;
    }
    if (mode !== 'home') ambient.intensity = L.ambient;
    applyDirs();
    loop.invalidate();
  }
  function setLook(next) {
    if (!LOOKS[next] || next === look) return;
    look = next;
    applyLook();
  }

  /** Pointer position across the window, each axis from -1 to 1. Turns the home view a little. */
  function setPointer(x, y) {
    homeView.tx = x;
    homeView.ty = -y;
  }

  // ── heatmap ──
  let heatOn = false;
  function applyHeatOn() {
    heatUniforms.uHeatOn.value = heatOn && mode !== 'home' ? 1 : 0;
  }
  /**
   * Show or hide the where-to-land tint. bytes: RGBA rows from the south pole up, cols from 0° E
   * eastward (see src/heatmap.js heatBytes). Leave bytes out to keep the current map.
   * @param {{on: boolean, bytes?: Uint8Array|null, rows?: number, cols?: number, needHours?: number, maxHours?: number}} p
   */
  function setHeatmap({ on, bytes, rows, cols, needHours, maxHours = 72 }) {
    if (bytes && rows > 0 && cols > 0 && bytes.length === rows * cols * 4) {
      const old = heatUniforms.uHeatMap.value;
      if (old.image.width === cols && old.image.height === rows) {
        old.image.data.set(bytes);
        old.needsUpdate = true;
      } else {
        const tex = new THREE.DataTexture(new Uint8Array(bytes), cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        heatUniforms.uHeatMap.value = tex;
        heatUniforms.uHeatGrid.value.set(cols, rows);
        old.dispose();
      }
    }
    if (Number.isFinite(needHours)) heatUniforms.uHeatNeed.value = Math.min(Math.max(needHours / maxHours, 0), 1);
    heatOn = Boolean(on);
    applyHeatOn();
    loop.invalidate();
  }

  // ── heatmap ── hover readout: where the pointer meets the Moon, by a ray and sphere test (no mesh raycast).
  let heatHover = null;
  const hoverRay = new THREE.Raycaster();
  const hoverNdc = new THREE.Vector2();
  const hoverSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const hoverHit = new THREE.Vector3();
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!heatHover || !heatOn || mode === 'home') return;
    const r = renderer.domElement.getBoundingClientRect();
    hoverNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    hoverRay.setFromCamera(hoverNdc, camera);
    if (!hoverRay.ray.intersectSphere(hoverSphere, hoverHit)) return heatHover(null);
    const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(hoverHit.y, -1, 1)));
    const lonE = (THREE.MathUtils.radToDeg(Math.atan2(-hoverHit.z, hoverHit.x)) + 360) % 360;
    heatHover({ lat, lonE, x: e.clientX - r.left, y: e.clientY - r.top });
  });
  renderer.domElement.addEventListener('pointerleave', () => heatHover?.(null));
  /** cb({lat, lonE, x, y}) while the pointer is over the Moon with the heatmap on, cb(null) when it leaves. */
  function onHeatHover(cb) {
    heatHover = cb;
  }

  /** Where a surface point lands on the page, in CSS pixels. For the heatmap checks. */
  function screenOf(lat, lonE) {
    const v = latLonToThree(lat, lonE, 1).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, front: v.z < 1 };
  }

  resize();
  return { update, setMode, setPointer, setLook, setHeatmap, screenOf, onHeatHover };
}
