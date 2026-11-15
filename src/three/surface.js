// Surface view: a generic lander on a smooth reference horizon, with the Sun and
// Earth placed by JPL azimuth/elevation. At Athena's 4° Sun the lander's shadow
// runs ~30 m across the ground — the long shadow the project is named for.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { regolithTexture, glowTexture, starfield, rng } from './textures.js';
import { azElToLocal, renderLoop } from './geo.js';
import { fmtDeg } from '../format.js';

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
  return g;
}

function buildLander() {
  const L = new THREE.Group();
  const foil = new THREE.MeshStandardMaterial({ color: 0xc8a046, metalness: 0.75, roughness: 0.38 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe7e5df, metalness: 0.1, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.5, roughness: 0.5 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1b2a4a, metalness: 0.6, roughness: 0.3 });
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
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.5, side: THREE.DoubleSide }));
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x020306, 1);
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 4.2, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 38;
  controls.minPolarAngle = THREE.MathUtils.degToRad(50);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(97);
  controls.enableZoom = false;
  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const off = camera.position.clone().sub(controls.target);
      off.setLength(Math.min(Math.max(off.length() * (1 + Math.sign(e.deltaY) * 0.08), controls.minDistance), controls.maxDistance));
      camera.position.copy(controls.target).add(off);
      loop.invalidate();
    },
    { passive: false },
  );

  // Ground
  const tex = regolithTexture();
  const ground = new THREE.Mesh(groundGeometry(), new THREE.MeshStandardMaterial({ map: tex, color: 0x9a968f, roughness: 1, metalness: 0 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Stars (only above the horizon; the ground hides the rest anyway)
  scene.add(starfield(2600, SKY_R * 1.4, 21, -50));

  // Horizon ring & cardinal labels
  const ringPts = [];
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * (GROUND_R - 5), 0.5, Math.sin(a) * (GROUND_R - 5)));
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })));
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
  const { group: lander, dish } = buildLander();
  scene.add(lander);

  // Lights
  const sunLight = new THREE.DirectionalLight(0xfff3df, 3.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 400 });
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.04;
  scene.add(sunLight, sunLight.target);
  const earthLight = new THREE.DirectionalLight(0xa9c8ff, 0.0);
  scene.add(earthLight, earthLight.target);
  const ambient = new THREE.HemisphereLight(0x8090a8, 0x101012, 0.05);
  scene.add(ambient);

  // Sun & Earth in the sky
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sunSprite.scale.setScalar(260);
  scene.add(sunSprite);
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix)*normal); vP=position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        vec3 p = normalize(vP)*3.0;
        float land = smoothstep(0.52,0.6, n3(p)*0.6 + n3(p*2.3)*0.4);
        float cloud = smoothstep(0.55,0.8, n3(p*3.1+7.0)*0.6 + n3(p*6.0)*0.4);
        vec3 col = mix(vec3(0.07,0.22,0.55), vec3(0.32,0.42,0.28), land);
        col = mix(col, vec3(0.95), cloud*0.85);
        float lit = smoothstep(-0.06, 0.12, dot(normalize(vN), normalize(uSun)));
        gl_FragColor = vec4(mix(vec3(0.01,0.015,0.03), col*1.25, lit), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // Earth spans ~1.9° from the Moon; drawn ~1.7× larger for legibility.
  const earth = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * Math.tan(THREE.MathUtils.degToRad(0.95)) * 1.7, 48, 32), earthMat);
  scene.add(earth);
  const earthHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(150,200,255,0.5)', 'rgba(90,150,255,0.12)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  earthHalo.scale.setScalar(260);
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

  const loop = renderLoop(container, () => {
    if (controls.update()) loop.invalidate();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });
  controls.addEventListener('change', () => loop.invalidate());

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 62 : 50;
    camera.updateProjectionMatrix();
    loop.invalidate();
  }
  new ResizeObserver(resize).observe(container);

  /** Point the camera across the lander toward an azimuth, pitched to fit the highest body. */
  function frame(azDeg, topElDeg = 5) {
    const look = azElToLocal(azDeg, 0);
    const dist = container.clientWidth < 520 ? 21 : 17;
    const halfV = camera.fov / 2;
    const pitch = THREE.MathUtils.clamp(topElDeg + 7 - halfV, 4, 30);
    controls.target.set(0, 2.6 + dist * Math.tan(THREE.MathUtils.degToRad(pitch)), 0);
    camera.position.set(0, 0, 0).addScaledVector(look, -dist).setY(2.6);
    // Nudge sideways so the lander doesn't sit dead-centre over the bodies.
    camera.position.addScaledVector(new THREE.Vector3(-look.z, 0, look.x), dist * 0.34);
    controls.update();
    loop.invalidate();
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
    lbl.o.position.copy(dirShown).multiplyScalar(SKY_R * 0.8).add(new THREE.Vector3(0, above ? 60 : 30, 0));
    return dirTrue;
  }

  let lastSite = null;

  function update({ siteId, sample }) {
    if (siteId !== lastSite) {
      lastSite = siteId;
      // Face whichever body is up, preferring Earth (it barely moves).
      const pick = sample.earth.el > -2 || sample.sun.el < 0 ? sample.earth : sample.sun;
      const topEl = Math.max(sample.sun.el > 0 ? sample.sun.el : 0, sample.earth.el > 0 ? sample.earth.el : 0);
      frame(pick.az, topEl);
    }
    const sDir = placeBody(sample, 'sun', sunSprite, null, sunLbl);
    const eDir = placeBody(sample, 'earth', earth, earthHalo, earthLbl);
    earthMat.uniforms.uSun.value.copy(sDir);

    // Sun: fade across its own disk (±0.27°) as it crosses the horizon.
    const sunUp = THREE.MathUtils.smoothstep(sample.sun.el, -SUN_RADIUS_DEG, SUN_RADIUS_DEG);
    sunLight.intensity = 3.4 * sunUp;
    sunLight.position.copy(sDir).multiplyScalar(160);
    sunSprite.material.opacity = Math.max(sunUp, 0.0);
    sunSprite.visible = sunUp > 0.001;

    // Earthshine scales with Earth's illuminated fraction seen from the Moon.
    const elong = sDir.angleTo(eDir);
    const k = (1 - Math.cos(elong)) / 2;
    const earthUp = THREE.MathUtils.smoothstep(sample.earth.el, -0.95, 0.95);
    earthLight.intensity = 0.95 * k * earthUp * (1 - sunUp * 0.85);
    earthLight.position.copy(eDir).multiplyScalar(160);
    ambient.intensity = 0.16 + 0.2 * sunUp;

    // Aim the dish at Earth.
    dish.lookAt(dish.getWorldPosition(new THREE.Vector3()).add(eDir));
    loop.invalidate();
  }

  resize();
  return { update };
}
