// Shared by tests/release/release_check.mjs and tests/release/restore_drill.mjs: the built Worker under `wrangler dev` with a local D1
// and R2, Cloudflare Access tokens signed with an RSA key made for the run, synthetic releases in the form `budget build` writes them,
// and the TypeScript release operator (`./budget`). Nothing here reads a real credential or talks to Cloudflare.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ISSUER = 'https://sigma-budget-test.cloudflareaccess.com';
export const AUD = 'sigma-budget-test-aud';
export const OPERATORS = 'alice@example.org,bob@example.org';
export const WRANGLER = join(ROOT, 'node_modules/.bin/wrangler');
export const BUILT = join(ROOT, 'apps/web/build/server/wrangler.json');
export const RESULTS = [];

export function ok(cond, msg) {
  RESULTS.push([Boolean(cond), msg]);
  console.log((cond ? '  ok    ' : '  FAIL  ') + msg);
  return Boolean(cond);
}

export function summary() {
  const failed = RESULTS.filter(([good]) => !good);
  console.log(
    `RESULT: ${failed.length ? 'FAIL' : 'PASS'} · ${RESULTS.length} checks, ${failed.length} failed`,
  );
  return failed.length ? 1 : 0;
}

export const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** sorted keys, no spaces, one newline: the bytes `budget build` writes for a manifest, validation.json and receipt.json */
export function canonical(value) {
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  return Buffer.from(JSON.stringify(sort(value)) + '\n', 'utf8');
}

export const jbody = (bytes) => {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return {};
  }
};

/** an RSA key for the run: the JWKS for the Worker, and RS256 tokens */
export class Keys {
  constructor(kid) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { n, e } = publicKey.export({ format: 'jwk' });
    this.kid = kid;
    this.privateKey = privateKey;
    this.jwk = { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n, e };
  }

  token({ email, aud = AUD, iss = ISSUER, expIn = 600, commonName } = {}) {
    const head = b64(JSON.stringify({ alg: 'RS256', kid: this.kid, typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss, aud: [aud], iat: now, nbf: now, exp: now + expIn };
    if (email) claims.email = email;
    if (commonName) claims.common_name = commonName;
    const body = b64(JSON.stringify(claims));
    return `${head}.${body}.${b64(sign('sha256', Buffer.from(`${head}.${body}`), this.privateKey))}`;
  }
}

/**
 * One HTTP request without a client of its own opinions: no redirect, no decompression (a gzip body stays the bytes the Worker sent),
 * a fresh connection. Returns the status, the headers (Headers: case-insensitive) and the body bytes; an error status is a result too.
 */
export function req(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = request(url, { method, headers, agent: false, timeout: 60_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers))
          h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        resolve([res.statusCode, h, Buffer.concat(chunks)]);
      });
      res.on('error', reject);
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end(body);
  });
}

/**
 * Several serialized CSP policies are enforced together. Each must have exactly one bare `sandbox` directive: a duplicate later in a
 * policy cannot repair a permissive first one.
 */
export function hasSandbox(csp) {
  const policies = String(csp)
    .split(',')
    .map((p) => p.trim());
  for (const policy of policies) {
    const sandbox = policy
      .split(';')
      .map((part) => part.trim().toLowerCase().split(/\s+/).filter(Boolean))
      .filter((parts) => parts.length && parts[0] === 'sandbox');
    if (sandbox.length !== 1 || sandbox[0].length !== 1) return false;
  }
  return policies.length > 0;
}

