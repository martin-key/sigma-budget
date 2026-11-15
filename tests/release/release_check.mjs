#!/usr/bin/env node
// The acceptance checks of stage C (docs/approach-specification.md, section 11) against the Worker on a local registry, driven through the
// TypeScript release operator (`./budget`, apps/etl/src/release-operator.ts) that operators use.
//
//   node tests/release/release_check.mjs                  synthetic releases (no raw files needed: this is what CI runs)
//   node tests/release/release_check.mjs --real DIR       also publish the release of `budget build` in DIR and reproduce it from the Worker
//   node tests/release/release_check.mjs --keep           keep the temporary folder (wrangler log, releases, receipts)
//
// It builds the site (react-router build: the Worker of apps/web/workers/app.ts and the static files, docs/adr/0002-react-router-ssr.md)
// and the operator (./budget), starts `wrangler dev` on it (node_modules, pnpm-lock.yaml) with a fresh local D1 and R2, applies
// migrations/, and signs Cloudflare Access tokens with an RSA key made for the run (the Worker gets the public key as ACCESS_JWKS). Then:
//   9  operator: no token, a foreign key, a wrong audience, an expired token and a person who is not an operator are refused
//   3  damaged upload: wrong bytes, an object missing, an unsafe path, a too large object: nothing becomes current
//   —  `budget upload` and `budget publish` publish a candidate with one command and read it back
//   4  interruption: the same publish again answers the first result without a second event; a new request on an old revision is refused
//   5  two operators publish at the same moment on the same revision: one succeeds, the other gets 409 and nothing is overwritten
//   —  `budget rollback` makes an earlier release current with a new revision; a release that never was current cannot be rolled back to
//   —  the public API: the pointer, the journal without operator names, the manifest bytes, the files by the manifest only, ETag/304, Range,
//      originals in HTML as a download, unknown and unpublished releases 404, and no public route that writes
//   E  tests/release/compat_check.mjs --env-url, the check the deploy runs, on the empty registry and on the current release
//   6  one release: a screen is drawn from the current release and names it with its data base; the stable /data/<file> follows it;
//      the edge cache keys a screen on the query it reads only and never keeps the 404 screen
// Exit code 0 only when every check passes.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import {
  BUILT,
  ROOT,
  Keys,
  budget,
  buildWorker,
  canonical,
  fatal,
  freePort,
  hasSandbox,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v) => JSON.stringify(v).slice(0, 300);

/** the process environment of an operator: the Access token of one person, and no credential of the machine running the check */
function operatorEnv(token) {
  const env = { ...process.env, BUDGET_ACCESS_TOKEN: token };
  delete env.CF_ACCESS_CLIENT_ID;
  delete env.CF_ACCESS_CLIENT_SECRET;
  return env;
}

function compat(base) {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'tests/release/compat_check.mjs'), '--env-url', base],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  return [r.status, r.stdout + r.stderr];
}

