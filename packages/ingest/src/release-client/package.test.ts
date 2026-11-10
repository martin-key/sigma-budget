import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeRelease, writeManifest } from '../../test/support/release-package.js';
import { preflightRelease } from './package.js';
import { ReleaseClient } from './client.js';
import {
  credentialHeaders,
  credentialsFromEnvironment,
  nodeHttpTransport,
  releaseEnvironment,
} from './transport.js';
import { ReceiptStore } from './receipts.js';
import { sha256 } from './files.js';

describe('strict offline package preflight', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'operator-package-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('hashes all declared inputs and outputs without changing original bytes', async () => {
    const pkg = await makeRelease(directory, 'valid');
    const manifest = await readFile(join(pkg.release, 'manifest.json'));
    const result = await preflightRelease(pkg);
    expect(result.releaseId).toBe(sha256(manifest));
    expect(result.objects.size).toBe(4);
    expect(await readFile(join(pkg.release, 'manifest.json'))).toEqual(manifest);
    await writeFile(join(pkg.originals, pkg.manifest.inputs[0]!.path), 'wrong');
    await expect(preflightRelease(pkg)).rejects.toMatchObject({ code: 2 });
  });
  it('checks receipt identity, successful validation, missing files and unlisted data', async () => {
    const pkg = await makeRelease(directory, 'receipt');
    await writeFile(
      join(pkg.release, 'receipt.json'),
      JSON.stringify({ release_id: 'b'.repeat(64) }),
    );
    await expect(preflightRelease(pkg)).rejects.toThrow('receipt');
    await writeManifest(pkg.release, pkg.manifest);
    await writeFile(join(pkg.release, 'data/extra.json'), '{}');
    await expect(preflightRelease(pkg)).rejects.toThrow('absent');
    await rm(join(pkg.release, 'data/extra.json'));
    const bad = Buffer.from(
      JSON.stringify({ passed: false, groups: [{ group: 'TEST', status: 'FAIL' }] }),
    );
    await writeFile(join(pkg.release, 'validation.json'), bad);
    Object.assign(pkg.manifest.outputs[1]!, { bytes: bad.length, sha256: sha256(bad) });
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toThrow('validation');
    await rm(join(pkg.release, 'data/x.json'));
    await expect(preflightRelease(pkg)).rejects.toMatchObject({ code: 3 });
  });
  it('rejects traversal, duplicate paths, unsupported schemas, noncanonical manifests and limits', async () => {
    const pkg = await makeRelease(directory, 'paths');
    pkg.manifest.inputs[0]!.path = 'data/../outside';
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toMatchObject({ code: 2 });
    pkg.manifest.inputs[0]!.path = 'data/originals/source.bin';
    pkg.manifest.outputs.push({ ...pkg.manifest.outputs[0]! });
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toThrow('duplicate');
    pkg.manifest.outputs.pop();
    pkg.manifest.data_schema.execution = 'execution/999';
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease(pkg)).rejects.toThrow('Unsupported');
    pkg.manifest.data_schema.execution = 'execution/2';
    await writeManifest(pkg.release, pkg.manifest);
    await expect(preflightRelease({ ...pkg, maxObjectBytes: 1 })).rejects.toThrow(
      'configured object limit 1',
    );
    await writeFile(join(pkg.release, 'manifest.json'), JSON.stringify(pkg.manifest, null, 2));
    await expect(preflightRelease(pkg)).rejects.toThrow('canonical');
  });
  for (const kind of ['symlink', 'hardlink', 'parent symlink'] as const)
    it(`rejects ${kind} before any upload`, async () => {
      const pkg = await makeRelease(directory, kind.replaceAll(' ', '-'));
      const file = join(pkg.release, 'data/x.json');
      if (kind === 'parent symlink') {
        await symlink(pkg.release, join(directory, 'aliased'), 'dir');
        pkg.release = join(directory, 'aliased');
      } else {
        const copy = join(directory, 'copy');
        await writeFile(copy, await readFile(file));
        await rm(file);
        if (kind === 'hardlink') await link(copy, file);
        else await symlink(copy, file);
      }
      let calls = 0;
      const client = new ReleaseClient({
        environment: { name: 'test', url: 'http://127.0.0.1:1' },
        receiptDirectory: join(directory, 'receipts'),
        transport: async () => {
          calls++;
          throw new Error();
        },
      });
      await expect(client.upload(pkg)).rejects.toMatchObject({ code: 2 });
      expect(calls).toBe(0);
    });
  it('rejects receipt/source overlap and malicious receipt destinations', async () => {
    const pkg = await makeRelease(directory, 'protected');
    const environment = { name: 'test', url: 'http://127.0.0.1:1' };
    await expect(
      new ReleaseClient({ environment, receiptDirectory: pkg.release }).upload(pkg),
    ).rejects.toThrow('separate');
    await expect(
      new ReleaseClient({ environment, receiptDirectory: join(pkg.originals, 'data') }).upload(pkg),
    ).rejects.toThrow('separate');
    const store = new ReceiptStore(join(directory, 'receipts'), environment);
    await store.locked(pkg.releaseId, async () => {
      const receipt = await store.load(pkg.releaseId);
      const outside = join(directory, 'outside');
      await writeFile(outside, 'untouched');
      await symlink(outside, store.path(pkg.releaseId));
      await expect(store.save(receipt)).rejects.toMatchObject({ code: 2 });
      expect(await readFile(outside, 'utf8')).toBe('untouched');
      await expect(store.load(pkg.releaseId)).rejects.toMatchObject({ code: 2 });
    });
    await expect(store.locked('../outside', async () => undefined)).rejects.toMatchObject({
      code: 2,
    });
  });
  it('rejects hardlinked receipts, receipt directory symlinks, cross-environment data and simultaneous locks', async () => {
    const pkg = await makeRelease(directory, 'receipt-links');
    const store = new ReceiptStore(join(directory, 'receipts'), {
      name: 'test',
      url: 'http://127.0.0.1:1',
    });
    await store.locked(pkg.releaseId, async () => {
      const receipt = await store.load(pkg.releaseId);
      await store.save(receipt);
      await expect(store.locked(pkg.releaseId, async () => undefined)).rejects.toThrow('locked');
      receipt.environment.url = 'http://127.0.0.1:2';
      await store.save(receipt);
      await expect(store.load(pkg.releaseId)).rejects.toThrow('identity');
      await link(store.path(pkg.releaseId), join(directory, 'linked-receipt'));
      await expect(store.load(pkg.releaseId)).rejects.toMatchObject({ code: 2 });
      await expect(store.save(receipt)).rejects.toMatchObject({ code: 2 });
    });
    await symlink(store.directory, join(directory, 'aliased-receipts'));
    const alias = new ReceiptStore(join(directory, 'aliased-receipts'), store.environment);
    await expect(alias.locked(pkg.releaseId, async () => undefined)).rejects.toMatchObject({
      code: 2,
    });
  });
});

