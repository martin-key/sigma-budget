import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('the code and the releases of the site agree', async () => {
  const result = spawnSync(process.execPath, ['tests/release/compat_check.mjs'], {
    encoding: 'utf8',
  });
  const code = result.status,
    out = result.stdout + result.stderr;
  assert.equal(code, 0, out);
  assert.match(out, /RESULT: PASS/);
});
