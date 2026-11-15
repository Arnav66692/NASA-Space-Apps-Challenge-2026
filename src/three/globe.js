// Hero 3D Moon globe. Lighting comes from the JPL Sun direction at the selected
// instant, so the terminator is real geometry, not decoration. Two great
// circles show where the Sun (gold) and Earth (blue) sit on the horizon.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { moonTextures, glowTexture, starfield } from './textures.js';
import { latLonToThree, slerpVec, easeInOut, renderLoop } from './geo.js';

const VIEW = {
  athena: { lat: -50, lon: 20 },
  blueGhost: { lat: 14, lon: 52 },
};

function greatCircle(color, dashed) {
  const pts = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(1.006));
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
    new THREE.SphereGeometry(1, 160, 120),
    new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 0.9, roughness: 1, metalness: 0 }),
  );
  scene.add(moon);

  // Graticule
  const grat = new THREE.Group();
  const gm = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 3) pts.push(latLonToThree(lat, lon, 1.003));
    grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gm));
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(latLonToThree(lat, lon, 1.003));
    grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gm));
  }
  scene.add(grat);

  // Terminator & Earth-horizon great circles
  const term = greatCircle(0xf2b33d, false);
  const limb = greatCircle(0x6cb4ff, true);
  scene.add(term, limb);

  // Lights
  const sun = new THREE.DirectionalLight(0xfff4e2, 3.2);
  const earthshine = new THREE.DirectionalLight(0x9cc4ff, 0.08);
  scene.add(sun, sun.target, earthshine, earthshine.target);
  scene.add(new THREE.AmbientLight(0x8899aa, 0.035));

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

  // Site pins
  const pins = {};
  for (const s of Object.values(sites)) {
    const g = new THREE.Group();
    const n = latLonToThree(s.lat, s.lonE, 1);
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
    g.position.copy(n);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize());
    const lab = labelEl(s.name, 'lbl lbl-site');
    const lo = new CSS2DObject(lab);
    lo.position.set(0, 0.12, 0);
    g.add(lo);
    scene.add(g);
    pins[s.id] = { g, ring, lab, normal: n.clone().normalize() };
  }

  function labelEl(text, cls) {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  }

  // State
  const state = {
    site: null,
    sunDir: new THREE.Vector3(1, 0, 0),
    earthDir: new THREE.Vector3(0, 0, 1),
  };
  let sunAnim = null;
  let camAnim = null;

  function applyDirs() {
    const s = state.sunDir, e = state.earthDir;
    sun.position.copy(s).multiplyScalar(10);
    sunSprite.position.copy(s).multiplyScalar(30);
    earthshine.position.copy(e).multiplyScalar(10);
    earth.position.copy(e).multiplyScalar(3.1);
    earthMat.uniforms.uSun.value.copy(s);
    term.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s);
    limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), e);
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
    controls.maxDistance = fitDist * 1.8;
    if (!camAnim && state.site) camera.position.setLength(fitDist);
    loop.invalidate();
  }
  let fitDist = 3.6;
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
    const pulse = 1 + 0.25 * Math.sin(now / 380);
    for (const [id, p] of Object.entries(pins)) {
      const active = id === state.site;
      p.ring.scale.setScalar(active ? pulse : 0.7);
      p.ring.material.opacity = active ? 0.9 : 0.35;
      p.lab.classList.toggle('is-active', active);
      // Hide labels for pins on the far side of the Moon.
      const facing = p.normal.dot(camDir.copy(camera.position).normalize()) > 0.08;
      p.lab.style.visibility = facing ? 'visible' : 'hidden';
    }
    if (controls.update()) loop.invalidate();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });
  loop.hold(); // keep the active-site pulse alive

  controls.addEventListener('change', () => loop.invalidate());
  new ResizeObserver(resize).observe(container);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frameSite(siteId, animate) {
    const v = VIEW[siteId];
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
   * @param {{siteId, sunDir: THREE.Vector3, earthDir: THREE.Vector3, transition?: boolean}} p
   */
  function update({ siteId, sunDir, earthDir, transition }) {
    if (siteId !== state.site) {
      frameSite(siteId, state.site !== null);
      state.site = siteId;
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

  resize();
  return { update };
}
