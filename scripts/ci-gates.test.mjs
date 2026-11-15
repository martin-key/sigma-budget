import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, globSync, readFileSync } from 'node:fs';
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
  // the Python browser checks that remain run on the browser build the npm Playwright installs: both stay on one version
  const lock = 'tests/requirements-dev.lock';
  if (existsSync(lock))
    assert.equal(
      readFileSync(lock, 'utf8').match(/^playwright==(\S+)/m)?.[1],
      JSON.parse(readFileSync('package.json', 'utf8')).devDependencies['@playwright/test'],
      'the Python and the npm Playwright must share one Chromium build',
    );
});

test('committed release checks use Node after authenticating the input snapshot', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const jobs = parse(workflow).jobs;
  for (const name of ['node-import']) {
    const job = jobs[name];
    assert.ok(!job.steps.some((step) => /setup-(python|uv)@/.test(step.uses ?? '')));
    assert.ok(!job.steps.some((step) => /\b(python[\d.]*|pip\d*|uv)\b/.test(step.run ?? '')));
  }
  const steps = jobs['node-import'].steps;
  const compile = steps.findIndex(
    (step) => step.run === 'pnpm --filter @sigma-budget/etl... build',
  );
  const restore = steps.findIndex((step) =>
    step.run?.startsWith('node scripts/restore-node-input-cache.mjs '),
  );
  const validate = steps.findIndex(
    (step) => step.run === './budget check-site --inputs "$RUNNER_TEMP/registered-node-inputs"',
  );
  assert.ok(compile >= 0 && restore > compile && validate > restore);
  assert.equal(steps[validate].if, undefined);
  assert.ok(!steps[validate]['continue-on-error']);
  const provenance = jobs.build.steps.find(
    (step) => step.run === 'node tests/release/budget_provenance_check.mjs',
  );
  assert.ok(provenance);
  assert.equal(provenance.if, undefined);
  assert.ok(!provenance['continue-on-error']);
  // Browser e2e and the historical data image still need Python until their later ports.
  assert.ok(jobs.check.steps.some((step) => step.uses?.startsWith('actions/setup-python@')));
});

test('the full pipeline suite retains Python and authenticated programme originals in build', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const job = parse(workflow).jobs.build;
  assert.ok(job.needs.includes('node-inputs'));
  const steps = job.steps;
  assert.ok(steps.some((step) => step.uses?.startsWith('actions/setup-python@')));
  const tools = steps.findIndex((step) =>
    step.run?.includes(
      'python -m pip install --require-hashes -r tests/requirements-dev.lock -r pipeline/requirements.lock',
    ),
  );
  const restore = steps.findIndex(
    (step) =>
      step.run ===
      'node scripts/restore-programme-test-inputs.mjs "$RUNNER_TEMP/registered-node-input-archive/registered-node-inputs.tar.gz"',
  );
  const tests = steps.findIndex(
    (step) => step.run === 'python -m unittest discover -s tests/pipeline -t .',
  );
  assert.ok(tools >= 0 && restore > tools && tests > restore);
  assert.equal(steps[tests].if, undefined);
  assert.ok(!steps[tests]['continue-on-error']);
});

test('the build job checks the registries with the TypeScript validator after building it', () => {
  const build = workflow.slice(workflow.indexOf('\n  build:\n'));
  const compile = build.indexOf('pnpm --filter @sigma-budget/etl... build');
  const check = build.indexOf(
    '- name: Check the source and dataset registries\n        run: node packages/ingest/dist/validate/cli.js --live --only REGISTRY\n',
  );
  assert.ok(compile >= 0 && check > compile, 'the registry check runs on the built validator');
  assert.doesNotMatch(workflow, /budget_pipeline\.validate\.registry/);
});

test('node-import checks the registries with the full history, so the historical producers are looked up', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const job = parse(workflow).jobs['node-import'];
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 0);
  const built = job.steps.findIndex(
    (step) => step.run === 'pnpm --filter @sigma-budget/etl... build',
  );
  const check = job.steps.findIndex((step) =>
    step.run?.includes('node packages/ingest/dist/validate/cli.js --live --only REGISTRY'),
  );
  assert.ok(built >= 0 && check > built);
  const run = job.steps[check].run;
  // a skipped lookup fails the step, and so does a failing validator
  assert.match(
    run,
    /if grep -q 'verification skipped' "\$RUNNER_TEMP\/registry\.json"; then\n(?:.*\n)*?\s*exit 1\n\s*fi/,
  );
  assert.match(run, /\|\| status=\$\?\n/);
  assert.match(run, /\nexit "\$status"\n?$/);
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

test('the Node suites run without a Python interpreter', () => {
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const job = parse(workflow).jobs.coverage;
  assert.ok(!job.steps.some((step) => /setup-(python|uv)@/.test(step.uses ?? '')));
  assert.ok(!job.steps.some((step) => /\b(python[\d.]*|pip\d*|uv)\b/.test(step.run ?? '')));
  for (const name of [job, ...job.steps].flatMap((part) => Object.keys(part.env ?? {})))
    assert.ok(!name.startsWith('PYTHON'), `coverage still sets ${name}`);
  const turbo = JSON.parse(readFileSync('turbo.json', 'utf8'));
  for (const name of [
    ...(turbo.globalEnv ?? []),
    ...(turbo.globalPassThroughEnv ?? []),
    ...Object.values(turbo.tasks ?? {}).flatMap((task) => [
      ...(task.env ?? []),
      ...(task.passThroughEnv ?? []),
    ]),
  ])
    assert.ok(!name.startsWith('PYTHON'), `Turbo still passes ${name}`);
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
  const { parse } = createRequire(new URL('../packages/ingest/package.json', import.meta.url))(
    'yaml',
  );
  const steps = parse(workflow).jobs.check.steps;
  const artifact = steps.find((step) => step.with?.name === 'e2e-failure-results');
  assert.ok(artifact);
  assert.equal(artifact.uses, 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9');
  assert.equal(artifact.if, 'failure()');
  assert.equal(artifact.with.path, 'tmp/e2e-results');
  // Python can fail before Playwright produces any files.
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
