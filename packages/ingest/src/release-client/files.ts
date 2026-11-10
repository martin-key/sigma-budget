import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, parse, relative, resolve, sep } from 'node:path';
import { ReleaseError } from './types.js';

export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
export const within = (root: string, path: string) => path === root || path.startsWith(root + sep);
export const overlap = (a: string, b: string) => within(a, b) || within(b, a);
export async function safeDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of relative(cursor, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    const s = await lstat(cursor);
    if (!s.isDirectory() || s.isSymbolicLink())
      throw new ReleaseError(2, 'Directory must have no symbolic links');
  }
  return absolute;
}
/** Check every parent and the opened inode; reject special files and hardlinks. */
export async function withSafeFile<T>(
  path: string,
  fn: (file: Awaited<ReturnType<typeof open>>) => Promise<T>,
): Promise<T> {
  try {
    await safeDirectory(join(path, '..'));
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
      throw new ReleaseError(2, 'Expected a regular file with one link');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const start = await file.stat();
      if (
        !start.isFile() ||
        start.nlink !== 1 ||
        start.ino !== before.ino ||
        start.dev !== before.dev
      )
        throw new ReleaseError(2, 'File changed while opening');
      const result = await fn(file);
      const after = await file.stat();
      const named = await lstat(path);
      if (
        after.nlink !== 1 ||
        after.size !== start.size ||
        after.mtimeMs !== start.mtimeMs ||
        after.ctimeMs !== start.ctimeMs ||
        named.ino !== start.ino ||
        named.dev !== start.dev ||
        named.isSymbolicLink()
      )
        throw new ReleaseError(2, 'File changed while reading');
      return result;
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError(3, 'Cannot safely read a required local file');
  }
}
export async function fileFacts(path: string, expectedSize?: number) {
  return withSafeFile(path, async (file) => {
    const size = (await file.stat()).size;
    if (expectedSize !== undefined && size !== expectedSize)
      throw new ReleaseError(2, 'Local file size differs from manifest');
    const hash = createHash('sha256');
    let bytes = 0;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const part = await file.read(buffer, 0, buffer.length, null);
      if (!part.bytesRead) break;
      bytes += part.bytesRead;
      if (bytes > size) throw new ReleaseError(2, 'File grew while hashing');
      hash.update(buffer.subarray(0, part.bytesRead));
    }
    return { bytes, sha256: hash.digest('hex') };
  });
}
export async function readSafeBytes(path: string, limit: number): Promise<Buffer> {
  return withSafeFile(path, async (file) => {
    const size = (await file.stat()).size;
    if (size > limit) throw new ReleaseError(2, `Local file exceeds configured limit ${limit}`);
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const part = await file.read(bytes, offset, size - offset, null);
      if (!part.bytesRead) throw new ReleaseError(2, 'File shrank while reading');
      offset += part.bytesRead;
    }
    if ((await file.read(Buffer.alloc(1), 0, 1, null)).bytesRead)
      throw new ReleaseError(2, 'File grew while reading');
    return bytes;
  });
}
export async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const name of await readdir(join(root, prefix))) {
    const path = prefix ? `${prefix}/${name}` : name;
    const s = await lstat(join(root, path));
    if (s.isSymbolicLink() || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1)))
      throw new ReleaseError(2, 'Package contains a link or special file');
    if (s.isDirectory()) result.push(...(await listFiles(root, path)));
    else result.push(path);
  }
  return result;
}
