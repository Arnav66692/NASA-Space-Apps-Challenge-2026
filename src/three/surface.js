// Surface view: a generic lander on a smooth reference horizon, with the Sun and
// Earth placed by JPL azimuth/elevation. At Athena's 4° Sun the lander's shadow
// runs ~30 m across the ground — the long shadow the project is named for.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { regolithTexture, glowTexture, starfield, rng } from './textures.js';
import { azElToLocal, renderLoop, easeInOut } from './geo.js';
import { fitSurfaceCamera, fitOverhead, poseBasis, FIT } from './surfaceFrame.js';
import { fmtDeg } from '../format.js';
import { detailedGround, regolithNormal, scatterRocks, sunDisc, milkyWay, earthShader, createPost, buildDetailedLander, realLanderMaterials, studioLanderMaterials, applyLanderMaterials } from './surfaceLook.js';

const SKY_R = 1400;
const GROUND_R = 1100;
const SUN_RADIUS_DEG = 0.27;

function groundGeometry() {
  const rings = 150, segs = 256;
  const pos = [], uv = [], idx = [];
  const r = rng(9);
  const craters = [];
  for (let i = 0; i < 70; i++) {
    const d = 6 + Math.pow(r(), 0.7) * 70;
    const a = r() * Math.PI * 2;
    craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rad: 0.6 + Math.pow(r(), 3) * 7, depth: 0.12 + r() * 0.25 });
  }
  const height = (x, z) => {
    const dist = Math.hypot(x, z);
    if (dist > 95) return 0;
    let h = 0;
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.rad;
      if (d < 1) h += c.depth * c.rad * 0.35 * (d * d - 1);
      h += c.depth * c.rad * 0.18 * Math.exp(-((d - 1) ** 2) / 0.04);
    }
    h += 0.06 * Math.sin(x * 0.7) * Math.cos(z * 0.6) + 0.04 * Math.sin(x * 1.9 + z * 1.3);
    const fadeIn = Math.min(Math.max((dist - 3.5) / 3, 0), 1); // flat pad under the lander
    const fadeOut = 1 - Math.min(Math.max((dist - 60) / 35, 0), 1); // smooth reference horizon
    return h * fadeIn * fadeOut;
  };
  pos.push(0, 0, 0);
  uv.push(0, 0);
  for (let i = 1; i <= rings; i++) {
    const rad = GROUND_R * Math.pow(i / rings, 2.4);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      pos.push(x, height(x, z), z);
      uv.push(x / 7, z / 7);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, a1 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, height };
}

/**
 * Regolith material that hides the texture's repeat: two samples at unrelated
 * scales and rotations, contrast-restored, under a slow brightness variation.
 */
function groundMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x9a968f, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 tA = texture2D(map, vMapUv);
        vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.381 + vec2(0.37, 0.11);
        vec4 tB = texture2D(map, uvB);
        vec3 detail = (tA.rgb + tB.rgb) * 0.5;
        detail = max(vec3(0.0), (detail - 0.21) * 1.38 + 0.21); // averaging halves contrast; restore it
        float macro = texture2D(map, mat2(0.6, 0.8, -0.8, 0.6) * vMapUv * 0.047 + vec2(0.5, 0.2)).r;
        detail *= 0.82 + 0.36 * smoothstep(0.12, 0.34, macro);
        diffuseColor *= vec4(detail, 1.0);
      #endif`,
    );
  };
  return mat;
}

function buildLander(mats) {
  const L = new THREE.Group();
  const { foil, white, dark, panel } = mats;
  const add = (m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    L.add(m);
    return m;
  };

  const body = add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.05, 1.2, 8), foil));
  body.position.y = 1.55;
  const deck = add(new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.08, 8), white));
  deck.position.y = 2.19;
  const skirt = add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.8, 0.25, 8), dark));
  skirt.position.y = 0.83;
  const bell = add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 0.35, 20, 1, true), dark));
  bell.position.y = 0.55;
  for (let i = 0; i < 2; i++) {
    const tank = add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), white));
    tank.position.set(i ? 0.45 : -0.45, 2.4, 0.3);
  }
  // Legs
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const top = new THREE.Vector3(Math.cos(a) * 0.95, 1.25, Math.sin(a) * 0.95);
    const foot = new THREE.Vector3(Math.cos(a) * 2.0, 0.08, Math.sin(a) * 2.0);
    const len = top.distanceTo(foot);
    const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8), white));
    leg.position.copy(top).add(foot).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(top).normalize());
    const strut = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), white));
    const mid = top.clone().lerp(foot, 0.55);
    const anchor = new THREE.Vector3(Math.cos(a) * 0.85, 0.8, Math.sin(a) * 0.85);
    strut.position.copy(mid).add(anchor).multiplyScalar(0.5);
    strut.scale.y = mid.distanceTo(anchor);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), anchor.clone().sub(mid).normalize());
    const pad = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 16), white));
    pad.position.copy(foot);
  }
  // Solar wing
  const wing = new THREE.Group();
  const p = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.04, 0.9), panel);
  p.castShadow = p.receiveShadow = true;
  p.position.x = 1.1;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), white);
  arm.rotation.z = Math.PI / 2;
  arm.position.x = 0.2;
  arm.castShadow = true;
  wing.add(p, arm);
  wing.position.set(0.85, 2.0, -0.2);
  wing.rotation.z = 0.35;
  L.add(wing);
  // Dish antenna on a mast — re-aimed at Earth every update.
  const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8), white));
  mast.position.set(-0.45, 2.65, -0.35);
  const dish = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const x = (i / 12) * 0.42;
    prof.push(new THREE.Vector2(x, x * x * 1.2));
  }
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), mats.dish);
  bowl.rotation.x = Math.PI / 2; // lathe axis +y → dish opens toward +z
  bowl.castShadow = true;
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), dark);
  feed.rotation.x = Math.PI / 2;
  feed.position.z = 0.16;
  dish.add(bowl, feed);
  dish.position.set(-0.45, 3.12, -0.35);
  L.add(dish);
  return { group: L, dish };
}

