import { dirname, resolve } from 'node:path';
import { type SourceClient, driftMarkdown } from './client.js';
import { exists, guardOutput, immutable, jsonBytes, readBounded, sha256 } from './files.js';

export interface DriftDecision {
  source: string;
  path: string;
  sha256: string;
  decision: 'accept-candidate' | 'preserve-historical' | 'reject';
  reason: string;
}
export interface DriftReview {
  schema: 'source-drift-review/1';
  snapshotSha256: string;
  reviewer: string;
  decisions: DriftDecision[];
}
export async function inspectDrift(
  client: SourceClient,
  options: {
    snapshotPath: string;
    reviewPath?: string;
    reportPath?: string;
    summaryPath?: string;
  },
) {
  const protectedPaths = [
    ...client.protectedPaths,
    dirname(resolve(options.snapshotPath)),
    ...(options.reviewPath ? [options.reviewPath] : []),
  ];
  for (const output of [options.reportPath, options.summaryPath].filter((p): p is string => !!p)) {
    await guardOutput(output, protectedPaths);
    if (await exists(output)) throw new Error('Drift output already exists');
  }
  if (options.reportPath && options.summaryPath)
    await guardOutput(options.reportPath, [options.summaryPath]);
  const snapshot = await client.readSnapshot(options.snapshotPath);
  const snapshotSha256 = sha256(await readBounded(options.snapshotPath, 32 * 1024 * 1024));
  const candidates = snapshot.collected.filter((r) => r.status === 'ok' && r.drift !== 'same');
  let review: DriftReview | undefined;
  if (options.reviewPath) {
    review = JSON.parse(
      (await readBounded(options.reviewPath, 8 * 1024 * 1024)).toString('utf8'),
    ) as DriftReview;
    if (
      review.schema !== 'source-drift-review/1' ||
      review.snapshotSha256 !== snapshotSha256 ||
      typeof review.reviewer !== 'string' ||
      !review.reviewer.trim() ||
      !Array.isArray(review.decisions)
    )
      throw new Error('Review must identify this exact snapshot and a reviewer');
    const seen = new Set<string>();
    for (const d of review.decisions) {
      const key = d.source + '\0' + d.path;
      if (
        seen.has(key) ||
        !candidates.some(
          (r) => r.source === d.source && r.path === d.path && r.sha256 === d.sha256,
        ) ||
        !['accept-candidate', 'preserve-historical', 'reject'].includes(d.decision) ||
        typeof d.reason !== 'string' ||
        !d.reason.trim()
      )
        throw new Error('Invalid, duplicate or stale drift decision');
      seen.add(key);
    }
  }
  const sources = candidates.map((row) => ({
    ...row,
    review: review?.decisions.find((d) => d.source === row.source && d.path === row.path) ?? null,
  }));
  const pending = sources.filter((r) => !r.review).length;
  const rejected = sources.filter((r) => r.review?.decision === 'reject').length;
  const unavailable = snapshot.collected.filter((r) => r.status === 'unavailable').length;
  const report = {
    schema: 'source-drift-report/1',
    snapshotSha256,
    identity: client.identity,
    complete: snapshot.complete,
    reviewedAt: client.now(),
    reviewer: review?.reviewer ?? null,
    pending,
    rejected,
    unavailable,
    sources,
    numericalValidation: 'not-run',
    historicalReconstruction: 'unverified',
    pinMutation: false,
    // Approval records intent for the later reader/manifest/validation stage. Never promotion.
    next: 'Bind real readers, validate derived data, then review any registry/pin change separately',
  };
  if (options.reportPath) await immutable(options.reportPath, jsonBytes(report));
  if (options.summaryPath)
    await immutable(
      options.summaryPath,
      Buffer.from(
        driftMarkdown(snapshot) +
          '\n' +
          `Review: ${pending} pending, ${rejected} rejected, ${unavailable} unavailable. Pins unchanged.\n`,
      ),
    );
  return { code: unavailable || !snapshot.complete ? 3 : rejected || pending ? 1 : 0, report };
}
