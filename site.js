/* Purremium Dining — shared behaviour */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer  = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------- brand: paw wiggle + left-to-right letter wave ---------- */
const brand = document.querySelector('.brand');
const brandText = brand && brand.querySelector('.brand-text');

// Timing lives here and is pushed into CSS as custom properties, so the
// reset timer below can never drift out of sync with the animation.
const WAVE_STAGGER  = 40;   // ms between one letter and the next
const WAVE_DURATION = 500;  // ms for a single letter's hop

if (brandText && !reduceMotion) {
  const label = brandText.textContent;

  // Rebuild the name one letter per span so the wave can be staggered
  // left to right. nbsp keeps the word gap from collapsing.
  brandText.textContent = '';
  const letters = [...label].map((ch, i) => {
    const span = document.createElement('span');
    span.textContent = ch === ' ' ? ' ' : ch;
    span.style.setProperty('--i', i);
    brandText.appendChild(span);
    return span;
  });
  // Screen readers should hear the name, not sixteen separate letters.
  brandText.setAttribute('aria-label', label);

  brand.style.setProperty('--stagger', WAVE_STAGGER + 'ms');
  brand.style.setProperty('--wave-dur', WAVE_DURATION + 'ms');

  // Last letter starts latest, so that's when the cycle is over.
  const cycleMs = WAVE_STAGGER * (letters.length - 1) + WAVE_DURATION;

  brand.addEventListener('mouseenter', () => {
    // Re-entry mid-cycle is ignored; the run has to finish first.
    if (brand.classList.contains('wave')) return;
    brand.classList.add('wave');
    // Deterministic reset — doesn't rely on animationend arriving, which
    // a background tab will never deliver.
    setTimeout(() => brand.classList.remove('wave'), cycleMs + 60);
  });
}

// Shadow under the sticky nav once the page has scrolled.
const nav = document.getElementById('nav');
if (nav) {
  const onScroll = () => nav.classList.toggle('stuck', window.scrollY > 40);
  onScroll();
  window.addEventListener('scroll', onScroll, {passive: true});
}

// Fade content in as it enters the viewport.
const revealables = document.querySelectorAll('.reveal');
if (revealables.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, {threshold: .12, rootMargin: '0px 0px -40px 0px'});

  revealables.forEach((el, i) => {
    el.style.transitionDelay = (i % 4) * 70 + 'ms';
    io.observe(el);
  });
}

/* ============================================================
   Laser pointer cursor + googly eyes that track it.

   The eye sockets are two exact circles burned into the source
   photo. Measured at native 1920x800:
       left  socket  centre (906.1, 278.1)  r 39.5
       right socket  centre (1054.2, 306.1) r 39.5
   Everything below is derived from those numbers, so the pupils
   stay glued to the artwork however the image is scaled.
   ============================================================ */

const IMG_W = 1920;
const IMG_H = 800;
const SOCKETS = [
  {x: 906.1,  y: 278.1, r: 39.5},
  {x: 1054.2, y: 306.1, r: 39.5},
];

// Pupil is 60% of the socket, so its centre can travel at most
// (1 - 0.6) = 40% of the socket radius before it would touch the rim.
const PUPIL_SCALE = 0.60;
const MAX_TRAVEL  = (1 - PUPIL_SCALE);   // × socket radius
const EASE_RANGE  = 260;                 // px: below this the gaze eases off centre
const FOLLOW      = reduceMotion ? 1 : 0.22;
const HALO_FOLLOW = reduceMotion ? 1 : 0.30;

const pointer = {x: innerWidth / 2, y: innerHeight / 2, seen: false};

// The laser cursor is opt-in per page (<body data-laser>) — only the
// front page gets it, everywhere else keeps the normal system cursor.
const heroEl = document.getElementById('hero');
const laserEnabled = finePointer && document.body.hasAttribute('data-laser');

/* ---------- pointer tracking (needed by the laser and the eyes) ---------- */
let laserCore = null, laserHalo = null;
const halo = {x: pointer.x, y: pointer.y};

if (laserEnabled || heroEl) {
  window.addEventListener('mousemove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (!pointer.seen) {
      pointer.seen = true;
      halo.x = pointer.x; halo.y = pointer.y;
      if (laserEnabled) document.documentElement.classList.add('laser-on');
    }
    if (laserCore) {
      const hot = !!(e.target.closest && e.target.closest('a, button, .btn, input, select, textarea, label'));
      laserCore.classList.toggle('hot', hot);
      laserHalo.classList.toggle('hot', hot);
    }
  }, {passive: true});

  // Touch: no laser to draw, but the eyes can still follow a finger.
  window.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (t) { pointer.x = t.clientX; pointer.y = t.clientY; pointer.seen = true; }
  }, {passive: true});
}

/* ---------- the laser dot ---------- */
if (laserEnabled) {
  const makeLaserPart = (cls) => {
    const el = document.createElement('div');
    el.className = 'laser ' + cls;
    el.setAttribute('aria-hidden', 'true');
    el.appendChild(document.createElement('i'));
    return el;
  };
  laserHalo = makeLaserPart('laser-halo');
  laserCore = makeLaserPart('laser-core');
  document.body.append(laserHalo, laserCore);

  // Laser off when it leaves the window, back on when it returns.
  document.addEventListener('mouseleave', () => {
    laserCore.style.opacity = laserHalo.style.opacity = '0';
  });
  document.addEventListener('mouseenter', () => {
    laserCore.style.opacity = laserHalo.style.opacity = '';
  });
}

