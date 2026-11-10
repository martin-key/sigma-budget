import { mkdtemp, rm, readFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { prepareAnnualCli } from './prepare-annual.js';
const root = resolve(import.meta.dirname, '../../..');
it('provides a real-path standalone CLI and verifies supplied intermediates with caller date', async () => {
  const out = await mkdtemp(join(tmpdir(), 'sigma-annual-cli-'));
  try {
    await mkdir(join(out, 'data/inputs'), { recursive: true });
    for (const role of ['forecast', 'bill'])
      await cp(
        join(root, `data/inputs/budget_${role}_2027.json`),
        join(out, `data/inputs/budget_${role}_2027.json`),
      );
    const log: string[] = [];
    expect(
      await prepareAnnualCli(
        [
          '--source-root',
          root,
          '--source-registry',
          join(root, 'data/sources.yaml'),
          '--pins',
          join(root, 'data/originals.sha256'),
          '--out',
          out,
          '--build-date',
          '2026-11-10',
        ],
        (s) => log.push(s),
      ),
    ).toBe(0);
    const receipt = JSON.parse(log[0]!);
    expect(receipt.buildDate).toBe('2026-11-10');
    expect(receipt.outputs.map((o: any) => o.action)).toEqual(['verified', 'verified']);
    expect(
      JSON.parse(await readFile(join(out, 'tmp/budget-2027-extractions.json'), 'utf8')),
    ).toEqual(receipt);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}, 60_000);
it('rejects missing, duplicate and unknown CLI flags', async () => {
  await expect(prepareAnnualCli([])).rejects.toThrow(/Required/);
  await expect(prepareAnnualCli(['--out', 'one', '--out', 'two'])).rejects.toThrow(/Invalid/);
  await expect(prepareAnnualCli(['--fixture-root', 'x'])).rejects.toThrow(/Invalid/);
});
