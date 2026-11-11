import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { bundledFeed } from './feed';

it('serves working RSS links from bundled data and preserves archived bytes', async () => {
  const archived =
    '<rss><link>https://budget-na-svetlo.example/#/novo</link><guid>https://budget-na-svetlo.example/izpalnenie</guid></rss>';
  const fetch = vi.fn(async (request: Request) => {
    expect(request.method).toBe('GET');
    expect(request.headers.has('If-None-Match')).toBe(false);
    expect(request.headers.has('Range')).toBe(false);
    return new Response(archived);
  });
  const assets = { fetch } as unknown as Pick<Fetcher, 'fetch'>;
  const origin = 'https://sigma-budget-dev.cf-midt.workers.dev';
  const url = origin + '/data/feed.xml';
  const response = await bundledFeed(new Request(url), assets, origin, 'release-id');
  const text = await response.text();
  expect(text).toBe(`<rss><link>${origin}/novo</link><guid>${origin}/izpalnenie</guid></rss>`);
  expect(archived).toContain('budget-na-svetlo.example');
  expect(response.headers.get('X-Release-Id')).toBe('release-id');
  const tag = '"' + createHash('sha256').update(text).digest('hex') + '"';
  expect(response.headers.get('ETag')).toBe(tag);
  for (const value of [tag, 'W/' + tag]) {
    const conditional = await bundledFeed(
      new Request(url, { headers: { 'If-None-Match': value } }),
      assets,
      origin,
      'release-id',
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe('');
  }
  const head = await bundledFeed(
    new Request(url, { method: 'HEAD' }),
    assets,
    origin,
    'release-id',
  );
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(head.headers.get('ETag')).toBe(tag);
});
