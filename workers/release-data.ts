// The data a server request draws its screen from (docs/adr/0002-react-router-ssr.md): the files of the current release, by release_id.
//   registry   the pointer in D1 names the release; its manifest lists data/<name>.json with a SHA-256; the bytes are in R2 (worker/store.js)
//   no registry or no current release (local, CI): the files of site/data that the build put in the static assets, under the release that
//   site/data/releases/current.json names
// A file that is not in the release is PENDING (the „Предстои“ state), as a 404 is in the browser; an unreadable one is an error.
import { current, manifestOf, readObject } from '../worker/store.js';
import { parse, PendingError, LoadError } from '../site/js/data.js';

export interface ReleaseData {
  /** the release the screen is drawn from */
  releaseId: string;
  /** where the browser loads more files of the same release: /data/releases/<id>/data/ or, from the static assets, /data/ */
  dataBase: string;
  /** a data file, parsed as the pages read it (site/js/data.js parse) */
  load(name: string): Promise<unknown>;
}

type Manifest = { json: { outputs: { path: string; sha256: string }[] } };
const POINTER_MS = 10_000;                                    // a new release shows within ten seconds; the files of a release never change
let pointer: { at: number; rid: string | null } | null = null;
const texts = new Map<string, string>();                      // sha256 -> text: immutable, so one copy per isolate is safe
const decoder = new TextDecoder();

async function currentRelease(env: Env): Promise<string | null> {
  if (pointer && Date.now() - pointer.at < POINTER_MS) return pointer.rid;
  let rid: string | null = null;
  try { rid = ((await current(env)) as { release_id?: string } | null)?.release_id ?? null; } catch { rid = null; }   // no registry here
  pointer = { at: Date.now(), rid };
  return rid;
}

async function fromRegistry(env: Env, rid: string): Promise<ReleaseData | null> {
  const m = (await manifestOf(env, rid)) as Manifest | null;
  if (!m) return null;
  const byPath = new Map(m.json.outputs.map(o => [o.path, o.sha256]));
  return {
    releaseId: rid,
    dataBase: `/data/releases/${rid}/data/`,
    async load(name) {
      const sha = byPath.get(`data/${name}.json`);
      if (!sha) throw new PendingError(name);
      let text = texts.get(sha);
      if (text === undefined) {
        const buf = await readObject(env, sha);
        if (!buf) throw new LoadError(name, 'missing object');
        text = decoder.decode(buf);
        texts.set(sha, text);
      }
      try { return parse(name, text); } catch (e) { throw new LoadError(name, e); }
    },
  };
}

function fromAssets(env: Env, origin: string, releaseId: string): ReleaseData {
  return {
    releaseId,
    dataBase: '/data/',
    async load(name) {
      const res = await env.ASSETS.fetch(new Request(new URL(`/data/${name}.json`, origin)));
      if (res.status === 404) throw new PendingError(name);
      if (!res.ok) throw new LoadError(name, res.status);
      const text = await res.text();
      if (/^\s*</.test(text)) throw new PendingError(name);
      try { return parse(name, text); } catch (e) { throw new LoadError(name, e); }
    },
  };
}

let assetsRelease: string | null = null;
async function assetsReleaseId(env: Env, origin: string): Promise<string> {
  if (assetsRelease !== null) return assetsRelease;
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/data/releases/current.json', origin)));
    assetsRelease = res.ok ? String(((await res.json()) as { release_id?: string }).release_id || '') : '';
  } catch { assetsRelease = ''; }
  return assetsRelease;
}

/** the release of this request: the current one in the registry, else the one built into the static assets */
export async function releaseData(env: Env, origin: string): Promise<ReleaseData> {
  const rid = await currentRelease(env);
  if (rid) {
    const r = await fromRegistry(env, rid);
    if (r) return r;
  }
  return fromAssets(env, origin, await assetsReleaseId(env, origin));
}
