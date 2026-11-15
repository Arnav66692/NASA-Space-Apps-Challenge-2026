// The parts that stay on screen: header, menu, corner controls and the cursor. Also the opening
// and the switch between the two pages (the one-screen home and the navigator).
// The behaviour follows unseen.co, measured for Arnav's portfolio build. The code is original.
// Written with an AI tool (Claude).

const TOOL_ANCHORS = ['navigator', 'sites', 'instrument', 'replay', 'methods'];
const LEAVE_MS = 480;
const MENU_MS = 1000;
const INTRO_MIN_MS = 1500;
const INTRO_MAX_MS = 6000;
const INTRO_OUT_MS = 800;
const CLOCK_ON_AT = 0.72; // the clock appears once the timelines' top is this far up the window
const REVEAL = '.hero-copy > .eyebrow, .hero-copy > h1, .hero-copy > .answer, .hero-copy > .controls, .hero-copy > .metrics, .globe-wrap, .sec-head, .sites-wrap, .tl-grid, .sky, .rp-copy, .rp-compare, .methods h2, .m-lede, .m-grid > div';
const HEADER_AWAY_AFTER = 120; // px scrolled before the header may hide
const PARALLAX = 0.066; // px of headline drift per px of pointer travel, against the pointer
const ARROW =
  '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M200,88V192a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h84.69L58.34,69.66A8,8,0,0,1,69.66,58.34L184,172.69V88a8,8,0,0,1,16,0Z"/></svg>';

const root = document.documentElement;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const chars = (text) =>
  [...text].map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');

/** Turn plain labels into the rolling nav links, the pills and the menu letters. */
function upgradeMarkup() {
  document.querySelectorAll('.nav-item[data-roll]').forEach((a) => {
    const label = a.textContent.trim();
    a.innerHTML =
      `<span class="nav-item__a" aria-hidden="true">${chars(label)}</span>` +
      `<span class="nav-item__b" aria-hidden="true">${chars(label)}</span><span class="sr">${esc(label)}</span>`;
  });
  document.querySelectorAll('.btn[data-pill]').forEach((b) => {
    const label = esc(b.textContent.trim());
    b.innerHTML =
      `<span class="btn__fill" aria-hidden="true"></span>` +
      `<span class="btn__label"><span class="btn__t">${label}</span><span class="btn__t btn__t--in" aria-hidden="true">${label}</span></span>` +
      `<span class="btn__icon" aria-hidden="true"><span>${ARROW}</span><span>${ARROW}</span></span>`;
  });
  document.querySelectorAll('.menu__item').forEach((item, n) => {
    item.style.setProperty('--n', n);
    const lab = item.querySelector('[data-chars]');
    const label = lab.textContent.trim();
    lab.innerHTML = chars(label);
    lab.setAttribute('aria-hidden', 'true');
    lab.insertAdjacentHTML('afterend', `<span class="sr">${esc(label)}</span>`);
  });
}

