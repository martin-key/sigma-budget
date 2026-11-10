import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { sha256 } from '@sigma-budget/ingest/readers/workbooks';
import type { ExecutionInputConfig } from '@sigma-budget/ingest/readers/execution';
import { prepareExecutionCli } from './prepare-execution.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = join(root, 'packages/ingest/test/fixtures/wave18');
const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8'));
const pinned = (path: string) => ({ path, sha256: sha256(readFileSync(path)) });
function config(): ExecutionInputConfig {
  const archive = pinned(join(fixture, 'data/originals/budget_2027/ZDBRB-2027.zip'));
  return {
    schema: 'execution-inputs/1',
    reports: Object.entries<string>(manifest.sha256)
      .filter(([p]) => p.includes('/kfp_') && p.endsWith('.xls'))
      .map(([p, sha256]) => ({ path: join(fixture, p), sha256 })),
    annual: {
      forecast: pinned(join(fixture, 'data/inputs/budget_forecast_2027.json')),
      bill: pinned(join(fixture, 'data/inputs/budget_bill_2027.json')),
      forecastArchive: archive,
      billArchive: archive,
      historicalAnnex3: pinned(
        join(
          root,
          'packages/ingest/test/fixtures/fiscal/inputs/data/originals/asbp/asbp_tables.json',
        ),
      ),
    },
  };
}
it('prepares deterministic real-path outputs in a new owned directory and never replaces existing data', () => {
  const temp = mkdtempSync(join(tmpdir(), 'sigma-prepare-execution-'));
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const input = join(temp, 'inputs.json'),
      c = config();
    writeFileSync(input, JSON.stringify(c));
    const out = join(temp, 'one'),
      args = ['--config', input, '--build-date', '2026-11-08', '--out', out];
    expect(prepareExecutionCli(args)).toBe(0);
    expect(readdirSync(out).sort()).toEqual([
      'execution-provenance.json',
      'execution-reader-evidence.json',
      'execution.json',
    ]);
    expect(JSON.parse(readFileSync(join(out, 'execution.json'), 'utf8'))).toEqual(
      JSON.parse(readFileSync(join(root, 'data/release/execution.json'), 'utf8')),
    );
    const hashes = Object.fromEntries(
      readdirSync(out).map((f) => [f, sha256(readFileSync(join(out, f)))]),
    );
    expect(() => prepareExecutionCli(args)).toThrow(/new owned directory/);
    expect(
      Object.fromEntries(readdirSync(out).map((f) => [f, sha256(readFileSync(join(out, f)))])),
    ).toEqual(hashes);
    const second = join(temp, 'two');
    expect(prepareExecutionCli([...args.slice(0, -1), second])).toBe(0);
    expect(
      Object.fromEntries(
        readdirSync(second).map((f) => [f, sha256(readFileSync(join(second, f)))]),
      ),
    ).toEqual(hashes);
    c.reports[0]!.sha256 = '0'.repeat(64);
    writeFileSync(input, JSON.stringify(c));
    expect(() => prepareExecutionCli([...args.slice(0, -1), join(temp, 'bad')])).toThrow(
      /SHA-256 mismatch/,
    );
    expect(readdirSync(temp).sort()).toEqual(['inputs.json', 'one', 'two']);
    c.reports[0]!.path = join(temp, 'absent.xls');
    writeFileSync(input, JSON.stringify(c));
    expect(() => prepareExecutionCli([...args.slice(0, -1), join(temp, 'missing')])).toThrow(
      /ENOENT/,
    );
    expect(readdirSync(temp).sort()).toEqual(['inputs.json', 'one', 'two']);
  } finally {
    stdout.mockRestore();
    rmSync(temp, { recursive: true, force: true });
  }
});
it('rejects protected input areas, symlink parents, malformed flags and invalid dates without creating outputs', () => {
  const temp = mkdtempSync(join(tmpdir(), 'sigma-prepare-execution-safety-'));
  try {
    const input = join(temp, 'inputs.json');
    writeFileSync(input, JSON.stringify(config()));
    const args = ['--config', input, '--build-date', '2026-11-08', '--out'];
    expect(() =>
      prepareExecutionCli([...args, join(fixture, 'data/originals/new-candidate')]),
    ).toThrow(/protected/);
    mkdirSync(join(temp, 'protected'));
    symlinkSync(join(temp, 'protected'), join(temp, 'alias'), 'dir');
    expect(() => prepareExecutionCli([...args, join(temp, 'alias', 'candidate')])).toThrow(
      /Unsafe directory/,
    );
    expect(() => prepareExecutionCli([...args, join(temp, 'out'), '--upload', 'yes'])).toThrow(
      /Usage/,
    );
    expect(() =>
      prepareExecutionCli([
        '--config',
        input,
        '--build-date',
        '2026-02-30',
        '--out',
        join(temp, 'bad-date'),
      ]),
    ).toThrow(/Invalid build date/);
    expect(readdirSync(temp).sort()).toEqual(['alias', 'inputs.json', 'protected']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
