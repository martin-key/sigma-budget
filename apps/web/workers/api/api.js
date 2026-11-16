// Public metadata always names the release packaged with the site.
export async function publicApi(request, env, url) {
  const invalid = (name, max) => {
    const values = url.searchParams.getAll(name);
    if (!values.length) return false;
    const n = Number(values[0]);
    return (
      values.length !== 1 ||
      !/^\d+$/.test(values[0]) ||
      !Number.isSafeInteger(n) ||
      n < 1 ||
      n > max
    );
  };
  try {
    decodeURIComponent(url.pathname);
  } catch {
    return Response.json(
      { error: 'malformed path encoding' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (invalid('limit', 100) || invalid('before', Number.MAX_SAFE_INTEGER))
    return Response.json(
      { error: 'limit must be an integer from 1 to 100; before must be a positive safe integer' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  if (url.pathname !== '/api/releases/current')
    return Response.json(
      { error: 'not found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  const asset = await env.ASSETS.fetch(new Request(new URL('/data/releases/current.json', url)));
  if (!asset.ok) return asset;
  const pointer = await asset.json();
  return Response.json(
    { ...pointer, manifest: `/data/releases/${pointer.release_id}/manifest.json` },
    {
      headers: { 'Cache-Control': 'no-store', 'X-Release-Id': pointer.release_id },
    },
  );
}
