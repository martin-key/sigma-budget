#!/usr/bin/env node
// The restore drill of acceptance scenario 10 (docs/approach-specification.md, section 11) on a test environment: the built Worker with a
// local D1 and R2, as tests/release/release_check.mjs runs it, and the TypeScript release operator (`./budget`).
//
//   node tests/release/restore_drill.mjs [--keep]      (pnpm install --frozen-lockfile first; the Worker is built with react-router build)
//
//   1  releases A and B are published; B is current at revision 2
//   2  backup: the registry as an SQL dump (schema, triggers and rows: what `wrangler d1 export --remote` gives in Cloudflare; locally the
//      dump of the D1 database file, because `wrangler d1 export` has no --persist-to) and the objects as they are (R2 is content-addressed
//      and the operator API never overwrites or deletes an object, so the bucket is its own history)
//   3  the registry moves on: C is published (revision 3), then A is made current again (revision 4)
//   4  loss: the registry database is gone
//   5  restore: a new database from the export, the objects from their copy, and the Worker started on them at the same address
//   6  checks: B is current at revision 2; the journal holds the two events of the backup with their request IDs; the manifest of B hashes
//      to its release_id and every file of B is served with its SHA-256; A stays public, C does not (it was published after the backup);
//      a new publish continues at revision 3 and journals itself (the trigger came back with the schema), although the operator's receipt
//      remembers C at revision 3 of the lost registry; `budget rollback` then takes the environment to the older release A
// In Cloudflare the same backup is D1 Time Travel (any minute of the last 30 days) or `wrangler d1 export`, and the bucket:
// docs/operator-guide.md. Exit code 0 only when every check passes.
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  BUILT,
  Keys,
  budget,
  buildWorker,
  fatal,
  freePort,
  jbody,
  makeRelease,
  ok,
  prepareOperator,
  req,
  sha,
  startWorker,
  summary,
  wrangler,
} from './release_lib.mjs';

function files(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

/**
 * The SQL of the local registry: schema, rows and triggers, without the tables of the runtime (_cf_*). Every table first, then the rows,
 * then indexes and triggers: a row may name a row of a table later in the alphabet (D1 checks foreign keys), and a trigger restored
 * before the rows would fire on them. The rows are written by SQLite's own quote(), as the sqlite3 .dump does.
 */
function dumpRegistry(state) {
  const db = files(join(state, 'v3/d1')).find(
    (f) => f.endsWith('.sqlite') && !f.endsWith('metadata.sqlite'),
  );
  if (!db) throw new Error('no local D1 database under ' + state);
  const con = new DatabaseSync(db, { readOnly: true });
  try {
    const ident = (name) => '"' + name.replaceAll('"', '""') + '"';
    const runtime = (name) => name.startsWith('_cf_') || name.startsWith('sqlite_');
    const tables = con
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql NOT NULL ORDER BY name",
      )
      .all();
    const schema = [],
      rows = [];
    for (const { name, sql } of tables) {
      if (runtime(name)) continue;
      schema.push(sql + ';');
      const columns = con
        .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
        .all(name)
        .map((c) => `quote(${ident(c.name)})`);
      const insert = `SELECT 'INSERT INTO ${ident(name).replaceAll("'", "''")} VALUES(' || ${columns.join(" || ',' || ")} || ')' AS line FROM ${ident(name)}`;
      for (const { line } of con.prepare(insert).all()) rows.push(line + ';');
    }
    if (tables.some((t) => t.name === 'sqlite_sequence')) {
      rows.push('DELETE FROM "sqlite_sequence";');
      for (const { name, seq } of con.prepare('SELECT name, seq FROM sqlite_sequence').all())
        if (!runtime(name))
          rows.push(
            `INSERT INTO "sqlite_sequence" VALUES('${name.replaceAll("'", "''")}',${seq});`,
          );
    }
    const rest = con
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type IN ('index', 'trigger', 'view') AND sql NOT NULL ORDER BY name",
      )
      .all()
      .filter((x) => !runtime(x.name) && !/\b_cf_/.test(x.sql.split('(')[0]))
      .map((x) => x.sql + ';');
    return ['PRAGMA defer_foreign_keys = true;', ...schema, ...rows, ...rest].join('\n') + '\n';
  } finally {
    con.close();
  }
}

