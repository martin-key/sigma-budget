import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { prepareDocumentsCli } from './prepare-documents.js';

const html = '<p>Чл. 1. Текст</p><table><tr><td>Приходи</td><td>1 000,1</td></tr></table>';
const hash = createHash('sha256').update(html).digest('hex');
async function owned(run: (root: string, args: string[]) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'sigma-prepare-documents-'));
  try {
    const path = 'data/originals/dv/test.html';
    await mkdir(join(root, 'data/originals/dv'), { recursive: true });
    await mkdir(join(root, 'tmp'));
    await writeFile(join(root, path), html);
    await writeFile(
      join(root, 'sources.yaml'),
      `schema: 1\nsources:\n- id: zdb\n  acquisition: manual\n  files:\n  - path: ${path}\n    sha256: ${hash}\n`,
    );
    await run(root, [
      '--kind',
      'html',
      '--input-root',
      root,
      '--registry',
      join(root, 'sources.yaml'),
      '--source',
      'zdb',
      '--path',
      path,
      '--date',
      '2026-11-10',
      '--out',
      join(root, 'tmp/prepared'),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it('prepares a real path/pin/date into a new owned output, with source bytes and receipt', async () => {
  await owned(async (root, args) => {
    expect(await prepareDocumentsCli(args, root)).toBe(0);
    const out = join(root, 'tmp/prepared');
    expect(JSON.parse(await readFile(join(out, 'data.json'), 'utf8'))).toEqual([
      ['p', 'Чл. 1. Текст'],
      ['t', [['Приходи', '1 000,1']]],
    ]);
    expect(JSON.parse(await readFile(join(out, 'receipt.json'), 'utf8'))).toMatchObject({
      source: 'zdb',
      sha256: hash,
      readDate: '2026-11-10',
      parser: 'html',
    });
    expect(await readFile(join(out, 'source.bin'), 'utf8')).toBe(html);
    await expect(prepareDocumentsCli(args, root)).rejects.toThrow(/EEXIST/);
    expect(await readFile(join(root, 'data/originals/dv/test.html'), 'utf8')).toBe(html);
  });
});
it('rejects protected outputs and corrupt raw inputs before creating output', async () => {
  await owned(async (root, args) => {
    const protectedArgs = [...args];
    protectedArgs[protectedArgs.length - 1] = join(root, 'data/originals/dv/new');
    await expect(prepareDocumentsCli(protectedArgs, root)).rejects.toThrow(/protected/);
    await writeFile(join(root, 'data/originals/dv/test.html'), 'corrupt');
    await expect(prepareDocumentsCli(args, root)).rejects.toThrow(/hash mismatch/);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });
});
it('rejects unknown/missing/duplicate flags and incompatible source selectors', async () => {
  await expect(prepareDocumentsCli(['--unknown', 'x'])).rejects.toThrow(/arguments/);
  await owned(async (root, args) => {
    await expect(prepareDocumentsCli([...args, '--kind', 'docx'], root)).rejects.toThrow(
      /arguments/,
    );
    await expect(
      prepareDocumentsCli([...args, '--indicator', 'GGALN_G01_XDC'], root),
    ).rejects.toThrow(/inapplicable/);
    const bnb = [...args];
    bnb[1] = 'bnb';
    await expect(prepareDocumentsCli(bnb, root)).rejects.toThrow(/source\/kind/);
  });
});
