import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportPaths, checkReports } from './check-parity-reports.mjs';

test('both relative validator and absolute builder reports use the declared job paths', () => {
  const root = '/repo';
  const defs = {
    WAVE14_PARITY_REPORT: 'tmp/ts-migration/14/report.json',
    COMMON_PARITY_REPORT: '${{ github.workspace }}/tmp/ts-migration/02/diff.json',
  };
  const env = {
    WAVE14_PARITY_REPORT: defs.WAVE14_PARITY_REPORT,
    COMMON_PARITY_REPORT: '/repo/tmp/ts-migration/02/diff.json',
  };
  assert.deepEqual(reportPaths(defs, env, root), [
    { name: 'WAVE14_PARITY_REPORT', path: '/repo/tmp/ts-migration/14/report.json' },
    { name: 'COMMON_PARITY_REPORT', path: '/repo/tmp/ts-migration/02/diff.json' },
  ]);
  assert.throws(() => reportPaths(defs, {}, root));
  assert.throws(() => reportPaths(defs, { ...env, WAVE14_PARITY_REPORT: 'other.json' }, root));
  assert.throws(() =>
    reportPaths({ X_REPORT: 'data/release/x.json' }, { X_REPORT: 'data/release/x.json' }, root),
  );
  assert.throws(() => reportPaths({}, {}, root));
});

test('every mandatory report must exist and be JSON, including all members of a multi-file upload', () => {
  const root = mkdtempSync(join(tmpdir(), 'parity-reports-'));
  try {
    const reports = ['first', 'second'].map((name) => ({ name, path: join(root, name + '.json') }));
    writeFileSync(reports[0].path, '{}');
    assert.throws(() => checkReports(reports), /second/);
    writeFileSync(reports[1].path, '{broken');
    assert.throws(() => checkReports(reports), /second/);
    writeFileSync(reports[1].path, '{"outcome":"pass"}');
    assert.equal(checkReports(reports), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale report cleanup refuses symlinked directories outside owned report storage', () => {
  const root = mkdtempSync(join(tmpdir(), 'parity-path-'));
  try {
    mkdirSync(join(root, 'tmp/ts-migration'), { recursive: true });
    mkdirSync(join(root, 'protected'));
    writeFileSync(join(root, 'protected/report.json'), '{"preserve":true}');
    symlinkSync(join(root, 'protected'), join(root, 'tmp/ts-migration/alias'));
    const name = 'EXAMPLE_REPORT';
    const path = 'tmp/ts-migration/alias/report.json';
    assert.throws(() => reportPaths({ [name]: path }, { [name]: path }, root), /symlinked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
