import { expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localReleaseWorker } from '../../test/support/release-worker.js';
import { makeRelease, writeManifest } from '../../test/support/release-package.js';
import { preflightRelease } from './package.js';
import { ReleaseClient } from './client.js';
import { nodeHttpTransport } from './transport.js';
import { sha256 } from './files.js';
import type { HttpRequest } from './types.js';

// Opt-in real input acceptance. Paths are supplied explicitly; no auth/config files are read.
const candidate = process.env.BUDGET_OPERATOR_CANDIDATE;
const originals = process.env.BUDGET_OPERATOR_ORIGINALS;
it.skipIf(!candidate || !originals)(
  'accepted 119-input package and real 63,488,595-byte archive through local upload/seal/readback',
  async () => {
    const release = candidate!,
      source = originals!,
      maxObjectBytes = 67108864;
    const before = {
      manifest: sha256(await readFile(join(release, 'manifest.json'))),
      receipt: sha256(await readFile(join(release, 'receipt.json'))),
    };
    await expect(preflightRelease({ release, originals: source })).rejects.toThrow(
      '63488595 bytes exceeds configured object limit 52428800',
    );
    const pkg = await preflightRelease({ release, originals: source, maxObjectBytes });
    expect(pkg.releaseId).toBe('f6e78e74fba37602840310934821f4a6d95872a0d19af2512ba4763fefe5ca0b');
    expect(pkg.manifest.inputs).toHaveLength(119);
    expect(pkg.manifest.outputs).toHaveLength(70);
    expect(pkg.manifestBytes.length).toBe(81852);
    const archive = pkg.manifest.inputs.find(
      (f) => f.path === 'data/originals/parliament/52-602-01-19.zip',
    )!;
    expect(archive).toMatchObject({
      bytes: 63488595,
      sha256: '59efdf6503c8ea92c033c73b48a8b20d817d61711f8e8dfe5d37587253fe35d8',
    });
    const directory = await mkdtemp(join(tmpdir(), 'operator-real-archive-'));
    let worker: Awaited<ReturnType<typeof localReleaseWorker>> | undefined;
    const started = performance.now();
    try {
      const sample = await makeRelease(directory, 'archive-protocol');
      await rm(join(sample.originals, sample.manifest.inputs[0]!.path));
      await mkdir(join(sample.originals, 'data/originals/parliament'), { recursive: true });
      await copyFile(join(source, archive.path), join(sample.originals, archive.path));
      sample.manifest.inputs = [{ ...archive }];
      sample.releaseId = await writeManifest(sample.release, sample.manifest);
      // A larger client allowance cannot override a server configured at the old 50 MiB.
      worker = await localReleaseWorker(52428800);
      const defaultServerClient = new ReleaseClient({
        environment: { name: 'archive-default-local', url: worker.url },
        receiptDirectory: join(directory, 'default-server-receipts'),
        maxObjectBytes,
        credentials: () => ({ accessToken: worker!.token() }),
      });
      await expect(defaultServerClient.upload(sample)).rejects.toMatchObject({
        code: 2,
        status: 422,
      });
      expect(await worker.db.prepare('SELECT * FROM operations').all()).toMatchObject({
        results: [],
      });
      await worker.mf.dispose();
      worker = undefined;
      // The default limit of every environment that does not set MAX_OBJECT_BYTES; the archive goes up in 16 MiB parts.
      worker = await localReleaseWorker();
      const packets: HttpRequest[] = [];
      const client = new ReleaseClient({
        environment: { name: 'archive-owned-local', url: worker.url },
        receiptDirectory: join(directory, 'receipts'),
        maxObjectBytes,
        credentials: () => ({ accessToken: worker!.token() }),
        transport: (request) => {
          packets.push({ ...request, headers: {}, body: undefined });
          return nodeHttpTransport(request);
        },
      });
      const sealed = await client.upload(sample);
      expect(
        packets.filter(
          (p) => p.method === 'PUT' && p.url.includes(`/objects/${archive.sha256}/parts/`),
        ),
      ).toHaveLength(4);
      expect(sealed.state).toContain('sealed');
      // Hash the final R2 object, not only a returned digest/size or a temporary upload.
      const stored = await worker.r2.get('objects/sha256/' + archive.sha256);
      const storedBytes = new Uint8Array(await stored!.arrayBuffer());
      expect(storedBytes.length).toBe(archive.bytes);
      expect(sha256(storedBytes)).toBe(archive.sha256);
      const published = await client.publish(sample);
      expect(published).toMatchObject({ revision: 1, readback: 'verified' });
      const response = await nodeHttpTransport({
        method: 'GET',
        url: `${worker.url}/data/releases/${sample.releaseId}/${archive.path}`,
        headers: { 'Cache-Control': 'no-cache' },
        timeoutMs: 120000,
        maxResponseBytes: maxObjectBytes,
      });
      expect(response.status).toBe(200);
      expect(response.body.length).toBe(archive.bytes);
      expect(sha256(response.body)).toBe(archive.sha256);
      expect(sha256(await readFile(join(source, archive.path)))).toBe(archive.sha256);
      expect(sha256(await readFile(join(release, 'manifest.json')))).toBe(before.manifest);
      expect(sha256(await readFile(join(release, 'receipt.json')))).toBe(before.receipt);
      const report = {
        acceptedReleaseId: pkg.releaseId,
        inputsVerified: 119,
        outputsVerified: 70,
        manifestBytes: pkg.manifestBytes.length,
        archive: { path: archive.path, bytes: archive.bytes, sha256: archive.sha256 },
        defaultObjectLimit: 52428800,
        defaultPreflight: 'refused',
        serverAt50MiBWith64MiBClient: 'HTTP 422 manifest refused before creating an operation',
        localObjectLimit: maxObjectBytes,
        serverObjectLimit: 'the Worker default (256 MiB)',
        localUpload: 'verified, in 4 parts of 16 MiB',
        localSeal: 'validated',
        finalR2Hash: archive.sha256,
        publicReadbackHash: archive.sha256,
        elapsedMs: Math.round(performance.now() - started),
        nodeMaxRssKiB: process.resourceUsage().maxRSS,
        scope:
          'local workerd/D1/R2 only; archive-focused synthetic release, no full-registry upload or remote deployment',
      };
      if (process.env.BUDGET_OPERATOR_REPORT)
        await writeFile(process.env.BUDGET_OPERATOR_REPORT, JSON.stringify(report, null, 2) + '\n');
    } finally {
      try {
        await worker?.mf.dispose();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
  180000,
);
