import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { gunzipSync } from 'node:zlib';

export interface SourceRequest {
  url: string;
  signal: AbortSignal;
  headers: Record<string, string>;
}
export interface SourceResponse {
  status: number;
  headers?: Record<string, string | undefined>;
  body: Uint8Array | AsyncIterable<Uint8Array>;
}
export type SourceTransport = (request: SourceRequest) => Promise<SourceResponse>;
/** Public sources only: no auth, cookies, environment credentials or automatic redirects/decompression. */
export const nodeSourceTransport: SourceTransport = ({ url, signal, headers }) =>
  new Promise((done, fail) => {
    const req = (url.startsWith('https:') ? httpsRequest : httpRequest)(
      url,
      { signal, headers },
      (res) => {
        const responseHeaders: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(res.headers))
          responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
        done({ status: res.statusCode ?? 0, headers: responseHeaders, body: res });
      },
    );
    req.on('error', fail);
    req.end();
  });
export interface FetchOptions {
  transport?: SourceTransport;
  attempts?: number;
  timeoutMs?: number;
  maxBytes?: number;
  maxDecodedBytes?: number;
  /** Exact additional public URLs permitted as redirects. Every hop is checked. */
  allowedRedirects?: string[];
  allowLocalHttp?: boolean;
}
export interface Download {
  bytes: Buffer;
  wire: Buffer;
  url: string;
  status: number;
  encoding: string;
  attempts: number;
}
export function publicUrl(value: string, allowLocalHttp = false): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        allowLocalHttp &&
        url.protocol === 'http:' &&
        ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      ))
  )
    throw new Error('Expected a public HTTPS URL (or explicitly allowed loopback HTTP)');
  for (const key of url.searchParams.keys())
    if (/^(access[_-]?token|api[_-]?key|password|secret|authorization|token)$/i.test(key))
      throw new Error('Credential query parameters are not supported');
  return url.href;
}
class FetchFailure extends Error {
  constructor(
    message: string,
    readonly retry = false,
  ) {
    super(message);
  }
}
function limit(value: number | undefined, fallback: number, maximum: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n <= 0 || n > maximum)
    throw new Error('Invalid acquisition limit');
  return n;
}
export async function download(
  url: string,
  options: FetchOptions,
  validate: (bytes: Buffer) => void,
): Promise<Download> {
  const initial = publicUrl(url, options.allowLocalHttp);
  const allowed = new Set([
    initial,
    ...(options.allowedRedirects ?? []).map((u) => publicUrl(u, options.allowLocalHttp)),
  ]);
  const attempts = limit(options.attempts, 3, 5),
    timeout = limit(options.timeoutMs, 30_000, 30_000);
  const max = limit(options.maxBytes, 256 * 1024 * 1024, 1024 * 1024 * 1024);
  const maxDecoded = limit(options.maxDecodedBytes, max, 1024 * 1024 * 1024);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new FetchFailure('Acquisition deadline exceeded', true));
      }, timeout);
    });
    const once = async (): Promise<Download> => {
      let target = initial;
      for (let hop = 0; hop <= 3; hop++) {
        if (!allowed.has(target)) throw new FetchFailure('Redirect URL is not allowlisted');
        const res = await (options.transport ?? nodeSourceTransport)({
          url: target,
          signal: controller.signal,
          headers: {
            'User-Agent':
              'budget-na-svetlo-data-pipeline/1.0 (+public data; contact: working group)',
            'Accept-Encoding': 'identity',
          },
        });
        const headers = Object.fromEntries(
          Object.entries(res.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
        );
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          controller.signal.throwIfAborted();
          if (!headers.location || hop === 3)
            throw new FetchFailure('Invalid or excessive redirect');
          target = publicUrl(new URL(headers.location, target).href, options.allowLocalHttp);
          // Destroy/cancel an unconsumed HTTP stream; never read a redirect/login body.
          if (!(res.body instanceof Uint8Array)) {
            const iterator = res.body[Symbol.asyncIterator]();
            await iterator.return?.();
          }
          continue;
        }
        if (res.status !== 200) {
          if (!(res.body instanceof Uint8Array)) await res.body[Symbol.asyncIterator]().return?.();
          throw new FetchFailure(
            'HTTP ' + res.status,
            [408, 429, 500, 502, 503, 504].includes(res.status),
          );
        }
        if (
          headers['content-length'] &&
          (!/^\d+$/.test(headers['content-length']) || Number(headers['content-length']) > max)
        )
          throw new FetchFailure('HTTP body exceeds byte limit');
        const parts: Buffer[] = [];
        let size = 0;
        const stream = res.body instanceof Uint8Array ? [res.body] : res.body;
        for await (const part of stream) {
          controller.signal.throwIfAborted();
          size += part.length;
          if (size > max) throw new FetchFailure('HTTP body exceeds byte limit');
          parts.push(Buffer.from(part));
        }
        const wire = Buffer.concat(parts);
        if (headers['content-length'] && Number(headers['content-length']) !== wire.length)
          throw new FetchFailure('HTTP content length does not match received bytes', true);
        const encoding = (headers['content-encoding'] ?? 'identity').trim().toLowerCase();
        if (!['identity', 'gzip'].includes(encoding))
          throw new FetchFailure('Unsupported content encoding');
        let bytes: Buffer;
        try {
          bytes = encoding === 'gzip' ? gunzipSync(wire, { maxOutputLength: maxDecoded }) : wire;
        } catch {
          throw new FetchFailure('Invalid or oversized gzip response');
        }
        if (bytes.length > maxDecoded) throw new FetchFailure('Decoded body exceeds byte limit');
        try {
          validate(bytes);
        } catch (e) {
          throw new FetchFailure(e instanceof Error ? e.message : 'Invalid source bytes', true);
        }
        return { bytes, wire, url: target, status: res.status, encoding, attempts: attempt };
      }
      throw new FetchFailure('Excessive redirect');
    };
    try {
      return await Promise.race([once(), timeoutPromise]);
    } catch (e) {
      if (e instanceof FetchFailure && (!e.retry || attempt === attempts)) throw e;
      if (attempt === attempts)
        throw new Error('Source transport failed after ' + attempt + ' attempt(s)');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  throw new Error('Acquisition attempts exhausted');
}