export function createSurface(container) {
  const wrap = container.parentElement;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // the post passes run at this resolution too
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x020306, 1);
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();

  // ───────────── Camera: orbits the lander; a vertical lens shift makes room for a high sky ─────────────
  const TARGET = new THREE.Vector3(0, FIT.targetY, 0);
  const DIST = { min: 6, max: 28 };
  const homeDist = () => (container.clientWidth < 520 ? 18 : 15);
  const EYE_CLEARANCE = 0.6; // metres the camera keeps above the ground under it

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
  let lensShift = 0; // in half-heights; positive moves the picture up (the lander down)
  const baseProjection = camera.updateProjectionMatrix.bind(camera);
  camera.updateProjectionMatrix = () => {
    baseProjection();
    // Off-axis frustum: same as top/bottom = t(1 ± s). Verticals stay vertical.
    camera.projectionMatrix.elements[9] = lensShift;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enablePan = false;
  controls.enableZoom = false; // zoom: buttons, or ctrl/⌘ + wheel (below)
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = DIST.min;
  controls.maxDistance = DIST.max;
  controls.minPolarAngle = THREE.MathUtils.degToRad(38); // no steep top-down views
  controls.maxPolarAngle = THREE.MathUtils.degToRad(95); // the ground clamp below does the rest

  /** Heading (azimuth looked toward), elevation above the lander centre, distance. */
  function currentPose() {
    const off = camera.position.clone().sub(TARGET);
    const dist = off.length();
    return {
      yaw: (THREE.MathUtils.radToDeg(Math.atan2(-off.x, off.z)) + 360) % 360,
      elev: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(off.y / dist, -1, 1))),
      dist,
    };
  }
  function placeCamera(pose) {
    camera.position.fromArray(poseBasis(pose).pos);
  }

  // Ground
  const tex = regolithTexture();
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const { geometry: groundGeo, height: groundHeight } = detailedGround(GROUND_R);
  const groundMat = groundMaterial(tex);
  const regolithN = regolithNormal();
  groundMat.normalMap = regolithN;
  groundMat.normalScale.set(0.5, 0.5);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(scatterRocks(groundHeight, regolithN));

  /** Keep the eye above the terrain directly under it (crater rims included). */
  function clampToGround() {
    const floor = groundHeight(camera.position.x, camera.position.z) + EYE_CLEARANCE;
    if (camera.position.y >= floor) return false;
    camera.position.y = floor;
    camera.lookAt(camAnim ? lookNow : controls.target);
    return true;
  }

  // Stars (only above the horizon; the ground hides the rest anyway)
  scene.add(starfield(2600, SKY_R * 1.4, 21, -50));
  scene.add(milkyWay(SKY_R * 1.38));

  // Horizon ring & cardinal labels
  const ringPts = [];
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * (GROUND_R - 5), 0.5, Math.sin(a) * (GROUND_R - 5)));
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 })));
  const cardinal = [
    [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'],
  ];
  for (const [az, name] of cardinal) {
    const d = document.createElement('div');
    d.className = `lbl lbl-cardinal ${name.length === 1 ? 'major' : ''}`;
    d.textContent = name;
    const o = new CSS2DObject(d);
    o.position.copy(azElToLocal(az, 0).multiplyScalar(GROUND_R * 0.9)).setY(3);
    scene.add(o);
  }

  // Lander
  // Two looks for the lander and its ground: 'real' and the soft 'studio' clay of the site's style.
  const LANDER_LOOKS = { real: realLanderMaterials(renderer), studio: studioLanderMaterials(renderer) };
  const { group: lander, dish } = buildDetailedLander(LANDER_LOOKS.real);
  scene.add(lander);

  // Lights
  const sunLight = new THREE.DirectionalLight(0xfffaf2, 3.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 420 });
  sunLight.shadow.bias = -0.0003;
  sunLight.shadow.normalBias = 0.05;
  sunLight.shadow.radius = 2.5;
  scene.add(sunLight, sunLight.target);
  const earthLight = new THREE.DirectionalLight(0xa9c8ff, 0.0);
  scene.add(earthLight, earthLight.target);
  const ambient = new THREE.HemisphereLight(0x8090a8, 0x101012, 0.05);
  scene.add(ambient);

  // Sun & Earth in the sky
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sunSprite.scale.setScalar(150);
  sunSprite.material.opacity = 0.7;
  scene.add(sunSprite);
  const sunCore = sunDisc(SKY_R);
  scene.add(sunCore);
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3() } },
    ...earthShader(),
  });
  // Earth spans ~1.9° from the Moon; drawn ~1.7× larger for legibility.
  const earth = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * Math.tan(THREE.MathUtils.degToRad(0.95)) * 1.7, 48, 32), earthMat);
  scene.add(earth);
  const earthHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(150,200,255,0.5)', 'rgba(90,150,255,0.12)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  earthHalo.scale.setScalar(150);
  scene.add(earthHalo);

  const mkLabel = (cls) => {
    const d = document.createElement('div');
    d.className = `lbl ${cls}`;
    const o = new CSS2DObject(d);
    scene.add(o);
    return { d, o };
  };
  const sunLbl = mkLabel('lbl-body lbl-sun');
  const earthLbl = mkLabel('lbl-body lbl-earth');

  // ───────────── Overlay controls: zoom, recentre, back-to-lander, sky dome ─────────────
  const ctrl = document.createElement('div');
  ctrl.className = 'surf-ctrl';
  ctrl.innerHTML = `
    <button type="button" data-z="in" aria-label="Zoom in">${svgIcon('M12 5v14M5 12h14')}</button>
    <button type="button" data-z="out" aria-label="Zoom out">${svgIcon('M5 12h14')}</button>
    <button type="button" data-z="home" aria-label="Recentre on the lander">${svgIcon('M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6')}</button>`;
  wrap.appendChild(ctrl);
  ctrl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (!b) return;
    if (b.dataset.z === 'in') zoomBy(1 / ZOOM_STEP);
    else if (b.dataset.z === 'out') zoomBy(ZOOM_STEP);
    else recentre();
  });

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'sky-back';
  backBtn.hidden = true;
  backBtn.innerHTML = '<span aria-hidden="true">↓</span> Back to lander';
  backBtn.addEventListener('click', () => backToLander());
  wrap.appendChild(backBtn);

  const dome = createSkyDome(wrap);

  // Edge markers: when a body that is up sits off screen, a chip on the frame's
  // edge points toward it. Clicking it turns toward that body.
  const edgeTags = {};
  for (const body of ['sun', 'earth']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `edge-tag edge-${body}`;
    b.hidden = true;
    b.addEventListener('click', () => focusBody(body));
    wrap.appendChild(b);
    edgeTags[body] = b;
  }
  const projected = new THREE.Vector3();
  const hudEl = wrap.querySelector('.surface-hud');
  const hudBottom = () => (hudEl ? hudEl.offsetTop + hudEl.offsetHeight : 0);
  const domeRect = () => {
    const el = dome.el;
    return el.hidden ? null : { l: el.offsetLeft, t: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight };
  };

  function placeEdgeTags() {
    const w = container.clientWidth, h = container.clientHeight;
    const dr = domeRect();
    let placed = null;
    for (const [body, el] of Object.entries(edgeTags)) {
      const s = lastSample?.[body];
      if (!s || s.el <= 0 || !w) {
        el.hidden = true;
        continue;
      }
      projected.copy(azElToLocal(s.az, s.el)).multiplyScalar(SKY_R).project(camera);
      // project() mirrors points behind the camera; flip them back.
      const behind = projected.z > 1;
      let x = behind ? -projected.x : projected.x;
      let y = behind ? -projected.y : projected.y;
      if (!behind && Math.abs(x) <= 1 && Math.abs(y) <= 1) {
        el.hidden = true;
        continue;
      }
      if (behind && Math.abs(x) < 1e-3 && Math.abs(y) < 1e-3) x = 1;
      // Clamp the direction from screen centre to an inset rectangle below the HUD.
      const ax = (w / 2 - 70) / (w / 2);
      const ayTop = (h / 2 - Math.max(30, hudBottom() + 18)) / (h / 2), ayBot = (h / 2 - 64) / (h / 2);
      const ay = y > 0 ? ayTop : ayBot;
      const k = Math.min(ax / Math.abs(x || 1e-6), ay / Math.abs(y || 1e-6));
      x *= k;
      y *= k;
      const angle = Math.atan2(-y * h, x * w); // screen angle, y down
      let px = ((x + 1) / 2) * w, py = ((1 - y) / 2) * h;
      // Keep clear of the sky dome.
      if (dr && px > dr.l - 70 && px < dr.r + 70 && py > dr.t - 16 && py < dr.b + 16) {
        py = dr.t < h / 2 ? dr.b + 20 : dr.t - 20;
      }
      // Both bodies off the same edge: stack the second chip instead of overlapping.
      if (placed && Math.abs(px - placed[0]) < 120 && Math.abs(py - placed[1]) < 30) {
        py = placed[1] + (placed[1] > h / 2 ? -30 : 30);
      }
      placed = [px, py];
      el.hidden = false;
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      el.style.setProperty('--a', `${angle}rad`);
      const name = body === 'sun' ? 'Sun' : 'Earth';
      el.innerHTML = `<span class="edge-arrow" aria-hidden="true">➜</span><b>${name}</b> <span class="num">${fmtDeg(s.el)}</span>`;
      el.setAttribute('aria-label', `${name} is off screen at ${fmtDeg(s.el)} elevation. Turn the view toward it.`);
    }
  }

  // ───────────── Camera motion ─────────────
  // Two modes. 'orbit': the camera circles the lander and looks at its centre.
  // 'overhead': the Sun or Earth is too high to frame with the whole lander, so the
  // camera stands low beside it and looks up past it; dragging then turns the view
  // in place (the pivot sits just in front of the lens), up to nearly the zenith.
  let mode = 'orbit';
  const LOOK_PIVOT = 0.6;
  let camAnim = null;
  let zoomGoal = null;
  const ZOOM_STEP = 1.1; // one button press: 10% closer or further (orbit), or 10% field of view (overhead)
  const lookNow = new THREE.Vector3().copy(TARGET);
  const tmpPos = new THREE.Vector3();
  // Keep the render loop running while a tween or a zoom is in flight.
  let held = false;
  function syncHold() {
    const want = Boolean(camAnim) || zoomGoal !== null;
    if (want && !held) loop.hold();
    if (!want && held) loop.release();
    held = want;
  }

  function setMode(next) {
    mode = next;
    backBtn.hidden = next !== 'overhead';
    wrap.classList.toggle('is-overhead', next === 'overhead');
    if (next === 'orbit') {
      controls.minDistance = DIST.min;
      controls.maxDistance = DIST.max;
      controls.minPolarAngle = THREE.MathUtils.degToRad(38); // no steep top-down views
      controls.maxPolarAngle = THREE.MathUtils.degToRad(95); // the ground clamp does the rest
      controls.rotateSpeed = 1;
    } else {
      controls.minDistance = controls.maxDistance = LOOK_PIVOT;
      controls.minPolarAngle = THREE.MathUtils.degToRad(60); // look down at most 30°
      controls.maxPolarAngle = THREE.MathUtils.degToRad(176); // and up to almost straight overhead
      controls.rotateSpeed = 0.5;
    }
  }

  /** Where the camera is and what it is looking at. */
  function camState() {
    let look;
    if (camAnim) look = lookNow.clone();
    else if (mode === 'orbit') look = TARGET.clone();
    else look = camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 30);
    return { pos: camera.position.clone(), look, fov: camera.fov, shift: lensShift };
  }
  function applyState(s) {
    camera.position.copy(s.pos);
    camera.fov = s.fov;
    lensShift = s.shift;
    camera.updateProjectionMatrix();
    lookNow.copy(s.look);
    camera.lookAt(lookNow);
    loop.invalidate();
  }
  function finishMode(m, s) {
    setMode(m);
    const dir = s.look.clone().sub(s.pos).normalize();
    controls.target.copy(m === 'orbit' ? TARGET : s.pos.clone().addScaledVector(dir, LOOK_PIVOT));
    controls.enabled = true;
    camera.lookAt(controls.target);
  }

  // Positions move around the lander's vertical axis (angle, radius, height), so a
  // camera crossing to another side swings round the lander instead of through it.
  const cyl = (v) => ({ a: Math.atan2(v.z, v.x), r: Math.hypot(v.x, v.z), y: v.y });
  /** Tween to a camera state and land in the given mode. */
  function animateTo(end, endMode, dur) {
    const from = camState();
    if (reduceMotion || !dur) {
      camAnim = null;
      syncHold();
      applyState(end);
      finishMode(endMode, end);
      return;
    }
    const c0 = cyl(from.pos), c1 = cyl(end.pos);
    const da = ((c1.a - c0.a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    camAnim = { t0: performance.now(), dur, from, end, c0, c1, da, endMode };
    controls.enabled = false; // no orbit limits pulling at the camera mid-flight
    syncHold();
  }
  function stepCamAnim(now) {
    const { t0, dur, from, end, c0, c1, da, endMode } = camAnim;
    const t = Math.min((now - t0) / dur, 1);
    const k = easeInOut(t);
    const a = c0.a + da * k, r = c0.r + (c1.r - c0.r) * k;
    applyState({
      pos: tmpPos.set(Math.cos(a) * r, c0.y + (c1.y - c0.y) * k, Math.sin(a) * r),
      look: from.look.clone().lerp(end.look, k),
      fov: from.fov + (end.fov - from.fov) * k,
      shift: from.shift + (end.shift - from.shift) * k,
    });
    if (t >= 1) {
      camAnim = null;
      syncHold();
      finishMode(endMode, end);
    }
  }

  function zoomBy(factor) {
    if (camAnim) {
      // Land the framing move first, then zoom from where it ends.
      const { end, endMode } = camAnim;
      camAnim = null;
      applyState(end);
      finishMode(endMode, end);
      syncHold();
    }
    if (mode === 'overhead') {
      // Standing beside the lander: zoom narrows or widens the lens instead.
      const s = camState();
      animateTo({ ...s, fov: THREE.MathUtils.clamp(camera.fov * factor, 35, 100) }, 'overhead', 220);
      return;
    }
    const base = zoomGoal ?? currentPose().dist;
    zoomGoal = THREE.MathUtils.clamp(base * factor, DIST.min, DIST.max);
    syncHold();
  }
  function stepZoom() {
    const pose = currentPose();
    const d = pose.dist + (zoomGoal - pose.dist) * 0.2;
    const done = Math.abs(zoomGoal - d) < 0.01;
    const off = camera.position.clone().sub(TARGET).setLength(done ? zoomGoal : d);
    camera.position.copy(TARGET).add(off);
    if (done) {
      zoomGoal = null;
      syncHold();
      // A closer lander needs a different lens to stay whole; keep the heading.
      if (lastSample) fitView(lastSample, { animate: true, keepPose: true, dur: 380 });
    }
  }

  // Ctrl/⌘ + wheel zooms (plain wheel scrolls the page). Gentle and proportional.
  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(THREE.MathUtils.clamp(Math.exp(px * 0.0015), 0.94, 1.06));
    },
    { passive: false },
  );

  const post = createPost(renderer, scene, camera);
  const loop = renderLoop(container, (now) => {
    if (camAnim) stepCamAnim(now);
    if (zoomGoal !== null) stepZoom();
    if (!camAnim && controls.enabled && controls.update()) loop.invalidate();
    if (clampToGround()) loop.invalidate();
    camera.updateMatrixWorld();
    labelSides();
    post.render();
    labels.render(scene, camera);
    placeEdgeTags();
    dome.draw(currentView());
  });
  controls.addEventListener('change', () => loop.invalidate());
  // Once someone drags, leave the view where they put it until the plan changes.
  controls.addEventListener('start', () => {
    auto = false;
  });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // A new panel shape changes what fits.
    if (lastSample && (auto || mode === 'orbit')) fitView(lastSample, { animate: false, keepPose: !auto });
    loop.invalidate();
  }

  // ───────────── Framing ─────────────
  let auto = true; // the camera follows the sky until the user drags
  let fitted = { kept: new Set(), dropped: new Set() };
  let lastSample = null;
  const OVERHEAD_FROM = 40; // a body this high (°) that will not frame with the lander → overhead shot
  const OVERHEAD_UNTIL = 45; // back to the lander framing once every body is below this

  /**
   * Frame the lander with whichever of the Sun and Earth are up; if a high body
   * cannot be framed that way, switch to the overhead shot. Below-horizon bodies
   * are framed only when nothing is up, so the view faces their ghost tags.
   * keepPose: orbit only; keep the heading and elevation, fit only the lens.
   * overhead: false keeps the camera in orbit even for a high sky.
   */
  function fitView(sample, { animate, focus = null, keepPose = false, dur = 1000, dist: distOverride = null, overhead = true }) {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return null;
    const up = ['sun', 'earth'].filter((b) => sample[b].el > 0);
    const names = up.length ? up : ['earth', 'sun'];
    const bodies = names.map((b) => ({
      name: b,
      az: sample[b].az,
      el: up.length ? sample[b].el : 0.6,
      // If both cannot fit: keep the one asked for, else Earth (it barely moves).
      priority: b === focus ? 3 : b === 'earth' ? 2 : 1,
    }));
    const byPriority = [...bodies].sort((a, b) => b.priority - a.priority);
    // Keep bodies low enough that their label (≈50 px above the disk) clears the
    // HUD and the sky dome. On wide panels those cover only the sides, so count half.
    const dr = domeRect();
    const topUi = w < 520 ? hudBottom() : Math.max(hudBottom(), dr && dr.t < h / 2 ? dr.b : 0) * 0.5;
    const topReserve = Math.min(0.42, (50 + topUi) / h);
    const aspect = w / h;
    const orbitPose = mode === 'orbit' && !camAnim ? currentPose() : { dist: homeDist() };
    const dist = THREE.MathUtils.clamp(distOverride ?? zoomGoal ?? orbitPose.dist, DIST.min, DIST.max);
    keepPose = keepPose && mode === 'orbit' && !camAnim;
    const fit = fitSurfaceCamera({
      bodies, aspect, dist, skyR: SKY_R, topReserve,
      pose: keepPose ? { yaw: orbitPose.yaw, elev: THREE.MathUtils.clamp(orbitPose.elev, -4, 40) } : null,
    });
    if (!keepPose) auto = true;

    // Too high to frame with the whole lander: the overhead shot.
    const highUnframed = up.some((b) => sample[b].el >= OVERHEAD_FROM && !byPriority.slice(0, fit.kept).some((x) => x.name === b));
    if (overhead && !keepPose && highUnframed) {
      const ov = fitOverhead({ bodies: bodies.filter((b) => up.includes(b.name)), aspect, skyR: SKY_R, topReserve });
      if (ov && ov.kept >= fit.kept) {
        const kept = byPriority.filter((b) => up.includes(b.name)).slice(0, ov.kept).map((b) => b.name);
        fitted = { kept: new Set(kept), dropped: new Set(up.filter((b) => !kept.includes(b))) };
        const pos = new THREE.Vector3().fromArray(ov.pos);
        pos.y = Math.max(pos.y, groundHeight(pos.x, pos.z) + EYE_CLEARANCE);
        const look = pos.clone().addScaledVector(new THREE.Vector3().fromArray(ov.f), 30);
        animateTo({ pos, look, fov: ov.fov, shift: 0 }, 'overhead', animate ? dur : 0);
        return fit;
      }
    }

    const kept = byPriority.slice(0, fit.kept).map((b) => b.name);
    fitted = { kept: new Set(kept), dropped: new Set(up.filter((b) => !kept.includes(b))) };
    const pos = keepPose ? camera.position.clone() : new THREE.Vector3().fromArray(poseBasis({ yaw: fit.yaw, elev: fit.elev, dist }).pos);
    animateTo({ pos, look: TARGET.clone(), fov: fit.fov, shift: fit.shift }, 'orbit', animate ? dur : 0);
    return fit;
  }

  /** Bring an off-screen body into view: with the whole lander if it fits, else the overhead shot. */
  function focusBody(body) {
    if (lastSample) fitView(lastSample, { animate: true, focus: body });
  }
  /** From the overhead shot back to circling the lander (the high body may leave the frame). */
  function backToLander() {
    if (!lastSample) return;
    fitView(lastSample, { animate: true, overhead: false, dist: homeDist(), dur: 900 });
    auto = false; // stay with the lander during playback until recentred
  }
  function recentre() {
    zoomGoal = null;
    syncHold();
    // Back to the automatic framing at the home zoom.
    if (lastSample) fitView(lastSample, { animate: true, dist: homeDist(), dur: 900 });
  }

  /** While following the sky, re-frame when a framed body drifts off, a new one rises, or the sky comes down. */
  function needsRefit(sample) {
    if (!auto || camAnim || zoomGoal !== null) return false;
    const up = ['sun', 'earth'].filter((b) => sample[b].el > 0);
    if (mode === 'overhead' && up.every((b) => sample[b].el < OVERHEAD_UNTIL)) return true;
    camera.updateMatrixWorld();
    return up.some((b) => {
      if (fitted.dropped.has(b)) return false;
      if (!fitted.kept.has(b)) return true;
      projected.copy(azElToLocal(sample[b].az, sample[b].el)).multiplyScalar(SKY_R).project(camera);
      return projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
    });
  }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** What the camera covers, for the sky dome: heading, elevation band, half-width. */
  function currentView() {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const heading = (THREE.MathUtils.radToDeg(Math.atan2(dir.x, -dir.z)) + 360) % 360;
    const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return {
      heading,
      top: pitch + THREE.MathUtils.radToDeg(Math.atan(t * (1 + lensShift))),
      bottom: pitch - THREE.MathUtils.radToDeg(Math.atan(t * (1 - lensShift))),
      half: THREE.MathUtils.radToDeg(Math.atan(t * camera.aspect)),
      sample: lastSample,
    };
  }

  function placeBody(sample, body, mesh, halo, lbl) {
    const { az, el } = sample[body];
    const dirTrue = azElToLocal(az, el);
    const above = el > 0;
    // Below-horizon bodies: show a ghost tag on the horizon at their azimuth.
    const dirShown = above ? dirTrue : azElToLocal(az, 0.6);
    mesh.position.copy(dirShown).multiplyScalar(SKY_R);
    if (halo) halo.position.copy(mesh.position);
    mesh.visible = above;
    if (halo) halo.visible = above;
    const name = body === 'sun' ? 'Sun' : 'Earth';
    lbl.d.innerHTML = above
      ? `<b>${name}</b> <span class="num">${fmtDeg(el)}</span>`
      : `<b>${name}</b> <span class="num">${fmtDeg(el)}</span><span class="lbl-sub">below horizon ↓</span>`;
    lbl.d.classList.toggle('is-below', !above);
    // Bodies in the sky: anchor on the body and lift the text by a fixed pixel
    // gap (CSS), so it clears the disk at any field of view.
    if (!above) lbl.d.classList.remove('lbl-up', 'lbl-down');
    if (above) lbl.o.position.copy(dirShown).multiplyScalar(SKY_R * 0.8);
    else lbl.o.position.copy(dirShown).multiplyScalar(SKY_R * 0.8).add(new THREE.Vector3(0, 30, 0));
    return dirTrue;
  }

  let lastView = null;
  let studioFill = 0; // the studio look lifts the shadows like a soft-box
  let closeLower = null;

  /**
   * Labels sit above their body unless that would print them under the HUD,
   * or the body is the lower of a close Sun–Earth pair; then they hang below.
   */
  const labelPt = new THREE.Vector3();
  function labelSides() {
    const h = container.clientHeight;
    const downs = new Map();
    for (const lbl of [sunLbl, earthLbl]) {
      if (lbl.d.classList.contains('is-below')) continue;
      labelPt.copy(lbl.o.position).project(camera);
      const yPx = ((1 - labelPt.y) / 2) * h;
      downs.set(lbl, lbl === closeLower || (labelPt.z < 1 && yPx < hudBottom() + 52));
    }
    // A close pair with both labels hanging below: stack the lower body's one row further down.
    const stacked = closeLower && downs.get(sunLbl) && downs.get(earthLbl);
    for (const [lbl, down] of downs) {
      lbl.d.classList.toggle('lbl-down', down);
      lbl.d.classList.toggle('lbl-up', !down);
      lbl.d.classList.toggle('lbl-far', Boolean(stacked) && lbl === closeLower);
    }
  }

  /**
   * @param {{viewKey: string, sample: object}} p viewKey changes with the site,
   *   touchdown, slip or scenario; each change re-frames the camera.
   */
  function update({ viewKey, sample }) {
    lastSample = sample;
    if (viewKey !== lastView) {
      const first = lastView === null;
      lastView = viewKey;
      if (first) placeCamera({ yaw: 0, elev: FIT.homeElev, dist: homeDist() });
      fitView(sample, { animate: !first });
    } else if (needsRefit(sample)) {
      fitView(sample, { animate: true });
    }
    const sDir = placeBody(sample, 'sun', sunSprite, null, sunLbl);
    const eDir = placeBody(sample, 'earth', earth, earthHalo, earthLbl);
    earthMat.uniforms.uSun.value.copy(sDir);
    // Near-new Earth puts both bodies a few degrees apart; hang the lower body's
    // label beneath it so the two labels don't print on top of each other.
    closeLower = null;
    if (sample.sun.el > 0 && sample.earth.el > 0 && sDir.angleTo(eDir) < THREE.MathUtils.degToRad(14)) {
      closeLower = sample.sun.el < sample.earth.el ? sunLbl : earthLbl;
    }
    labelSides();

    // Sun: fade across its own disk (±0.27°) as it crosses the horizon.
    const sunUp = THREE.MathUtils.smoothstep(sample.sun.el, -SUN_RADIUS_DEG, SUN_RADIUS_DEG);
    sunLight.intensity = 3.4 * sunUp;
    sunLight.position.copy(sDir).multiplyScalar(160);
    sunSprite.material.opacity = 0.7 * Math.max(sunUp, 0.0);
    sunSprite.visible = sunUp > 0.001;
    sunCore.position.copy(sunSprite.position);
    sunCore.visible = sunSprite.visible;

    // Earthshine scales with Earth's illuminated fraction seen from the Moon.
    const elong = sDir.angleTo(eDir);
    const k = (1 - Math.cos(elong)) / 2;
    const earthUp = THREE.MathUtils.smoothstep(sample.earth.el, -0.95, 0.95);
    earthLight.intensity = 0.95 * k * earthUp * (1 - sunUp * 0.85);
    earthLight.position.copy(eDir).multiplyScalar(160);
    ambient.intensity = 0.16 + 0.2 * sunUp + 0.55 * studioFill;
    // Sunlit regolith throws light back up onto the lander's shadow side; the
    // higher the Sun, the brighter the ground and the stronger that bounce.
    const bounce = sunUp * Math.sin(THREE.MathUtils.degToRad(Math.max(sample.sun.el, 0)));
    ambient.groundColor.setRGB(0.063 + 0.5 * bounce, 0.063 + 0.47 * bounce, 0.07 + 0.42 * bounce, THREE.SRGBColorSpace);

    // Aim the dish at Earth.
    dish.lookAt(dish.getWorldPosition(new THREE.Vector3()).add(eDir));
    loop.invalidate();
  }

  /** Switch the lander, the ground and the fill light between the real and studio looks. */
  const groundLook = { real: { color: 0x9a968f, normal: 0.5, rock: 0x96938c }, studio: { color: 0xd9d1c8, normal: 0.12, rock: 0xd2cac1 } };
  const rocks = scene.children.find((o) => o.isGroup && o.children.some((c) => c.isInstancedMesh));
  let look = 'real';
  function setLook(next) {
    if (!LANDER_LOOKS[next] || next === look) return;
    look = next;
    applyLanderMaterials(lander, LANDER_LOOKS[next]);
    const g = groundLook[next];
    groundMat.color.set(g.color);
    groundMat.normalScale.set(g.normal, g.normal);
    if (rocks) for (const m of rocks.children) {
      m.material.color.set(g.rock);
      m.material.normalScale.set(g.normal * 0.7, g.normal * 0.7);
    }
    studioFill = next === 'studio' ? 1 : 0;
    if (lastSample) update({ viewKey: lastView, sample: lastSample });
    loop.invalidate();
  }

  new ResizeObserver(resize).observe(container);
  resize();
  return { update, setLook };
}

