import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReleaseClient, type HttpRequest } from '@sigma-budget/ingest/release-client';
import { makeRelease } from '../../../packages/ingest/test/support/release-package.js';
import { releaseOperatorCli } from './release-operator.js';

describe('standalone release operator integration contract', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'operator-cli-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('supports offline preflight and injected registry/transport without touching environment or root dispatch', async () => {
    const pkg = await makeRelease(directory, 'cli');
    const output: string[] = [],
      requests: HttpRequest[] = [];
    const deps = {
      environment: (name: string) => ({ name, url: 'http://127.0.0.1:1' }),
      credentialEnvironment: {},
      stdout: (text: string) => output.push(text),
      client: (options: ConstructorParameters<typeof ReleaseClient>[0]) =>
        new ReleaseClient({
          ...options,
          transport: async (request) => {
            requests.push(request);
            return {
              status: request.url.endsWith('/current') ? 404 : 200,
              body: Buffer.from(
                request.url.endsWith('/current')
                  ? '{"release_id":null,"revision":0}'
                  : '{"items":[]}',
              ),
            };
          },
        }),
    };
    expect(
      await releaseOperatorCli(
        [
          'preflight',
          '--environment',
          'test',
          '--release',
          pkg.release,
          '--originals',
          pkg.originals,
        ],
        deps,
      ),
    ).toBe(0);
    expect(JSON.parse(output[0]!)).toMatchObject({
      release_id: pkg.releaseId,
      inputs: 1,
      outputs: 2,
      preflight: 'verified',
    });
    expect(requests).toHaveLength(0);
    expect(
      await releaseOperatorCli(
        [
          'publish',
          '--environment',
          'test',
          '--release',
          pkg.release,
          '--originals',
          pkg.originals,
          '--dry-run',
        ],
        deps,
      ),
    ).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers).not.toHaveProperty('Cf-Access-Token');
    expect(await releaseOperatorCli(['status', '--environment', 'test'], deps)).toBe(0);
  });
  it('requires explicit mutation consent and environment, rejects credential flags without reflecting values', async () => {
    const lines: string[] = [];
    const deps = { credentialEnvironment: {}, stdout: (text: string) => lines.push(text) };
    for (const args of [
      ['status'],
      ['upload', '--environment', 'test', '--url', 'http://127.0.0.1:1'],
      [
        'status',
        '--environment',
        'test',
        '--url',
        'https://example.invalid',
        '--token',
        'fake-private-secret',
      ],
      [
        'rollback',
        '--environment',
        'test',
        '--url',
        'http://127.0.0.1:1',
        '--release-id',
        'a'.repeat(64),
        '--expected-revision',
        '-1',
        '--yes',
      ],
    ])
      expect(await releaseOperatorCli(args, deps)).toBe(2);
    expect(lines.join('\n')).not.toContain('fake-private-secret');
    expect(
      await releaseOperatorCli(
        ['status', '--environment', 'test', '--url', 'https://other.invalid'],
        { ...deps, environment: (name) => ({ name, url: 'https://example.invalid' }) },
      ),
    ).toBe(2);
  });
});
