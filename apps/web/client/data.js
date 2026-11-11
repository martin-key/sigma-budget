// Lazy JSON loader with a cache, following mock/DATA_SPEC.md.  data.load('execution') -> data/release/execution.json
//   mock/payments -> data/mock/payments.json, ministries/1300 -> data/ministries/1300.json
// A file that does not exist (404, or an HTML fallback page) is a PENDING state, not an error:
// pages render the „Предстои“ component for it. A network failure is a LoadError (the „Опитай пак“ state).
export class PendingError extends Error {
  constructor(name) {
    super('pending: ' + name);
    this.name = 'PendingError';
    this.file = name;
  }
}
export class LoadError extends Error {
  constructor(name, cause) {
    super('load failed: ' + name);
    this.name = 'LoadError';
    this.file = name;
    this.cause = cause;
  }
}
import { ROOT } from './loc.js';
import { serverScope } from './env.js';
const OK_NAME = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;
const cache = new Map(); // name -> Promise<json>
const done = new Map(); // name -> json (sync access after resolve)

// execution.json, contract v2 (pipeline/budget_pipeline/validate/execution_contract.py): money as decimal strings ("33898.456"), percentages as numbers. The pages
// compute with numbers, so the loader turns the money into numbers once; the file as published stays on `canonical` (not enumerable),
// for the exports, which must carry the published decimals (docs/approach-specification.md, section 6.1). Version 1 passes unchanged.
const COLS = ['kfp', 'nat', 'eu'];
const num = (v) => (v == null ? null : Number(v));
function execNumbers(text) {
  const out = JSON.parse(text);
  if (!out || !out.contract || out.contract.schema !== 2) return out;
  const series = (blocks) => {
    for (const b of Object.values(blocks || {}))
      for (const c of COLS) for (const [r, a] of Object.entries(b[c] || {})) b[c][r] = a.map(num);
  };
  series(out.data);
  series(out.monthly);
  for (const c of COLS) {
    const plan = out.plan2026?.[c] || {};
    for (const k of Object.keys(plan)) plan[k] = num(plan[k]);
    for (const d of Object.values(out.latest?.[c] || {}))
      for (const k of ['cum', 'plan', 'prevYearCum']) if (k in d) d[k] = num(d[k]);
  }
  for (const [key, rec] of Object.entries(out.reconcile || {}))
    if (key.startsWith('dec'))
      for (const d of Object.values(rec))
        for (const k of ['kfp', 'annex3', 'diff']) d[k] = num(d[k]);
  Object.defineProperty(out, 'canonical', { value: JSON.parse(text), enumerable: false });
  return out;
}
const ADAPT = { execution: execNumbers };
/** the JSON of a data file as the pages read it: the same in the browser and on the server (apps/web/workers/release-data.ts) */
export const parse = (name, text) => (ADAPT[name] ? ADAPT[name](text) : JSON.parse(text));

/* One release for the whole visit (docs/approach-specification.md, section 7.3; docs/adr/0002-react-router-ssr.md): a page drawn by the
   server names its release (<meta name="release-id">) and where its files are (<meta name="data-base">: /data/releases/<id>/data/ when
   it comes from the registry). Every file the browser loads afterwards comes from there, so a release published in the middle of a visit
   does not mix with the one on the screen. Without the tags (the static site) the files are the site's own data/. */
const metaOf = (n) =>
  typeof document === 'undefined' ? '' : document.querySelector(`meta[name="${n}"]`)?.content || '';
/** the visit's release comes from a registry (it has a journal and a public API); false for the static site and for a Worker without one */
export const fromRegistry = () => !!pinnedBase()?.startsWith('/data/releases/');
export const pinnedBase = () => {
  const b = serverScope()?.dataBase || metaOf('data-base');
  return /^\/data\/(releases\/[0-9a-f]{64}\/data\/)?$/.test(b) ? b : null;
};
const pinnedRelease = () => {
  const r = serverScope()?.releaseId || metaOf('release-id');
  return /^[0-9a-f]{64}$/.test(r) ? r : null;
};
/** the address of a data file of the visit's release: href('execution-provenance') -> /data/releases/<id>/data/execution-provenance.json */
export const dataHref = (name) => (pinnedBase() || '/data/') + name + '.json';
/** the record of the visit's release, as data/releases/current.json has it (the CSV exports and S15 name it) */
const releaseRecord = (rid) => ({
  release_id: rid,
  manifest: `data/releases/${rid}/manifest.json`,
});

