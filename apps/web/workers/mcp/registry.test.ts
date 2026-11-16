// explain_number with a registry: the record is checked by the public API against the manifest of the release
// (apps/web/workers/api/api.js provenance); tests/release/release_check.py runs the same call against local D1 and R2.
import { expect, it, vi } from 'vitest';
vi.mock('../api/api.js', () => ({ publicApi: vi.fn() }));
import { publicApi } from '../api/api.js';
import { call } from './tools';
import { diskCtx, diskRelease, ORIGIN } from './disk-release';

const RID = 'f'.repeat(64);
const ctx = diskCtx(diskRelease({ releaseId: RID, dataBase: `/data/releases/${RID}/data/` }));
const answer = (status: number, body: unknown) =>
  vi.mocked(publicApi).mockResolvedValueOnce(Response.json(body, { status }));

it('asks the public API and links the original on the site', async () => {
  answer(200, {
    release_id: RID,
    record: 'data/2026-09/kfp/rev',
    value: '33898.456',
    cell: 'B11',
    original: { download: `/data/releases/${RID}/originals/x.xls`, sha256: 'a'.repeat(64) },
  });
  const res = await call(ctx, 'explain_number', { record: 'data/2026-09/kfp/rev' });
  expect(res.structuredContent).toMatchObject({
    verified: true,
    cell: 'B11',
    original: { download: `${ORIGIN}/data/releases/${RID}/originals/x.xls` },
  });
  const [req, , url] = vi.mocked(publicApi).mock.calls[0]!;
  expect((req as Request).url).toBe(
    `${ORIGIN}/api/releases/${RID}/provenance/data/2026-09/kfp/rev`,
  );
  expect(String(url)).toBe((req as Request).url);
});

it('passes on what the API says is not there, and fails on an outage', async () => {
  answer(200, { release_id: RID, record: 'monthly/2026-09/kfp/rev', value: '3780.7' });
  expect(
    (await call(ctx, 'explain_number', { record: 'monthly/2026-09/kfp/rev' })).structuredContent,
  ).toMatchObject({ verified: true, value: '3780.7' });
  answer(404, { error: 'no such value in execution.json of this release' });
  const missing = await call(ctx, 'explain_number', { record: 'data/2026-12/kfp/rev' });
  expect(missing).toMatchObject({
    isError: true,
    content: [{ text: 'no such value in execution.json of this release' }],
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  answer(503, { error: 'this environment has no release registry yet' });
  const down = await call(ctx, 'explain_number', { record: 'data/2026-09/kfp/rev' });
  expect(down.content[0]!.text).toMatch(/не могат да бъдат прочетени/);
});