describe('protected transport contract', () => {
  it('requires an explicit clean environment origin', () => {
    for (const url of [
      'http://example.invalid',
      'https://example.invalid/admin',
      'https://user:secret@example.invalid',
      'https://example.invalid/?token=value',
    ])
      expect(() => releaseEnvironment({ name: 'dev', url })).toThrow();
    expect(releaseEnvironment({ name: 'dev', url: 'https://example.invalid/' }).url).toBe(
      'https://example.invalid',
    );
  });
  it('only accepts provided Access identity credentials and never reflects provider failures', async () => {
    expect(() => credentialsFromEnvironment({ CLOUDFLARE_API_TOKEN: 'account-secret' })).toThrow(
      'Access',
    );
    expect(() => credentialsFromEnvironment({ CF_ACCESS_CLIENT_ID: 'id' })).toThrow('Both');
    expect(credentialsFromEnvironment({ BUDGET_ACCESS_TOKEN: 'provided-test-token' })).toEqual({
      accessToken: 'provided-test-token',
    });
    await expect(
      credentialHeaders(
        () => {
          throw new Error('private-test-secret');
        },
        { name: 'dev', url: 'https://example.invalid' },
      ),
    ).rejects.toThrow('Cannot obtain valid operator credentials');
    expect(
      await credentialHeaders(() => ({ clientId: 'test-id', clientSecret: 'test-secret' }), {
        name: 'dev',
        url: 'https://example.invalid',
      }),
    ).toEqual({ 'CF-Access-Client-Id': 'test-id', 'CF-Access-Client-Secret': 'test-secret' });
  });
  it('sanitizes HTTP failures and refuses redirect responses without leaking credentials', async () => {
    const env = { name: 'dev', url: 'http://127.0.0.1:1' };
    const client = new ReleaseClient({
      environment: env,
      receiptDirectory: '/tmp/not-created-operator-receipts',
      transport: async () => {
        throw new Error('private-test-secret');
      },
      attempts: 1,
    });
    await expect(client.status()).rejects.toThrow('bounded response');
    const redirect = new ReleaseClient({
      environment: env,
      receiptDirectory: '/tmp/not-created-operator-receipts',
      transport: async () => ({ status: 302, body: Buffer.from('private-test-secret') }),
    });
    await expect(redirect.status()).rejects.toMatchObject({ code: 4 });
    expect(typeof nodeHttpTransport).toBe('function');
  });
});
