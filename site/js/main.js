// Boot: core data (small, eager) -> shell -> router.  Everything else loads lazily.
import { data } from './data.js';
import { router } from './router.js';
import { shell } from './shell.js';
import { initActions } from './actions.js';
import * as motion from './ui/motion.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  // core.json carries the source cards and the „Предстои“ texts; do not hold the first paint for more than ~1.5 s
  const coreP = data.load('core').catch(() => null);
  await Promise.race([coreP, wait(1500)]);
  motion.init();
  shell.init();
  initActions();
  coreP.then(() => { shell.refreshFooter(); });
  await router.start();
  registerWorker();
}

function registerWorker() {
  try {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); }, { once: true });
    if (document.readyState === 'complete') navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch { /* a service worker is an enhancement */ }
}

boot().catch(e => {
  console.error(e);
  const v = document.getElementById('view');
  if (v) { v.removeAttribute('aria-busy'); v.textContent = 'Не успяхме да заредим сайта. Опресни страницата и опитай пак.'; }
});
