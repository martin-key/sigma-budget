const PLACEHOLDER = /https?:\/\/budget-na-svetlo\.example\/(?:#\/)?/g;

/** Rebase the public RSS view; the release's archived bytes remain unchanged. */
export async function withFeedOrigin(bytes: ArrayBuffer, origin: string) {
  const text = new TextDecoder()
    .decode(bytes)
    .replace(PLACEHOLDER, origin + '/')
    .split(origin + '/#/')
    .join(origin + '/');
  const out = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', out));
  return {
    bytes: out.buffer as ArrayBuffer,
    tag: [...digest].map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

export async function bundledFeed(
  request: Request,
  assets: Pick<Fetcher, 'fetch'>,
  origin: string,
  releaseId: string,
) {
  // A conditional request or HEAD concerns the rebased view, not the archived
  // asset's ETag/body. Read the complete asset before applying those semantics.
  const inputHeaders = new Headers(request.headers);
  for (const key of ['If-None-Match', 'If-Modified-Since', 'Range', 'If-Range'])
    inputHeaders.delete(key);
  const asset = await assets.fetch(new Request(request.url, { headers: inputHeaders }));
  if (!asset.ok) return asset;
  const view = await withFeedOrigin(await asset.arrayBuffer(), origin);
  const tag = `"${view.tag}"`;
  const headers = new Headers({
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=300, must-revalidate, no-transform',
    ETag: tag,
    'X-Release-Id': releaseId,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });
  const unchanged = (request.headers.get('If-None-Match') || '').replace(/^W\//, '') === tag;
  return new Response(unchanged || request.method === 'HEAD' ? null : view.bytes, {
    status: unchanged ? 304 : 200,
    headers,
  });
}
