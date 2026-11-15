import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localReleaseWorker } from '../../test/support/release-worker.js';
import { makeRelease } from '../../test/support/release-package.js';
import { ReleaseClient } from './client.js';
import { nodeHttpTransport } from './transport.js';
import { sha256 } from './files.js';
import type { HttpRequest, HttpTransport } from './types.js';

const MiB = 1024 * 1024;
const PART = 16 * MiB; // PART_BYTES of apps/web/workers/api/store.js
const OLD_LIMIT = 50 * MiB; // the default MAX_OBJECT_BYTES before objects went up in parts

/** deterministic bytes that do not compress or repeat within a part */
function bytes(length: number, seed: string) {
  const out = Buffer.alloc(length);
  for (let at = 0, n = 0; at < length; n++)
    at += createHash('sha512')
      .update(seed + n)
      .digest()
      .copy(out, at);
  return out;
}

describe('an object larger than one request goes up in parts (local workerd, D1 and R2)', () => {
  let worker: Awaited<ReturnType<typeof localReleaseWorker>>, directory: string;
  const packets: HttpRequest[] = [];
  const transport: HttpTransport = async (request) => {
    packets.push({ ...request, headers: {}, body: undefined });
    return nodeHttpTransport(request);
  };
  const client = (receipts: string, maxObjectBytes = 64 * MiB) =>
    new ReleaseClient({
      environment: { name: 'multipart-local', url: worker.url },
      receiptDirectory: join(directory, receipts),
      maxObjectBytes,
      credentials: () => ({ accessToken: worker.token() }),
      transport,
      attempts: 1,
    });
  const http = (method: HttpRequest['method'], path: string, body?: Uint8Array) =>
    nodeHttpTransport({
      method,
      url: worker.url + path,
      headers: {
        'Cf-Access-Jwt-Assertion': worker.token(),
        ...(body ? { 'Content-Length': String(body.byteLength) } : {}),
      },
      body,
      timeoutMs: 60000,
      maxResponseBytes: 1024 * 1024,
    });
  const answer = (r: { body: Uint8Array }) => JSON.parse(Buffer.from(r.body).toString());
  const finalBytes = async (sha: string) => {
    const object = await worker.r2.get('objects/sha256/' + sha);
    return object && Buffer.from(await object.arrayBuffer());
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'operator-multipart-'));
    worker = await localReleaseWorker(); // the default limit of every environment that does not set MAX_OBJECT_BYTES
  }, 30000);
  afterAll(async () => {
    try {
      await worker?.mf.dispose();
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });

  it('publishes an original over the old 50 MiB limit, sent in 16 MiB parts and read back whole', async () => {
    const archive = bytes(OLD_LIMIT + 3 * MiB + 5, 'archive'); // like the 63 MB archive to the budget bill: four parts
    const pkg = await makeRelease(directory, 'large', archive);
    const sha = pkg.manifest.inputs[0]!.sha256;
    expect(archive.length).toBeGreaterThan(OLD_LIMIT);
    const sealed = await client('large-receipts').upload(pkg);
    expect(sealed.state).toContain('sealed');
    const sent = packets.filter((p) => p.url.includes(`/objects/${sha}`));
    expect(
      sent.map((p) => `${p.method} ${p.url.replace(/^.*\/objects\/[0-9a-f]{64}/, '')}`),
    ).toEqual([
      'POST /parts',
      ...[1, 2, 3, 4].map(
        (n) => `PUT /parts/${n}?upload_id=${sent[1]!.url.split('upload_id=')[1]}`,
      ),
      'POST /parts/complete',
    ]);
    expect(sha256((await finalBytes(sha))!)).toBe(sha);
    expect((await worker.r2.list({ prefix: 'uploads/' })).objects).toEqual([]);
    expect(await client('large-receipts').publish(pkg)).toMatchObject({
      revision: 1,
      readback: 'verified',
    });
    const download = await nodeHttpTransport({
      method: 'GET',
      url: `${worker.url}/data/releases/${pkg.releaseId}/${pkg.manifest.inputs[0]!.path}`,
      headers: { 'Cache-Control': 'no-cache' },
      timeoutMs: 60000,
      maxResponseBytes: 64 * MiB,
    });
    expect(download.status).toBe(200);
    expect(sha256(download.body)).toBe(sha);
  }, 120000);

  it('reuses the stored large original in the next release after hashing it, without sending it again', async () => {
    const archive = await readFile(join(directory, 'large-originals', 'data/originals/source.bin'));
    const next = await makeRelease(directory, 'large-next', archive);
    const before = packets.length;
    const result = await client('large-next-receipts').upload(next);
    expect(result).toMatchObject({ objects: 1, state: 'sealed: a candidate, not current' }); // only data/x.json is new
    expect(packets.slice(before).some((p) => p.url.includes('/parts'))).toBe(false);
  }, 120000);

  it('refuses a whole PUT over one part, wrong parts and a damaged part; a wrong object never takes the key', async () => {
    const object = bytes(PART + 5, 'damaged'); // two parts: 16 MiB and 5 bytes
    const pkg = await makeRelease(directory, 'parts-checked', object);
    const sha = pkg.manifest.inputs[0]!.sha256;
    const started = answer(
      await http('POST', '/admin/operations', await readFile(join(pkg.release, 'manifest.json'))),
    );
    expect(started).toMatchObject({ part_bytes: PART });
    expect(started.needed.map((o: { sha256: string }) => o.sha256)).toContain(sha);
    const objectPath = `/admin/operations/${started.operation_id}/objects/${sha}`;

    const whole = await http('PUT', objectPath, object);
    expect([whole.status, answer(whole).part_bytes]).toEqual([413, PART]);

    const begun = await http('POST', objectPath + '/parts', Buffer.from('{}'));
    expect(begun.status).toBe(201);
    const { upload_id: id, parts } = answer(begun);
    expect(parts).toBe(2);
    const part = (n: number | string, body: Uint8Array, upload = id) =>
      http('PUT', `${objectPath}/parts/${n}?upload_id=${encodeURIComponent(upload)}`, body);
    expect((await part(3, object.subarray(0, 5))).status).toBe(404);
    expect((await part('0', object.subarray(0, 5))).status).toBe(404);
    expect((await http('PUT', `${objectPath}/parts/1`, object.subarray(0, 5))).status).toBe(400);
    expect((await part(1, object.subarray(0, MiB))).status).toBe(422); // every part but the last has part_bytes
    expect((await part(2, object.subarray(0, 6))).status).toBe(422); // the last part has the rest
    expect((await part(1, object.subarray(0, PART), 'not-an-upload')).status).toBe(409);

    const first = answer(await part(1, object.subarray(0, PART)));
    const damaged = answer(await part(2, Buffer.from('xxxxx'))); // the right length, the wrong bytes
    expect((await http('POST', objectPath + '/parts/complete', Buffer.from('{}'))).status).toBe(
      400,
    );
    const misordered = {
      upload_id: id,
      parts: [damaged, first].map((p) => ({ part: p.part, etag: p.etag })),
    };
    expect(
      (await http('POST', objectPath + '/parts/complete', Buffer.from(JSON.stringify(misordered))))
        .status,
    ).toBe(400);
    const joined = {
      upload_id: id,
      parts: [first, damaged].map((p) => ({ part: p.part, etag: p.etag })),
    };
    const refused = await http(
      'POST',
      objectPath + '/parts/complete',
      Buffer.from(JSON.stringify(joined)),
    );
    expect([refused.status, answer(refused).error]).toEqual([
      422,
      expect.stringContaining('the bytes do not match'),
    ]);
    expect(await finalBytes(sha)).toBeNull();
    expect((await worker.r2.list({ prefix: 'uploads/' })).objects).toEqual([]);
    expect(
      (await http('POST', `/admin/operations/${started.operation_id}/seal`, Buffer.from('{}')))
        .status,
    ).toBe(409);

    const again = answer(await http('POST', objectPath + '/parts', Buffer.from('{}')));
    const good = [];
    for (const [n, slice] of [object.subarray(0, PART), object.subarray(PART)].entries())
      good.push(answer(await part(n + 1, slice, again.upload_id)));
    const done = {
      upload_id: again.upload_id,
      parts: good.map((p) => ({ part: p.part, etag: p.etag })),
    };
    const verified = await http(
      'POST',
      objectPath + '/parts/complete',
      Buffer.from(JSON.stringify(done)),
    );
    expect([verified.status, answer(verified)]).toEqual([200, { sha256: sha, verified: true }]);
    expect(sha256((await finalBytes(sha))!)).toBe(sha);
    // a completion whose reply was lost, sent again: the object is verified already
    const repeated = await http(
      'POST',
      objectPath + '/parts/complete',
      Buffer.from(JSON.stringify(done)),
    );
    expect(answer(repeated)).toMatchObject({ sha256: sha, verified: true, already: true });
  }, 120000);
});