/** a free local port, or BUDGET_TEST_PORT */
export async function freePort() {
  if (process.env.BUDGET_TEST_PORT) return Number(process.env.BUDGET_TEST_PORT);
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const MIME = {
  '.json': 'application/json',
  '.xls': 'application/vnd.ms-excel',
  '.html': 'text/html',
  '.xml': 'application/rss+xml',
  '.zip': 'application/zip',
};

/**
 * A small release folder as `budget build` writes it (manifest.json, receipt.json, validation.json with every required validation group,
 * one data file per dataset) and its originals (an xls-like and an HTML original, and the originals in `extra`). The Node proof is built
 * here from its contract, not by the code under test, so the operator's own checks decide whether it is accepted.
 */
export function makeRelease(
  root,
  name,
  text,
  groups,
  compatibility,
  commit = 'a'.repeat(40),
  extra = {},
) {
  const rel = join(root, 'rel-' + name),
    orig = join(root, 'orig-' + name);
  const feed = Buffer.from(
    `<rss version="2.0"><channel><title>${text}</title><link>https://budget-na-svetlo.example/</link>` +
      '<item><link>https://budget-na-svetlo.example/#/izpalnenie?mesec=9</link></item></channel></rss>\n',
  );
  const checked = groups.map((group) => ({
    group,
    status: 'OK',
    checks: 1,
    summary: 'synthetic release of tests/release',
    problems: [],
    warnings: [],
  }));
  const validation = canonical({
    tool: 'tests/release synthetic release',
    completeValidation: true,
    passed: true,
    groups: checked,
    result: `RESULT OK: ${checked.length} checks, 0 problems, 0 warnings`,
    historicalReconstruction: 'unverified',
  });
  const files = {
    'data/x.json': Buffer.from(JSON.stringify({ meta: { status: 'real' }, value: text })),
    'data/feed.xml': feed,
    'validation.json': validation,
  };
  const originals = {
    'data/originals/kfp_2026/report.xls': Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
      Buffer.from(text.repeat(8)),
    ]),
    'data/originals/dv/law.html': Buffer.from(`<html><script>alert(1)</script>${text}</html>`),
    ...extra,
  };
  for (const [p, b] of Object.entries(files)) {
    mkdirSync(dirname(join(rel, p)), { recursive: true });
    writeFileSync(join(rel, p), b);
  }
  for (const [p, b] of Object.entries(originals)) {
    mkdirSync(dirname(join(orig, p)), { recursive: true });
    writeFileSync(join(orig, p), b);
  }
  const m = {
    manifest_schema: 'budget-release/1',
    data_schema: { execution: 'execution/2' },
    provenance_format: 'provenance/1',
    processing: {
      code: { commit, repository: 'https://github.com/midt-bg/sigma-budget' },
      executor: { runtime: 'node-export/1', id: 'registered-typescript-production/1' },
      snapshot: { sha256: sha(`snapshot ${name}`) },
      parameters: { build_date: '2026-11-05' },
    },
    inputs: Object.entries(originals).map(([path, b]) => ({
      path,
      kind: 'source',
      source: 'test',
      acquisition: 'fetch',
      mime: MIME[extname(path)],
      bytes: b.length,
      sha256: sha(b),
    })),
    outputs: Object.entries(files).map(([path, b]) => ({
      path,
      mime: MIME[extname(path)],
      bytes: b.length,
      sha256: sha(b),
      ...(path.startsWith('data/') ? { dataset: 'x' } : { role: 'validation' }),
    })),
    coverage: {},
    compatibility: { execution: [...compatibility.execution] },
  };
  const mb = canonical(m);
  const releaseId = sha(mb);
  writeFileSync(join(rel, 'manifest.json'), mb);
  writeFileSync(
    join(rel, 'receipt.json'),
    canonical({
      schema: 'node-release-build/1',
      release_id: releaseId,
      built: m.processing.parameters.build_date + 'T00:00:00Z',
      env: 'node-offline',
      commit,
      executor: m.processing.executor,
      snapshot: m.processing.snapshot,
      validation_sha256: sha(validation),
      outputs_sha256: sha(canonical(m.outputs)),
    }),
  );
  return { rel, orig, id: releaseId, manifest: m };
}

/**
 * Builds the release operator once through the launcher operators use (`./budget`: Turbo builds @sigma-budget/etl and its packages), then
 * reads what the checks need from that build: the validation groups a Node release must carry and the declared compatibility.
 */