function fetchJson(name) {
  if (!OK_NAME.test(name)) return Promise.reject(new PendingError(name));
  const rid = pinnedRelease();
  if (name === 'releases/current' && rid) return Promise.resolve(releaseRecord(rid));
  if (RELEASE_FILE[name]) {
    // the manifest and the checks of the visit's release (S35 „Данни и проверка“)
    const id = rid ? Promise.resolve(rid) : data.load('releases/current').then((c) => c.release_id);
    return id.then((i) =>
      fetchFile(name, new URL(`/data/releases/${i}/${RELEASE_FILE[name]}`, location.origin)),
    );
  }
  if (name === 'release/journal') {
    // the registry's public journal; no registry, no journal (nothing to ask for)
    return fromRegistry()
      ? fetchFile(name, new URL('/api/releases?limit=50', location.origin))
      : Promise.reject(new PendingError(name));
  }
  return fetchFile(
    name,
    pinnedBase()
      ? new URL(`${pinnedBase()}${name}.json`, location.origin)
      : new URL(`data/${name}.json`, ROOT),
  );
}
const RELEASE_FILE = {
  'release/manifest': 'manifest.json',
  'release/validation': 'validation.json',
};
function fetchFile(name, url) {
  return fetch(url).then(
    async (res) => {
      if (res.status === 404) throw new PendingError(name);
      if (!res.ok) throw new LoadError(name, res.status);
      const text = await res.text();
      if (/^\s*</.test(text)) throw new PendingError(name); // SPA/HTML fallback = the file does not exist
      try {
        return parse(name, text);
      } catch (e) {
        throw new LoadError(name, e);
      }
    },
    (e) => {
      throw new LoadError(name, e);
    },
  );
}
const raceAbort = (p, signal) =>
  !signal
    ? p
    : new Promise((ok, no) => {
        if (signal.aborted) return no(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
        p.then(ok, no);
      });

export const data = {
  PendingError,
  LoadError,
  /** Adopt only the serializable editorial seed. Never seed adapted numeric files. */
  adoptTextSeed(seed) {
    if (serverScope()) return;
    for (const name of ['core', 'glossary'])
      if (seed?.[name]) {
        done.set(name, seed[name]);
        cache.set(name, Promise.resolve(seed[name]));
      }
  },
  /** load(name, {signal, demo}) ; demo 'error' | 'pending' simulates a failure for ?demo= */
  load(name, o = {}) {
    if (o.demo === 'error') return Promise.reject(new LoadError(name, 'demo'));
    if (o.demo === 'pending') return Promise.reject(new PendingError(name));
    const sc = serverScope();
    if (sc) {
      // the server: the file of the request's release (apps/web/workers/release-data.ts)
      if (!OK_NAME.test(name)) return Promise.reject(new PendingError(name));
      if (name === 'releases/current' && sc.releaseId) {
        const r = releaseRecord(sc.releaseId);
        sc.data.set(name, r);
        return Promise.resolve(r);
      }
      // a file that could not be read (not a pending one) makes the screen incomplete: apps/web/workers/app.ts then does not keep it in the cache
      return sc.load(name).then(
        (j) => {
          sc.data.set(name, j);
          return j;
        },
        (e) => {
          if (!(e instanceof PendingError)) sc.degraded = true;
          throw e;
        },
      );
    }
    let p = cache.get(name);
    if (!p) {
      p = fetchJson(name).then(
        (j) => {
          done.set(name, j);
          return j;
        },
        (e) => {
          if (e instanceof LoadError) cache.delete(name);
          throw e;
        },
      );
      cache.set(name, p);
    }
    return raceAbort(p, o.signal);
  },
  /** already loaded? returns the json or undefined (never fetches) */
  get: (name) => (serverScope()?.data || done).get(name),
  /** warm the cache without waiting for it and without throwing */
  prefetch(name) {
    data.load(name).catch(() => {});
  },
  reset() {
    cache.clear();
    done.clear();
  },
  /** status of a node with inheritance (node.status, else the file's meta.status) */
  statusOf: (node, doc) => node?.status || doc?.meta?.status || 'real',
  /** source keys of a node with inheritance */
  sourceOf: (node, doc) => node?.source || doc?.meta?.source || [],
  /** core.sources entry, or a minimal stub so a popover always has something to show */
  source(key) {
    return (
      data.get('core')?.sources?.[key] || {
        title: key,
        publisher: '',
        url: '',
        kind: '',
        access: '',
        note: '',
      }
    );
  },
  pending: (id) => data.get('core')?.pending?.[id],
};
