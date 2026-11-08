// The data a server request draws its screen from (docs/adr/0002-react-router-ssr.md): the files of the current release, by release_id.
//   registry   the pointer in D1 names the release; its manifest lists data/<name>.json with a SHA-256; the bytes are in R2 (apps/web/workers/api/store.js)
//   no registry or no current release (local, CI): the files of data/release that the build put in the static assets, under the release that
//   data/release/releases/current.json names
// A file that is not in the release is PENDING (the „Предстои“ state), as a 404 is in the browser; an unreadable one is an error.
// Three names are not files of data/ (S35 „Данни и проверка“): release/manifest and release/validation are the manifest and the checks of
// the release, release/journal is the registry's public journal (PENDING without a registry).
import { current, manifestOf, readObject } from './api/store.js';
import { publicApi } from './api/api.js';
import { parse, PendingError, LoadError } from '../client/data.js';

export interface ReleaseData {
  /** the release the screen is drawn from */
  releaseId: string;
  /** where the browser loads more files of the same release: /data/releases/<id>/data/ or, from the static assets, /data/ */
  dataBase: string;
  /** a data file, parsed as the pages read it (apps/web/client/data.js parse) */
  load(name: string): Promise<unknown>;
  /** the bytes of a file of the release (data/catalog.json), for the stable addresses /data/…; null: not from the registry */
  file(path: string): Promise<{ bytes: ArrayBuffer; mime: string; sha256: string } | null>;
}

type Manifest = { json: { outputs: { path: string; sha256: string; mime: string }[] } };
const JOURNAL_PATH = '/api/releases?limit=50';
const POINTER_MS = 10_000; // a new release shows within ten seconds; the files of a release never change
let pointer: { at: number; rid: string | null } | null = null;
const texts = new Map<string, string>(); // sha256 -> text: immutable, so one copy per isolate is safe
const decoder = new TextDecoder();

/** the registry could not be read: an outage of D1 or R2, not an environment without a registry. The request fails with 503 and nothing
 *  is cached; it never falls back to the release of the static files, which would mix two releases on one page */
export class RegistryError extends Error {
  constructor(what: string, cause?: unknown) {
    super(`registry unavailable: ${what}`, { cause });
    this.name = 'RegistryError';
  }
}
/** an environment without a registry: no D1 binding, or the tables are not created (a local check, CI, a new environment) */
export const noRegistry = (env: Env, e: unknown) =>
  !env.DB || /no such table/i.test(String((e as Error)?.message ?? e));

async function currentRelease(env: Env): Promise<string | null> {
  if (pointer && Date.now() - pointer.at < POINTER_MS) return pointer.rid;
  let rid: string | null = null;
  try {
    rid = ((await current(env)) as { release_id?: string } | null)?.release_id ?? null;
  } catch (e) {
    if (!noRegistry(env, e)) throw new RegistryError('pointer', e);
  } // an outage is not remembered: the next request asks again
  pointer = { at: Date.now(), rid };
  return rid;
}

async function fromRegistry(env: Env, rid: string, origin: string): Promise<ReleaseData> {
  let m: Manifest | null;
  try {
    m = (await manifestOf(env, rid)) as Manifest | null;
  } catch (e) {
    throw new RegistryError(`manifest of ${rid}`, e);
  }
  if (!m) throw new RegistryError(`manifest of ${rid} is not in storage`);
  const byPath = new Map(m.json.outputs.map((o) => [o.path, o.sha256]));
  const mimes = new Map(m.json.outputs.map((o) => [o.path, o.mime]));
  return {
    releaseId: rid,
    dataBase: `/data/releases/${rid}/data/`,
    async file(path) {
      const sha = byPath.get(path);
      if (!sha) return null;
      const bytes = await readObject(env, sha);
      return bytes
        ? { bytes, mime: mimes.get(path) || 'application/octet-stream', sha256: sha }
        : null;
    },
    async load(name) {
      if (name === 'release/manifest') return m.json;
      if (name === 'release/journal') {
        const url = new URL(JOURNAL_PATH, origin);
        let res: Response;
        try {
          res = await publicApi(new Request(url), env, url);
        } catch (e) {
          throw new LoadError(name, e);
        }
        if (!res.ok) throw new LoadError(name, res.status);
        return res.json();
      }
      const sha = byPath.get(
        name === 'release/validation' ? 'validation.json' : `data/${name}.json`,
      );
      if (!sha) throw new PendingError(name);
      let text = texts.get(sha);
      if (text === undefined) {
        let buf: ArrayBuffer | null;
        try {
          buf = await readObject(env, sha);
        } catch (e) {
          throw new LoadError(name, e);
        }
        if (!buf) throw new LoadError(name, 'missing object');
        text = decoder.decode(buf);
        texts.set(sha, text);
      }
      try {
        return parse(name, text);
      } catch (e) {
        throw new LoadError(name, e);
      }
    },
  };
}

function fromAssets(env: Env, origin: string, releaseId: string): ReleaseData {
  return {
    releaseId,
    dataBase: '/data/',
    async file() {
      return null;
    },
    async load(name) {
      if (name === 'release/journal') throw new PendingError(name); // no registry: the release was published with the site
      const own = { 'release/manifest': 'manifest.json', 'release/validation': 'validation.json' }[
        name
      ];
      const path = own ? `/data/releases/${releaseId}/${own}` : `/data/${name}.json`;
      const res = await env.ASSETS.fetch(new Request(new URL(path, origin)));
      if (res.status === 404) throw new PendingError(name);
      if (!res.ok) throw new LoadError(name, res.status);
      const text = await res.text();
      if (/^\s*</.test(text)) throw new PendingError(name);
      try {
        return parse(name, text);
      } catch (e) {
        throw new LoadError(name, e);
      }
    },
  };
}

let assetsRelease: string | null = null;
async function assetsReleaseId(env: Env, origin: string): Promise<string> {
  if (assetsRelease !== null) return assetsRelease;
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/data/releases/current.json', origin)));
    assetsRelease = res.ok
      ? String(((await res.json()) as { release_id?: string }).release_id || '')
      : '';
  } catch {
    assetsRelease = '';
  }
  return assetsRelease;
}

/** the release of this request: the current one in the registry, else (no registry, or no current release yet) the one built into the
 *  static assets. Throws RegistryError when the registry is there but cannot be read */
export async function releaseData(env: Env, origin: string): Promise<ReleaseData> {
  const rid = await currentRelease(env);
  if (rid) return fromRegistry(env, rid, origin);
  return fromAssets(env, origin, await assetsReleaseId(env, origin));
}
