import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { checkCoverage, compareBaselines, raisedBaseline } from './check-coverage.mjs';
const baseline = { tolerance: 0.5, workspaces: { 'apps/web': { lines: 80, branches: 70 } } };
const reports = (pct) => ({
  'apps/web': {
    total: Object.fromEntries(
      ['lines', 'branches', 'functions', 'statements'].map((m) => [m, { pct }]),
    ),
  },
});
test('boundary passes; regression and missing reports fail', () => {
  assert.deepEqual(checkCoverage(baseline, reports(79.5), []), []);
  assert.equal(checkCoverage(baseline, reports(79.49), []).length, 1);
  assert.equal(checkCoverage(baseline, {}, []).length, 4);
  assert.equal(checkCoverage(baseline, reports(NaN), []).length, 4);
});
test('reviewed exceptions are scoped, bounded and expire', () => {
  const e = {
    workspace: 'apps/web',
    metric: 'lines',
    minimum: 75,
    reason: 'Reviewed migration',
    review: 'https://github.com/midt-bg/sigma-budget/pull/1',
    expires: '2026-12-01',
  };
  assert.deepEqual(checkCoverage(baseline, reports(75), [e], '2026-11-11'), []);
  assert.equal(checkCoverage(baseline, reports(74), [e], '2026-11-11').length, 1);
  for (const change of [
    { review: '' },
    { reason: '' },
    { minimum: -1 },
    { workspace: 'apps/missing' },
    { expires: '2026-01-01' },
    { expires: '2026-99-99' },
  ]) {
    assert.throws(() => checkCoverage(baseline, reports(75), [{ ...e, ...change }], '2026-11-11'));
  }
  assert.throws(() => checkCoverage(baseline, reports(75), [e, e], '2026-11-11'));
});

test('the documented tolerance cannot be silently widened', () => {
  assert.throws(() => checkCoverage({ ...baseline, tolerance: 1 }, reports(79.4), []));
});

const script = fileURLToPath(new URL('./check-coverage.mjs', import.meta.url));
const exception = {
  workspace: 'apps/web',
  metric: 'lines',
  minimum: 75,
  reason: 'Reviewed production scope change',
  review: 'https://github.com/midt-bg/sigma-budget/pull/65',
  expires: '2099-12-01',
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'coverage-ratchet-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const write = (path, value) => writeFileSync(join(root, path), JSON.stringify(value) + '\n');
  mkdirSync(join(root, 'apps/web/coverage'), { recursive: true });
  mkdirSync(join(root, 'packages'));
  write('apps/web/package.json', { scripts: { test: 'vitest run' } });
  write('coverage-baseline.json', baseline);
  write('coverage-exceptions.json', []);
  write('apps/web/coverage/coverage-summary.json', reports(85)['apps/web']);
  const runWith = (env, ...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: '',
        COVERAGE_BASE_REF: 'integration',
        COVERAGE_BASE_SHA: '',
        ...env,
      },
    });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Coverage Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  const init = () => {
    git('init', '-q');
    commit();
    git('update-ref', 'refs/remotes/origin/integration', 'HEAD');
  };
  return { root, write, run: (...args) => runWith({}, ...args), runWith, git, commit, init };
}

test('--update rejects lower reports without changing baseline bytes, including within tolerance', (t) => {
  const { root, write, run } = fixture(t);
  const before = readFileSync(join(root, 'coverage-baseline.json'), 'utf8');
  for (const pct of [20, 79.8]) {
    write('apps/web/coverage/coverage-summary.json', reports(pct)['apps/web']);
    const result = run('--update');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /update refused/);
    assert.equal(readFileSync(join(root, 'coverage-baseline.json'), 'utf8'), before);
  }
  assert.throws(() => raisedBaseline(baseline, reports(75), [exception]), /update refused/);
});

test('--update validates missing, incomplete and invalid reports before writing anything', (t) => {
  const { root, write, run } = fixture(t);
  const before = readFileSync(join(root, 'coverage-baseline.json'), 'utf8');
  for (const total of [
    {},
    { ...reports(85)['apps/web'].total, functions: {} },
    { ...reports(85)['apps/web'].total, statements: { pct: 101 } },
  ]) {
    write('apps/web/coverage/coverage-summary.json', { total });
    assert.notEqual(run('--update').status, 0);
    assert.equal(readFileSync(join(root, 'coverage-baseline.json'), 'utf8'), before);
  }
  rmSync(join(root, 'apps/web/coverage/coverage-summary.json'));
  assert.notEqual(run('--update').status, 0);
  assert.equal(readFileSync(join(root, 'coverage-baseline.json'), 'utf8'), before);
});

