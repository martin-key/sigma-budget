import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rmdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { overlap, readSafeBytes, safeDirectory, sha256 } from './files.js';
import {
  MANIFEST_LIMIT,
  OPERATION_ID,
  parseJson,
  record,
  ReleaseError,
  REQUEST_ID,
  revision,
  SHA256,
  type ChangeKind,
  type PublishResult,
  type ReleaseEnvironment,
} from './types.js';

export interface ChangeReceipt {
  kind: ChangeKind;
  expected_revision: number;
  request_id: string;
  state: 'pending' | 'applied' | 'conflict';
  result?: PublishResult;
  confirmed?: boolean;
}
export interface OperatorReceipt {
  schema: 'budget-operator-receipt/1';
  environment: ReleaseEnvironment;
  release_id: string;
  operation?: { id: string; state: 'open' | 'sealed' };
  requests: ChangeReceipt[];
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((k) => allowed.includes(k));
}
export function parsePublishResult(
  value: unknown,
  rid: string,
  intent: Pick<ChangeReceipt, 'kind' | 'expected_revision' | 'request_id'>,
): PublishResult {
  if (
    !record(value) ||
    value.release_id !== rid ||
    value.request_id !== intent.request_id ||
    value.kind !== intent.kind ||
    value.revision !== intent.expected_revision + 1 ||
    !revision(value.revision) ||
    !(
      value.previous_release_id === null ||
      (typeof value.previous_release_id === 'string' && SHA256.test(value.previous_release_id))
    ) ||
    typeof value.at !== 'string' ||
    (value.replay !== undefined && typeof value.replay !== 'boolean') ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value.at)
  )
    throw new ReleaseError(6, 'Publish result does not match the saved request');
  // Whitelist fields: no arbitrary server payload can reach a receipt or stdout.
  return {
    release_id: rid,
    previous_release_id: value.previous_release_id as string | null,
    revision: value.revision,
    kind: intent.kind,
    request_id: intent.request_id,
    at: value.at,
    replay: value.replay === true,
  };
}
export class ReceiptStore {
  readonly directory: string;
  constructor(
    directory: string,
    readonly environment: Readonly<ReleaseEnvironment>,
  ) {
    this.directory = resolve(directory);
  }
  path(rid: string): string {
    if (!SHA256.test(rid)) throw new ReleaseError(2, 'Release ID must be SHA-256');
    return join(
      this.directory,
      `${sha256(this.environment.name + '\n' + this.environment.url)}-${rid}.json`,
    );
  }
  protect(roots: string[]) {
    if (roots.some((root) => overlap(resolve(root), this.directory)))
      throw new ReleaseError(2, 'Operator receipts must be separate from package and source data');
  }
  private async prepare() {
    // Create parents individually, checking existing ancestors before each mkdir.
    const ensure = async (path: string): Promise<void> => {
      try {
        await safeDirectory(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await ensure(dirname(path));
        try {
          await mkdir(path, { mode: 0o700 });
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure;
        }
        await safeDirectory(path);
      }
    };
    await ensure(this.directory);
  }
  async locked<T>(rid: string, work: () => Promise<T>): Promise<T> {
    try {
      await this.prepare();
    } catch {
      throw new ReleaseError(2, 'Cannot safely create the receipt directory');
    }
    const lock = this.path(rid) + '.lock';
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch {
      throw new ReleaseError(2, 'Receipt is locked; another operator process may be using it');
    }
    try {
      return await work();
    } finally {
      await rmdir(lock);
    }
  }
  async load(rid: string): Promise<OperatorReceipt> {
    const path = this.path(rid);
    try {
      await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return {
          schema: 'budget-operator-receipt/1',
          environment: { ...this.environment },
          release_id: rid,
          requests: [],
        };
      throw new ReleaseError(2, 'Cannot read operator receipt');
    }
    const r = parseJson(await readSafeBytes(path, MANIFEST_LIMIT));
    if (
      !record(r) ||
      !onlyKeys(r, ['schema', 'environment', 'release_id', 'operation', 'requests']) ||
      r.schema !== 'budget-operator-receipt/1' ||
      r.release_id !== rid ||
      !record(r.environment) ||
      !onlyKeys(r.environment, ['name', 'url']) ||
      r.environment.name !== this.environment.name ||
      r.environment.url !== this.environment.url ||
      !Array.isArray(r.requests)
    )
      throw new ReleaseError(2, 'Operator receipt identity or structure is invalid');
    if (
      r.operation !== undefined &&
      (!record(r.operation) ||
        !onlyKeys(r.operation, ['id', 'state']) ||
        typeof r.operation.id !== 'string' ||
        !OPERATION_ID.test(r.operation.id) ||
        (r.operation.state !== 'open' && r.operation.state !== 'sealed'))
    )
      throw new ReleaseError(2, 'Invalid operation in operator receipt');
    const ids = new Set<string>(),
      intents = new Set<string>();
    for (const req of r.requests) {
      if (
        !record(req) ||
        !onlyKeys(req, [
          'kind',
          'expected_revision',
          'request_id',
          'state',
          'result',
          'confirmed',
        ]) ||
        (req.kind !== 'publish' && req.kind !== 'rollback') ||
        !revision(req.expected_revision) ||
        typeof req.request_id !== 'string' ||
        !REQUEST_ID.test(req.request_id) ||
        ids.has(req.request_id) ||
        (req.state !== 'pending' && req.state !== 'applied' && req.state !== 'conflict') ||
        (req.confirmed !== undefined && typeof req.confirmed !== 'boolean')
      )
        throw new ReleaseError(2, 'Invalid request in operator receipt');
      const key = `${req.kind}:${req.expected_revision}`;
      if (intents.has(key))
        throw new ReleaseError(2, 'Duplicate request intent in operator receipt');
      intents.add(key);
      ids.add(String(req.request_id));
      if (req.state === 'applied') {
        if (
          !record(req.result) ||
          !onlyKeys(req.result, [
            'release_id',
            'previous_release_id',
            'revision',
            'kind',
            'request_id',
            'at',
            'replay',
          ])
        )
          throw new ReleaseError(2, 'Invalid saved publish result');
        req.result = parsePublishResult(req.result, rid, req as unknown as ChangeReceipt);
      } else if (req.result !== undefined || req.confirmed)
        throw new ReleaseError(2, 'Invalid pending request receipt');
    }
    return r as unknown as OperatorReceipt;
  }
  /** Exclusive temporary file + fsync + rename + directory fsync. */
  async save(receipt: OperatorReceipt): Promise<void> {
    const path = this.path(receipt.release_id),
      temp = path + '.' + randomUUID() + '.tmp';
    await safeDirectory(this.directory);
    try {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.nlink !== 1 || stat.isSymbolicLink())
          throw new ReleaseError(2, 'Receipt destination must be a regular file with one link');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const file = await open(
        temp,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(JSON.stringify(receipt, null, 2) + '\n');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, path);
      const directory = await open(
        this.directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      if (error instanceof ReleaseError) throw error;
      throw new ReleaseError(2, 'Cannot atomically save operator receipt');
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }
}
