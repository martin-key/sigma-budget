import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';

for (const failures of [0, 2, 3]) {
  test(`browser install preserves checks and retries at most three times (${failures} failures)`, () => {
    const root = mkdtempSync(join(tmpdir(), 'browser-retry-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      writeFileSync(join(root, 'count'), '0');
      writeFileSync(join(root, 'delays'), '');
      writeFileSync(
        join(bin, 'python'),
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$BROWSER_RETRY_STATE/args"
count=$(cat "$BROWSER_RETRY_STATE/count")
count=$((count + 1))
printf '%s' "$count" > "$BROWSER_RETRY_STATE/count"
if (( count <= BROWSER_RETRY_FAILURES )); then exit 17; fi
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(bin, 'sleep'),
        '#!/usr/bin/env bash\nprintf "%s\\n" "$1" >> "$BROWSER_RETRY_STATE/delays"\n',
        { mode: 0o755 },
      );
      const result = spawnSync('bash', [resolve('scripts/ci-install-browser.sh')], {
        env: {
          ...process.env,
          PATH: bin + delimiter + process.env.PATH,
          BROWSER_RETRY_STATE: root,
          BROWSER_RETRY_FAILURES: String(failures),
        },
        encoding: 'utf8',
        timeout: 5000,
      });
      const attempts = Math.min(failures + 1, 3);
      assert.equal(result.status, failures === 3 ? 17 : 0, result.stderr);
      assert.equal(Number(readFileSync(join(root, 'count'), 'utf8')), attempts);
      assert.deepEqual(
        readFileSync(join(root, 'args'), 'utf8').trim().split('\n'),
        Array(attempts).fill('-m playwright install --with-deps chromium'),
      );
      assert.equal(readFileSync(join(root, 'delays'), 'utf8'), attempts === 1 ? '' : '15\n30\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