async function main() {
  const keep = process.argv.includes('--keep');
  buildWorker('restore_drill');
  const { groups, compatibility } = await prepareOperator();
  const tmp = mkdtempSync(join(tmpdir(), 'restore-drill-'));
  const state = join(tmp, 'state'),
    restored = join(tmp, 'restored'),
    backup = join(tmp, 'registry.sql'),
    receipts = join(tmp, 'receipts');
  const key = new Keys('drill-key');
  const [A, B, C] = [
    ['A', 'first'],
    ['B', 'second'],
    ['C', 'third'],
  ].map(([n, t]) => makeRelease(tmp, n, t, groups, compatibility));
  const m = wrangler([
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '-c',
    BUILT,
    '--persist-to',
    state,
  ]);
  if (m.status !== 0) fatal('restore_drill: migrations failed: ' + (m.stderr || '').slice(-500));
  // one address for the environment before and after the loss, as in Cloudflare: the operator's receipts are kept per environment and
  // address, so the restored registry meets the receipts written before the loss
  const port = await freePort();
  let n = 0;
  const worker = (dir) =>
    startWorker({ state: dir, port, log: join(tmp, `wrangler-${++n}.log`), key });
  const operator = (base) => {
    const env = { ...process.env, BUDGET_ACCESS_TOKEN: key.token({ email: 'alice@example.org' }) };
    delete env.CF_ACCESS_CLIENT_ID;
    delete env.CF_ACCESS_CLIENT_SECRET;
    const where = ['--environment', 'local', '--url', base, '--receipts', receipts, '--yes'];
    return {
      publish: (rel) =>
        budget(['publish', '--release', rel.rel, '--originals', rel.orig, ...where], env),
      rollback: (rel) => budget(['rollback', '--release-id', rel.id, ...where], env),
    };
  };
  let w;
  try {
    console.log('1  A and B published');
    w = await worker(state);
    let op = operator(w.base);
    for (const rel of [A, B]) {
      const [code, out] = await op.publish(rel);
      ok(code === 0, `publish ${rel.id.slice(0, 12)} (${out.error ?? out.revision})`);
    }
    const before = jbody((await req('GET', w.base + '/api/releases'))[2]).items ?? [];
    let cur = jbody((await req('GET', w.base + '/api/releases/current'))[2]);
    ok(cur.release_id === B.id && cur.revision === 2, 'B is current at revision 2');
    await w.stop();

    console.log('2  backup');
    writeFileSync(backup, dumpRegistry(state));
    const sql = readFileSync(backup, 'utf8');
    ok(
      sql.includes('CREATE TABLE') && sql.includes('CREATE TRIGGER') && sql.includes('INSERT INTO'),
      `the registry dumped: its schema, triggers and rows (${sql.length} bytes of SQL)`,
    );
    cpSync(join(state, 'v3/r2'), join(tmp, 'objects-backup'), { recursive: true });
    ok(files(join(tmp, 'objects-backup')).length > 0, 'a copy of the objects');

    console.log('3  the registry moves on');
    w = await worker(state);
    op = operator(w.base);
    let [code, out] = await op.publish(C);
    ok(code === 0 && out.revision === 3, 'C published at revision 3');
    [code, out] = await op.rollback(A);
    ok(code === 0 && out.revision === 4, 'A current again at revision 4');
    await w.stop();

    console.log('4  loss of the registry');
    rmSync(join(state, 'v3/d1'), { recursive: true, force: true });
    ok(!existsSync(join(state, 'v3/d1')), 'the registry database is gone');

    console.log('5  restore');
    const r = wrangler([
      'd1',
      'execute',
      'DB',
      '--local',
      '-c',
      BUILT,
      '--persist-to',
      restored,
      '--file',
      backup,
      '--yes',
    ]);
    ok(
      r.status === 0,
      'the registry restored from the export into a new database' +
        (r.status === 0 ? '' : ': ' + (r.stderr || '').slice(-300)),
    );
    cpSync(join(tmp, 'objects-backup'), join(restored, 'v3/r2'), { recursive: true });

    console.log('6  checks');
    w = await worker(restored);
    cur = jbody((await req('GET', w.base + '/api/releases/current'))[2]);
    ok(
      cur.release_id === B.id && cur.revision === 2,
      'B is current at revision 2, as at the backup',
    );
    const after = jbody((await req('GET', w.base + '/api/releases'))[2]).items ?? [];
    ok(
      JSON.stringify(after) === JSON.stringify(before) && after.length === 2,
      'the journal is the two events of the backup, unchanged',
    );
    const [s, , mb] = await req('GET', `${w.base}/data/releases/${B.id}/manifest.json`);
    ok(s === 200 && sha(mb) === B.id, 'the manifest of B hashes to its release_id');
    const all = [...B.manifest.outputs, ...B.manifest.inputs];
    let good = 0;
    for (const f of all) {
      const [fs, , fb] = await req('GET', `${w.base}/data/releases/${B.id}/${f.path}`);
      if (fs === 200 && sha(fb) === f.sha256) good++;
    }
    ok(
      good === all.length,
      `every file of B is served with its SHA-256 (${good} of ${all.length})`,
    );
    ok(
      (await req('GET', `${w.base}/data/releases/${A.id}/manifest.json`))[0] === 200,
      'A is still public (it is in the journal)',
    );
    ok(
      (await req('GET', `${w.base}/data/releases/${C.id}/manifest.json`))[0] === 404,
      'C is not public: it was published after the backup',
    );
    op = operator(w.base);
    [code, out] = await op.publish(C);
    const journal = jbody((await req('GET', w.base + '/api/releases'))[2]).items ?? [];
    ok(
      code === 0 && out.revision === 3 && journal.length === 3,
      `a new publish continues at revision 3 and is journaled (${JSON.stringify(out).slice(0, 200)})`,
    );
    [code, out] = await op.rollback(A);
    cur = jbody((await req('GET', w.base + '/api/releases/current'))[2]);
    ok(
      code === 0 && cur.release_id === A.id && cur.revision === 4,
      'budget rollback takes the environment to the older release A',
    );
  } catch (e) {
    ok(false, 'the drill stopped: ' + String(e?.stack || e).slice(0, 2000));
  } finally {
    await w?.stop();
    if (!keep) rmSync(tmp, { recursive: true, force: true });
    else console.log('kept ' + tmp);
  }
  return summary();
}

process.exitCode = await main();
