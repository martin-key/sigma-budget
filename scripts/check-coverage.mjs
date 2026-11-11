import { readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function validateConfig(baseline, exceptions, today = new Date().toISOString().slice(0, 10)) {
  if (baseline.tolerance !== 0.5) throw new Error('Coverage tolerance must remain 0.5pp');
  for (const [workspace, targets] of Object.entries(baseline.workspaces)) {
    for (const metric of ['lines', 'branches']) {
      if (!Number.isFinite(targets[metric]) || targets[metric] < 0 || targets[metric] > 100)
        throw new Error(`Invalid baseline: ${workspace}/${metric}`);
    }
  }
  const scopes = new Set();
  for (const e of exceptions) {
    if (
      !baseline.workspaces[e.workspace] ||
      !['lines', 'branches'].includes(e.metric) ||
      !Number.isFinite(e.minimum) ||
      e.minimum < 0 ||
      e.minimum > 100 ||
      !e.reason?.trim() ||
      !/^https:\/\/github.com\/midt-bg\/sigma-budget\/pull\/\d+$/.test(e.review) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.expires) ||
      !Number.isFinite(Date.parse(e.expires)) ||
      new Date(e.expires).toISOString().slice(0, 10) !== e.expires ||
      e.expires < today
    ) {
      throw new Error('Invalid or expired reviewed coverage exception');
    }
    const scope = `${e.workspace}/${e.metric}`;
    if (scopes.has(scope)) throw new Error('Duplicate coverage exception');
    scopes.add(scope);
  }
}

export function checkCoverage(
  baseline,
  reports,
  exceptions,
  today = new Date().toISOString().slice(0, 10),
) {
  validateConfig(baseline, exceptions, today);
  const failures = [];
  for (const [workspace, targets] of Object.entries(baseline.workspaces)) {
    const total = reports[workspace]?.total;
    for (const metric of ['lines', 'branches', 'functions', 'statements']) {
      const actual = total?.[metric]?.pct;
      if (!Number.isFinite(actual) || actual < 0 || actual > 100) {
        failures.push(`${workspace}: missing/invalid ${metric} report`);
        continue;
      }
      if (!['lines', 'branches'].includes(metric)) continue;
      const target = targets[metric];
      const exception = exceptions.filter((e) => e.workspace === workspace && e.metric === metric);
      const minimum = exception[0]?.minimum ?? target - baseline.tolerance;
      if (actual < minimum) failures.push(`${workspace}: ${metric} ${actual}% < ${minimum}%`);
    }
  }
  return failures;
}

export function compareBaselines(baseline, base, exceptions, today) {
  validateConfig(baseline, exceptions, today);
  validateConfig(base, [], today);
  const failures = [];
  for (const [workspace, targets] of Object.entries(base.workspaces)) {
    if (!baseline.workspaces[workspace]) {
      failures.push(`${workspace}: existing baseline workspace removed`);
      continue;
    }
    for (const metric of ['lines', 'branches']) {
      const current = baseline.workspaces[workspace][metric];
      if (current >= targets[metric]) continue;
      const exception = exceptions.find((e) => e.workspace === workspace && e.metric === metric);
      if (!exception || current < exception.minimum)
        failures.push(
          `${workspace}: baseline ${metric} reduced from ${targets[metric]}% to ${current}% without a covering reviewed exception`,
        );
    }
  }
  return failures;
}

