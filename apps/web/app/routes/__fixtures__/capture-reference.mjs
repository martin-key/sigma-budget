// Freeze the S24 („Откъде са данните?“) and S27 („Обратна връзка“) oracles from a Worker built from the unmodified base commit
// (docs/react-shell.md): the documents it serves, the release files the legacy renderer reads for them, and their SHA-256.
//
//   pnpm build && pnpm exec wrangler dev -c build/server/wrangler.json --port 8796      # on the base commit, before the React screens
//   node app/routes/__fixtures__/capture-reference.mjs --url http://127.0.0.1:8796 --commit <base>
//
// The React components are never used as their oracle. The inputs are found by drawing every case once with the legacy renderer
// (apps/web/client/render.js) over data/release and recording what it loads.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { provideScope } from '../../../client/env.js';
import { requestState } from '../../../client/store.js';
import { data } from '../../../client/data.js';
import { resolve, build } from '../../../client/render.js';
import { reset as resetShare } from '../../../client/share.js';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = arg('--url'),
  commit = arg('--commit');
if (!base || !commit) throw new Error('--url <base Worker> and --commit <base commit> are required');
const file = (name) => new URL(name, import.meta.url);
const release = new URL('../../../../../data/release/', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const CASES = [
  ['S27', '/vrazka', 'S27.html'],
  ['S27', '/vrazka?tab=neyasno', 'S27-neyasno.html'],
  ['S27', '/vrazka?tab=ideya', 'S27-ideya.html'],
  ['S27', '/vrazka?type=error&from=prihodi&val=33+898%2C5&src=kfp&block=s06-total', 'S27-context.html'],
  ['S27', '/vrazka?type=idea', 'S27-type.html'],
  ['S27', '/vrazka?from=nonsense&src=unknown&block=bad+id', 'S27-rejected.html'],
  ['S24', '/danni', 'S24.html'],
  ['S24', '/danni?status=pending', 'S24-status.html'],
  ['S24', '/danni?q=%D0%B4%D1%8A%D0%BB%D0%B3', 'S24-q.html'],
  ['S24', '/danni?ekran=dalg&izvor=bnb', 'S24-ekran.html'],
  ['S24', '/danni?q=zzzz', 'S24-none.html'],
  ['S24', '/danni/execution', 'S24-execution.html'],
  ['S24', '/danni/ministries-programs', 'S24-parts.html'],
  ['S24', '/danni/p01', 'S24-pending-set.html'],
  ['S24', '/danni/feed-rss', 'S24-rss.html'],
  ['S24', '/danni/nope', 'S24-unknown.html'],
  ...['loading', 'empty', 'error', 'pending'].flatMap((demo) => [
    ['S24', `/danni?demo=${demo}`, `S24-${demo}.html`],
    ['S27', `/vrazka?demo=${demo}`, `S27-${demo}.html`],
  ]),
];

const loaded = new Set(['glossary']); // the server links glossary terms in the drawn article (apps/web/app/lib/screen.server.ts)
const inputs = {};
for (const [screen, address, name] of CASES) {
  const response = await fetch(new URL(address, base), { redirect: 'manual' });
  const body = await response.text();
  if (response.status >= 300 && response.status < 400) throw new Error(`${address} redirects`);
  writeFileSync(file(name), body);
  const url = new URL(address, 'https://sigma-budget.my-data.bg');
  const scope = {
    url,
    origin: url.origin,
    state: requestState(null),
    data: new Map(),
    load: async (n) => {
      loaded.add(n);
      return JSON.parse(readFileSync(new URL(`${n}.json`, release), 'utf8'));
    },
  };
  provideScope(() => scope);
  try {
    await data.load('core');
    const r = resolve(address);
    resetShare(r.route);
    await build(r.route, r.params, r.query, { path: r.segs.join('/') });
  } finally {
    provideScope(() => null);
  }
  console.log(`${response.status} ${address} -> ${name} (${screen})`);
}
for (const n of [...loaded].sort()) inputs[n] = JSON.parse(readFileSync(new URL(`${n}.json`, release), 'utf8'));
const inputText = JSON.stringify(inputs);
writeFileSync(file('reference-inputs.json'), inputText);
const releaseId = /<meta name="release-id" content="([^"]*)"/.exec(readFileSync(file('S24.html'), 'utf8'))?.[1] || '';
const manifest = {
  referenceCommit: commit,
  releaseId,
  origin: 'https://sigma-budget.my-data.bg',
  generator: 'capture-reference.mjs',
  inputs: Object.keys(inputs),
  inputsSha256: hash(inputText),
  cases: await Promise.all(
    CASES.map(async ([screen, address, name]) => {
      const u = new URL(address, 'https://x');
      const status = (await fetch(new URL(address, base), { redirect: 'manual' })).status;
      return {
        screen,
        address,
        params: screen === 'S24' && u.pathname.split('/')[2] ? { set: decodeURIComponent(u.pathname.split('/')[2]) } : {},
        query: Object.fromEntries(u.searchParams),
        status,
        file: name,
        sha256: hash(readFileSync(file(name))),
      };
    }),
  ),
};
writeFileSync(file('reference-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${CASES.length} documents and ${Object.keys(inputs).length} inputs frozen from ${base} (${commit})`);
