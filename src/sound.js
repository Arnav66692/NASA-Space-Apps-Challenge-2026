// Ambient music, made live with Web Audio and no files. Slow open chords in D swell in and fade under the
// next one, with a faint shimmer on top, a dark wash of air and a long soft room.
// It is off by default. The Sound pill in the header turns it on and off, with a fade either way. The choice
// is remembered, but browsers only allow sound after a click, so a remembered "on" waits for the first click
// or key press on the page. It goes quiet while the tab is hidden.
// The earlier version rendered a whole minute of music offline before it made any sound (about 8 s in
// headless Chrome next to the 3D scene), so a click looked like it did nothing. This one plays at once.
// Written with an AI tool.
import './sound.css';

export const KEY = 'long-shadow-sound';
const CHORD_S = 12; // seconds per chord
const OVERLAP_S = 5; // each chord rings this long into the next
const ATTACK_S = 4;
const ROLL_S = 0.45; // notes enter from the bottom up, this far apart
const ROOM_S = 4.5; // reverb tail
const LOOKAHEAD_S = 4; // chords are scheduled this far ahead
const TICK_MS = 1000;
const FADE_IN_S = 1.5;
const FADE_OUT_S = 1.2;
const HIDE_FADE_S = 0.3;
const LEVEL = 0.55; // master gain when on. Measured about -21 dBFS rms over 75 s in Chrome, peaks under -8 dBFS.
const NOTE_GAIN = 0.14;

const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const lin = (d) => 10 ** (d / 20);

// [midi note, dB]. Open voicings, lowest note quiet so the bass never booms on laptop speakers.
export const CHORDS = [
  [[50, -9], [57, -3], [61, -2], [64, 0], [69, -4]], // Dmaj9
  [[47, -10], [54, -3], [57, -2], [62, 0], [64, -5]], // Bm11
  [[43, -10], [50, -4], [54, -2], [61, 0], [66, -5]], // Gmaj7 sharp 11
  [[45, -10], [52, -3], [57, -3], [59, 0], [64, -4]], // A add 9
  [[40, -11], [47, -4], [55, -2], [59, 0], [66, -5]], // Em9
  [[43, -10], [50, -4], [54, -3], [57, 0], [62, -3]], // Gmaj9, back to the first chord
];

/** Read the remembered choice. Anything but "on" means off, so the page starts silent. */
export function readChoice(storage) {
  try {
    return storage?.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function writeChoice(storage, on) {
  try {
    storage?.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Private browsing can refuse storage. The choice still holds for this visit.
  }
}

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pinkInto(d, rand) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}

function panner(ac, pan) {
  if (!ac.createStereoPanner) return ac.createGain();
  const p = ac.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

// A long, soft room: noise that darkens as it decays, different in each ear.
function roomBuffer(ac, rand) {
  const len = Math.round(ac.sampleRate * ROOM_S);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ac.sampleRate;
      lp += (rand() * 2 - 1 - lp) * Math.max(0.03, 0.4 - t * 0.09);
      d[i] = lp * Math.exp(-t / 1.1) * Math.min(1, t / 0.03);
    }
  }
  return buf;
}

/** The live graph: a bus into a dry path and a room, then master, an analyser and the speakers. */
function buildGraph(ac, rand) {
  const master = ac.createGain();
  master.gain.value = 0;
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  // A gentle limiter, so a stack of notes can never clip.
  const limit = ac.createDynamicsCompressor();
  limit.threshold.value = -10;
  limit.knee.value = 6;
  limit.ratio.value = 8;
  master.connect(limit).connect(analyser).connect(ac.destination);

  const bus = ac.createGain();
  const dry = ac.createGain();
  dry.gain.value = 0.55;
  const wet = ac.createGain();
  wet.gain.value = 0.75;
  const verb = ac.createConvolver();
  verb.buffer = roomBuffer(ac, rand);
  bus.connect(dry).connect(master);
  bus.connect(verb).connect(wet).connect(master);

  // Air: dark pink noise, wide, breathing slowly.
  const n = Math.round(8 * ac.sampleRate);
  [-1, 1].forEach((side) => {
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    pinkInto(buf.getChannelData(0), rand);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 0.5;
    const g = ac.createGain();
    g.gain.value = 0.035;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 1 / (CHORD_S * (side < 0 ? 1 : 1.3));
    const depth = ac.createGain();
    depth.gain.value = 0.013;
    lfo.connect(depth).connect(g.gain);
    src.connect(bp).connect(g).connect(panner(ac, side * 0.8)).connect(master);
    src.start();
    lfo.start();
  });

  // A soft, round tone: the fundamental, a quiet octave and a trace of the fifth above it.
  const wave = ac.createPeriodicWave(new Float32Array(4), Float32Array.of(0, 1, 0.18, 0.05));
  return { master, analyser, bus, wave };
}