test('--update raises minima only after complete reports pass', (t) => {
  const { root, run } = fixture(t);
  const result = run('--update');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'coverage-baseline.json'))), {
    ...baseline,
    workspaces: { 'apps/web': { lines: 85, branches: 85 } },
  });
});

test('base comparison rejects every reduction, including noise, and removed existing workspaces', (t) => {
  const { write, run, init } = fixture(t);
  init();
  for (const metric of ['lines', 'branches']) {
    write('coverage-baseline.json', {
      ...baseline,
      workspaces: {
        'apps/web': {
          ...baseline.workspaces['apps/web'],
          [metric]: baseline.workspaces['apps/web'][metric] - 0.1,
        },
      },
    });
    const result = run('--check-base');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, new RegExp(`baseline ${metric} reduced`));
  }
  assert.equal(compareBaselines({ ...baseline, workspaces: {} }, baseline, []).length, 1);
  assert.deepEqual(
    compareBaselines(
      {
        ...baseline,
        workspaces: { ...baseline.workspaces, 'apps/new': { lines: 20, branches: 10 } },
      },
      baseline,
      [],
    ),
    [],
  );
});

test('base reduction requires a valid, scoped exception that covers the new minimum', (t) => {
  const { write, run, init } = fixture(t);
  init();
  write('coverage-baseline.json', {
    ...baseline,
    workspaces: { 'apps/web': { lines: 75, branches: 70 } },
  });
  write('coverage-exceptions.json', [exception]);
  assert.equal(run('--check-base').status, 0);
  for (const change of [
    { minimum: 76 },
    { metric: 'branches' },
    { reason: '' },
    { expires: '2000-01-01' },
  ]) {
    write('coverage-exceptions.json', [{ ...exception, ...change }]);
    assert.notEqual(run('--check-base').status, 0);
  }
});

test('missing base file is explicitly skipped; missing refs and malformed base files fail', (t) => {
  const { root, run, git, commit, init } = fixture(t);
  rmSync(join(root, 'coverage-baseline.json'));
  init();
  writeFileSync(join(root, 'coverage-baseline.json'), JSON.stringify(baseline));
  let result = run('--check-base');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP baseline comparison: coverage-baseline.json does not exist/);
  writeFileSync(join(root, 'coverage-baseline.json'), '{broken');
  commit();
  git('update-ref', 'refs/remotes/origin/integration', 'HEAD');
  writeFileSync(join(root, 'coverage-baseline.json'), JSON.stringify(baseline));
  assert.notEqual(run('--check-base').status, 0);
  git('update-ref', '-d', 'refs/remotes/origin/integration');
  result = run('--check-base');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /SKIP/);
});

test('push and manual runs compare their previous merge-base, not the current HEAD baseline', (t) => {
  const { write, runWith, git, commit, init } = fixture(t);
  init();
  const before = git('rev-parse', 'HEAD');
  write('coverage-baseline.json', {
    ...baseline,
    workspaces: { 'apps/web': { lines: 75, branches: 70 } },
  });
  commit();
  for (const sha of [before, '']) {
    const result = runWith({ COVERAGE_BASE_REF: '', COVERAGE_BASE_SHA: sha }, '--check-base');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /baseline lines reduced from 80% to 75%/);
  }
  assert.notEqual(
    runWith({ COVERAGE_BASE_REF: '', COVERAGE_BASE_SHA: 'not-a-sha;exit 0' }, '--check-base')
      .status,
    0,
  );
});

test('PR target refs are literal argv values, including valid shell metacharacters', (t) => {
  const { runWith, git, init } = fixture(t);
  init();
  const ref = 'integration;literal';
  git('update-ref', `refs/remotes/origin/${ref}`, 'HEAD');
  const result = runWith({ COVERAGE_BASE_REF: ref }, '--check-base');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS baseline ratchet/);
  assert.notEqual(
    runWith({ COVERAGE_BASE_REF: 'integration:other.json' }, '--check-base').status,
    0,
  );
});
