import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../release-client/package.js';
import {
  fileFacts,
  overlap,
  safeDirectory,
  sha256,
  withSafeFile,
} from '../release-client/files.js';
import { ReleaseError } from '../release-client/types.js';

export { fileFacts, overlap, safeDirectory, sha256 };
export function fail(message: string, code: 2 | 3 = 2): never {
  throw new ReleaseError(code, message);
}
export const jsonBytes = (value: unknown): Buffer => Buffer.from(canonicalJson(value) + '\n');
export function safeRelative(path: string, pattern = false): string {
  if (
    !path ||
    path.length > 300 ||
    path.startsWith('/') ||
    /[\\\x00-\x1f\x7f]/.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..') ||
    (!pattern && /[*?\[\]{}]/.test(path))
  )
    fail('Unsafe relative path: ' + path);
  return path;
}
/** Inspect existing components, including broken links, before creating anything. */
export async function inspectPath(path: string): Promise<boolean> {
  path = resolve(path);
  let cursor = parse(path).root;
  const parts = relative(cursor, path).split(sep).filter(Boolean);
  let exists = true;
  for (let i = 0; i < parts.length; i++) {
    cursor = join(cursor, parts[i]!);
    try {
      const s = await lstat(cursor);
      if (
        s.isSymbolicLink() ||
        (i < parts.length - 1 && !s.isDirectory()) ||
        (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))
      )
        fail('Link or special path is forbidden: ' + cursor);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      exists = false;
    }
  }
  return exists;
}
/** All public destinations are new and outside source, checkout and other evidence trees. */
export async function preflightDestination(
  path: string,
  protectedPaths: readonly string[],
): Promise<string> {
  path = resolve(path);
  if (protectedPaths.some((p) => overlap(path, resolve(p))))
    fail('Destination overlaps protected input or checkout');
  if (await inspectPath(path)) fail('Destination already exists; choose a new owned path');
  return path;
}
export async function atomicNew(path: string, bytes: Uint8Array): Promise<void> {
  if (await inspectPath(path)) fail('Refusing to overwrite a file');
  await mkdir(dirname(path), { recursive: true });
  await safeDirectory(dirname(path));
  const temp = join(dirname(path), `.release-${randomUUID()}.tmp`);
  try {
    const handle = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (await inspectPath(path)) fail('Destination appeared during write');
    await rename(temp, path);
    const dir = await open(dirname(path), constants.O_RDONLY);
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await rm(temp, { force: true });
  }
}
/** A private copy, never a hardlink into the immutable acquired snapshot. */
export async function copyAuthenticated(
  source: string,
  target: string,
  expected: { bytes: number; sha256: string },
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await safeDirectory(dirname(target));
  await withSafeFile(source, async (input) => {
    const output = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o444,
    );
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        let offset = 0;
        while (offset < bytesRead)
          offset += (await output.write(buffer, offset, bytesRead - offset, null)).bytesWritten;
      }
      await output.sync();
    } finally {
      await output.close();
    }
  });
  const actual = await fileFacts(target, expected.bytes);
  if (actual.sha256 !== expected.sha256) fail('Input changed during staging: ' + source);
}
