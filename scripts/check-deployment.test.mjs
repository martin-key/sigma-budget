import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDeployment } from './check-deployment.mjs';

function clock() {
  let elapsed = 0;
  return {
    now: () => elapsed,
    wait: async (ms) => {
      elapsed += ms;
    },
    timeoutMs: 30,
    intervalMs: 10,
  };
}

test('deployment waits for DNS, certificate and the expected release to become ready', async () => {
  let calls = 0;
  await checkDeployment('https://site.example', 'expected', {
    ...clock(),
    timeoutMs: 100,
    fetchSite: async (url, options) => {
      assert.equal(url.href, 'https://site.example/');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, undefined);
      calls++;
      if (calls === 1) throw new Error('DNS not ready');
      if (calls === 2) throw new Error('certificate not ready');
      return new Response('', {
        status: 200,
        headers: { 'X-Release-Id': calls === 3 ? 'old' : 'expected' },
      });
    },
  });
  assert.equal(calls, 4);
});

for (const [name, status, headers] of [
  ['missing release header', 200, {}],
  ['wrong release', 200, { 'X-Release-Id': 'old' }],
  ['wrong status', 503, { 'X-Release-Id': 'expected' }],
]) {
  test(`deployment fails after the retry window: ${name}`, async () => {
    let calls = 0;
    await assert.rejects(
      checkDeployment('https://wrong.example', 'expected', {
        ...clock(),
        fetchSite: async () => {
          calls++;
          return new Response('', { status, headers });
        },
      }),
      /verification failed/,
    );
    assert.equal(calls, 3);
  });
}