/* ---------- the eyes ---------- */
const hero   = heroEl;
const googly = document.getElementById('googly');
const eyes = [];

if (hero && googly) {
  const socketEls = googly.querySelectorAll('.socket');

  socketEls.forEach((el, i) => {
    eyes.push({
      el,
      pupil: el.querySelector('.pupil'),
      spec: SOCKETS[i],
      cx: 0, cy: 0, max: 0,   // live viewport centre + travel limit
      x: 0, y: 0,             // current pupil offset
    });
  });

  // Map image-space circles onto the rendered element.
  // .hero-img uses object-fit:cover / object-position:center, so we
  // reproduce that transform rather than assuming the box matches.
  let geo = {scale: 1, ox: 0, oy: 0};

  function layout() {
    const w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return;

    const scale = Math.max(w / IMG_W, h / IMG_H);      // "cover"
    const ox = (w - IMG_W * scale) / 2;                // "center"
    const oy = (h - IMG_H * scale) / 2;
    geo = {scale, ox, oy};

    eyes.forEach(eye => {
      const {x, y, r} = eye.spec;
      const size = r * 2 * scale;
      eye.el.style.width  = size + 'px';
      eye.el.style.height = size + 'px';
      eye.el.style.left   = (ox + (x - r) * scale) + 'px';
      eye.el.style.top    = (oy + (y - r) * scale) + 'px';
      eye.max = r * scale * MAX_TRAVEL;
    });
  }

  layout();
  new ResizeObserver(layout).observe(hero);
  // The image can settle after decode; re-measure once it's in.
  const img = hero.querySelector('.hero-img');
  if (img && !img.complete) img.addEventListener('load', layout, {once: true});

  // Only animate while the hero is actually on screen. rafId guards
  // against the observer kicking off a second concurrent loop.
  let running = true;
  let rafId = 0;
  const start = () => { if (!rafId) rafId = requestAnimationFrame(tick); };
  const stop  = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };

  new IntersectionObserver(([entry]) => {
    running = entry.isIntersecting;
    running ? start() : stop();
  }, {threshold: 0}).observe(hero);

  function tick() {
    rafId = 0;

    // Hero position in viewport coords, live (cheap: one rect per frame).
    const rect = hero.getBoundingClientRect();

    for (const eye of eyes) {
      const cx = rect.left + geo.ox + eye.spec.x * geo.scale;
      const cy = rect.top  + geo.oy + eye.spec.y * geo.scale;

      let tx = 0, ty = 0;
      if (pointer.seen) {
        const dx = pointer.x - cx;
        const dy = pointer.y - cy;
        const dist = Math.hypot(dx, dy);

        if (dist > 0.5) {
          // Ease the gaze in near the eye so it never snaps or jitters,
          // then pin at full deflection once the laser is further away.
          const t = Math.min(1, dist / EASE_RANGE);
          const eased = t * t * (3 - 2 * t);          // smoothstep
          tx = (dx / dist) * eye.max * eased;
          ty = (dy / dist) * eye.max * eased;
        }
      }

      eye.x += (tx - eye.x) * FOLLOW;
      eye.y += (ty - eye.y) * FOLLOW;

      // Belt and braces: clamp the offset to the socket regardless.
      const len = Math.hypot(eye.x, eye.y);
      if (len > eye.max) {
        eye.x = (eye.x / len) * eye.max;
        eye.y = (eye.y / len) * eye.max;
      }

      eye.pupil.style.transform =
        `translate3d(${eye.x.toFixed(2)}px, ${eye.y.toFixed(2)}px, 0)`;
    }

    if (running) start();
  }

  start();
}

/* ---------- laser render loop ---------- */
if (laserEnabled) {
  (function drawLaser() {
    halo.x += (pointer.x - halo.x) * HALO_FOLLOW;
    halo.y += (pointer.y - halo.y) * HALO_FOLLOW;

    // Core is exact — a laser doesn't lag. The halo trails a touch.
    laserCore.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`;
    laserHalo.style.transform = `translate3d(${halo.x.toFixed(2)}px, ${halo.y.toFixed(2)}px, 0)`;

    requestAnimationFrame(drawLaser);
  })();
}

/* ---------- booking form ---------- */
// Static site, so this only shows a local confirmation.
const bookingForm = document.getElementById('booking-form');
if (bookingForm) {
  const confirmBox = document.getElementById('booking-confirm');
  const dateInput = bookingForm.querySelector('#date');
  if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(bookingForm);
    const who = (data.get('name') || 'friend').toString().trim().split(' ')[0] || 'friend';
    document.getElementById('confirm-name').textContent = who;
    document.getElementById('confirm-detail').textContent =
      `${data.get('guests')} guest(s) · ${data.get('date')} at ${data.get('time')}`;
    bookingForm.style.display = 'none';
    confirmBox.classList.add('show');
    confirmBox.scrollIntoView({behavior: reduceMotion ? 'auto' : 'smooth', block: 'center'});
  });
}