/** Schedule one chord at time t: notes with slow swells, its own breathing filter, and a shimmer. */
function playChord(ac, g, rand, notes, t, index) {
  const end = t + CHORD_S + OVERLAP_S;
  const tone = ac.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.4;
  tone.frequency.setValueAtTime(480, t);
  tone.frequency.linearRampToValueAtTime(1500, t + CHORD_S * 0.55);
  tone.frequency.linearRampToValueAtTime(650, end);
  tone.connect(g.bus);
  const nodes = [tone];

  notes.forEach(([m, db], k) => {
    const env = ac.createGain();
    const peak = lin(db) * NOTE_GAIN;
    const start = t + k * ROLL_S;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + ATTACK_S);
    env.gain.setValueAtTime(peak, t + CHORD_S - 1);
    env.gain.linearRampToValueAtTime(0, end);
    env.connect(tone);
    nodes.push(env);
    // Two slightly detuned voices per note, spread across the stereo field.
    [-1, 1].forEach((side) => {
      const o = ac.createOscillator();
      o.setPeriodicWave(g.wave);
      o.frequency.value = hz(m);
      o.detune.value = side * (3 + 3 * rand());
      const p = panner(ac, side * 0.4 + (k - 2) * 0.08);
      o.connect(p).connect(env);
      o.start(start);
      o.stop(end + 0.05);
      nodes.push(o, p);
    });
  });

  // Shimmer: the top note two octaves up, very quiet, with a slow tremolo.
  const shimmer = ac.createOscillator();
  shimmer.frequency.value = hz(notes[notes.length - 1][0] + 24);
  const sg = ac.createGain();
  sg.gain.setValueAtTime(0, t + 2);
  sg.gain.linearRampToValueAtTime(0.011, t + 5);
  sg.gain.linearRampToValueAtTime(0, end - 1);
  const trem = ac.createOscillator();
  trem.frequency.value = 0.2 + rand() * 0.1;
  const tremDepth = ac.createGain();
  tremDepth.gain.value = 0.005;
  trem.connect(tremDepth).connect(sg.gain);
  const sp = panner(ac, index % 2 ? 0.35 : -0.35);
  shimmer.connect(sg).connect(sp).connect(g.bus);
  shimmer.start(t + 2);
  shimmer.stop(end);
  trem.start(t + 2);
  trem.stop(end);
  nodes.push(shimmer, sg, trem, tremDepth, sp);

  // Free the chord's nodes once its last voice ends.
  shimmer.onended = () => nodes.forEach((x) => x.disconnect());
}

function ramp(param, now, to, seconds) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(to, now + seconds);
}

const PILL_TEXT = { on: 'On', off: 'Off' };

/**
 * Wire every [data-sound] pill on the page. Returns a small handle, also on window.__longShadowSound for QA.
 * @param {ParentNode} root
 */