export async function prepareOperator() {
  const r = spawnSync(join(ROOT, 'budget'), ['--help'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0)
    fatal('./budget could not build the operator:\n' + (r.stderr || '').slice(-2000));
  const types = await import(
    pathToFileURL(join(ROOT, 'packages/ingest/dist/release-build/types.js')).href
  );
  const compat = await import(
    pathToFileURL(join(ROOT, 'packages/ingest/dist/release-build/contracts.js')).href
  );
  return {
    groups: [...types.REQUIRED_VALIDATION_GROUPS, 'REGISTRY'],
    compatibility: compat.RELEASE_COMPATIBILITY,
  };
}

/** `./budget <command> … --json` with the given process environment; the last line of its standard output is its JSON result */
export function budget(args, env) {
  return new Promise((resolve) => {
    const p = spawn(join(ROOT, 'budget'), [...args, '--json'], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => {
      const line = out.trim().split('\n').at(-1) ?? '';
      try {
        resolve([code, JSON.parse(line)]);
      } catch {
        // the operator prints only JSON; anything else is shown shortened (it never contains the token, which is an environment input)
        resolve([code, { stdout: out.slice(-400), stderr: err.slice(-400) }]);
      }
    });
  });
}

export function fatal(message) {
  console.error(message);
  process.exit(2);
}

/** react-router build of apps/web: the Worker of apps/web/workers/app.ts and the static files (docs/adr/0002-react-router-ssr.md) */
export function buildWorker(name) {
  if (!existsSync(WRANGLER))
    fatal(`${name}: run \`pnpm install --frozen-lockfile\` first (wrangler from pnpm-lock.yaml)`);
  const b = spawnSync(join(ROOT, 'node_modules/.bin/react-router'), ['build'], {
    cwd: join(ROOT, 'apps/web'),
    encoding: 'utf8',
  });
  if (b.status !== 0 || !existsSync(BUILT))
    fatal(
      `${name}: react-router build failed:\n` + ((b.stdout || '') + (b.stderr || '')).slice(-2000),
    );
}

export function wrangler(args) {
  return spawnSync(WRANGLER, args, { cwd: ROOT, encoding: 'utf8' });
}

/**
 * the built Worker under `wrangler dev` on a persisted state folder; stop() ends the process group it started, nothing else.
 * maxObjectBytes null leaves MAX_OBJECT_BYTES unset: the default size limits of every environment that does not set it.
 */
export async function startWorker({ state, port, log, key, maxObjectBytes = 4096, serviceTokens }) {
  const base = `http://127.0.0.1:${port}`;
  const vars = [
    'ACCESS_ISSUER:' + ISSUER,
    'ACCESS_AUD:' + AUD,
    'OPERATORS:' + OPERATORS,
    ...(serviceTokens ? ['SERVICE_TOKENS:' + serviceTokens] : []),
    'ACCESS_JWKS:' + JSON.stringify({ keys: [key.jwk] }),
    ...(maxObjectBytes === null ? [] : ['MAX_OBJECT_BYTES:' + maxObjectBytes]),
  ];
  const out = createWriteStream(log);
  const dev = spawn(
    WRANGLER,
    [
      'dev',
      '-c',
      BUILT,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      state,
      ...vars.flatMap((v) => ['--var', v]),
    ],
    { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  dev.stdout.pipe(out);
  dev.stderr.pipe(out);
  let exited = false;
  dev.on('exit', () => (exited = true));
  // wrangler runs in its own process group (so that stop() can end workerd with it), which also means that Ctrl+C in the terminal
  // does not reach it: an interrupted check ends the group itself, otherwise wrangler and workerd would keep the port.
  const interrupted = (signal) => {
    try {
      process.kill(-dev.pid, 'SIGTERM');
    } catch {}
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const stop = async () => {
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
    if (exited) return;
    const gone = new Promise((r) => dev.once('exit', r));
    try {
      process.kill(-dev.pid, 'SIGTERM');
    } catch {}
    const timer = setTimeout(() => {
      try {
        process.kill(-dev.pid, 'SIGKILL');
      } catch {}
    }, 20_000);
    await gone;
    clearTimeout(timer);
  };
  for (let i = 0; i < 120 && !exited; i++) {
    try {
      const [s] = await req('GET', base + '/api/releases/current');
      if (s === 200 || s === 404) return { base, stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stop();
  let tail = '';
  try {
    tail = readFileSync(log, 'utf8').slice(-2000);
  } catch {}
  throw new Error(`wrangler dev did not start (${log})\n${tail}`);
}
