import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const workflow = readFileSync('.github/workflows/site.yml', 'utf8');
test('one Node suite command and explicit deploy barrier', () => {
  assert.equal((workflow.match(/run: pnpm test -- --coverage/g) || []).length, 1);
  assert.equal((workflow.match(/vitest run/g) || []).length, 0);
  assert.match(workflow, /deploy:\n    needs: \[required-validation, target\]/);
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
test('all retained provenance and browser commands stay in CI', () => {
  const evidence = JSON.parse(readFileSync('scripts/ci-provenance-commands.json', 'utf8'));
  for (const [path, commands] of Object.entries(evidence)) {
    const raw = readFileSync(path, 'utf8')
      .split('\n')
      .map((x) => x.trim().replace(/^(?:- )?run: /, ''));
    const current = raw.map((x) =>
      x === 'bash scripts/ci-install-browser.sh'
        ? 'pnpm exec playwright install --with-deps chromium'
        : x,
    );
    for (const command of commands) assert.ok(current.includes(command), command);
    const browserInstall = 'pnpm exec playwright install --with-deps chromium';
    assert.equal(
      current.filter((command) => command === browserInstall).length,
      commands.filter((command) => command === browserInstall).length,
      `${path}: every browser setup must retain the checked retry wrapper`,
    );
    assert.ok(
      !raw.some((command) => /playwright install/.test(command)),
      `${path}: a browser setup outside the checked retry wrapper`,
    );
  }
});

test('security covers other PR targets without duplicating main PR checks', () => {
  const { parse } = createRequire(
    createRequire(new URL('../apps/web/package.json', import.meta.url)).resolve(
      'vite/package.json',
    ),
  )('yaml');
  const site = parse(workflow);
  const security = parse(readFileSync('.github/workflows/security.yml', 'utf8'));
  assert.deepEqual(site.on.pull_request.branches, ['main']);
  assert.deepEqual(security.on.pull_request, { 'branches-ignore': ['main'] });
  assert.ok(Object.hasOwn(security.on, 'workflow_call'));
  assert.deepEqual(Object.keys(security.jobs).sort(), ['dependencies-and-secrets', 'semgrep']);
});

test('merged boot and route modules remain inside formatting and production coverage', async () => {
  const { getFileInfo } = await import('prettier');
  const { matchesGlob } = await import('node:path');
  const { default: config } = await import('../apps/web/vitest.config.ts');
  const modules = [
    'client/chrome-boot.js',
    'app/migration/screens.ts',
    ...['S14', 'S16', 'S25', 'S30', 'S35'].map((id) => `app/migration/screen-${id}.tsx`),
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
});

test('coverage CI checks the target baseline with history and env refs before running suites', () => {
  const { parse } = createRequire(
    createRequire(new URL('../apps/web/package.json', import.meta.url)).resolve(
      'vite/package.json',
    ),
  )('yaml');
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

test('every browser spec stays formatted, typechecked and strict in the independent e2e gate', async () => {
  const { getFileInfo } = await import('prettier');
  const { matchesGlob } = await import('node:path');
  const { default: coverage } = await import('../apps/web/vitest.config.ts');
  const { default: config } = await import('../tests/e2e/playwright.config.ts');
  assert.equal(config.retries, 0);
  assert.equal(config.forbidOnly, true);
  assert.match(
    JSON.parse(readFileSync('package.json', 'utf8')).scripts.typecheck,
    /tsc -p tests\/e2e\/tsconfig\.json/,
  );
  const tsconfig = JSON.parse(readFileSync('tests/e2e/tsconfig.json', 'utf8'));
  const specs = globSync('tests/e2e/**/*.spec.ts');
  assert.ok(
    specs.includes('tests/e2e/worker/boot.spec.ts'),
    'the boot guard must survive the migration',
  );
  for (const file of specs) {
    const info = await getFileInfo(file, { ignorePath: '.prettierignore' });
    assert.equal(info.inferredParser, 'typescript', file);
    assert.equal(info.ignored, false, file);
    assert.ok(
      tsconfig.include.some((glob) => matchesGlob(file.slice('tests/e2e/'.length), glob)),
      file,
    );
    assert.ok(
      !coverage.test.coverage.include.some((glob) => matchesGlob('../../' + file, glob)),
      file,
    );
  }
  // The fixtures and helpers count too: an automatic fixture there could skip every test, and a local `retries` would undo the config.
  for (const file of globSync('tests/e2e/**/*.ts').filter(
    (name) => name !== 'tests/e2e/playwright.config.ts',
  ))
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /\.\s*(?:only|skip|fixme|fail)\s*\(|\bretries\b/,
      file + ': focused, skipped, expected-failing or retried checks are forbidden',
    );
});

test('failed e2e diagnostics are uploaded before any later test invocation can clean them', () => {
  const { parse } = createRequire(
    createRequire(new URL('../apps/web/package.json', import.meta.url)).resolve(
      'vite/package.json',
    ),
  )('yaml');
  const steps = parse(workflow).jobs.check.steps;
  const artifact = steps.find((step) => step.with?.name === 'e2e-failure-results');
  assert.ok(artifact);
  assert.equal(artifact.uses, 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9');
  assert.equal(artifact.if, 'failure()');
  assert.equal(artifact.with.path, 'tmp/e2e-results');
  // Browser setup can fail before Playwright produces any files.
  assert.equal(artifact.with['if-no-files-found'], 'ignore');
  for (const step of steps.filter((step) => step.run?.includes('pnpm test:e2e'))) {
    assert.equal(
      step.if,
      undefined,
      'test invocations must retain the default success() condition',
    );
    assert.ok(steps.indexOf(step) < steps.indexOf(artifact));
  }
});

test('e2e project selectors use equals so file filters cannot become project names', () => {
  for (const file of [
    '.github/workflows/site.yml',
    'scripts/ci-provenance-commands.json',
    'README.md',
    'docs/dev-guide.md',
    'docs/release.md',
    'docs/ci-test-gates.md',
  ]) {
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /pnpm\s+test:e2e\b[^\n]*--project\s+/,
      file + ': use --project=worker or --project=static before file filters',
    );
  }
});
