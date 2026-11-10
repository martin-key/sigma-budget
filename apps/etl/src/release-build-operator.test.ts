import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseBuildOperatorCli } from './release-build-operator.js';

describe('isolated offline release build operator', () => {
  it('explains the explicit executor and historical replay boundaries', async () => {
    const output: string[] = [];
    expect(await releaseBuildOperatorCli(['--help'], { stdout: (text) => output.push(text) })).toBe(
      0,
    );
    expect(output.join('\n')).toContain('Historical Python releases use budget reproduce');
  });
  it.each([
    ['build'],
    ['publish'],
    ['build', '--root', '/tmp', '--unknown', 'x'],
    ['validate', '--release', '/tmp', '--inputs', '/tmp', '--max-object-bytes', '-1'],
    [
      'build',
      '--root',
      '/tmp',
      '--inputs',
      '/tmp',
      '--out',
      '/tmp/new',
      '--commit',
      'HEAD',
      '--build-date',
      '2026-11-10',
    ],
    ['validate', '--release', '/tmp', '--inputs', '/tmp', '--inputs', '/tmp'],
  ])('rejects invalid or implicitly defaulted inputs %j', async (...args) => {
    const output: string[] = [];
    expect(await releaseBuildOperatorCli(args, { stdout: (text) => output.push(text) })).toBe(2);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({ exit: 2 });
  });
  it('returns missing-evidence exit 3 for a missing local package directory', async () => {
    const output: string[] = [];
    expect(
      await releaseBuildOperatorCli(
        [
          'validate',
          '--release',
          join(tmpdir(), 'missing-release-' + randomUUID()),
          '--inputs',
          tmpdir(),
        ],
        { stdout: (text) => output.push(text) },
      ),
    ).toBe(3);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({ exit: 3 });
  });
  it('refuses command executor options conflicting with the injected parent boundary', async () => {
    const stdout = () => {};
    expect(
      await releaseBuildOperatorCli(['build', '--inputs', '/tmp', '--entry', 'x.mjs'], {
        stdout,
        executor: {
          identity: { runtime: 'node-export/1', id: 'parent', entry: 'real.mjs' },
          async execute() {
            throw Error('must not execute');
          },
        },
      }),
    ).toBe(2);
  });
});
