// tests/release/compat_check.mjs --env-url against stand-in environments (node --test tests/release/*.test.mjs): the exit code the
// deploy relies on. The Worker itself is exercised by tests/release/release_check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./compat_check.mjs', import.meta.url));
const ID = 'a'.repeat(64);

function check(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('close', (code) => resolve([code, out]));
  });
}

async function environment(routes, run) {
  const server = createServer((request, response) => {
    const route = routes[request.url];
    if (!route) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      return response.end('{"message":"няма публикувано издание","release_id":null,"revision":0}');
    }
    response.writeHead(route[0], { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(route[1]));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const pointer = { release_id: ID, revision: 3, manifest: `/data/releases/${ID}/manifest.json` };
const manifest = (execution) => ({
  manifest_schema: 'budget-release/1',
  data_schema: { execution },
});

test('the code and the releases of the site agree', async () => {
  const [code, out] = await check([]);
  assert.equal(code, 0, out);
  assert.match(out, /RESULT: PASS/);
});

test('an environment without a current release has nothing to read yet', async () => {
  const [code, out] = await environment({}, (base) => check(['--env-url', base]));
  assert.equal(code, 0, out);
  assert.match(out, /no release is current there/);
});

test('a 404 that is not the answer of the Worker is not "no release yet"', async () => {
  const routes = { '/api/releases/current': [404, { error: 'not found' }] };
  const [code, out] = await environment(routes, (base) => check(['--env-url', base]));
  assert.equal(code, 2, out);
  assert.match(out, /HTTP 404, not from the Worker/);
});

test('a current release with a contract this code reads passes', async () => {
  const routes = {
    '/api/releases/current': [200, pointer],
    [pointer.manifest]: [200, manifest('execution/2')],
  };
  const [code, out] = await environment(routes, (base) => check(['--env-url', base + '/']));
  assert.equal(code, 0, out);
  assert.match(out, /execution is execution\/2, which this code reads/);
});

test('a current release with a contract this code cannot read fails', async () => {
  const routes = {
    '/api/releases/current': [200, pointer],
    [pointer.manifest]: [200, manifest('execution/9')],
  };
  const [code, out] = await environment(routes, (base) => check(['--env-url', base]));
  assert.equal(code, 1, out);
  assert.match(out, /FAIL {2}release aaaaaaaaaaaa: execution is execution\/9/);
});

test('an environment that cannot be read stops the deploy with exit 2', async () => {
  let [code, out] = await environment({ '/api/releases/current': [500, {}] }, (base) =>
    check(['--env-url', base]),
  );
  assert.equal(code, 2, out);
  [code, out] = await environment({ '/api/releases/current': [200, pointer] }, (base) =>
    check(['--env-url', base]),
  );
  assert.equal(code, 2, out);
  [code, out] = await environment({ '/api/releases/current': [200, { revision: 1 }] }, (base) =>
    check(['--env-url', base]),
  );
  assert.equal(code, 2, out);
  const closed = await environment({}, async (base) => base);
  [code, out] = await check(['--env-url', closed]);
  assert.equal(code, 2, out);
});
