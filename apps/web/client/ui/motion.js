// Motion (V6, 26.10): the small shared module behind css/motion.css. No library; only opacity/transform are animated, so nothing moves the layout.
//   init()              once at boot: sets html.mo (the CSS hook for every start state) unless the visitor asked for reduced motion or the browser has no IntersectionObserver;
//                       follows a later change of the OS setting
//   enter(article,kind) a screen was painted: the header parts and the blocks of the first viewport rise in turn, the blocks further down get [data-rv] and appear when scrolled to
//                       (kind 'rerender' = a unit/period change on the same screen: no replay)
//   scan(article)       after hydration: bars (.prog-fill, .rank-fill) fill from the left and numbers (.prog-text, .kpi-num) count up when they come into view
//   settle()            finish everything NOW (final state): used before a picture export and when the safety timer runs out
//   cleanup()           before replacing a screen: stop counters and release all observed elements of the old page
// Without html.mo (reduced motion, no JS, an old browser) none of this runs and the page is complete. A safety timer shows whatever is in view and still waiting after 3 s.
const root = document.documentElement;
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const hasIO = typeof IntersectionObserver === 'function';
export const active = () => root.classList.contains('mo');

let rvIo = null,
  unitIo = null,
  safety = 0;
const units = new Map(); // observed element -> { fills:[…], counts:[…], i }
const counting = new Set(); // running count animations: { el, orig, stop }

export function init() {
  const sync = () => {
    const on = !!mq && !mq.matches && hasIO;
    root.classList.toggle('mo', on);
    if (!on) settle();
  };
  sync();
  mq?.addEventListener?.('change', sync);
}

function revealRv(el) {
  if (!el.hasAttribute('data-rv')) return;
  el.classList.add('rv-in');
  const done = () => {
    el.removeAttribute('data-rv');
    el.classList.remove('rv-in');
  };
  el.addEventListener(
    'transitionend',
    (e) => {
      if (e.target === el && e.propertyName === 'opacity') done();
    },
    { once: true },
  );
  setTimeout(done, 700); // transitionend never fires when the element is hidden: do not keep the hook
}

/** a jump (End, an anchor, a fast fling) can pass blocks without an observer ever seeing them: everything that is now at or above the lower edge of the view is shown / filled, so scrolling back never finds an empty block or an empty bar */
let sweepQueued = false;
function sweep() {
  sweepQueued = false;
  const edge = (innerHeight || 800) * 0.94;
  document.querySelectorAll('[data-rv]').forEach((el) => {
    if (el.getBoundingClientRect().top < edge) {
      rvIo?.unobserve(el);
      revealRv(el);
    }
  });
  for (const host of [...units.keys()]) if (host.getBoundingClientRect().top < edge) run(host);
}
addEventListener(
  'scroll',
  () => {
    if (sweepQueued || !active()) return;
    sweepQueued = true;
    requestAnimationFrame(sweep);
  },
  { passive: true },
);

/** the safety net: what is IN VIEW after 3 s but still waiting for its observer is shown at once (what is further down keeps waiting for the scroll) */
function arm() {
  clearTimeout(safety);
  safety = setTimeout(rescue, 3000);
}
function rescue() {
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (innerHeight || 800);
  };
  document.querySelectorAll('[data-rv]').forEach((el) => {
    if (inView(el)) {
      rvIo?.unobserve(el);
      revealRv(el);
    }
  });
  for (const host of [...units.keys()]) if (inView(host)) run(host);
}

/** a screen was painted */
export function enter(article, kind) {
  if (!active() || !article?.isConnected || article.classList.contains('page-bare')) return;
  if (kind === 'rerender') return;
  article.classList.add('enter-anim');
  const vh = innerHeight || 800;
  [...article.querySelectorAll(':scope > .page-body > *')].forEach((el, n) => {
    if (el.dataset.mo) return;
    el.dataset.mo = '1';
    const top = el.getBoundingClientRect().top;
    if (top < vh * 0.92) {
      el.classList.add('rv-enter');
      el.style.setProperty('--i', String(Math.min(5 + n, 9)));
    } else {
      el.setAttribute('data-rv', '');
      (rvIo ||= new IntersectionObserver(
        (es, observer) =>
          es.forEach((e) => {
            if (e.isIntersecting) {
              observer.unobserve(e.target);
              revealRv(e.target);
            }
          }),
        { rootMargin: '0px 0px -6% 0px' },
      )).observe(el);
    }
  });
  const next = article.querySelector(':scope > .next');
  if (next && !next.dataset.mo) {
    next.dataset.mo = '1';
    if (next.getBoundingClientRect().top >= vh * 0.92) {
      next.setAttribute('data-rv', '');
      (rvIo ||= new IntersectionObserver(
        (es, observer) =>
          es.forEach((e) => {
            if (e.isIntersecting) {
              observer.unobserve(e.target);
              revealRv(e.target);
            }
          }),
        { rootMargin: '0px 0px -6% 0px' },
      )).observe(next);
    }
  }
  article.addEventListener('focusin', (e) => {
    const b = e.target.closest?.('[data-rv]');
    if (b) {
      rvIo?.unobserve(b);
      revealRv(b);
    }
  }); // a keyboard user never lands in an invisible block
  scan(article);
  arm();
}

