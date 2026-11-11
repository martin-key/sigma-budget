// Global view state (v4: light only, so there is no theme preference). Preferences persist in localStorage (always in try/catch, in-memory fallback);
// the banner dismissal lives in sessionStorage. Changing a key notifies subscribers; the router re-renders
// the current screen for period / userType / unit / perPerson / leva / onlyReal.
import { serverScope } from './env.js';

import { PERIODS, DEFAULT_PERIOD, resolvePeriod, periodByKey } from './periods.js';
export { PERIODS, DEFAULT_PERIOD } from './periods.js';
export const USER_TYPES = [
  { id: 'citizen', label: 'Гражданин', hint: 'Колко плащам и за какво отиват парите.' },
  {
    id: 'journalist',
    label: 'Журналист',
    hint: 'Какво се променя спрямо 2025 г. и кои са най-големите промени.',
  },
  { id: 'expert', label: 'Експерт', hint: 'Изпълнение по месеци, таблици и източници.' },
];
export const SCOPES = {
  kfp: { label: 'КФП', long: 'Консолидирана фискална програма', gl: 'kfp' },
  nat: {
    label: 'Национален бюджет',
    long: 'Национален бюджет, без европейските средства',
    gl: null,
  },
  eu: { label: 'Европейски средства', long: 'Средствата от ЕС, включени в КФП', gl: null },
  zdd: { label: 'ЗДД', long: 'Държавен дълг по Закона за държавния дълг', gl: 'darzhaven-dalg' },
  maastricht: {
    label: 'Маастрихт',
    long: 'Дълг на сектор „Държавно управление“ по методиката на Маастрихт',
    gl: 'sektor-darzhavno-upravlenie',
  },
  esa: {
    label: 'ЕСС · начислено',
    long: 'ЕСС 2010: начислена основа, сектор „Държавно управление“ (не е КФП, не е касова основа)',
    gl: 'ess-2010',
    variant: 'esa',
  },
};
/** Roles «гражданин / журналист / експерт». OPEN DECISION (V5): the UX V2 PDF recommends no role selector in the main flow, the team has not decided.
    false = no selector in the menu, every screen keeps the citizen view and a saved role is ignored. Set true to bring the selector back: it is
    listed in the settings again (js/shell.js), the saved choice is read again and a change re-renders the screen (js/router.js). */
export const ROLE_SELECTOR = false;
const KEY = 'bns.prefs.v1';
const DEFAULTS = {
  period: DEFAULT_PERIOD,
  userType: 'citizen',
  scope: 'kfp',
  unit: 'eur',
  perPerson: false,
  leva: false,
  onlyReal: false,
  sources: false,
  periodRequested: null,
  periodNotice: '',
};
const VALID = {
  periodRequested: (v) => v == null || typeof v === 'string',
  periodNotice: (v) => typeof v === 'string',
  period: (v) => PERIODS.some((p) => p.key === v),
  userType: (v) => USER_TYPES.some((t) => t.id === v),
  scope: (v) => typeof v === 'string' && Object.hasOwn(SCOPES, v), // own keys only: 'constructor' / 'toString' are not scopes
  unit: (v) => v === 'eur' || v === 'pct',
  perPerson: (v) => typeof v === 'boolean',
  leva: (v) => typeof v === 'boolean',
  onlyReal: (v) => typeof v === 'boolean',
  sources: (v) => typeof v === 'boolean',
};
/* V6 (26.10): the three switches «Само официални данни», «На човек», «Сумите и в лева» (and the sources tags) have no control any more: they stay at their default (off) and an old stored value is NEVER read */
const PERSIST = ['userType', 'scope', 'unit']; // period lives in the URL (?per=)

/** safe storage accessors: never throw, return null/false when blocked */
export const safe = {
  get(store, k) {
    try {
      return window[store].getItem(k);
    } catch {
      return null;
    }
  },
  set(store, k, v) {
    try {
      window[store].setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  del(store, k) {
    try {
      window[store].removeItem(k);
    } catch {
      /* blocked */
    }
  },
};
const own = { ...DEFAULTS };
/** the server (js/env.js) gives every request its own view state: the period of its address, the defaults for the rest */
const S = () => serverScope()?.state || own;
const state = new Proxy(
  {},
  {
    get: (_, k) => S()[k],
    set: (_, k, v) => {
      S()[k] = v;
      return true;
    },
    has: (_, k) => k in S(),
    ownKeys: () => Reflect.ownKeys(S()),
    getOwnPropertyDescriptor: (_, k) => Object.getOwnPropertyDescriptor(S(), k),
  },
);
/** the view state a server request starts from: the defaults, and the period of the address when it is a valid one */
export const requestState = (per) => ({
  ...DEFAULTS,
  period: resolvePeriod(per).resolved,
  periodRequested: per ?? null,
});
try {
  const saved = JSON.parse(safe.get('localStorage', KEY) || '{}');
  for (const k of PERSIST)
    if (Object.hasOwn(saved, k) && VALID[k](saved[k]) && (k !== 'userType' || ROLE_SELECTOR))
      state[k] = saved[k];
} catch {
  /* corrupt JSON: keep defaults */
}
const subs = new Set();

export const store = {
  PERIODS,
  USER_TYPES,
  SCOPES,
  get: (k) => state[k],
  set(k, v) {
    if (!Object.hasOwn(VALID, k) || !VALID[k](v) || (k === 'userType' && !ROLE_SELECTOR))
      return false;
    if (JSON.stringify(state[k]) === JSON.stringify(v)) return false;
    state[k] = v;
    if (PERSIST.includes(k))
      safe.set(
        'localStorage',
        KEY,
        JSON.stringify(Object.fromEntries(PERSIST.map((x) => [x, state[x]]))),
      );
    subs.forEach((f) => {
      try {
        f(k, v);
      } catch (e) {
        console.error(e);
      }
    });
    return true;
  },
  /** subscribe(fn(key, value)) -> unsubscribe */
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  get period() {
    return periodByKey(state.period);
  },
  get userTypeInfo() {
    return USER_TYPES.find((t) => t.id === state.userType) || USER_TYPES[0];
  },
  snapshot: () => ({ ...state }),
  /** the share link of a view carries the period only when it is not the default */
  periodParam: () => (state.period === DEFAULT_PERIOD ? undefined : state.period),
  periodByKey: (k) => PERIODS.find((p) => p.key === k),
  bannerDismissed: () => safe.get('sessionStorage', 'bns.banner') === '1',
  dismissBanner: () => safe.set('sessionStorage', 'bns.banner', '1'),
};