export function initChrome() {
  upgradeMarkup();
  const home = document.querySelector('.home');
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.getElementById('menu');
  const items = [...menu.querySelectorAll('.menu__item')];
  let globe = null;
  let busy = false;

  // ───────────── Pages ─────────────
  const pageOf = (id) => (TOOL_ANCHORS.includes(id) ? 'tool' : 'home');

  function markCurrent(page) {
    items.forEach((a) => {
      const on = a.dataset.pageLink === page;
      a.classList.toggle('is-current', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function setPage(page) {
    root.dataset.page = page;
    markCurrent(page);
    globe?.setMode(page === 'home' ? 'home' : 'site');
  }

  function scrollToAnchor(id, behavior) {
    const el = id === 'navigator' || id === 'home' ? null : document.getElementById(id);
    if (el) el.scrollIntoView({ behavior, block: 'start' });
    else window.scrollTo({ top: 0, behavior });
  }

  /** Go to an anchor. Crossing between home and the navigator dissolves the page. */
  async function go(id, { push = true } = {}) {
    if (busy) return;
    const page = pageOf(id);
    if (push) {
      try {
        window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#${id}`);
      } catch {
        // file:// and some embeds refuse history changes. The page still switches.
      }
    }
    await closeMenu({ restore: false });
    if (page === root.dataset.page) {
      scrollToAnchor(id, reduce ? 'instant' : 'smooth');
      return;
    }
    busy = true;
    if (!reduce) {
      root.classList.add('leaving');
      await wait(LEAVE_MS);
    }
    home.classList.remove('is-in');
    root.classList.remove('header-away');
    setPage(page);
    scrollToAnchor(id, 'instant');
    syncClock();
    root.classList.remove('leaving');
    root.classList.add('arriving');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        root.classList.remove('arriving');
        if (page === 'home') home.classList.add('is-in');
        busy = false;
      }),
    );
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const id = a.getAttribute('href').slice(1);
    if (id !== 'home' && !TOOL_ANCHORS.includes(id)) return;
    e.preventDefault();
    go(id);
  });
  window.addEventListener('popstate', () => {
    const id = window.location.hash.slice(1);
    const plan = new URLSearchParams(window.location.search);
    plan.delete('look');
    go(id || ([...plan.keys()].length ? 'navigator' : 'home'), { push: false });
  });

  // On the navigator the header steps away on the way down and returns on the way up.
  let lastY = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) < 6) return;
      root.classList.toggle('header-away', y > lastY && y > HEADER_AWAY_AFTER);
      lastY = y;
    },
    { passive: true },
  );

  // The mission clock shows only while the timelines are on screen.
  const timelines = document.getElementById('timelines');
  const syncClock = () => {
    const on = root.dataset.page === 'tool' && timelines.getBoundingClientRect().top < window.innerHeight * CLOCK_ON_AT;
    root.classList.toggle('clock-on', on);
  };
  window.addEventListener('scroll', syncClock, { passive: true });
  window.addEventListener('resize', syncClock, { passive: true });

  // Content rises in once, the first time it comes on screen.
  if (!reduce && 'IntersectionObserver' in window) {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          seen.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    document.querySelectorAll(REVEAL).forEach((el) => {
      el.classList.add('will-reveal');
      seen.observe(el);
    });
  }

  // ───────────── Menu: a mask wipe from the right, items slide in, letters unfold ─────────────
  let open = false;
  let lastFocus = null;
  let closeTimer = null;

  function openMenu() {
    if (open) return;
    open = true;
    clearTimeout(closeTimer);
    lastFocus = document.activeElement;
    menu.hidden = false;
    void menu.offsetWidth; // start the transitions from the closed state
    menu.classList.add('is-open');
    root.classList.add('menu-open');
    toggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => items.find((i) => !i.classList.contains('is-current'))?.focus({ preventScroll: true }));
  }

  function closeMenu({ restore = true } = {}) {
    if (!open) return Promise.resolve();
    open = false;
    toggle.setAttribute('aria-expanded', 'false');
    menu.classList.remove('is-open');
    root.classList.remove('menu-open');
    if (restore && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    else toggle.focus({ preventScroll: true });
    return new Promise((resolve) => {
      closeTimer = setTimeout(() => {
        menu.hidden = true;
        resolve();
      }, reduce ? 0 : MENU_MS);
      // Page changes do not wait for the panel to finish sliding away.
      if (!restore) resolve();
    });
  }

  toggle.addEventListener('click', () => (open ? closeMenu() : openMenu()));
  menu.querySelector('[data-menu-close]').addEventListener('click', () => closeMenu());
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
    if (e.key === 'Tab') {
      // Keep Tab inside the menu and its toggle while it is open.
      const focusables = [toggle, ...menu.querySelectorAll('a[href]')];
      const i = focusables.indexOf(document.activeElement);
      const n = e.shiftKey ? i - 1 : i + 1;
      if (i === -1 || n < 0 || n >= focusables.length) {
        e.preventDefault();
        focusables[(n + focusables.length) % focusables.length].focus();
      }
    }
  });

  // ───────────── Cursor ring and the headline's drift against the pointer ─────────────
  const fine = window.matchMedia('(pointer: fine)').matches && !reduce;
  const cursor = document.querySelector('.cursor');
  const ring = cursor.querySelector('.cursor__ring');
  const title = home.querySelector('.home__title');
  const cta = home.querySelector('.home__cta');
  const c = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, mode: '', calm: 0, live: false, px: 0, py: 0 };
  let snap = null;

  function setMode(mode, el) {
    if (mode === c.mode && mode !== 'pill') return;
    const leavingPill = c.mode === 'pill' && mode !== 'pill';
    c.mode = mode;
    snap = mode === 'pill' ? el : null;
    cursor.classList.toggle('is-pill', mode === 'pill');
    cursor.classList.toggle('is-hidden', mode === 'hide');
    if (mode === 'pill') {
      const r = el.getBoundingClientRect();
      ring.style.width = `${r.width}px`;
      ring.style.height = `${Math.max(r.height + 6, 30)}px`;
    } else {
      ring.style.width = '';
      ring.style.height = '';
    }
    if (leavingPill) {
      // Leaving a link, the ring snaps back to a circle without stretching.
      c.vx = 0;
      c.vy = 0;
      c.calm = 0.18;
    }
  }

  if (fine) {
    root.classList.add('has-cursor');
    window.addEventListener(
      'pointermove',
      (e) => {
        c.tx = e.clientX;
        c.ty = e.clientY;
        if (!c.live) {
          c.live = true;
          c.x = c.tx;
          c.y = c.ty;
          cursor.classList.add('is-live');
        }
        globe?.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      },
      { passive: true },
    );
    document.addEventListener('pointerover', (e) => {
      const nav = e.target.closest('.nav-item');
      const hide = e.target.closest(
        'button, select, input, .btn, .disc, .orbit, .tl-track, .slip-cell, .globe, .surface, a:not(.nav-item):not(.logo)',
      );
      cursor.classList.toggle('is-dark', Boolean(e.target.closest('.menu__panel')));
      if (nav) setMode('pill', nav);
      else if (hide) setMode('hide');
      else setMode('');
    });
    document.documentElement.addEventListener('pointerleave', () => setMode('hide'));

    let last = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      let tx = c.tx;
      let ty = c.ty;
      if (snap) {
        const r = snap.getBoundingClientRect();
        tx = r.left + r.width / 2;
        ty = r.top + r.height / 2;
      }
      // Free, the ring keeps up with the mouse. The softer glide is only for landing on a nav link.
      const k = 1 - Math.pow(snap ? 0.8 : 0.4, dt * 60);
      const px = c.x;
      const py = c.y;
      c.x += (tx - c.x) * k;
      c.y += (ty - c.y) * k;
      const vx = (c.x - px) / Math.max(dt, 1e-3);
      const vy = (c.y - py) / Math.max(dt, 1e-3);
      c.vx += (vx - c.vx) * 0.3;
      c.vy += (vy - c.vy) * 0.3;
      c.calm = Math.max(0, c.calm - dt);
      const s = snap || c.calm > 0 ? 0 : Math.min(Math.hypot(c.vx, c.vy) / 2200, 0.55);
      const angle = Math.atan2(c.vy, c.vx);
      cursor.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
      ring.style.transform = `rotate(${angle}rad) scale(${1 + s}, ${1 - s}) rotate(${-angle}rad)`;

      if (root.dataset.page === 'home' && c.live) {
        const gx = -(c.tx - window.innerWidth / 2) * PARALLAX;
        const gy = -(c.ty - window.innerHeight / 2) * PARALLAX;
        const ease = 1 - Math.exp(-dt * 4);
        c.px += (gx - c.px) * ease;
        c.py += (gy - c.py) * ease;
        title.style.transform = `translate3d(${c.px.toFixed(2)}px, ${c.py.toFixed(2)}px, 0)`;
        cta.style.translate = `${(c.px * 0.6).toFixed(2)}px ${(c.py * 0.6).toFixed(2)}px`;
      }
    };
    requestAnimationFrame(tick);
  }

  // ───────────── Opening ─────────────
  function reveal() {
    root.classList.remove('entering', 'intro-on');
    if (root.dataset.page === 'home') requestAnimationFrame(() => home.classList.add('is-in'));
  }

  function runIntro() {
    const intro = document.querySelector('[data-intro]');
    if (!root.classList.contains('intro-on')) return reveal();
    const fill = intro.querySelector('[data-intro-fill]');
    const ready = { fonts: false, scene: false, moon: false, table: false };
    document.fonts?.ready.then(() => (ready.fonts = true));
    const check = () => {
      ready.scene = document.body.classList.contains('has-3d') || document.body.classList.contains('no-3d');
      ready.moon = document.body.classList.contains('moon-ready') || document.body.classList.contains('no-3d');
      ready.table =
        !document.getElementById('start-input').disabled || document.getElementById('plan-msg').classList.contains('is-error');
    };
    const t0 = performance.now();
    let shown = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      fill.style.clipPath = 'inset(0)';
      intro.classList.add('is-out');
      setTimeout(reveal, INTRO_OUT_MS);
    };
    // Frames stop in a background tab. The opening must still end.
    setTimeout(finish, INTRO_MAX_MS + 1000);
    const frame = (now) => {
      if (finished) return;
      check();
      const elapsed = now - t0;
      const done = Object.values(ready).filter(Boolean).length / Object.keys(ready).length;
      const loaded = elapsed > INTRO_MAX_MS ? 1 : 0.15 + 0.85 * done;
      const target = Math.min(loaded, elapsed / INTRO_MIN_MS);
      shown += (target - shown) * 0.12;
      fill.style.clipPath = `inset(${((1 - shown) * 100).toFixed(2)}% 0 0 0)`;
      if (shown < 0.995) return requestAnimationFrame(frame);
      finish();
    };
    requestAnimationFrame(frame);
  }

  markCurrent(root.dataset.page);
  syncClock();
  runIntro();

  return {
    /** Hand over the 3D globe once it has loaded, so the home screen can turn it into a horizon. */
    setGlobe(next) {
      globe = next;
      globe.setMode(root.dataset.page === 'home' ? 'home' : 'site');
    },
    go,
  };
}
