/** Finite, offline acceptance of the composed source layers, after workspace build.
 * Reads the registered originals and writes only one new caller-owned export.
 * Published documents are comparison targets, never producer inputs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnnualLineage, parsePythonJson } from '@sigma-budget/ingest';
import * as workbooks from '@sigma-budget/ingest/readers/workbooks';
import * as execution from '@sigma-budget/ingest/readers/execution';
import * as documents from '@sigma-budget/ingest/readers/documents';
import * as snapshots from '@sigma-budget/ingest/readers/snapshots';
import * as pdf from '@sigma-budget/ingest/readers/pdf';
import * as annual from '@sigma-budget/ingest/readers/annual';
import * as releaseClient from '@sigma-budget/ingest/release-client';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const flags = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i],
    value = process.argv[i + 1];
  assert(['--source-root', '--out'].includes(key) && value && !flags[key], 'Invalid arguments');
  flags[key] = value;
}
assert(
  flags['--source-root'] && flags['--out'],
  'Required: --source-root ROOT --out NEW_DIRECTORY',
);
const sourceRoot = realpathSync(resolve(flags['--source-root']));
const out = resolve(flags['--out']);
const inside = (parent, path) => {
  const part = relative(parent, path);
  return !part || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep));
};
assert.equal(realpathSync(dirname(out)), dirname(out), 'Real output parent required');
assert(!inside(sourceRoot, out) && !inside(out, sourceRoot), 'Source/output overlap');
assert(!inside(repo, out) && !inside(out, repo), 'Use an external owned export');
assert(!out.split(sep).some((part) => ['originals', 'release', 'fixtures', '.git'].includes(part)));
mkdirSync(out); // Exclusive ownership; existing paths are never reused.

const inputs = new Map();
const checks = [];
const report = { schema: 'source-layer-composition/1', outcome: 'running', checks };
const read = (path, expected) => {
  const bytes = readFileSync(path);
  const receipt = { path, bytes: bytes.length, sha256: workbooks.sha256(bytes) };
  if (expected) assert.equal(receipt.sha256, expected, path);
  if (inputs.has(path)) assert.deepEqual(receipt, inputs.get(path), `Input changed: ${path}`);
  inputs.set(path, receipt);
  return bytes;
};
const json = (path, expected) => parsePythonJson(read(path, expected).toString('utf8'));
const command = (name, args) => {
  const result = spawnSync(process.execPath, [join(repo, 'apps/etl/dist', name + '.js'), ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  return result;
};
const success = (result) => assert.equal(result.status, 0, result.stderr);
const pin = (path) => ({ path, sha256: workbooks.sha256(readFileSync(path)) });
const outputNames = [
  'execution.json',
  'execution-provenance.json',
  'execution-reader-evidence.json',
];
try {
  for (const [fn, name] of [
    [AnnualLineage, '.'],
    [workbooks.readWorkbook, 'readers/workbooks'],
    [execution.prepareExecution, 'readers/execution'],
    [documents.readLegalDocx, 'readers/documents'],
    [snapshots.SnapshotReader, 'readers/snapshots'],
    [pdf.readPdf, 'readers/pdf'],
    [annual.prepareAnnual, 'readers/annual'],
    [releaseClient.preflightRelease, 'release-client'],
  ]) {
    assert.equal(typeof fn, 'function', name);
  }
  checks.push('All eight package exports resolve from the ETL consumer');

  const registry = join(repo, 'data/sources.yaml');
  const pins = join(repo, 'data/originals.sha256');
  read(registry);
  read(pins);
  const registration = await annual.readAnnualRegistration(registry, pins);
  const archive = read(join(sourceRoot, registration.archive), registration.archiveSha256);
  read(join(sourceRoot, registration.acquisition), registration.acquisitionSha256);
  const manifest = json(join(repo, 'packages/ingest/test/fixtures/wave18/manifest.json'));
  const reports = Object.entries(manifest.sha256)
    .filter(([path]) => path.includes('/kfp_') && path.endsWith('.xls'))
    .map(([path, sha256]) => {
      const absolute = join(sourceRoot, path);
      read(absolute, sha256);
      return { path: absolute, sha256 };
    });
  assert.equal(reports.length, 33);
  const historicalPath = join(
    repo,
    'packages/ingest/test/fixtures/fiscal/inputs/data/originals/asbp/asbp_tables.json',
  );
  const historical = json(
    historicalPath,
    '27b82e1b8059c88b70dab8cf588c944e444b3532d4eba9fe1b085a776e4b2d3a',
  );
  const expected = Object.fromEntries(
    outputNames.slice(0, 2).map((name) => [name, json(join(repo, 'data/release', name))]),
  );

  const buildDate = '2026-11-08'; // Existing full-document oracle publication date.
  const prepared = join(out, 'annual');
  const generated = command('prepare-annual', [
    '--source-root',
    sourceRoot,
    '--source-registry',
    registry,
    '--pins',
    pins,
    '--out',
    prepared,
    '--build-date',
    buildDate,
  ]);
  success(generated);
  const receipt = JSON.parse(generated.stdout);
  assert.deepEqual(
    receipt.outputs.map((entry) => entry.action),
    ['generated', 'generated'],
  );
  const forecastPath = join(prepared, 'data/inputs/budget_forecast_2027.json');
  const billPath = join(prepared, 'data/inputs/budget_bill_2027.json');
  for (const entry of receipt.outputs) read(join(prepared, entry.path), entry.sha256);
  const forecast = json(forecastPath);
  const bill = json(billPath);
  assert.equal(forecast.checks.length, 2775);
  assert.equal(bill.checks.length, 1473);
  assert(forecast.checks.every((entry) => entry.passed));
  assert(
    bill.checks.every(
      (entry) =>
        typeof entry.check === 'string' &&
        Number.isFinite(entry.delta) &&
        Number.isFinite(entry.tolerance) &&
        entry.tolerance >= 0 &&
        Math.abs(entry.delta) <= entry.tolerance,
    ),
  );
  checks.push('Compiled annual CLI generates both intermediates from the actual pinned ZIP/PDFs');

  const lineage = new AnnualLineage(forecast, bill, { forecast: archive, bill: archive });
  const annualInput = execution.executionAnnualFromPrepared(lineage, historical.tables);
  const result = execution.prepareExecution({ reports, annual: annualInput, buildDate });
  assert.deepEqual(result.execution, expected['execution.json']);
  assert.deepEqual(result.provenance, expected['execution-provenance.json']);
  assert.equal(result.evidence.reports.length, 33);
  assert.equal(
    result.evidence.reports.reduce((sum, entry) => sum + Object.keys(entry.sourceCells).length, 0),
    7128,
  );
  assert.equal(result.evidence.warnings.length, 4);
  assert.equal(result.evidence.annualBoundary.rawPdfDecoded, false);
  assert.equal(result.execution.plan2026.basis, 'adopted-law');
  assert.equal(result.execution.plan2026.unit, 'млн. €');
  assert.deepEqual(result.execution.plan2026.nat, {});
  assert.deepEqual(result.execution.plan2026.eu, {});
  const first = workbooks.readWorkbook({ ...reports[0], format: 'xls' });
  assert.equal(first.engine, 'sheetjs/0.20.3');
  checks.push(
    'Fresh annual lineage/law projection + all 33 actual XLS -> both complete published documents',
  );

  const config = {
    schema: 'execution-inputs/1',
    reports,
    annual: {
      forecast: pin(forecastPath),
      bill: pin(billPath),
      forecastArchive: pin(join(sourceRoot, registration.archive)),
      billArchive: pin(join(sourceRoot, registration.archive)),
      historicalAnnex3: pin(historicalPath),
    },
  };
  assert.deepEqual(execution.readExecutionAnnual(config.annual).plan, annualInput.plan);
  const configPath = join(out, 'execution-inputs.json');
  writeFileSync(configPath, JSON.stringify(config) + '\n', { flag: 'wx' });
  const args = (destination) => [
    '--config',
    configPath,
    '--build-date',
    buildDate,
    '--out',
    destination,
  ];
  const monthly = join(out, 'monthly');
  success(command('prepare-execution', args(monthly)));
  const again = join(out, 'monthly-again');
  success(command('prepare-execution', args(again)));
  const outputHashes = {};
  for (const name of outputNames) {
    const bytes = readFileSync(join(monthly, name));
    assert.deepEqual(bytes, readFileSync(join(again, name)));
    if (expected[name]) assert.deepEqual(JSON.parse(bytes), expected[name]);
    outputHashes[name] = workbooks.sha256(bytes);
  }
  checks.push(
    'Compiled execution CLI consumes the generated files, agrees with API, repeats byte-identically',
  );

  const existing = command('prepare-execution', args(monthly));
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /Output must be a new owned directory/);
  for (const name of outputNames)
    assert.equal(workbooks.sha256(readFileSync(join(monthly, name))), outputHashes[name]);
  config.annual.forecast.sha256 = '0'.repeat(64);
  const badConfig = join(out, 'wrong-pin.json');
  writeFileSync(badConfig, JSON.stringify(config) + '\n', { flag: 'wx' });
  const rejected = join(out, 'rejected');
  const bad = command('prepare-execution', [
    '--config',
    badConfig,
    '--build-date',
    buildDate,
    '--out',
    rejected,
  ]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /SHA-256 mismatch/);
  assert.equal(existsSync(rejected), false);
  for (const name of ['prepare-annual', 'prepare-execution', 'prepare-documents']) {
    assert.equal(command(name, []).status, 1, name);
  }
  assert.equal(command('release-operator', ['preflight']).status, 2);
  checks.push('All four compiled CLI argument guards, stale pin and existing-output safety');
  report.annualReceipt = receipt;
  report.outputs = outputHashes;
  report.boundaries = {
    annualPdfDecodedHere: true,
    executionReaderRawPdfDecoded: false,
    historicalAnnex3: 'Existing pinned prepared artifact; historical original unavailable',
    documentComparison: 'Complete parsed execution and execution-provenance; no field exclusions',
    productionDefault: 'Python',
    graphWiring: false,
  };
  report.outcome = 'pass';
} catch (error) {
  report.outcome = 'fail';
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  try {
    for (const entry of inputs.values())
      assert.equal(workbooks.sha256(readFileSync(entry.path)), entry.sha256, entry.path);
    checks.push(
      'SHA-256 of every source, registry, pin, oracle and generated intermediate unchanged',
    );
  } catch (error) {
    report.outcome = 'fail';
    report.error = [report.error, error.stack ?? String(error)].filter(Boolean).join('\n');
    process.exitCode = 1;
  }
  report.inputs = [...inputs.values()];
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`${report.outcome}: ${checks.length} checks; ${join(out, 'report.json')}\n`);
  if (report.error) process.stderr.write(report.error + '\n');
}
