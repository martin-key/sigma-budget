// Negative controls for gitleaks: the scanner must block an introduced secret and accept safe input.
// The semgrep controls run inside the semgrep image, which has no Node: scripts/security-scanner-check.sh.
// Usage: node scripts/security-scanner-check.mjs gitleaks <gitleaks-binary>
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [kind, binary, ...rest] = process.argv.slice(2);
if (kind !== 'gitleaks' || !binary || rest.length) {
  console.error(
    'usage: security-scanner-check.mjs gitleaks <gitleaks-binary> (semgrep: security-scanner-check.sh)',
  );
  process.exit(2);
}

// Public, fixed test data; chosen to exercise the detector, outside reviewed checksums.
const controlValue = 'b1fe548869255ebb76ff76b0f5042749a8afaa501f44e7a64f306aa4b256d8c7';
const samples = [['bad.txt', `api_key = "${controlValue}"`]];
for (const name of [
  'validate14/code-path-capture',
  'validate15/compound/provenance',
  'validate17a/provenance',
  'validate15/oracle',
  'wave13b/proof',
]) {
  samples.push([`packages/ingest/test/fixtures/${name}.json`, `{"api_key":"${controlValue}"}`]);
}

const target = mkdtempSync(join(tmpdir(), 'security-control-'));
const scan = () => {
  const result = spawnSync(
    binary,
    ['dir', target, '--config', join(root, '.gitleaks.toml'), '--redact', '--no-banner'],
    { encoding: 'utf8' },
  );
  return {
    status: result.status ?? result.error?.message ?? result.signal,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
};
const fail = (message, output) => {
  if (output) process.stderr.write(output);
  console.error(`${kind}: ${message}`);
  process.exitCode = 1;
};

try {
  let failed = false;
  for (const [name, content] of samples) {
    const file = join(target, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    const { status, output } = scan();
    // gitleaks exits 1 for a finding and for a fatal error alike (a broken config, for one), so the
    // exit code alone does not show that the sample was detected.
    if (status !== 1 || !output.includes('leaks found')) {
      fail(`negative control did not fail with a finding (${name}, exit ${status})`, output);
      failed = true;
      break;
    }
    unlinkSync(file);
  }
  if (!failed) {
    writeFileSync(
      join(target, 'safe.js'),
      "const key = '2028.forecast'; const laterKey = '2029.forecast';",
    );
    const { status, output } = scan();
    if (status !== 0) fail(`safe control failed (exit ${status})`, output);
    else console.log(`${kind}: ${samples.length} unsafe controls blocked; safe control passed`);
  }
} finally {
  rmSync(target, { recursive: true, force: true });
}
