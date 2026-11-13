import { resolvePeriod, DEFAULT_PERIOD } from './periods.js';
import { toHref } from './loc.js';
import { ROUTES, GROUPS } from '../app/lib/routes.ts';
export { ROUTES, GROUPS } from '../app/lib/routes.ts';
export { SCREEN_QUERY, screenQuery, screenSearch } from '../app/lib/query-params.ts';
export const byId = Object.fromEntries(ROUTES.map(r => [r.id, r]));
export const byKey = Object.fromEntries(ROUTES.map(r => [r.key, r]));
export const NOT_FOUND = byId.S30;

/** Does the address of a screen with these periods keep the chosen one when the visitor goes there (js/router.js go, the header and footer
 *  links)? Yes when the screen shows it ('all', or a list with it) and when it does not depend on the period at all ('none'): the year stays
 *  in the header on every screen, so the choice must survive the screens without one (and a reload there). */
export const keepsPeriod = (periods, period) => periods === 'all' || periods === 'none' || (Array.isArray(periods) && periods.includes(period));
/** Keep a selected historical publication when the destination supports it. The links inside a screen name only the publications the
 *  target shows (the published HTML stays as it was); a click on one still carries the choice, router.go adds it by keepsPeriod. */
export function periodHref(period, id, params = {}, query = {}) {
  const target = byId[id] || byKey[id];
  const preserve = period && period !== DEFAULT_PERIOD && (target?.periods === 'all' || target?.periods?.includes?.(period));
  return href(id, params, { ...(preserve ? { per: period } : {}), ...query });
}

/* ---- matching ---- */
// pattern segment grammar: literal | :name | :name? | :name(regex) | :name(regex)?   (optional only at the end)
const compiled = ROUTES.filter(r => r.pattern).map(r => ({
  r,
  segs: r.pattern.split('/').filter(Boolean).map(s => {
    const m = /^:(\w+)(?:\(([^)]+)\))?(\?)?$/.exec(s);
    return m ? { name: m[1], re: m[2] ? new RegExp('^(?:' + m[2] + ')$') : null, opt: !!m[3] } : { lit: s };
  })
})).sort((a, b) => b.segs.length - a.segs.length);   // longer patterns first: /razhodi/:fn/deynosti before /razhodi/:fn before /razhodi

/** match(['razhodi','obrazovanie']) -> {route, params, canon:['razhodi','obrazovanie']} | null */
export function match(segs) {
  for (const { r, segs: ps } of compiled) {
    const required = ps.filter(p => !p.opt).length;
    if (segs.length < required || segs.length > ps.length) continue;
    const params = {}, canon = [];
    let ok = true;
    for (let i = 0; i < ps.length && ok; i++) {
      const p = ps[i], v = segs[i];
      if (v === undefined) { if (!p.opt) ok = false; continue; }
      if (p.lit !== undefined) { if (p.lit === v.toLowerCase()) canon.push(p.lit); else ok = false; }
      else if (p.re) {
        const lv = v.toLowerCase();
        if (p.re.test(v)) { params[p.name] = v; canon.push(v); }
        else if (p.re.test(lv)) { params[p.name] = lv; canon.push(lv); }
        else ok = false;
      } else { params[p.name] = v; canon.push(v); }
    }
    if (ok) return { route: r, params, canon };
  }
  return null;
}

/** href('S06', {source:'dds'}, {per:'2026.law'}) -> '/prihodi/dds?per=2026.law' (hash mode: '#/prihodi/dds?per=2026.law', js/loc.js) ; accepts id or key */
export function href(idOrKey, params = {}, query = {}) {
  const r = byId[idOrKey] || byKey[idOrKey];
  if (!r || !r.pattern) return toHref('/');
  const parts = r.pattern.split('/').filter(Boolean).map(s => {
    const m = /^:(\w+)/.exec(s);
    return m ? params[m[1]] : s;
  }).filter(v => v != null && v !== '');
  if (query.per != null) query = { ...query, per: resolvePeriod(query.per).resolved };
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString();
  return toHref('/' + parts.map(encodeURIComponent).join('/') + (q ? '?' + q : ''));
}
/** the step of the (merged) guide a screen belonged to, inherited from its parent screen (S08 shows step 3); data only, the interface no longer shows steps */
export const stepOf = r => r.step ?? (r.parent ? stepOf(byId[r.parent]) : null);
/** parent chain from the root: [S07, S08] for a screen two levels down */
export function chainOf(r) { const out = []; for (let p = r.parent && byId[r.parent]; p; p = p.parent && byId[p.parent]) out.unshift(p); return out; }

if (typeof window !== 'undefined') {
  window.__ROUTES__ = ROUTES.map(r => ({ id: r.id, key: r.key, pattern: r.pattern, title: r.title, group: r.group, step: r.step, next: r.next, parent: r.parent, phase: r.phase, bare: !!r.bare, nav: r.nav, periods: r.periods, samples: r.samples }));
}
