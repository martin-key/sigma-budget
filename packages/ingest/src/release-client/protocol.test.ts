import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localReleaseWorker } from '../../test/support/release-worker.js';
import { makeRelease } from '../../test/support/release-package.js';
import { ReleaseClient } from './client.js';
import { nodeHttpTransport } from './transport.js';
import { ReceiptStore } from './receipts.js';
import { sha256 } from './files.js';
import type { HttpRequest, HttpTransport } from './types.js';

describe('existing Worker protocol with isolated local D1 and R2', () => {
  let worker: Awaited<ReturnType<typeof localReleaseWorker>>, directory: string;
  const packets: HttpRequest[] = [];
  const transport: HttpTransport = async (request) => {
    packets.push({ ...request, headers: {} });
    return nodeHttpTransport(request);
  };
  const client = (receipts = 'receipts', http = transport) =>
    new ReleaseClient({
      environment: { name: 'owned-local', url: worker.url },
      receiptDirectory: join(directory, receipts),
      credentials: () => ({ accessToken: worker.token() }),
      transport: http,
      attempts: 1,
    });
  const journal = async () =>
    (await worker.db.prepare('SELECT * FROM journal ORDER BY revision').all()).results;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'operator-protocol-'));
    worker = await localReleaseWorker();
  }, 30000);
  afterAll(async () => {
    try {
      await worker?.mf.dispose();
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });
  it('reports an empty environment, rejects wrong operator identity and dry-runs without credentials/writes', async () => {
    expect(await client().status()).toMatchObject({ release_id: null, revision: 0, journal: [] });
    const pkg = await makeRelease(directory, 'dry');
    const noAuth = new ReleaseClient({
      environment: { name: 'owned-local', url: worker.url },
      receiptDirectory: join(directory, 'dry-receipts'),
      transport,
    });
    expect(await noAuth.publish({ ...pkg, dryRun: true })).toMatchObject({
      dryRun: true,
      expected_revision: 0,
    });
    expect(await noAuth.upload({ ...pkg, dryRun: true })).toMatchObject({ dryRun: true });
    expect(await worker.db.prepare('SELECT * FROM operations').all()).toMatchObject({
      results: [],
    });
    const unauthorized = new ReleaseClient({
      environment: { name: 'owned-local', url: worker.url },
      receiptDirectory: join(directory, 'bad-identity'),
      credentials: () => ({ accessToken: worker.token('outsider@example.invalid') }),
      transport,
    });
    await expect(unauthorized.upload(pkg)).rejects.toMatchObject({ code: 4, status: 403 });
  });
  it('resumes an interrupted upload with the original operation and skips already verified objects', async () => {
    const pkg = await makeRelease(directory, 'resume');
    let puts = 0;
    const interrupted: HttpTransport = async (request) => {
      if (request.method === 'PUT' && ++puts === 2) throw new Error('simulated interruption');
      return transport(request);
    };
    await expect(client('resume-receipts', interrupted).upload(pkg)).rejects.toMatchObject({
      code: 3,
    });
    const store = client('resume-receipts').receipts;
    const first = await store.load(pkg.releaseId);
    expect(first.operation?.state).toBe('open');
    const result = await client('resume-receipts').upload(pkg);
    expect(result.operation).toBe(first.operation?.id);
    expect(result.objects).toBe(2);
    expect((await client('resume-receipts').upload(pkg)).objects).toBe(0);
    expect(await client().current()).toEqual({ release_id: null, revision: 0 });
    const receiptPath = store.path(pkg.releaseId);
    expect(
      (await readdir(join(directory, 'resume-receipts'))).every((p) => p.endsWith('.json')),
    ).toBe(true);
    expect(await readFile(receiptPath, 'utf8')).not.toContain('Cf-Access');
  });
  it('recovers a committed publish with a lost reply and replays without another journal event', async () => {
    const pkg = await makeRelease(directory, 'lost-reply');
    const lost: HttpTransport = async (request) => {
      const response = await transport(request);
      if (request.url.endsWith('/admin/publish')) throw new Error('reply lost after commit');
      return response;
    };
    const result = await client('lost-receipts', lost).publish(pkg);
    expect(result).toMatchObject({ release_id: pkg.releaseId, revision: 1, readback: 'verified' });
    const repeated = await client('lost-receipts').publish(pkg);
    expect(repeated).toMatchObject({
      revision: 1,
      request_id: 'request_id' in result ? result.request_id : '',
      replay: true,
    });
    expect(await journal()).toHaveLength(1);
    const status = await client().status();
    expect(status.journal[0]).toMatchObject({
      revision: 1,
      release_id: pkg.releaseId,
      previous_release_id: null,
      role: 'operator',
    });
    expect(status.journal[0]!.by).toMatch(/^operator-[0-9a-f]{8}$/);
    expect(packets.every((r) => r.url.startsWith(worker.url + '/'))).toBe(true);
    expect(packets.some((r) => r.url.includes('/admin/requests/'))).toBe(true);
  });
  it('keeps request ID and expected revision after an unconfirmed lost publish and process restart', async () => {
    const pkg = await makeRelease(directory, 'retry');
    let id = '';
    const lostBefore: HttpTransport = async (request) => {
      if (request.url.endsWith('/admin/publish')) {
        id = JSON.parse(Buffer.from(request.body!).toString()).request_id;
        throw new Error('lost before commit');
      }
      return transport(request);
    };
    await expect(client('retry-receipts', lostBefore).publish(pkg)).rejects.toMatchObject({
      code: 6,
    });
    const saved = await client('retry-receipts').receipts.load(pkg.releaseId);
    expect(saved.requests[0]).toMatchObject({
      request_id: id,
      expected_revision: 1,
      state: 'pending',
    });
    const result = await client('retry-receipts').publish(pkg);
    expect(result).toMatchObject({ request_id: id, revision: 2 });
    expect(await journal()).toHaveLength(2);
  });
  it('rejects concurrent revision changes, requires explicit new CAS intent and permits rollback only to prior releases', async () => {
    const one = await makeRelease(directory, 'race-one'),
      two = await makeRelease(directory, 'race-two');
    const first = await client('race-one-receipts').publish({ ...one, expectedRevision: 2 });
    expect(first).toMatchObject({ revision: 3 });
    // Lose a reply before POST while retaining expected revision 2 in the competing receipt.
    const stale = new ReceiptStore(join(directory, 'race-two-receipts'), client().environment);
    await stale.locked(two.releaseId, async () => {
      const receipt = await stale.load(two.releaseId);
      receipt.requests.push({
        kind: 'publish',
        expected_revision: 2,
        request_id: 'race-request-00000002',
        state: 'pending',
      });
      await stale.save(receipt);
    });
    await expect(client('race-two-receipts').publish(two)).rejects.toMatchObject({
      code: 5,
      status: 409,
    });
    await expect(client('race-two-receipts').publish(two)).rejects.toThrow('explicitly');
    expect(await client().current()).toMatchObject({ release_id: one.releaseId, revision: 3 });
    const unpublished = await makeRelease(directory, 'unpublished');
    await client('rollback-receipts').upload(unpublished);
    await expect(
      client('rollback-receipts').rollback({ releaseId: unpublished.releaseId }),
    ).rejects.toMatchObject({ code: 5 });
    const earlier = (await journal())[0]!.release_id as string;
    const back = await client('rollback-receipts').rollback({
      releaseId: earlier,
      expectedRevision: 3,
    });
    expect(back).toMatchObject({ release_id: earlier, revision: 4, kind: 'rollback' });
    const applied = await client('race-two-receipts').publish({ ...two, expectedRevision: 4 });
    expect(applied).toMatchObject({ revision: 5 });
    // A resolved older conflict must not mask the most recent confirmed intent.
    expect(await client('race-two-receipts').publish(two)).toMatchObject({
      revision: 5,
      replay: true,
    });
    expect(await journal()).toHaveLength(5);
  });
  it('retains applied receipts on wrong readback hashes, retries readback without publishing again', async () => {
    const pkg = await makeRelease(directory, 'readback');
    const wrong: HttpTransport = async (request) => {
      const response = await transport(request);
      return request.url.endsWith('/data/x.json')
        ? { status: 200, body: Buffer.from('incorrect') }
        : response;
    };
    await expect(client('readback-receipts', wrong).publish(pkg)).rejects.toMatchObject({
      code: 6,
    });
    const store = client('readback-receipts').receipts;
    expect((await store.load(pkg.releaseId)).requests[0]).toMatchObject({
      state: 'applied',
      expected_revision: 5,
    });
    expect(await client('readback-receipts').publish(pkg)).toMatchObject({
      revision: 6,
      replay: true,
    });
    expect(await journal()).toHaveLength(6);
    const manifestWrong: HttpTransport = async (request) =>
      request.url.endsWith('/manifest.json')
        ? { status: 200, body: Buffer.from('{}') }
        : transport(request);
    await expect(
      client('readback-receipts', manifestWrong).readBack(pkg.releaseId, 6),
    ).rejects.toMatchObject({ code: 6 });
  });
  it('server refuses wrong object bytes; changed originals fail before HTTP; receipts cannot cross environments', async () => {
    const pkg = await makeRelease(directory, 'wrong-object');
    let changed = false;
    const wrong: HttpTransport = (request) => {
      if (request.method === 'PUT' && !changed) {
        changed = true;
        return transport({ ...request, body: Buffer.alloc(request.body!.length, 9) });
      }
      return transport(request);
    };
    await expect(client('wrong-receipts', wrong).upload(pkg)).rejects.toMatchObject({
      code: 2,
      status: 422,
    });
    expect((await client('wrong-receipts').upload(pkg)).state).toContain('sealed');
    const original = await readFile(join(pkg.originals, pkg.manifest.inputs[0]!.path));
    await writeFile(join(pkg.originals, pkg.manifest.inputs[0]!.path), 'corrupted');
    const count = packets.length;
    await expect(client('wrong-receipts').publish(pkg)).rejects.toMatchObject({ code: 2 });
    expect(packets).toHaveLength(count);
    await writeFile(join(pkg.originals, pkg.manifest.inputs[0]!.path), original);
    const other = new ReceiptStore(join(directory, 'wrong-receipts'), {
      name: 'another-environment',
      url: worker.url,
    });
    expect(other.path(pkg.releaseId)).not.toBe(
      client('wrong-receipts').receipts.path(pkg.releaseId),
    );
    expect((await other.load(pkg.releaseId)).operation).toBeUndefined();
    const object = await worker.r2.get('objects/sha256/' + pkg.manifest.inputs[0]!.sha256);
    expect(sha256(new Uint8Array(await object!.arrayBuffer()))).toBe(
      pkg.manifest.inputs[0]!.sha256,
    );
  });
  it('retries lost PUT and seal replies idempotently, deduplicating input/output hashes', async () => {
    const pkg = await makeRelease(
      directory,
      'deduplicated',
      Buffer.from(JSON.stringify({ value: 'deduplicated' }) + '\n'),
    );
    let lostPut = false,
      lostSeal = false;
    const lost: HttpTransport = async (request) => {
      const response = await transport(request);
      if (request.method === 'PUT' && !lostPut) {
        lostPut = true;
        throw new Error('lost PUT reply');
      }
      if (request.url.endsWith('/seal') && !lostSeal) {
        lostSeal = true;
        throw new Error('lost seal reply');
      }
      return response;
    };
    const c = new ReleaseClient({
      environment: client().environment,
      receiptDirectory: join(directory, 'idempotent-receipts'),
      credentials: () => ({ accessToken: worker.token() }),
      transport: lost,
      attempts: 3,
      retryDelay: async () => undefined,
    });
    expect(await c.upload(pkg)).toMatchObject({
      // The identical validation report is already stored by earlier releases.
      objects: 1,
      state: 'sealed: a candidate, not current',
    });
    expect(lostPut && lostSeal).toBe(true);
    expect(await journal()).toHaveLength(6);
  });
  it('never automatically retries operation creation if its response was lost', async () => {
    const pkg = await makeRelease(directory, 'lost-operation');
    let starts = 0;
    const lost: HttpTransport = async (request) => {
      const response = await transport(request);
      if (request.url.endsWith('/admin/operations') && request.method === 'POST') {
        starts++;
        throw new Error('lost creation response');
      }
      return response;
    };
    await expect(client('lost-operation-receipts', lost).upload(pkg)).rejects.toMatchObject({
      code: 6,
    });
    expect(starts).toBe(1);
  });
  it('admits one of two publishers targeting the same revision and preserves the journal', async () => {
    const one = await makeRelease(directory, 'concurrent-one'),
      two = await makeRelease(directory, 'concurrent-two');
    let remaining = 2,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const simultaneous: HttpTransport = async (request) => {
      const response = await transport(request);
      if (request.url.endsWith('/current') && remaining > 0) {
        if (--remaining === 0) release();
        await gate;
      }
      return response;
    };
    const results = await Promise.allSettled([
      client('concurrent-one-receipts', simultaneous).publish({ ...one, expectedRevision: 6 }),
      client('concurrent-two-receipts', simultaneous).publish({ ...two, expectedRevision: 6 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: 5, status: 409 });
    expect(await journal()).toHaveLength(7);
    expect((await client().current()).revision).toBe(7);
  });
});
