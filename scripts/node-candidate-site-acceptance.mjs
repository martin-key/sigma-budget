/** Local-only Worker/SSR/browser/CSV journeys from a strictly verified fresh Node candidate. */
import { strict as assert } from 'node:assert';
import { readFile, writeFile, mkdir, symlink, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { exportCommit, preflightDestination } from '../packages/ingest/dist/release-build/index.js';
import { verifyNodeProof, parseManifest } from '../packages/ingest/dist/release-client/index.js';
const root = resolve(new URL('..', import.meta.url).pathname),
  [candidateArg, outArg] = process.argv.slice(2);
assert(
  candidateArg && outArg,
  'Usage: node scripts/node-candidate-site-acceptance.mjs NODE_CANDIDATE NEW_OUTPUT',
);
const candidate = resolve(candidateArg),
  out = await preflightDestination(resolve(outArg), [root, candidate]);
await mkdir(out);
const manifestBytes = await readFile(join(candidate, 'manifest.json')),
  manifest = parseManifest(manifestBytes, 67108864),
  validation = await readFile(join(candidate, 'validation.json')),
  receipt = JSON.parse(await readFile(join(candidate, 'receipt.json'), 'utf8'));
assert.equal(manifest.processing.executor?.id, 'registered-typescript-production/1');
verifyNodeProof(manifest, manifestBytes, receipt, validation);
const rid = createHash('sha256').update(manifestBytes).digest('hex');
const source = join(out, 'source');
await exportCommit(root, manifest.processing.code.commit, source);
for (const p of [
  'node_modules',
  'apps/web/node_modules',
  'packages/ingest/node_modules',
  'packages/dataset-schema/node_modules',
])
  if (existsSync(join(root, p))) {
    await mkdir(dirname(join(source, p)), { recursive: true });
    await symlink(join(root, p), join(source, p), 'dir');
  }
const config = {
  name: 'sigma-node-candidate-owned',
  main: join(source, 'apps/web/workers/app.ts'),
  compatibility_date: '2025-09-01',
  compatibility_flags: ['nodejs_compat'],
  assets: {
    binding: 'ASSETS',
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'none',
    run_worker_first: ['/data/*'],
  },
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'owned-registry',
      database_id: '00000000-0000-0000-0000-000000000000',
      migrations_dir: join(source, 'apps/web/migrations'),
    },
  ],
  r2_buckets: [{ binding: 'OBJECTS', bucket_name: 'owned-objects' }],
  vars: {
    ENVIRONMENT: 'local',
    SITE_ORIGIN: '',
    SIGMA_URL: '',
    FEEDBACK_EMAIL: '',
    NOINDEX: '1',
    ACCESS_ISSUER: '',
    ACCESS_AUD: '',
    SERVICE_TOKENS: '',
  },
};
const configPath = join(out, 'wrangler-source.json');
await writeFile(configPath, JSON.stringify(config));
const env = {
  ...process.env,
  HOME: join(out, 'home'),
  XDG_CONFIG_HOME: join(out, 'config'),
  WRANGLER_SEND_METRICS: 'false',
  NO_UPDATE_NOTIFIER: '1',
  BUDGET_CANDIDATE: candidate,
  WRANGLER_CONFIG: configPath,
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  CLOUDFLARE_ENV: '',
};
await mkdir(env.HOME);
await mkdir(env.XDG_CONFIG_HOME);
try {
  const build = await promisify(execFile)('pnpm', ['build'], {
    cwd: join(source, 'apps/web'),
    env,
    timeout: 300000,
    maxBuffer: 2 * 1024 * 1024,
  });
  await writeFile(join(out, 'site-build.log'), build.stdout + build.stderr);
} catch (e) {
  await writeFile(join(out, 'site-build.log'), String(e.stdout ?? '') + String(e.stderr ?? e));
  throw e;
}
const port = await new Promise((ok, no) => {
  const server = createServer();
  server.once('error', no);
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => ok(value));
  });
});
const origin = 'http://127.0.0.1:' + port,
  worker = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      join(source, 'apps/web/build/server/wrangler.json'),
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      join(out, 'state'),
      '--log-level',
      'error',
    ],
    { cwd: join(source, 'apps/web'), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
let workerLog = '',
  browser;
worker.stdout.on('data', (b) => (workerLog += b));
worker.stderr.on('data', (b) => (workerLog += b));
const delay = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function stop(child) {
  if (!child) return;
  const ended = () => child.exitCode !== null || child.signalCode !== null;
  const exited = ended() ? Promise.resolve() : new Promise((ok) => child.once('exit', ok));
  const signal = (s) => {
    try {
      process.kill(-child.pid, s);
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  };
  signal('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  signal('SIGKILL');
  await exited;
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (worker.exitCode !== null) throw Error('Owned Worker exited: ' + workerLog.slice(-1000));
    try {
      const r = await fetch(origin + '/robots.txt');
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert(ready, 'Owned Worker did not start');
  const journeys = [];
  for (const path of [
    '/byudzhet-2027?per=2027.draft',
    '/prihodi?per=2026.law',
    '/prognoza?per=2029.forecast',
    '/vedomstva?per=2027.draft',
    '/izpalnenie',
  ]) {
    const response = await fetch(origin + path),
      html = await response.text();
    assert.equal(response.status, 200, path);
    assert(html.includes(`name="release-id" content="${rid}"`), path + ' SSR release identity');
    assert(html.includes('data-view="ready"'), path + ' SSR ready data');
    journeys.push({ path, status: response.status, releaseId: rid });
  }
  for (const name of ['execution.json', 'budget2027.json', 'catalog.json']) {
    const expected = manifest.outputs.find((f) => f.path === 'data/' + name),
      response = await fetch(origin + '/data/' + name),
      bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(bytes.length, expected.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
  }
  // Existing locked test-tool Chromium. No package install or network fallback in this script.
  let chromium = process.env.CHROMIUM_PATH;
  if (!chromium) {
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache/ms-playwright');
    for (const folder of (await readdir(cache))
      .filter((n) => /^chromium-\d+$/.test(n))
      .sort()
      .reverse()) {
      const path = join(cache, folder, 'chrome-linux64/chrome');
      if (existsSync(path)) {
        chromium = path;
        break;
      }
    }
  }
  assert(
    chromium,
    'A provisioned Chromium is required (CHROMIUM_PATH or locked Playwright browser cache)',
  );
  let browserLog = '';
  browser = spawn(
    chromium,
    [
      '--headless',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--no-first-run',
      '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--user-data-dir=' + join(out, 'chromium-profile'),
      'about:blank',
    ],
    { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  browser.stderr.on('data', (b) => (browserLog += b));
  let wsUrl;
  for (let i = 0; i < 80; i++) {
    wsUrl = /DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(browserLog)?.[1];
    if (wsUrl) break;
    if (browser.exitCode !== null) throw Error('Chromium exited: ' + browserLog.slice(-1500));
    await delay(100);
  }
  assert(wsUrl, 'Chromium debugging endpoint missing');
  const endpoint = new URL(wsUrl);
  const page = await (
    await fetch(`http://${endpoint.host}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const socket = new WebSocket(page.webSocketDebuggerUrl),
    pending = new Map();
  let next = 1;
  await new Promise((ok, no) => {
    socket.onopen = ok;
    socket.onerror = no;
  });
  function call(method, params = {}, sessionId) {
    const id = next++;
    return new Promise((ok, no) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        no(Error('CDP deadline: ' + method));
      }, 30000);
      pending.set(id, {
        ok: (v) => {
          clearTimeout(timer);
          ok(v);
        },
        no: (e) => {
          clearTimeout(timer);
          no(e);
        },
      });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const external = [],
    errors = [];
  let session;
  socket.onmessage = (event) => {
    void dispatch(event).catch((e) => errors.push(String(e)));
  };
  async function dispatch(event) {
    const m = JSON.parse(event.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error ? p.no(Error(JSON.stringify(m.error))) : p.ok(m.result);
      }
      return;
    }
    if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.url;
      if (url.startsWith(origin + '/') || url.startsWith('data:'))
        await call('Fetch.continueRequest', { requestId: m.params.requestId }, m.sessionId);
      else {
        external.push(url);
        await call(
          'Fetch.failRequest',
          { requestId: m.params.requestId, errorReason: 'BlockedByClient' },
          m.sessionId,
        );
      }
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  }
  await call('Page.enable', {}, session);
  await call('Runtime.enable', {}, session);
  await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, session);
  await call('Page.navigate', { url: origin + '/izpalnenie' }, session);
  const evaluate = async (expression) => {
    const r = await call(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      session,
    );
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  let state;
  for (let i = 0; i < 80; i++) {
    state = await evaluate(
      `({ready:!!document.querySelector('[data-view="ready"]'),id:document.querySelector('meta[name="release-id"]')?.content,base:document.querySelector('meta[name="data-base"]')?.content})`,
    );
    if (state.ready && state.id === rid) break;
    await delay(250);
  }
  assert.equal(state.id, rid);
  assert.equal(state.base, '/data/');
  assert(state.ready);
  const browserProof = await evaluate(
    `(async()=>{const {data}=await import('/js/data.js');await data.load('releases/current');const raw=await (await fetch('/data/execution.json')).json();const share=await import('/js/share.js');let csv='';for(let i=0;i<40;i++){const spec=share.get('s15-b-grid');if(spec){csv=share.csvFor(spec);if(csv)break;}await new Promise(r=>setTimeout(r,100));}return {releaseId:data.get('releases/current')?.release_id,rawSchema:raw.contract.schema,rawRevenue:raw.data['2026'].kfp.rev[raw.latest.month-1],csv};})()`,
  );
  assert.equal(browserProof.releaseId, rid);
  assert.equal(browserProof.rawSchema, 2);
  const execution = JSON.parse(await readFile(join(candidate, 'data/execution.json'), 'utf8'));
  assert.equal(browserProof.rawRevenue, execution.data['2026'].kfp.rev[execution.latest.month - 1]);
  assert(browserProof.csv.startsWith('\uFEFF'));
  assert(browserProof.csv.includes(rid));
  assert(browserProof.csv.includes('издание'));
  await writeFile(join(out, 'execution.csv'), browserProof.csv);
  const month = Number(/mesec=(\d+)/.exec(browserProof.csv)?.[1]);
  assert(month >= 1 && month <= 12, 'CSV records its selected month');
  const revenue = execution.data['2026'].kfp.rev[month - 1];
  const expectedCsv = String(Math.round((Number(revenue) / 1000) * 1000) / 1000).replace('.', ',');
  assert(
    browserProof.csv.includes(expectedCsv),
    'CSV contains exact selected-month revenue in billion EUR: ' + expectedCsv,
  );
  assert.deepEqual(errors, []);
  const screenshot = await call(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    session,
  );
  await writeFile(join(out, 'execution.png'), Buffer.from(screenshot.data, 'base64'));
  await call('Fetch.disable');
  socket.onmessage = null;
  socket.close();
  const report = {
    releaseId: rid,
    head: manifest.processing.code.commit,
    journeys,
    assetHashes: 'all representative bytes match manifest',
    browser: {
      releaseId: browserProof.releaseId,
      rawSchema: browserProof.rawSchema,
      rawRevenue: browserProof.rawRevenue,
      csv: 'actual registered execution block; UTF-8 BOM, decimal comma and matching release ID',
      externalRequestsBlocked: external.length,
      errors,
    },
    network: 'owned loopback only',
  };
  await writeFile(join(out, 'site-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (e) {
  await writeFile(join(out, 'failure.log'), String(e.stack ?? e));
  throw e;
} finally {
  await stop(browser);
  await stop(worker);
  await writeFile(join(out, 'worker.log'), workerLog);
}
