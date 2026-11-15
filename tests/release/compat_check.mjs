#!/usr/bin/env node
// The compatibility of code and data (docs/approach-specification.md, sections 10.1 and 11, stage E).
//
//   node tests/release/compat_check.mjs                              the code against itself and against the releases in data/release/releases
//   node tests/release/compat_check.mjs --env-url https://staging.…  also against the current release of an environment, before a deploy
//
// The code says which data contracts it reads in three places, and they must agree:
//   apps/web/workers/api/store.js SUPPORTED                       what the Worker accepts in a manifest (it refuses to publish anything else)
//   packages/ingest/src/release-build/contracts.ts                what a release built by this code declares (and the operator reads)
//   apps/web/client/data.js parse                                 what the pages read: run here on the published execution.json, every
//                                                                 amount must become a number
// Then every release this code may meet must use a contract it reads: the releases published with the site, their execution.json, and
// with --env-url the release that is current in an environment (a code deploy must not leave the screens unable to read the data on them).
// Needs only Node 24 and the checkout: no build, no dependencies. Exit 0 when all agree, 1 when not, 2 when the environment cannot be read.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const ROOT = new URL('../../', import.meta.url);
const fails = [];

function ok(cond, msg) {
  console.log((cond ? '  ok    ' : '  FAIL  ') + msg);
  if (!cond) fails.push(msg);
}

const json = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const names = (list) => (Array.isArray(list) ? list.join(', ') : String(list));

/** apps/web/client/data.js parse('execution', text): how many amounts are not numbers after it (the pages compute with numbers) */
async function clientParse(path) {
  try {
    const { parse } = await import(new URL('apps/web/client/data.js', ROOT).href);
    const d = parse('execution', readFileSync(new URL(path, ROOT), 'utf8'));
    let bad = 0,
      all = 0;
    for (const b of Object.values(d.data || {}))
      for (const c of ['kfp', 'nat', 'eu'])
        for (const a of Object.values(b[c] || {}))
          for (const v of a) {
            all++;
            if (v !== null && typeof v !== 'number') bad++;
          }
    return { bad, all, schema: d.contract && d.contract.schema };
  } catch (e) {
    return { error: String(e?.stack || e).slice(-300) };
  }
}

function checkManifest(m, where, sup) {
  for (const [name, version] of Object.entries(m.data_schema || {}))
    if (Object.hasOwn(sup, name))
      ok(
        sup[name].includes(version),
        `${where}: ${name} is ${version}, which this code reads (${names(sup[name])})`,
      );
}

async function read(url, timeoutMs) {
  return fetch(url, {
    headers: { 'User-Agent': 'compat-check' },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { 'env-url': { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    console.log('node tests/release/compat_check.mjs [--env-url <origin>]');
    return 0;
  }

  console.log('the code');
  const { SUPPORTED: w } = await import(new URL('apps/web/workers/api/store.js', ROOT).href);
  const { RELEASE_COMPATIBILITY: b } = await import(
    new URL('packages/ingest/src/release-build/contracts.ts', ROOT).href
  );
  ok(
    Array.isArray(w?.execution) && w.execution.length > 0,
    `apps/web/workers/api/store.js SUPPORTED names the execution contracts (${JSON.stringify(w)})`,
  );
  ok(
    same(w, b),
    `packages/ingest/src/release-build/contracts.ts declares the same contracts as the Worker accepts (${JSON.stringify(b)})`,
  );
  const ex = 'data/release/execution.json';
  const r = await clientParse(ex);
  ok(
    !r.error && r.all > 0 && r.bad === 0,
    `apps/web/client/data.js reads execution.json (contract ${r.schema}): ${r.all} amounts, ${r.bad} not numbers ${r.error ?? ''}`,
  );
  const schema = json(ex).contract?.schema;
  ok(
    (w?.execution ?? []).includes(`execution/${schema}`),
    `data/release/execution.json is execution/${schema}, which the Worker accepts`,
  );

  console.log('the releases published with the site');
  const dir = new URL('data/release/releases/', ROOT);
  const rels = readdirSync(dir)
    .filter((name) => existsSync(new URL(`${name}/manifest.json`, dir)))
    .sort();
  ok(rels.length > 0, `${rels.length} release(s) in data/release/releases`);
  const cur = json('data/release/releases/current.json');
  for (const id of rels) {
    const m = json(`data/release/releases/${id}/manifest.json`);
    checkManifest(m, 'release ' + id.slice(0, 12), w);
    if (id === cur.release_id)
      ok(
        m.data_schema?.execution === `execution/${schema}`,
        `the current release declares the contract of data/release/execution.json (execution/${schema})`,
      );
  }
  ok(
    rels.includes(cur.release_id),
    'releases/current.json names a release in data/release/releases',
  );

  if (values['env-url']) {
    const base = values['env-url'].replace(/\/+$/, '');
    console.log('the current release of ' + base);
    let c;
    try {
      const res = await read(base + '/api/releases/current', 30_000);
      if (res.status === 404) {
        // The Worker answers 404 with release_id: null while nothing is published; any other 404 is not this site.
        const none = await res.json().catch(() => undefined);
        if (none?.release_id !== null) {
          console.error(`cannot read ${base}/api/releases/current: HTTP 404, not from the Worker`);
          return 2;
        }
        console.log('  —     no release is current there: nothing to read yet');
        return finish();
      }
      if (!res.ok) {
        console.error(`cannot read ${base}/api/releases/current: HTTP ${res.status}`);
        return 2;
      }
      c = await res.json();
    } catch (e) {
      console.error(
        `cannot read ${base}/api/releases/current: ${e?.cause?.code ?? e?.message ?? e}`,
      );
      return 2;
    }
    if (
      typeof c?.manifest !== 'string' ||
      !c.manifest.startsWith('/') ||
      typeof c.release_id !== 'string'
    ) {
      console.error(`cannot read ${base}/api/releases/current: not a release pointer`);
      return 2;
    }
    let m;
    try {
      const res = await read(base + c.manifest, 60_000);
      if (!res.ok) {
        console.error(`cannot read ${base}${c.manifest}: HTTP ${res.status}`);
        return 2;
      }
      m = await res.json();
    } catch (e) {
      console.error(`cannot read ${base}${c.manifest}: ${e?.cause?.code ?? e?.message ?? e}`);
      return 2;
    }
    checkManifest(m, 'release ' + c.release_id.slice(0, 12), w);
  }
  return finish();
}

function finish() {
  console.log(`RESULT: ${fails.length ? 'FAIL' : 'PASS'} · ${fails.length} failed`);
  return fails.length ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2)).catch((e) => {
  console.error(String(e?.stack || e));
  return 1;
});
