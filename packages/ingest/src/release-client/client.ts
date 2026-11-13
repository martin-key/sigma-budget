import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { sha256 } from './files.js';
import {
  checkedBytes,
  fileUrlPath,
  objectLimit,
  parseManifest,
  preflightRelease,
  type ReleasePackage,
} from './package.js';
import {
  parsePublishResult,
  ReceiptStore,
  type ChangeReceipt,
  type OperatorReceipt,
} from './receipts.js';
import { credentialHeaders, nodeHttpTransport, releaseEnvironment } from './transport.js';
import {
  MANIFEST_LIMIT,
  MIN_PART_BYTES,
  OPERATION_ID,
  parseJson,
  record,
  ReleaseError,
  revision,
  SHA256,
  type ChangeKind,
  type ClientOptions,
  type CurrentRelease,
  type HttpResponse,
  type HttpTransport,
  type PublishOptions,
  type PublishResult,
  type ReleaseManifest,
  type RollbackOptions,
  type UploadOptions,
} from './types.js';

export class ReleaseClient {
  readonly environment;
  readonly receipts: ReceiptStore;
  private readonly limit: number;
  private readonly transport: HttpTransport;
  private readonly attempts: number;
  private readonly timeout: number;
  constructor(private readonly options: ClientOptions) {
    this.environment = releaseEnvironment(options.environment);
    this.receipts = new ReceiptStore(options.receiptDirectory, this.environment);
    this.limit = objectLimit(options.maxObjectBytes);
    this.transport = options.transport ?? nodeHttpTransport;
    this.attempts = options.attempts ?? 3;
    this.timeout = options.timeoutMs ?? 120_000;
    if (
      !Number.isInteger(this.attempts) ||
      this.attempts < 1 ||
      this.attempts > 5 ||
      !Number.isSafeInteger(this.timeout) ||
      this.timeout < 1
    )
      throw new ReleaseError(2, 'Invalid transport retry or timeout setting');
  }
  private async request(
    method: 'GET' | 'PUT' | 'POST',
    path: string,
    body?: Uint8Array,
    admin = false,
    retry = true,
    responseLimit = MANIFEST_LIMIT,
  ): Promise<HttpResponse> {
    if (
      !(
        path.startsWith('/admin/') ||
        path.startsWith('/api/releases') ||
        path.startsWith('/data/releases/')
      ) ||
      path.startsWith('//')
    )
      throw new ReleaseError(2, 'Invalid protocol route');
    const headers: Record<string, string> = {
      'User-Agent': 'sigma-budget-release-client/1',
      'Cache-Control': 'no-cache',
      'Accept-Encoding': 'identity',
    };
    if (admin)
      Object.assign(headers, await credentialHeaders(this.options.credentials, this.environment));
    if (body)
      Object.assign(headers, {
        'Content-Type': method === 'PUT' ? 'application/octet-stream' : 'application/json',
        'Content-Length': String(body.byteLength),
      });
    for (let attempt = 1; ; attempt++) {
      let response: HttpResponse;
      try {
        response = await this.transport({
          method,
          url: this.environment.url + path,
          headers,
          body,
          timeoutMs: this.timeout,
          maxResponseBytes: responseLimit,
        });
        if (
          !Number.isInteger(response.status) ||
          response.status < 100 ||
          response.status > 599 ||
          !(response.body instanceof Uint8Array) ||
          response.body.byteLength > responseLimit
        )
          throw new Error();
      } catch {
        if (retry && attempt < this.attempts) {
          await this.delay(attempt);
          continue;
        }
        throw new ReleaseError(3, 'HTTP request did not return a bounded response');
      }
      if (response.status >= 300 && response.status < 400)
        throw new ReleaseError(
          4,
          'HTTP redirect refused; verify the environment and Access identity',
          response.status,
        );
      if ([401, 403].includes(response.status))
        throw new ReleaseError(
          4,
          'Access identity is missing, expired or unauthorized in this environment',
          response.status,
        );
      if (
        retry &&
        [408, 429, 500, 502, 503, 504].includes(response.status) &&
        attempt < this.attempts
      ) {
        await this.delay(attempt);
        continue;
      }
      return response;
    }
  }
  private delay(attempt: number) {
    return (
      this.options.retryDelay?.(attempt) ??
      new Promise<void>((r) => setTimeout(r, Math.min(250 * 2 ** (attempt - 1), 2000)))
    );
  }
  private expect(response: HttpResponse, statuses: number[], context: string): unknown {
    if (!statuses.includes(response.status))
      throw new ReleaseError(
        response.status === 409 ? 5 : response.status >= 500 || response.status === 429 ? 3 : 2,
        `${context}: HTTP ${response.status}${response.status === 413 ? ' (configured server object/manifest limit)' : ''}; inspect local limits and protocol configuration`,
        response.status,
      );
    return parseJson(response.body);
  }
  async current(): Promise<CurrentRelease> {
    const response = await this.request('GET', '/api/releases/current');
    const data = this.expect(response, [200, 404], 'Current release');
    if (
      !record(data) ||
      !revision(data.revision) ||
      !(
        data.release_id === null ||
        (typeof data.release_id === 'string' && SHA256.test(data.release_id))
      ) ||
      (response.status === 404 && data.release_id !== null) ||
      (response.status === 200 && data.release_id === null)
    )
      throw new ReleaseError(3, 'Invalid current-release response');
    return { release_id: data.release_id, revision: data.revision };
  }
  async status() {
    const current = await this.current();
    const data = this.expect(await this.request('GET', '/api/releases?limit=5'), [200], 'Journal');
    if (!record(data) || !Array.isArray(data.items))
      throw new ReleaseError(3, 'Invalid release journal');
    const journal = data.items.map((row) => {
      if (
        !record(row) ||
        !revision(row.revision) ||
        typeof row.release_id !== 'string' ||
        !SHA256.test(row.release_id) ||
        !['publish', 'rollback'].includes(String(row.kind)) ||
        typeof row.at !== 'string' ||
        !(
          row.previous_release_id === null ||
          (typeof row.previous_release_id === 'string' && SHA256.test(row.previous_release_id))
        ) ||
        row.role !== 'operator' ||
        typeof row.by !== 'string' ||
        !/^operator-[0-9a-f]{8}$/.test(row.by) ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(row.at)
      )
        throw new ReleaseError(3, 'Invalid release journal entry');
      return {
        revision: row.revision,
        release_id: row.release_id,
        previous_release_id: row.previous_release_id as string | null,
        kind: row.kind as ChangeKind,
        at: row.at,
        role: 'operator' as const,
        by: row.by,
      };
    });
    return { environment: this.environment.name, url: this.environment.url, ...current, journal };
  }
  private preflight(options: UploadOptions) {
    this.receipts.protect([resolve(options.release), join(resolve(options.originals), 'data')]);
    if (options.maxObjectBytes !== undefined && options.maxObjectBytes !== this.limit)
      throw new ReleaseError(
        2,
        'Set the object limit on ReleaseClient so preflight and readback agree',
      );
    return preflightRelease({ ...options, maxObjectBytes: this.limit });
  }
  async upload(options: UploadOptions) {
    const pkg = await this.preflight(options);
    if (options.dryRun)
      return {
        environment: this.environment.name,
        release_id: pkg.releaseId,
        operation: null,
        objects: pkg.objects.size,
        dryRun: true,
        state: 'would upload',
      };
    return this.receipts.locked(pkg.releaseId, async () =>
      this.uploadPackage(pkg, await this.receipts.load(pkg.releaseId)),
    );
  }
  private async uploadPackage(pkg: ReleasePackage, receipt: OperatorReceipt) {
    let data: unknown;
    if (receipt.operation) {
      const response = await this.request(
        'GET',
        '/admin/operations/' + receipt.operation.id,
        undefined,
        true,
      );
      // A missing operation can safely be replaced; a mismatching identity cannot.
      if (response.status !== 404) data = this.expect(response, [200], 'Resume operation');
      else delete receipt.operation;
    }
    if (!data) {
      // The server allocates operation IDs; creation has no idempotency key. Never retry a lost creation reply.
      let response: HttpResponse;
      try {
        response = await this.request('POST', '/admin/operations', pkg.manifestBytes, true, false);
      } catch (error) {
        if (error instanceof ReleaseError && error.code === 3)
          throw new ReleaseError(
            6,
            'Operation creation reply was lost; the server may have an unreferenced open operation',
          );
        throw error;
      }
      data = this.expect(
        response,
        [201],
        'Manifest refused by server (check configured object limit)',
      );
    }
    if (
      !record(data) ||
      data.release_id !== pkg.releaseId ||
      typeof data.operation_id !== 'string' ||
      !OPERATION_ID.test(data.operation_id) ||
      (receipt.operation && data.operation_id !== receipt.operation.id) ||
      !Array.isArray(data.needed) ||
      !revision(data.objects) ||
      data.objects !== pkg.objects.size ||
      (data.state !== undefined && data.state !== 'open' && data.state !== 'sealed') ||
      (data.part_bytes !== undefined &&
        (!Number.isSafeInteger(data.part_bytes) || Number(data.part_bytes) < MIN_PART_BYTES))
    )
      throw new ReleaseError(2, 'Operation response does not match the local package');
    const operation = String(data.operation_id);
    // A server without part_bytes takes every object in one PUT; one with it takes larger objects in parts.
    const partBytes = data.part_bytes === undefined ? undefined : Number(data.part_bytes);
    const needed = new Set<string>();
    for (const entry of data.needed) {
      if (
        !record(entry) ||
        typeof entry.sha256 !== 'string' ||
        !pkg.objects.has(entry.sha256) ||
        needed.has(entry.sha256) ||
        entry.bytes !== pkg.objects.get(entry.sha256)!.bytes ||
        entry.role !== pkg.objects.get(entry.sha256)!.role
      )
        throw new ReleaseError(2, 'Server requested an object absent from the local manifest');
      needed.add(entry.sha256);
    }
    receipt.operation = { id: operation, state: data.state === 'sealed' ? 'sealed' : 'open' };
    if (receipt.operation.state === 'sealed' && needed.size)
      throw new ReleaseError(2, 'Sealed operation still needs objects');
    await this.receipts.save(receipt);
    for (const sha of needed) {
      const object = pkg.objects.get(sha)!;
      const body = await checkedBytes(
        object,
        object.role === 'manifest' ? MANIFEST_LIMIT : this.limit,
      );
      const path = `/admin/operations/${operation}/objects/${sha}`;
      const verified =
        partBytes !== undefined && body.byteLength > partBytes
          ? await this.uploadParts(path, body, partBytes)
          : this.expect(await this.request('PUT', path, body, true), [200], 'Object upload');
      if (!record(verified) || verified.sha256 !== sha || verified.verified !== true)
        throw new ReleaseError(2, 'Server did not verify the uploaded object');
    }
    if (receipt.operation.state !== 'sealed') {
      const sealed = this.expect(
        await this.request('POST', `/admin/operations/${operation}/seal`, Buffer.from('{}'), true),
        [200],
        'Seal',
      );
      if (
        !record(sealed) ||
        sealed.release_id !== pkg.releaseId ||
        sealed.state !== 'validated' ||
        (sealed.problems !== undefined &&
          (!Array.isArray(sealed.problems) || sealed.problems.length > 0))
      )
        throw new ReleaseError(2, 'Candidate did not seal as validated');
      receipt.operation.state = 'sealed';
      await this.receipts.save(receipt);
    }
    return {
      environment: this.environment.name,
      release_id: pkg.releaseId,
      operation,
      objects: needed.size,
      dryRun: false,
      state: 'sealed: a candidate, not current',
    };
  }
  /** An object larger than one request goes up in parts (R2 multipart); the server hashes the joined object before it gets its key. */
  private async uploadParts(path: string, body: Buffer, partBytes: number): Promise<unknown> {
    const count = Math.ceil(body.byteLength / partBytes);
    const begun = this.expect(
      await this.request('POST', path + '/parts', Buffer.from('{}'), true),
      [200, 201],
      'Multipart upload',
    );
    if (record(begun) && begun.verified === true) return begun; // verified since the operation listed it
    if (
      !record(begun) ||
      typeof begun.upload_id !== 'string' ||
      !begun.upload_id ||
      begun.part_bytes !== partBytes ||
      begun.parts !== count
    )
      throw new ReleaseError(2, 'Multipart upload response does not match the object');
    const query = '?upload_id=' + encodeURIComponent(begun.upload_id);
    const parts: { part: number; etag: string }[] = [];
    for (let part = 1; part <= count; part++) {
      const chunk = body.subarray((part - 1) * partBytes, part * partBytes);
      const stored = this.expect(
        await this.request('PUT', `${path}/parts/${part}${query}`, chunk, true),
        [200],
        'Object part upload',
      );
      if (
        !record(stored) ||
        stored.part !== part ||
        typeof stored.etag !== 'string' ||
        !stored.etag
      )
        throw new ReleaseError(2, 'Server did not store the object part');
      parts.push({ part, etag: stored.etag });
    }
    const complete = Buffer.from(JSON.stringify({ upload_id: begun.upload_id, parts }));
    return this.expect(
      await this.request('POST', path + '/parts/complete', complete, true),
      [200],
      'Object upload',
    );
  }
  async publish(options: PublishOptions) {
    const pkg = await this.preflight(options);
    if (options.dryRun) return this.dryChange(pkg.releaseId, options.expectedRevision);
    return this.change(pkg.releaseId, 'publish', options.expectedRevision, pkg);
  }
  async rollback(options: RollbackOptions) {
    if (!SHA256.test(options.releaseId))
      throw new ReleaseError(2, 'Rollback release ID must be SHA-256');
    if (options.dryRun) return this.dryChange(options.releaseId, options.expectedRevision);
    return this.change(options.releaseId, 'rollback', options.expectedRevision);
  }
  private async dryChange(rid: string, expected?: number) {
    const current = await this.current();
    if (expected !== undefined && (!revision(expected) || expected !== current.revision))
      throw new ReleaseError(5, 'Expected revision differs from the current release');
    return {
      environment: this.environment.name,
      release_id: rid,
      expected_revision: expected ?? current.revision,
      dryRun: true,
    };
  }
  private async change(rid: string, kind: ChangeKind, expected?: number, pkg?: ReleasePackage) {
    if (expected !== undefined && (!revision(expected) || expected === Number.MAX_SAFE_INTEGER))
      throw new ReleaseError(
        2,
        'Expected revision must be a nonnegative safe integer with a successor',
      );
    return this.receipts.locked(rid, async () => {
      const receipt = await this.receipts.load(rid);
      const latest = [...receipt.requests].reverse().find((r) => r.kind === kind);
      let intent =
        expected !== undefined
          ? receipt.requests.find((r) => r.kind === kind && r.expected_revision === expected)
          : latest && (latest.state !== 'applied' || !latest.confirmed)
            ? latest
            : undefined;
      if (!intent) {
        const current = await this.current();
        if (expected === undefined)
          intent = [...receipt.requests]
            .reverse()
            .find(
              (r) =>
                r.kind === kind &&
                r.result?.revision === current.revision &&
                current.release_id === rid,
            );
        if (!intent) {
          if (expected !== undefined && expected !== current.revision)
            throw new ReleaseError(5, 'Expected revision differs from the current release');
          if (current.release_id === rid)
            throw new ReleaseError(
              5,
              'Release is already current without a matching saved request',
            );
          intent = {
            kind,
            expected_revision: expected ?? current.revision,
            request_id: randomUUID(),
            state: 'pending',
          };
          receipt.requests.push(intent);
          await this.receipts.save(receipt);
        }
      }
      if (intent.state === 'conflict')
        throw new ReleaseError(
          5,
          'Saved request conflicted; inspect status and explicitly supply a new expected revision',
        );
      let done = intent.result;
      if (!done) {
        // Always consult the primary journal first, including after a process restart.
        const lookup = await this.request(
          'GET',
          '/admin/requests/' + intent.request_id,
          undefined,
          true,
        );
        if (lookup.status === 200)
          done = { ...parsePublishResult(parseJson(lookup.body), rid, intent), replay: true };
        else {
          this.expect(lookup, [404], 'Request lookup');
          if (pkg) await this.uploadPackage(pkg, receipt);
          const body = Buffer.from(
            JSON.stringify({
              release_id: rid,
              expected_revision: intent.expected_revision,
              request_id: intent.request_id,
              kind,
            }),
          );
          let response: HttpResponse;
          try {
            response = await this.request('POST', '/admin/publish', body, true, false);
          } catch (error) {
            if (!(error instanceof ReleaseError) || error.code !== 3) throw error;
            response = await this.lostPublish(intent);
          }
          if ([408, 429, 500, 502, 503, 504].includes(response.status))
            response = await this.lostPublish(intent);
          if (response.status === 409) {
            intent.state = 'conflict';
            await this.receipts.save(receipt);
            throw new ReleaseError(
              5,
              'Revision conflict or rollback target was never current; pointer was not overwritten',
              409,
            );
          }
          done = parsePublishResult(this.expect(response, [200], 'Publish'), rid, intent);
        }
        intent.state = 'applied';
        intent.result = done;
        await this.receipts.save(receipt);
      } else done = { ...done, replay: true };
      try {
        const manifest = pkg?.manifest ?? (await this.remoteManifest(rid));
        await this.readBack(rid, done.revision, manifest);
      } catch {
        throw new ReleaseError(
          6,
          'Pointer change is journaled but public readback is unconfirmed; retry the saved request',
        );
      }
      intent.confirmed = true;
      await this.receipts.save(receipt);
      return {
        environment: this.environment.name,
        ...done,
        receipt: this.receipts.path(rid),
        readback: 'verified' as const,
      };
    });
  }
  private async lostPublish(intent: ChangeReceipt) {
    try {
      const response = await this.request(
        'GET',
        '/admin/requests/' + intent.request_id,
        undefined,
        true,
      );
      if (response.status === 200) return response;
    } catch {
      /* Outcome is uncertain; keep the exact request in its receipt. */
    }
    throw new ReleaseError(
      6,
      'Publish reply was lost and the journal did not confirm it; retry the same command and receipt',
    );
  }
  private async remoteManifest(rid: string) {
    const response = await this.request('GET', `/data/releases/${rid}/manifest.json`);
    if (response.status !== 200 || sha256(response.body) !== rid)
      throw new ReleaseError(6, 'Published manifest SHA-256 does not match release ID');
    return parseManifest(response.body, this.limit);
  }
  /** Pointer + authenticated manifest bytes + one output, all from this environment. */
  async readBack(rid: string, expectedRevision: number, localManifest?: ReleaseManifest) {
    if (!SHA256.test(rid) || !revision(expectedRevision))
      throw new ReleaseError(2, 'Invalid readback identity');
    const current = await this.current();
    if (current.release_id !== rid || current.revision !== expectedRevision)
      throw new ReleaseError(6, 'Public pointer differs from the applied request');
    const manifest = await this.remoteManifest(rid);
    if (localManifest && canonicalIdentity(localManifest) !== canonicalIdentity(manifest))
      throw new ReleaseError(6, 'Public manifest differs from the local package');
    const output = manifest.outputs.find((o) => o.path.startsWith('data/')) ?? manifest.outputs[0]!;
    const response = await this.request(
      'GET',
      `/data/releases/${rid}/${fileUrlPath(output)}`,
      undefined,
      false,
      true,
      this.limit,
    );
    if (
      response.status !== 200 ||
      response.body.byteLength !== output.bytes ||
      sha256(response.body) !== output.sha256
    )
      throw new ReleaseError(6, 'Published output bytes do not match the manifest');
    const after = await this.current();
    if (after.release_id !== rid || after.revision !== expectedRevision)
      throw new ReleaseError(6, 'Public pointer moved during readback');
    return current;
  }
}
const canonicalIdentity = (manifest: ReleaseManifest) => JSON.stringify(manifest);