export function raisedBaseline(baseline, reports, exceptions, today) {
  // Validate every workspace and all four report metrics before creating a candidate.
  const failures = checkCoverage(baseline, reports, exceptions, today);
  if (failures.length) throw new Error(`Coverage baseline update refused:\n${failures.join('\n')}`);
  const candidate = {
    ...baseline,
    workspaces: Object.fromEntries(
      Object.keys(baseline.workspaces).map((workspace) => [
        workspace,
        Object.fromEntries(
          ['lines', 'branches'].map((metric) => [metric, reports[workspace].total[metric].pct]),
        ),
      ]),
    ),
  };
  // Updates never lower a minimum, even within the noise tolerance or with an exception.
  const reductions = compareBaselines(candidate, baseline, [], today);
  if (reductions.length)
    throw new Error(`Coverage baseline update refused:\n${reductions.join('\n')}`);
  return candidate;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function comparisonRef(env, cwd = process.cwd()) {
  if (env.COVERAGE_BASE_REF) {
    // base_ref can contain shell metacharacters. Keep it in argv and validate the full ref.
    git(['check-ref-format', `refs/heads/${env.COVERAGE_BASE_REF}`], cwd);
    return `refs/remotes/origin/${env.COVERAGE_BASE_REF}`;
  }
  const before = env.COVERAGE_BASE_SHA;
  if (before && !/^0+$/.test(before) && !/^[a-f0-9]{40}$/i.test(before))
    throw new Error('Invalid coverage push base SHA');
  // Pushes compare with the common ancestor of HEAD and the pre-push revision;
  // manual runs use the previous revision. Checkout fetches the needed history.
  return git(['merge-base', 'HEAD', before && !/^0+$/.test(before) ? before : 'HEAD^'], cwd);
}

export function readBaseBaseline(ref, cwd = process.cwd()) {
  // A missing ref, malformed JSON or git failure is an error, never an introduction skip.
  git(['rev-parse', '--verify', `${ref}^{commit}`], cwd);
  if (!git(['ls-tree', ref, '--', 'coverage-baseline.json'], cwd)) return null;
  return JSON.parse(git(['show', `${ref}:coverage-baseline.json`], cwd));
}

function main(args, env) {
  const baseline = JSON.parse(readFileSync('coverage-baseline.json', 'utf8'));
  const exceptions = JSON.parse(readFileSync('coverage-exceptions.json', 'utf8'));
  validateConfig(baseline, exceptions);
  if (args.includes('--update') && args.includes('--check-base'))
    throw new Error('Choose either --update or --check-base');
  const workspaces = ['apps', 'packages']
    .flatMap((dir) => readdirSync(dir).map((name) => `${dir}/${name}`))
    .filter((dir) => {
      try {
        return JSON.parse(readFileSync(`${dir}/package.json`)).scripts?.test;
      } catch {
        return false;
      }
    });
  if (
    workspaces.some((w) => !baseline.workspaces[w]) ||
    Object.keys(baseline.workspaces).some((w) => !workspaces.includes(w))
  ) {
    throw new Error('Baseline must list every test-bearing workspace');
  }
  if (args.includes('--check-base')) {
    const ref = comparisonRef(env);
    const base = readBaseBaseline(ref);
    if (base === null) {
      console.log(`SKIP baseline comparison: coverage-baseline.json does not exist at ${ref}`);
      return;
    }
    const failures = compareBaselines(baseline, base, exceptions);
    console.log(failures.length ? failures.join('\n') : `PASS baseline ratchet against ${ref}`);
    if (failures.length) process.exitCode = 1;
    return;
  }
  const reports = Object.fromEntries(
    workspaces.map((w) => [
      w,
      JSON.parse(readFileSync(`${w}/coverage/coverage-summary.json`, 'utf8')),
    ]),
  );
  if (args.includes('--update')) {
    const candidate = raisedBaseline(baseline, reports, exceptions);
    writeFileSync('coverage-baseline.json', JSON.stringify(candidate, null, 2) + '\n');
  }
  const failures = checkCoverage(baseline, reports, exceptions);
  const summary =
    '# Покритие на Node тестовете\n\n| Workspace | Lines | Branches | Functions | Statements |\n| --- | ---: | ---: | ---: | ---: |\n' +
    workspaces
      .map(
        (w) =>
          `| ${w} | ` +
          ['lines', 'branches', 'functions', 'statements']
            .map((m) => `${reports[w].total[m].pct}%`)
            .join(' | ') +
          ' |',
      )
      .join('\n') +
    '\n\nНачална измерена база; регресионният праг е по workspace за lines и branches, с толеранс 0.5 процентни пункта.\n' +
    (failures.length ? '\n' + failures.join('\n') : '\nПроверка: PASS.') +
    '\n';
  writeFileSync('coverage-summary.md', summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2), process.env);
