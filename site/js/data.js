// Lazy JSON loader with a cache, following mock/DATA_SPEC.md.  data.load('execution') -> site/data/execution.json
//   mock/payments -> data/mock/payments.json, ministries/1300 -> data/ministries/1300.json
// A file that does not exist (404, or an HTML fallback page) is a PENDING state, not an error:
// pages render the „Предстои“ component for it. A network failure is a LoadError (the „Опитай пак“ state).
export class PendingError extends Error { constructor(name) { super('pending: ' + name); this.name = 'PendingError'; this.file = name; } }
export class LoadError extends Error { constructor(name, cause) { super('load failed: ' + name); this.name = 'LoadError'; this.file = name; this.cause = cause; } }
import { ROOT } from './loc.js';
const OK_NAME = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;
const cache = new Map();   // name -> Promise<json>
const done = new Map();    // name -> json (sync access after resolve)

// execution.json, contract v2 (tools/mock/exec_contract.py): money as decimal strings ("33898.456"), percentages as numbers. The pages
// compute with numbers, so the loader turns the money into numbers once; the file as published stays on `canonical` (not enumerable),
// for the exports, which must carry the published decimals (docs/approach-specification.md, section 6.1). Version 1 passes unchanged.
const COLS = ['kfp', 'nat', 'eu'];
const num = v => (v == null ? null : Number(v));
function execNumbers(text) {
  const out = JSON.parse(text);
  if (!out || !out.contract || out.contract.schema !== 2) return out;
  const series = blocks => { for (const b of Object.values(blocks || {})) for (const c of COLS) for (const [r, a] of Object.entries(b[c] || {})) b[c][r] = a.map(num); };
  series(out.data);
  series(out.monthly);
  for (const c of COLS) {
    const plan = out.plan2026?.[c] || {};
    for (const k of Object.keys(plan)) plan[k] = num(plan[k]);
    for (const d of Object.values(out.latest?.[c] || {})) for (const k of ['cum', 'plan', 'prevYearCum']) if (k in d) d[k] = num(d[k]);
  }
  for (const [key, rec] of Object.entries(out.reconcile || {})) if (key.startsWith('dec')) for (const d of Object.values(rec)) for (const k of ['kfp', 'annex3', 'diff']) d[k] = num(d[k]);
  Object.defineProperty(out, 'canonical', { value: JSON.parse(text), enumerable: false });
  return out;
}
const ADAPT = { execution: execNumbers };

function fetchJson(name) {
  if (!OK_NAME.test(name)) return Promise.reject(new PendingError(name));
  return fetch(new URL(`data/${name}.json`, ROOT)).then(async res => {
    if (res.status === 404) throw new PendingError(name);
    if (!res.ok) throw new LoadError(name, res.status);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new PendingError(name);      // SPA/HTML fallback = the file does not exist
    try { return ADAPT[name] ? ADAPT[name](text) : JSON.parse(text); } catch (e) { throw new LoadError(name, e); }
  }, e => { throw new LoadError(name, e); });
}
const raceAbort = (p, signal) => (!signal ? p : new Promise((ok, no) => {
  if (signal.aborted) return no(new DOMException('Aborted', 'AbortError'));
  signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')), { once: true });
  p.then(ok, no);
}));

export const data = {
  PendingError, LoadError,
  /** load(name, {signal, demo}) ; demo 'error' | 'pending' simulates a failure for ?demo= */
  load(name, o = {}) {
    if (o.demo === 'error') return Promise.reject(new LoadError(name, 'demo'));
    if (o.demo === 'pending') return Promise.reject(new PendingError(name));
    let p = cache.get(name);
    if (!p) {
      p = fetchJson(name).then(j => { done.set(name, j); return j; }, e => { if (e instanceof LoadError) cache.delete(name); throw e; });
      cache.set(name, p);
    }
    return raceAbort(p, o.signal);
  },
  /** already loaded? returns the json or undefined (never fetches) */
  get: name => done.get(name),
  /** warm the cache without waiting for it and without throwing */
  prefetch(name) { data.load(name).catch(() => {}); },
  reset() { cache.clear(); done.clear(); },
  /** status of a node with inheritance (node.status, else the file's meta.status) */
  statusOf: (node, doc) => node?.status || doc?.meta?.status || 'real',
  /** source keys of a node with inheritance */
  sourceOf: (node, doc) => node?.source || doc?.meta?.source || [],
  /** core.sources entry, or a minimal stub so a popover always has something to show */
  source(key) { return done.get('core')?.sources?.[key] || { title: key, publisher: '', url: '', kind: '', access: '', note: '' }; },
  pending: id => done.get('core')?.pending?.[id]
};
