import { ReleaseError, type HttpTransport, type ReleaseEnvironment } from './types.js';
export function releaseEnvironment(input: ReleaseEnvironment): Readonly<ReleaseEnvironment> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new ReleaseError(2, 'An explicit environment origin is required');
  }
  if (
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(input.name) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new ReleaseError(
      2,
      'Environment requires a name and HTTPS origin (HTTP only on loopback)',
    );
  return Object.freeze({ name: input.name, url: url.origin });
}
/** Redirects are never followed, including on public requests. Bounds decoded response bytes. */
export const nodeHttpTransport: HttpTransport = async (request) => {
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > request.maxResponseBytes) {
            await reader.cancel();
            throw new ReleaseError(3, 'HTTP response exceeds the configured byte limit');
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    return { status: response.status, body: Buffer.concat(chunks, length) };
  } catch {
    throw new ReleaseError(3, 'HTTP transport failed or response exceeded its limit');
  }
};