/* ---------------------------------------------------------------- bars and numbers */
function plan(el) {
  const m = /(\d[\d   ]*(?:,\d+)?)/.exec(el.textContent || '');
  if (!m || el.childElementCount) return null;
  const raw = m[1],
    sep = (/[   ]/.exec(raw) || [''])[0],
    dec = (raw.split(',')[1] || '').length;
  const val = parseFloat(raw.replace(/[   ]/g, '').replace(',', '.'));
  if (!isFinite(val) || val === 0) return null;
  return {
    pre: el.textContent.slice(0, m.index),
    post: el.textContent.slice(m.index + raw.length),
    sep,
    dec,
    val,
  };
}
const fmt = (p, v) => {
  const [i, d] = v.toFixed(p.dec).split('.');
  return (
    p.pre + (p.sep ? i.replace(/\B(?=(\d{3})+(?!\d))/g, p.sep) : i) + (d ? ',' + d : '') + p.post
  );
};
function countUp(el, delay) {
  const p = plan(el);
  if (!p) return;
  const orig = el.textContent,
    w = el.getBoundingClientRect().width,
    keep = { d: el.style.display, w: el.style.minWidth };
  if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
  el.style.minWidth = `${Math.ceil(w)}px`; // the final width is reserved: the digits never move their neighbours
  const rec = { el, orig, stop: null };
  const t0 = performance.now() + delay,
    T = 700;
  let raf = 0,
    over = false;
  const end = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    el.textContent = orig;
    el.style.display = keep.d;
    el.style.minWidth = keep.w;
    counting.delete(rec);
  };
  rec.stop = end;
  counting.add(rec);
  el.textContent = fmt(p, 0);
  const tick = (now) => {
    if (over) return;
    const k = Math.min(1, Math.max(0, (now - t0) / T));
    if (k >= 1) {
      end();
      return;
    }
    el.textContent = fmt(p, p.val * (1 - Math.pow(1 - k, 3)));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function run(host) {
  const u = units.get(host);
  if (!u) return;
  units.delete(host);
  unitIo.unobserve(host);
  u.fills.forEach((f) => {
    f.style.setProperty('--pi', String(u.i));
    f.setAttribute('data-pg', '1');
  });
  u.counts.forEach((c) => countUp(c, u.i * 55));
  const clean = () =>
    u.fills.forEach((f) => {
      f.removeAttribute('data-pg');
      f.style.removeProperty('--pi');
    });
  setTimeout(clean, 900 + u.i * 55);
}

/** bars and numbers of the screen: wait until they are in view, then fill / count */
export function scan(article) {
  if (!active() || !article?.isConnected || article.classList.contains('page-bare')) return;
  unitIo ||= new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) run(e.target);
      }),
    { threshold: 0.2 },
  );
  let n = 0;
  for (const prog of article.querySelectorAll('.prog')) {
    if (prog.dataset.mo) continue;
    prog.dataset.mo = '1';
    const fills = [...prog.querySelectorAll('.prog-fill')];
    fills.forEach((f) => f.setAttribute('data-pg', '0'));
    units.set(prog, {
      fills,
      counts: [...prog.querySelectorAll('.prog-text')].filter(
        (el) => !el.closest('[data-st="pending"]'),
      ),
      i: n++ % 4,
    });
    unitIo.observe(prog);
  }
  for (const f of article.querySelectorAll('.rank-fill')) {
    if (f.dataset.mo) continue;
    f.dataset.mo = '1';
    f.setAttribute('data-pg', '0');
    const host = f.parentElement || f;
    const u = units.get(host) || { fills: [], counts: [], i: n++ % 4 };
    u.fills.push(f);
    units.set(host, u);
    unitIo.observe(host);
  }
  for (const k of article.querySelectorAll('.kpi-num')) {
    if (k.dataset.mo) continue;
    k.dataset.mo = '1';
    if (!plan(k)) continue;
    units.set(k, { fills: [], counts: [k], i: n++ % 4 });
    unitIo.observe(k);
  }
  arm();
}

/** the final state, now */
export function settle() {
  clearTimeout(safety);
  document.querySelectorAll('[data-rv]').forEach((el) => {
    rvIo?.unobserve(el);
    el.removeAttribute('data-rv');
    el.classList.remove('rv-in');
  });
  for (const host of [...units.keys()]) {
    const u = units.get(host);
    units.delete(host);
    unitIo?.unobserve(host);
    u.fills.forEach((f) => {
      f.removeAttribute('data-pg');
      f.style.removeProperty('--pi');
    });
  }
  document.querySelectorAll('[data-pg]').forEach((f) => {
    f.removeAttribute('data-pg');
    f.style.removeProperty('--pi');
  });
  for (const r of [...counting]) r.stop();
}

/** route replacement must release below-fold targets too: detached elements never intersect or appear in document queries */
export function cleanup() {
  settle();
  rvIo?.disconnect();
  unitIo?.disconnect();
  rvIo = unitIo = null;
}

addEventListener('beforeprint', () => settle());
