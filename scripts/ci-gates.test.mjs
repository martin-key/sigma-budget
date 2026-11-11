import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const workflow = readFileSync('.github/workflows/site.yml', 'utf8');
test('one Node suite command and explicit deploy barrier', () => {
  assert.equal((workflow.match(/run: pnpm test -- --coverage/g) || []).length, 1);
  assert.equal((workflow.match(/vitest run/g) || []).length, 0);
  assert.match(workflow, /deploy:\n    needs: \[required-validation\]/);
  const deps = workflow
    .match(/required-validation:[\s\S]*?needs:\s*\[([^\]]+)\]/)[1]
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const jobs = [
    ...workflow.slice(workflow.indexOf('jobs:\n')).matchAll(/^  ([a-z][\w-]*):\n(?:    |\n)/gm),
  ]
    .map((x) => x[1])
    .filter((x) => !['deploy', 'required-validation'].includes(x));
  for (const job of jobs) assert.ok(deps.includes(job), `missing gate ${job}`);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}[\s\S]*Every validation must succeed/);
});
test('all independent Python and provenance commands survive the consolidation', () => {
  const evidence = JSON.parse(readFileSync('scripts/ci-provenance-commands.json', 'utf8'));
  for (const [path, commands] of Object.entries(evidence)) {
    const current = readFileSync(path, 'utf8')
      .split('\n')
      .map((x) => x.trim().replace(/^- run: /, ''))
      .map((x) =>
        x === 'bash scripts/ci-install-browser.sh'
          ? 'python -m playwright install --with-deps chromium'
          : x,
      );
    for (const command of commands) assert.ok(current.includes(command), command);
    const browserInstall = 'python -m playwright install --with-deps chromium';
    assert.equal(
      current.filter((command) => command === browserInstall).length,
      commands.filter((command) => command === browserInstall).length,
      `${path}: every browser setup must retain the checked retry wrapper`,
    );
  }
  const wave = readFileSync('.github/workflows/wave15b-validation.yml', 'utf8');
  assert.match(wave, /workflow_call:/);
  assert.doesNotMatch(wave, /vitest run/);
});

test('security covers other PR targets without duplicating main PR checks', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const site = parse(workflow);
  const security = parse(readFileSync('.github/workflows/security.yml', 'utf8'));
  assert.deepEqual(site.on.pull_request.branches, ['main']);
  assert.deepEqual(security.on.pull_request, { 'branches-ignore': ['main'] });
  assert.ok(Object.hasOwn(security.on, 'workflow_call'));
  assert.deepEqual(Object.keys(security.jobs).sort(), ['dependencies-and-secrets', 'semgrep']);
});

test('ETL coverage includes the standalone entry point and retains shared production globs', async () => {
  const { default: config } = await import('../apps/etl/vitest.config.ts');
  assert.deepEqual(config.test.coverage.include, [
    'src/**/*.{ts,js}',
    'bin/**/*.js',
    'publication-documents/prepare.mjs',
  ]);
});

test('merged boot and route modules remain inside formatting and production coverage', async () => {
  const { getFileInfo } = await import('prettier');
  const { matchesGlob } = await import('node:path');
  const { default: config } = await import('../apps/web/vitest.config.ts');
  const modules = [
    'client/chrome-boot.js',
    'app/migration/screens.ts',
    ...['S14', 'S16', 'S25', 'S26', 'S30', 'S35'].map((id) => `app/migration/screen-${id}.tsx`),
  ];
  for (const file of modules) {
    assert.ok(
      config.test.coverage.include.some((glob) => matchesGlob(file, glob)),
      file,
    );
    const info = await getFileInfo(`apps/web/${file}`, { ignorePath: '.prettierignore' });
    assert.equal(info.ignored, false, file);
    assert.ok(info.inferredParser, file);
  }
  for (const file of ['package.json', 'apps/web/package.json']) {
    const info = await getFileInfo(file, { ignorePath: '.prettierignore' });
    assert.equal(info.inferredParser, 'json-stringify', file);
    assert.equal(info.ignored, false, file);
  }
  // Python stays in its own unit/e2e gates; it is never presented as V8/Prettier coverage.
  const python = await getFileInfo('tests/e2e/boot.py', { ignorePath: '.prettierignore' });
  assert.equal(python.inferredParser, null);
});

test('every report reaches strict Turbo tasks and its upload uses the same env path', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const job = parse(workflow).jobs.coverage;
  const turbo = JSON.parse(readFileSync('turbo.json', 'utf8'));
  const allowed = [...turbo.globalEnv, ...turbo.globalPassThroughEnv];
  const names = Object.keys(job.env).filter((name) => name.endsWith('_REPORT'));
  const uploaded = [];
  for (const step of job.steps.filter((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  )) {
    for (const match of step.with.path.matchAll(/\$\{\{ env\.([A-Z0-9_]+_REPORT) \}\}/g)) {
      uploaded.push(match[1]);
      assert.equal(step.with['if-no-files-found'], 'error');
      assert.equal(step.if, 'always()');
    }
  }
  assert.deepEqual(uploaded.sort(), [...names].sort());
  for (const name of names) assert.ok(allowed.includes(name), `Turbo drops ${name}`);
  for (const name of names) {
    assert.equal(
      [...workflow.matchAll(new RegExp(`^ +${name}:`, 'gm'))].length,
      1,
      `${name}: exactly one report path definition`,
    );
  }
  assert.ok(job.steps.some((step) => step.run === 'node scripts/check-parity-reports.mjs --clean'));
  assert.ok(job.steps.some((step) => step.run === 'node scripts/check-parity-reports.mjs'));
});

test('coverage CI checks the target baseline with history and env refs before running suites', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const job = parse(workflow).jobs.coverage;
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 0);
  const gate = job.steps.findIndex(
    (step) => step.run === 'node scripts/check-coverage.mjs --check-base',
  );
  assert.ok(gate >= 0);
  assert.deepEqual(job.steps[gate].env, {
    COVERAGE_BASE_REF: '${{ github.base_ref }}',
    COVERAGE_BASE_SHA: '${{ github.event.before }}',
  });
  assert.ok(gate < job.steps.findIndex((step) => step.run === 'pnpm test -- --coverage'));
});
