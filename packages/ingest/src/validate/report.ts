import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { safePath } from './context.js';

/** Validate the destination without creating directories or processing inputs. */
export function preflightValidationReport(root: string, report: string): string {
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
  return path;
}

/** Reports share the same confinement and link protection in the CLI and CI harness. */
export function writeValidationReport(root: string, report: string, text: string): void {
  const path = preflightValidationReport(root, report);
  mkdirSync(dirname(path), { recursive: true });
  preflightValidationReport(root, report);
  const temporary = resolve(dirname(path), `.validation-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: 'wx' });
    preflightValidationReport(root, report);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
