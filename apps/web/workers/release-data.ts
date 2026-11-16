import { parse, PendingError, LoadError } from '../client/data.js';

declare const __BUDGET_CANDIDATE_RELEASE__: string | null;
/** Build-time selection, never a public query parameter or remote pointer. */
export const candidateReleaseId = (): string | null =>
  typeof __BUDGET_CANDIDATE_RELEASE__ === 'undefined' ? null : __BUDGET_CANDIDATE_RELEASE__;

export interface ReleaseData {
  /** the release the screen is drawn from */
  releaseId: string;
  /** where the browser loads the packaged data files */
  dataBase: string;
  /** a data file, parsed as the pages read it (apps/web/client/data.js parse) */
  load(name: string): Promise<unknown>;
}

type Manifest = { json: { outputs: { path: string; sha256: string; mime: string }[] } };
const decoder = new TextDecoder();

function fromAssets(
  env: Env,
  origin: string,
  releaseId: string,
  outputs?: Set<string>,
): ReleaseData {
  return {
    releaseId,
    dataBase: '/data/',
    async load(name) {
      const own = { 'release/manifest': 'manifest.json', 'release/validation': 'validation.json' }[
        name
      ];
      const path = own ? `/data/releases/${releaseId}/${own}` : `/data/${name}.json`;
      if (outputs && !outputs.has(own || `data/${name}.json`)) throw new PendingError(name);
      const res = await env.ASSETS.fetch(new Request(new URL(path, origin)));
      if (outputs && !res.ok) throw new LoadError(name, `candidate asset ${path}: ${res.status}`);
      if (res.status === 404) throw new PendingError(name);
      if (!res.ok) throw new LoadError(name, res.status);
      const text = await res.text();
      if (/^\s*</.test(text)) {
        if (outputs) throw new LoadError(name, `candidate asset ${path} is HTML`);
        throw new PendingError(name);
      }
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

/** The release packaged with this build. */
export async function releaseData(env: Env, origin: string): Promise<ReleaseData> {
  const selected = candidateReleaseId();
  if (selected) {
    const path = `/data/releases/${selected}/manifest.json`;
    const res = await env.ASSETS.fetch(new Request(new URL(path, origin)));
    if (!res.ok) throw new LoadError('release/manifest', `candidate manifest: ${res.status}`);
    const bytes = await res.arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (sha !== selected)
      throw new LoadError('release/manifest', 'candidate manifest SHA-256 differs');
    const manifest = JSON.parse(decoder.decode(bytes)) as Manifest['json'];
    return fromAssets(
      env,
      origin,
      selected,
      new Set([...manifest.outputs.map((o) => o.path), 'manifest.json']),
    );
  }
  return fromAssets(env, origin, await assetsReleaseId(env, origin));
}
