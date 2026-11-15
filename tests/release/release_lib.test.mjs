// The response helpers of tests/release/release_check.mjs (node --test tests/release/*.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { hasSandbox, req } from './release_lib.mjs';

async function serve(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('success and error headers are read case-insensitively, and an error status is a result', async () => {
  const headers = {
    'content-security-policy': "default-src 'self'; sandbox",
    'CACHE-CONTROL': 'no-store, no-transform',
    'Content-Disposition': 'attachment; filename="original.html"',
  };
  await serve(
    (request, response) => {
      response.writeHead(request.url === '/error' ? 400 : 200, headers);
      response.end('body');
    },
    async (base) => {
      for (const [path, status] of [
        ['/ok', 200],
        ['/error', 400],
      ]) {
        const [s, found, body] = await req('GET', base + path);
        assert.equal(s, status);
        assert.equal(body.toString(), 'body');
        assert.ok(hasSandbox(found.get('Content-Security-Policy') ?? ''));
        assert.match(found.get('Cache-Control') ?? '', /no-transform/);
        assert.match(found.get('Content-Disposition') ?? '', /attachment/);
      }
    },
  );
});

test('a compressed body stays the bytes the server sent', async () => {
  const zipped = gzipSync('the bytes');
  await serve(
    (request, response) => {
      response.writeHead(200, { 'Content-Encoding': 'gzip' });
      response.end(zipped);
    },
    async (base) => {
      const [, found, body] = await req('GET', base, undefined, { 'Accept-Encoding': 'gzip' });
      assert.equal(found.get('content-encoding'), 'gzip');
      assert.deepEqual(body, zipped);
    },
  );
});

test('sandbox requires a bare directive, not a substring or permissions', () => {
  assert.ok(hasSandbox('sandbox'));
  assert.ok(hasSandbox("default-src 'self'; sandbox; object-src 'none'"));
  assert.ok(hasSandbox("sandbox, default-src 'self'; sandbox"));
  for (const policy of [
    'sandbox allow-scripts; sandbox',
    'sandbox allow-scripts allow-same-origin; sandbox',
    'sandbox; sandbox',
    'sandbox, sandbox allow-scripts',
    "sandbox, default-src 'self'",
    "default-src 'self'",
    'report-uri /sandbox',
    'sandbox allow-scripts',
    'sandbox allow-same-origin',
    '',
  ])
    assert.equal(hasSandbox(policy), false, policy);
});