async function main(argv) {
  const { values: a } = parseArgs({
    args: argv,
    options: { real: { type: 'string' }, keep: { type: 'boolean' } },
  });
  buildWorker('release_check');
  const { groups, compatibility } = await prepareOperator();
  const tmp = mkdtempSync(join(tmpdir(), 'release-check-'));
  const state = join(tmp, 'state');
  const receipts = join(tmp, 'receipts');
  const key = new Keys('test-key'),
    foreign = new Keys('foreign-key');
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
  if (m.status !== 0) fatal('release_check: migrations failed: ' + (m.stderr || '').slice(-500));
  let worker;
  try {
    worker = await startWorker({
      state,
      port: await freePort(),
      log: join(tmp, 'wrangler.log'),
      key,
      serviceTokens: 'ci-publisher',
      maxObjectBytes: a.real ? 64 * 1024 * 1024 : 4096,
    });
    const { base } = worker;
    const alice = { 'Cf-Access-Jwt-Assertion': key.token({ email: 'alice@example.org' }) };
    const bob = { 'Cf-Access-Jwt-Assertion': key.token({ email: 'bob@example.org' }) };
    const env = operatorEnv(alice['Cf-Access-Jwt-Assertion']);
    const where = ['--environment', 'local', '--url', base, '--receipts', receipts];
    const [A, B, C, D] = [
      ['A', 'first'],
      ['B', 'second'],
      ['C', 'third'],
      ['D', 'fourth'],
    ].map(([n, t]) => makeRelease(tmp, n, t, groups, compatibility));
    const json = (h) => ({ ...h, 'Content-Type': 'application/json' });

    console.log('empty environment');
    let [s, h, b] = await req('GET', base + '/api/releases/current');
    ok(
      s === 404 && jbody(b).message === 'няма публикувано издание',
      'no release yet: 404 with „няма публикувано издание“, no fallback',
    );
    let [code, text] = compat(base);
    ok(
      code === 0 && text.includes('no release is current there'),
      'compat_check --env-url on the empty registry: nothing to read yet, exit 0',
    );

    console.log('9 operator access');
    [s] = await req('POST', base + '/admin/operations', '{}');
    ok(s === 401, 'no token: 401');
    [s] = await req('POST', base + '/admin/operations', '{}', {
      'Cf-Access-Jwt-Assertion': foreign.token({ email: 'alice@example.org' }),
    });
    ok(s === 401, 'a token of another key: 401');
    [s] = await req('POST', base + '/admin/operations', '{}', {
      'Cf-Access-Jwt-Assertion': key.token({ email: 'alice@example.org', aud: 'other-app' }),
    });
    ok(s === 401, 'a token for another Access application (audience): 401');
    [s] = await req('POST', base + '/admin/operations', '{}', {
      'Cf-Access-Jwt-Assertion': key.token({ email: 'alice@example.org', expIn: -3600 }),
    });
    ok(s === 401, 'an expired token: 401');
    [s] = await req('POST', base + '/admin/operations', '{}', {
      'Cf-Access-Jwt-Assertion': key.token({ email: 'carol@example.org' }),
    });
    ok(s === 403, 'a valid login of a person who is not an operator here: 403');
    [s] = await req(
      'GET',
      base + '/admin/operations/00000000-0000-0000-0000-000000000000',
      undefined,
      {
        'Cf-Access-Jwt-Assertion': key.token({ commonName: 'ci-publisher' }),
      },
    );
    ok(
      s === 404,
      'a service token in SERVICE_TOKENS is an operator (unknown operation: 404, not 401/403)',
    );

    console.log('3 damaged upload');
    const bad = JSON.parse(readFileSync(join(A.rel, 'manifest.json'), 'utf8'));
    bad.outputs[0].path = '../escape.json';
    [s, h, b] = await req('POST', base + '/admin/operations', canonical(bad), json(alice));
    ok(
      s === 422 && (jbody(b).problems ?? []).some((p) => p.includes('unsafe path')),
      'a manifest with ../ in a path: 422',
    );
    [s, h, b] = await req(
      'POST',
      base + '/admin/operations',
      readFileSync(join(B.rel, 'manifest.json')),
      json(alice),
    );
    const op = jbody(b).operation_id;
    ok(
      s === 201 && jbody(b).release_id === B.id,
      'an operation for B, the manifest stored and checked at once',
    );
    const target = B.manifest.outputs[0];
    [s] = await req(
      'PUT',
      `${base}/admin/operations/${op}/objects/${target.sha256}`,
      'not the bytes of the manifest',
      alice,
    );
    ok(s === 422, 'wrong bytes for a listed sha256: 422, the key is not taken');
    [s] = await req('PUT', `${base}/admin/operations/${op}/objects/${'0'.repeat(64)}`, 'x', alice);
    ok(s === 404, 'an object the manifest does not list: 404');
    if (!a.real) {
      // with --real the limit is 64 MB: the real originals are larger than 4 KB
      [s] = await req(
        'PUT',
        `${base}/admin/operations/${op}/objects/${target.sha256}`,
        'x'.repeat(5000),
        alice,
      );
      ok(s === 413, 'an object over MAX_OBJECT_BYTES: 413');
    }
    [s, h, b] = await req('POST', `${base}/admin/operations/${op}/seal`, '{}', alice);
    ok(s === 409 && jbody(b).needed, 'seal with objects missing: 409, no candidate');
    [s] = await req(
      'PUT',
      `${base}/admin/operations/${op}/objects/${target.sha256}`,
      readFileSync(join(B.rel, target.path)),
      bob,
    );
    ok(s === 403, 'another operator cannot write into this operation: 403');
    [s] = await req(
      'POST',
      base + '/admin/publish',
      JSON.stringify({
        release_id: B.id,
        expected_revision: 0,
        request_id: 'r-b-unsealed-0000001',
      }),
      json(alice),
    );
    ok(s === 404, 'publish of a candidate that was never sealed: 404');
    [s] = await req('GET', base + '/api/releases/current');
    ok(s === 404, 'nothing became current');

    console.log('publish with one command');
    let r;
    [code, r] = await budget(
      ['publish', '--release', A.rel, '--originals', A.orig, ...where, '--yes'],
      env,
    );
    ok(
      code === 0 && r.release_id === A.id && r.revision === 1 && r.readback === 'verified',
      `budget publish A: uploaded, sealed, current at revision 1, read back (${short(r)})`,
    );
    [code, r] = await budget(['status', ...where], env);
    ok(
      code === 0 && r.release_id === A.id && r.revision === 1 && (r.journal ?? []).length === 1,
      'budget status: A at revision 1, one journal entry',
    );
    for (const X of [B, C, D]) {
      [code, r] = await budget(
        ['upload', '--release', X.rel, '--originals', X.orig, ...where, '--yes'],
        env,
      );
      ok(
        code === 0 && r.release_id === X.id,
        `budget upload ${X.id.slice(0, 8)}: a sealed candidate`,
      );
    }
    [code, r] = await budget(
      ['upload', '--release', B.rel, '--originals', B.orig, ...where, '--yes'],
      env,
    );
    ok(
      code === 0 && r.objects === 0,
      'budget upload again: resumed from the receipt, nothing sent twice',
    );

    console.log('4 interruption');
    const pub = (rid, rev, rq, hdr = alice, kind = 'publish') =>
      req(
        'POST',
        base + '/admin/publish',
        JSON.stringify({ release_id: rid, expected_revision: rev, request_id: rq, kind }),
        json(hdr),
      );
    const [s1, , b1] = await pub(B.id, 1, 'r-b-0000000000000001');
    const [s2, , b2] = await pub(B.id, 1, 'r-b-0000000000000001');
    ok(s1 === 200 && jbody(b1).revision === 2, 'publish B on revision 1: revision 2');
    ok(
      s2 === 200 && jbody(b2).replay && jbody(b2).revision === 2,
      'the same request again: the first result, replay, no new revision',
    );
    [s] = await pub(C.id, 1, 'r-b-0000000000000001');
    ok(s === 422, 'the same request_id with another payload: 422');
    [s, h, b] = await pub(C.id, 1, 'r-c-0000000000000002');
    ok(
      s === 409 && jbody(b).current_release_id === B.id,
      'a new request on the old revision: 409, the current release is named, B stays',
    );
    [s, h, b] = await req('GET', base + '/api/releases?limit=50');
    ok(s === 200 && (jbody(b).items ?? []).length === 2, 'two journal events, not three');

    console.log('5 two operators at the same moment');
    const [ra, rb] = await Promise.all([
      pub(C.id, 2, 'r-race-alice-000000000', alice),
      pub(D.id, 2, 'r-race-bob-000000000', bob),
    ]);
    const codes = [ra[0], rb[0]].sort();
    ok(
      codes[0] === 200 && codes[1] === 409,
      `one publish succeeds and the other gets 409 (${codes})`,
    );
    const winner = ra[0] === 200 ? 'alice' : rb[0] === 200 ? 'bob' : null;
    let cur = jbody((await req('GET', base + '/api/releases/current'))[2]);
    ok(
      winner !== null &&
        cur.revision === 3 &&
        cur.release_id === (winner === 'alice' ? C.id : D.id),
      'the pointer holds the winner at revision 3; the loser overwrote nothing',
    );

    console.log('rollback');
    const envB = operatorEnv(bob['Cf-Access-Jwt-Assertion']);
    [code, r] = await budget(['rollback', '--release-id', A.id, ...where, '--yes'], envB);
    ok(
      code === 0 &&
        r.revision === 4 &&
        r.release_id === A.id &&
        r.kind === 'rollback' &&
        r.readback === 'verified',
      `budget rollback to A: revision 4, read back (${short(r)})`,
    );
    const loser = winner === 'alice' ? D : C;
    [code, r] = await budget(['rollback', '--release-id', loser.id, ...where, '--yes'], envB);
    ok(
      code === 5,
      `rollback to a release that was never current: refused with exit 5 (${short(r)})`,
    );
    [code, r] = await budget(
      ['publish', '--release', B.rel, '--originals', B.orig, ...where, '--yes', '--dry-run'],
      env,
    );
    ok(
      code === 0 && r.dryRun === true && r.expected_revision === 4,
      `publish --dry-run reads the revision and writes nothing (${short(r)})`,
    );
    [code, r] = await budget(['publish', '--release', B.rel, '--originals', B.orig, ...where], env);
    ok(code === 2, 'publish without --yes or --dry-run: refused before any request (exit 2)');
    [s, h, b] = await req('GET', base + '/api/releases/current');
    ok(jbody(b).revision === 4, 'after the dry run the revision is still 4');

    console.log('public API');
    [s, h, b] = await req('GET', base + '/api/releases/current');
    ok(
      s === 200 &&
        h.get('Cache-Control') === 'no-store' &&
        jbody(b).manifest === `/data/releases/${A.id}/manifest.json`,
      'the pointer: no-store, the manifest URL',
    );
    [s, h, b] = await req('GET', base + '/api/releases?limit=2');
    const j = jbody(b);
    ok(
      s === 200 && (j.items ?? []).length === 2 && j.next && !b.toString('utf8').includes('@'),
      `the journal is paged and names no operator (${b.length} bytes)`,
    );
    [s, h, b] = await req('GET', `${base}/data/releases/${A.id}/manifest.json`);
    ok(
      s === 200 && sha(b) === A.id && (h.get('Cache-Control') ?? '').includes('immutable'),
      'the manifest bytes hash to the release_id; immutable',
    );
    const out0 = A.manifest.outputs[0];
    const out0url = `${base}/data/releases/${A.id}/${out0.path}`;
    [s, h, b] = await req('GET', out0url);
    ok(
      s === 200 && sha(b) === out0.sha256 && h.get('ETag') === `"${out0.sha256}"`,
      'an output: its bytes and the ETag of its sha256',
    );
    [s, h, b] = await req('GET', out0url, undefined, { 'Accept-Encoding': 'gzip' });
    let unzipped = null;
    try {
      unzipped = gunzipSync(b);
    } catch {}
    ok(
      s === 200 &&
        h.get('Content-Encoding') === 'gzip' &&
        unzipped !== null &&
        sha(unzipped) === out0.sha256 &&
        h.get('ETag') === `W/"${out0.sha256}"` &&
        (h.get('Cache-Control') ?? '').includes('no-transform'),
      `compressed by the Worker (no-transform keeps the edge from it): it decodes to the bytes of the sha256 (${h.get('Content-Encoding')}, ${h.get('ETag')}, ${b.length} bytes)`,
    );
    [s] = await req('GET', out0url, undefined, { 'If-None-Match': `"${out0.sha256}"` });
    ok(s === 304, 'If-None-Match: 304');
    [s, h, b] = await req('GET', out0url, undefined, { Range: 'bytes=0-9' });
    ok(
      s === 206 && b.length === 10 && (h.get('Content-Range') ?? '').startsWith('bytes 0-9/'),
      'Range: 206 with ten bytes',
    );
    [s, h] = await req('GET', `${base}/data/releases/${A.id}/data/originals/dv/law.html`);
    ok(
      s === 200 &&
        (h.get('Content-Disposition') ?? '').includes('attachment') &&
        hasSandbox(h.get('Content-Security-Policy') ?? ''),
      'an HTML original is a download in a sandbox, not a page of this origin',
    );
    ok(
      (h.get('Cache-Control') ?? '').includes('no-transform'),
      'release files are no-transform: the edge may not edit their bytes (a Web Analytics beacon)',
    );
    [s] = await req('GET', `${base}/data/releases/${A.id}/data/not-listed.json`);
    ok(s === 404, 'a file the manifest does not list: 404');
    [s] = await req('GET', `${base}/data/releases/${A.id}/%2e%2e/%2e%2e/secret`);
    ok(s === 404, 'an encoded ../ path: 404');
    const never = (winner === 'bob' ? C : D).id;
    [s] = await req('GET', `${base}/data/releases/${never}/manifest.json`);
    ok(s === 404, 'a candidate that never was current is not public: 404');
    [s, h, b] = await req('GET', `${base}/api/releases/${A.id}/datasets/x`);
    ok(
      s === 200 && jbody(b).release_id === A.id && jbody(b).files,
      'a dataset of the release carries the release ID and the schema',
    );
    for (const [method, path] of [
      ['POST', '/api/releases/current'],
      ['PUT', `/data/releases/${A.id}/data/x.json`],
      ['DELETE', `/data/releases/${A.id}/manifest.json`],
    ]) {
      [s] = await req(method, base + path, 'x');
      ok(s === 405, `${method} ${path.split('/')[1]}: 405, no public route writes`);
    }

    console.log('E the compatibility check of the deploy');
    [code, text] = compat(base);
    ok(
      code === 0 && text.includes(`release ${A.id.slice(0, 12)}: execution is execution/2`),
      'compat_check --env-url reads the current release of the Worker and passes (exit 0)',
    );

    console.log('one release on the screen (scenario 6)');
    cur = jbody((await req('GET', base + '/api/releases/current'))[2]);
    const rid = cur.release_id ?? '';
    const x = [A, B, C, D].find((rel) => rel.id === rid);
    const fileSha = (path) => x?.manifest.outputs.find((o) => o.path === path)?.sha256;
    [s, h, b] = await req('GET', base + '/izpalnenie');
    let page = b.toString('utf8');
    ok(
      s === 200 &&
        h.get('X-Release-Id') === rid &&
        page.includes(`<meta name="release-id" content="${rid}"/>`) &&
        page.includes(`<meta name="data-base" content="/data/releases/${rid}/data/"/>`),
      'a screen is drawn from the current release and names it, with the data base of that release',
    );
    ok(
      (h.get('Cache-Control') ?? '').includes('no-transform') &&
        (h.get('Content-Security-Policy') ?? '').startsWith("default-src 'self'"),
      'the document is no-transform and carries the content security policy',
    );
    await sleep(1000); // the copy is stored after the response (ctx.waitUntil)
    const [s2b, h2, b2b] = await req('GET', base + '/izpalnenie');
    ok(
      s2b === 200 &&
        h2.get('X-Screen-Cache') === 'HIT' &&
        h2.get('X-Release-Id') === rid &&
        b2b.equals(b) &&
        (h2.get('Cache-Control') ?? '').includes('max-age=0'),
      'the screen again comes from the edge cache: the same bytes, the same release, revalidated by the visitor',
    );
    const [s3, h3, b3] = await req('GET', base + '/izpalnenie', undefined, {
      'Accept-Encoding': 'gzip',
    });
    let page3 = null;
    try {
      page3 = gunzipSync(b3);
    } catch {}
    ok(
      s3 === 200 &&
        h3.get('Content-Encoding') === 'gzip' &&
        page3 !== null &&
        page3.equals(b) &&
        (h3.get('Cache-Control') ?? '').includes('no-transform'),
      'the document is compressed by the Worker for a visitor that accepts gzip (no-transform keeps the edge from it), the same bytes',
    );
    const [s4, h4, b4] = await req('GET', base + '/izpalnenie?x=junk&utm_source=feed');
    ok(
      s4 === 200 && h4.get('X-Screen-Cache') === 'HIT' && b4.equals(b),
      'a key the screen does not read (?x=, ?utm_source=) lands on the same cache entry: the same bytes, no new render',
    );
    const [s5, h5] = await req('GET', base + '/izpalnenie?mesec=1');
    ok(
      s5 === 200 && h5.get('X-Screen-Cache') === 'MISS',
      'a key the screen reads (?mesec=) is an entry of its own',
    );
    const [s6] = await req('GET', base + '/ne-e-ekran');
    await sleep(1000);
    const [s7, h7] = await req('GET', base + '/ne-e-ekran');
    ok(
      s6 === 404 && s7 === 404 && h7.get('X-Screen-Cache') === 'BYPASS',
      'the 404 screen is never kept in the edge cache',
    );
    [s, h, b] = await req('GET', base + '/data/x.json');
    ok(
      s === 200 &&
        x !== undefined &&
        sha(b) === fileSha('data/x.json') &&
        h.get('X-Release-Id') === rid,
      'the stable address /data/x.json serves the file of the current release',
    );
    [s, h, b] = await req('GET', base + '/data/feed.xml');
    const feed = b.toString('utf8');
    ok(
      s === 200 &&
        h.get('X-Release-Id') === rid &&
        !feed.includes('budget-na-svetlo.example') &&
        !feed.includes('#/') &&
        feed.includes('/izpalnenie?mesec=9</link>'),
      'the stable /data/feed.xml of a registry release links to the site, not to the placeholder host',
    );
    [s, h, b] = await req('GET', `${base}/data/releases/${rid}/data/feed.xml`);
    ok(
      s === 200 && x !== undefined && sha(b) === fileSha('data/feed.xml'),
      'the feed.xml of the release itself keeps its bytes (its SHA-256 is in the manifest)',
    );
    [s, h, b] = await req('GET', base + '/proverka');
    page = b.toString('utf8');
    const revs = (jbody((await req('GET', base + '/api/releases?limit=50'))[2]).items ?? []).map(
      (e) => e.revision,
    );
    ok(
      s === 200 &&
        page.includes('data-view="ready"') &&
        page.includes(rid) &&
        page.includes('id="s35-journal') &&
        revs.length > 0 &&
        revs.every((rev) => page.includes(`>${rev}<`)),
      `„Проверка на данните“ (section 9.1) is drawn from the current release, with its files and the registry's journal (${revs.length} revisions)`,
    );

    if (a.real) {
      console.log('the release of budget build, published and reproduced from the Worker');
      const rel = resolve(a.real);
      // the originals of a real release are the pinned files of this checkout (the default of `budget publish`)
      [code, r] = await budget(['publish', '--release', rel, ...where, '--yes'], env);
      ok(code === 0, `budget publish of ${rel} (${r.error ?? r.release_id})`);
      const realId = r.release_id ?? '';
      [s, h, b] = await req(
        'GET',
        `${base}/api/releases/${realId}/provenance/data/2026-09/kfp/rev`,
      );
      const pj = jbody(b);
      ok(
        s === 200 && pj.cell === 'B11' && pj.value === '33898.456' && pj.original?.download,
        'provenance of data/2026-09/kfp/rev: B11 of the September report, 33898.456, with the original to download',
      );
      await sleep(11_000); // the Worker reads the pointer at most every ten seconds (apps/web/workers/release-data.ts)
      [s, h, b] = await req('GET', base + '/izpalnenie');
      page = b.toString('utf8');
      ok(
        s === 200 &&
          h.get('X-Release-Id') === realId &&
          page.includes('data-view="ready"') &&
          page.includes(`/data/releases/${realId}/data/execution-provenance.json`),
        'the monthly screen is drawn from the published release, and its provenance link is the file of that release',
      );
      [code, r] = await budget(['reproduce', '--current', base], env);
      ok(
        code === 0 && r.verdict === 'reproduced byte for byte',
        `budget reproduce --current: the originals downloaded from the release, rebuilt byte for byte (${r.verdict ?? short(r)})`,
      );
    }
  } catch (e) {
    ok(false, 'the check stopped: ' + String(e?.stack || e).slice(0, 2000));
  } finally {
    await worker?.stop();
    if (!a.keep) rmSync(tmp, { recursive: true, force: true });
    else console.log('kept ' + tmp);
  }
  return summary();
}

process.exitCode = await main(process.argv.slice(2));
