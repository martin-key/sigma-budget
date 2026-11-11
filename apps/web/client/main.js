// Boot: core data (small, eager) -> shell -> router.  Everything else loads lazily.
import { store } from './store.js';
import { migratePeriod, resolvePeriod } from './periods.js';
import { data } from './data.js';
import { router, dropStalePrerender } from './router.js';
import { shell } from './shell.js';
import { initActions } from './actions.js';
import * as motion from './ui/motion.js';
import { watchLinks, ROOT } from './loc.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  const initial = router.parseHash(location.hash.startsWith('#/') ? location.hash : location.pathname + location.search).query;
  store.set('period', resolvePeriod(initial.per).resolved);
  store.set('periodRequested', initial.per ?? null);
  dropStalePrerender();                                           // the HTML of another address is not shown while the data loads
  if (document.documentElement.hasAttribute('data-prerendered')) {
    const seed = document.getElementById('react-screen-seed');
    if (seed) data.adoptTextSeed(JSON.parse(seed.textContent));
  }
  // core.json carries the source cards and the „Предстои“ texts; do not hold the first paint for more than ~1.5 s
  const coreP = data.load('core').catch(() => null);
  await Promise.race([coreP, wait(1500)]);
  motion.init();
  watchLinks();                                                   // path mode: old #/x links in pages and data become /x (js/loc.js)
  const bridge = await import('./react-bridge.js');
  const refreshChrome = () => {
    const r = router.current?.route || router.routes.find(r=>r.id === document.querySelector('article.page')?.dataset.route);
    bridge.refreshChrome({route:r,periods:r?.periods,wide:window.matchMedia('(min-width: 961px)').matches,cur:r?.id,from:location.pathname.replace(/^\//,'')});
  };
  shell.init(refreshChrome);
  initActions();
  coreP.then(() => { shell.refreshFooter(); });
  data.prefetch('releases/current');                            // the release ID that every CSV names (js/share.js csvMeta)
  await router.start();
  const beforeMigration = location.href;
  const migration = migratePeriod({ address: location.href,
    get: key => localStorage.getItem(key), set: (key, value) => localStorage.setItem(key, value),
    replace: url => history.replaceState(history.state, '', url) });
  if (location.href !== beforeMigration) { await router.rerender(); store.set('periodNotice', migration?.resolved === store.get('period') ? migration.notice || '' : ''); refreshChrome(); }
  registerWorker();
}

function registerWorker() {
  try {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', () => { navigator.serviceWorker.register(new URL('sw.js', ROOT)).catch(() => {}); }, { once: true });
    if (document.readyState === 'complete') navigator.serviceWorker.register(new URL('sw.js', ROOT)).catch(() => {});
  } catch { /* a service worker is an enhancement */ }
}

boot().catch(e => {
  console.error(e);
  const v = document.getElementById('view');
  if (v) { v.removeAttribute('aria-busy'); v.textContent = 'Не успяхме да заредим сайта. Опресни страницата и опитай пак.'; }
});
