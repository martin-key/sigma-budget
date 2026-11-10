import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value) + '\n');
export const overlaps = (a: string, b: string): boolean => {
  const rel = relative(resolve(a), resolve(b));
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
};
export function safeRelative(path: string, pattern = false): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path.split('/').some((x) => !x || x === '.' || x === '..') ||
    (!pattern && /[*?\[\]{}]/.test(path))
  )
    throw new Error('Unsafe relative path: ' + path);
  return path;
}
/** Reject links at every existing component, including broken links. No realpath-following. */
export async function noLinks(path: string): Promise<void> {
  const full = resolve(path);
  let current = parse(full).root;
  for (const part of relative(current, full).split('/').filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Symbolic link is not permitted: ' + current);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
export async function exists(path: string): Promise<boolean> {
  await noLinks(path);
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}
export async function readBounded(path: string, maxBytes = 256 * 1024 * 1024): Promise<Buffer> {
  await noLinks(path);
  const before = await lstat(path);
  if (!before.isFile() || before.size > maxBytes)
    throw new Error('Not a bounded regular file: ' + path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error('Not a bounded regular file: ' + path);
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('File exceeds byte limit');
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  } finally {
    await handle.close();
  }
}
/** Exclusive install; a racing writer cannot replace an existing object. */
export async function immutable(path: string, bytes: Buffer): Promise<void> {
  await noLinks(path);
  await mkdir(dirname(path), { recursive: true });
  await noLinks(path);
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    if (!(await readBounded(path, bytes.length)).equals(bytes))
      throw new Error('Immutable object conflict: ' + path);
    return;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (e) {
    await handle.close();
    await unlink(path);
    throw e;
  }
  await handle.close();
}
export async function replacePointer(path: string, bytes: Buffer): Promise<void> {
  await noLinks(path);
  if (await exists(path)) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unsafe snapshot pointer');
    const old = JSON.parse((await readBounded(path, 32 * 1024 * 1024)).toString('utf8'));
    if (old.schema !== 'source-snapshot/1')
      throw new Error('Refusing to replace an unrelated file');
  }
  const temporary = path + '.' + randomUUID() + '.tmp';
  await immutable(temporary, bytes);
  try {
    await noLinks(path);
    await rename(temporary, path);
  } finally {
    if (await exists(temporary)) await unlink(temporary);
  }
}
export async function listFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symbolic link in input tree: ' + path);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) out.push(relative(root, path));
      else throw new Error('Non-regular input: ' + path);
    }
  }
  await visit(root);
  return out;
}
export async function guardOutput(path: string, protectedPaths: string[]): Promise<void> {
  await noLinks(path);
  for (const input of protectedPaths) {
    await noLinks(input);
    if (overlaps(path, input) || overlaps(input, path))
      throw new Error('Output overlaps protected input: ' + input);
    // Also catches a report hard-linked to registry, pins, manifest, or manual input.
    if ((await exists(path)) && (await exists(input))) {
      const [a, b] = await Promise.all([lstat(path), lstat(input)]);
      if (a.dev === b.dev && a.ino === b.ino) throw new Error('Output aliases protected input');
    }
  }
}
export async function withLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  await noLinks(root);
  await mkdir(root, { recursive: true });
  const path = join(root, '.source-client.lock');
  const handle = await open(path, 'wx', 0o600);
  try {
    return await work();
  } finally {
    await handle.close();
    await unlink(path);
  }
}
