import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const ROOT = new URL('../../', import.meta.url);
const fails = [];

function ok(cond, msg) {
  console.log((cond ? '  ok    ' : '  FAIL  ') + msg);
  if (!cond) fails.push(msg);
}

const json = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
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

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('node tests/release/compat_check.mjs');
    return 0;
  }

  console.log('the code');
  const { RELEASE_COMPATIBILITY: w } = await import(
    new URL('packages/ingest/src/release-build/contracts.ts', ROOT).href
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
    `data/release/execution.json is execution/${schema}, which the code reads`,
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