function svgIcon(d) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

// ───────────── Sky dome mini-map ─────────────
// The whole sky seen from the lander, flattened: zenith in the middle, horizon
// at the rim, rotated so the way the camera faces is up. The wedge shows what
// the main view covers.
function createSkyDome(wrap) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElement('div');
  el.className = 'sky-dome';
  el.setAttribute('aria-hidden', 'true'); // the readout beside the view says the same in text
  const R = 44, C = 50;
  el.innerHTML = `<svg viewBox="0 0 100 100">
      <circle class="sd-bg" cx="${C}" cy="${C}" r="${R}"/>
      <circle class="sd-ring" cx="${C}" cy="${C}" r="${(R * 2) / 3}"/>
      <circle class="sd-ring" cx="${C}" cy="${C}" r="${R / 3}"/>
      <path class="sd-wedge"/>
      <g class="sd-card"></g>
      <g class="sd-bodies"></g>
      <circle class="sd-zenith" cx="${C}" cy="${C}" r="1.1"/>
    </svg><span class="sd-cap">Sky</span>`;
  wrap.appendChild(el);
  const wedge = el.querySelector('.sd-wedge');
  const card = el.querySelector('.sd-card');
  const bodiesG = el.querySelector('.sd-bodies');
  const rho = (elev) => R * (1 - Math.min(Math.max(elev, 0), 90) / 90);
  const pt = (rel, elev, r = rho(elev)) => {
    const a = (rel * Math.PI) / 180;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };
  let sig = '';

  function draw(v) {
    const s = v.sample;
    if (!s) return;
    const key = [v.heading, v.top, v.bottom, v.half, s.sun.az, s.sun.el, s.earth.az, s.earth.el].map((n) => n.toFixed(1)).join();
    if (key === sig) return;
    sig = key;
    // View wedge between the bottom and top of the frame, ±half-width around the heading.
    const top = Math.min(v.top, 90), bot = Math.max(v.bottom, 0);
    const half = Math.min(v.half, 89);
    if (top <= 0) wedge.setAttribute('d', '');
    else {
      const steps = 16, outer = [], inner = [];
      for (let i = 0; i <= steps; i++) {
        const rel = -half + (2 * half * i) / steps;
        outer.push(pt(rel, bot));
        inner.push(pt(rel, top));
      }
      const d = [...outer, ...inner.reverse()].map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + 'Z';
      wedge.setAttribute('d', d);
    }
    card.innerHTML = [['N', 0], ['E', 90], ['S', 180], ['W', 270]]
      .map(([n, az]) => {
        const [x, y] = pt(az - v.heading, 0, R - 6.5);
        return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="${n === 'N' ? 'is-n' : ''}">${n}</text>`;
      })
      .join('');
    bodiesG.innerHTML = ['earth', 'sun']
      .map((b) => {
        const { az, el: e } = s[b];
        const below = e <= 0;
        const [x, y] = pt(az - v.heading, 0, below ? R + 2.5 : rho(e));
        return `<circle class="sd-${b} ${below ? 'is-below' : ''}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${b === 'sun' ? 4 : 3.6}"/>`;
      })
      .join('');
  }
  return { el, draw };
}