export function initSound(root = document) {
  const pills = [...root.querySelectorAll('[data-sound]')];
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  let on = readChoice(storage); // what the visitor wants
  let ac = null;
  let graph = null;
  let rand = rng(23);
  let nextAt = 0;
  let chord = 0;
  let timer = 0;
  let fadeTimer = 0;
  let playing = false;

  const render = () => {
    for (const p of pills) {
      p.setAttribute('aria-pressed', String(on));
      p.classList.toggle('is-playing', playing);
      const state = p.querySelector('[data-sound-state]');
      if (state) state.textContent = on ? PILL_TEXT.on : PILL_TEXT.off;
    }
  };

  function ensureContext() {
    if (ac) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    try {
      ac = new Ctx({ latencyHint: 'playback' });
    } catch {
      return false;
    }
    graph = buildGraph(ac, rand);
    nextAt = ac.currentTime + 0.1;
    return true;
  }

  function schedule() {
    if (!ac) return;
    while (nextAt < ac.currentTime + LOOKAHEAD_S) {
      playChord(ac, graph, rand, CHORDS[chord], nextAt, chord);
      chord = (chord + 1) % CHORDS.length;
      nextAt += CHORD_S;
    }
  }

  // Must run inside a click or key handler the first time, so the browser lets the context run.
  async function start() {
    if (!ensureContext()) return;
    clearTimeout(fadeTimer);
    const resumed = ac.state === 'running' ? null : ac.resume();
    // A context that was suspended for a long time has fallen behind. Start the chords again from now.
    if (nextAt < ac.currentTime) nextAt = ac.currentTime + 0.1;
    schedule();
    clearInterval(timer);
    timer = setInterval(schedule, TICK_MS);
    try {
      await resumed;
    } catch {
      return;
    }
    if (!on || document.hidden) return;
    ramp(graph.master.gain, ac.currentTime, LEVEL, FADE_IN_S);
    playing = ac.state === 'running';
    render();
  }

  function stop(seconds) {
    playing = false;
    render();
    if (!ac) return;
    ramp(graph.master.gain, ac.currentTime, 0, seconds);
    clearTimeout(fadeTimer);
    // Once the fade is done, suspend the context so nothing runs in the background.
    fadeTimer = setTimeout(() => {
      if (playing) return;
      clearInterval(timer);
      ac.suspend().catch(() => {});
    }, seconds * 1000 + 100);
  }

  function setOn(next) {
    on = next;
    writeChoice(storage, on);
    disarm();
    if (on) start();
    else stop(FADE_OUT_S);
    render();
  }

  for (const p of pills) p.addEventListener('click', () => setOn(!on));

  // A remembered "on" starts with the first click or key press anywhere, which browsers accept as a gesture.
  const GESTURES = ['pointerdown', 'keydown', 'touchend', 'click'];
  const first = (e) => {
    if (e.target?.closest?.('[data-sound]')) return; // the pill handles its own click
    disarm();
    if (on && !document.hidden) start();
  };
  function disarm() {
    for (const type of GESTURES) window.removeEventListener(type, first, true);
  }
  if (on) for (const type of GESTURES) window.addEventListener(type, first, true);

  // Quiet while the tab is hidden, back with a fade when it returns.
  document.addEventListener('visibilitychange', () => {
    if (!ac || !on) return;
    if (document.hidden) stop(HIDE_FADE_S);
    else start();
  });

  render();
  const api = {
    get on() {
      return on;
    },
    get playing() {
      return playing;
    },
    get state() {
      return ac?.state ?? 'none';
    },
    level: () => graph?.master.gain.value ?? 0,
    /** Root mean square of what the speakers get right now, in dBFS. */
    rmsDb() {
      if (!graph) return -Infinity;
      const a = new Float32Array(graph.analyser.fftSize);
      graph.analyser.getFloatTimeDomainData(a);
      let s = 0;
      for (const v of a) s += v * v;
      return 10 * Math.log10(s / a.length || 1e-20);
    },
    /** Tallest sample in the last analyser frame, in dBFS. */
    peakDb() {
      if (!graph) return -Infinity;
      const a = new Float32Array(graph.analyser.fftSize);
      graph.analyser.getFloatTimeDomainData(a);
      let m = 0;
      for (const v of a) m = Math.max(m, Math.abs(v));
      return 20 * Math.log10(m || 1e-10);
    },
    set: (next) => setOn(Boolean(next)),
    /** Stop and close the context. For tests. */
    async close() {
      on = false;
      playing = false;
      clearInterval(timer);
      clearTimeout(fadeTimer);
      disarm();
      render();
      if (ac) await ac.close().catch(() => {});
      ac = null;
      graph = null;
      rand = rng(23);
      chord = 0;
    },
  };
  window.__longShadowSound = api;
  return api;
}
