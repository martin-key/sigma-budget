import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { safePath } from './context.js';

/** Reports share the same confinement and link protection in the CLI and CI harness. */
export function writeValidationReport(root: string, report: string, text: string): void {
  if (!report.startsWith('tmp/ts-migration/') || !report.endsWith('.json'))
    throw new Error('report must be a JSON path under tmp/ts-migration/');
  const path = safePath(root, report);
  if (path.split(sep).some((part, i, parts) => part === 'data' && parts[i + 1] === 'release'))
    throw new Error('report cannot be written inside a release tree');
  const checkTarget = () => {
    safePath(root, report);
    try {
      const entry = lstatSync(path);
      if (!entry.isFile() || entry.nlink !== 1)
        throw new Error('report must not overwrite a hard-linked or non-regular file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
  checkTarget();
  mkdirSync(dirname(path), { recursive: true });
  checkTarget();
  const temporary = resolve(dirname(path), `.validation-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: 'wx' });
    checkTarget();
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
