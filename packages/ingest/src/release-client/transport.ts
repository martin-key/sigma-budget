import {
  ReleaseError,
  type AccessCredentials,
  type CredentialProvider,
  type HttpTransport,
  type ReleaseEnvironment,
} from './types.js';

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
/** Only the supplied map is read. No files, home authentication or account token. */
export function credentialsFromEnvironment(
  values: Readonly<Record<string, string | undefined>>,
): AccessCredentials {
  const clientId = values.CF_ACCESS_CLIENT_ID,
    clientSecret = values.CF_ACCESS_CLIENT_SECRET;
  if (clientId || clientSecret) {
    if (!clientId || !clientSecret)
      throw new ReleaseError(4, 'Both Access service credentials are required');
    return { clientId, clientSecret };
  }
  if (!values.BUDGET_ACCESS_TOKEN)
    throw new ReleaseError(
      4,
      'Provide a protected Access identity token or service credential pair',
    );
  return { accessToken: values.BUDGET_ACCESS_TOKEN };
}
export async function credentialHeaders(
  provider: CredentialProvider | undefined,
  environment: Readonly<ReleaseEnvironment>,
): Promise<Record<string, string>> {
  if (!provider) throw new ReleaseError(4, 'No operator credential provider');
  try {
    const creds = await provider(environment);
    const valid = (v: unknown): v is string =>
      typeof v === 'string' && v.length > 0 && !/[\r\n\0]/.test(v);
    if (valid(creds.accessToken) && !creds.clientId && !creds.clientSecret)
      return { 'Cf-Access-Token': creds.accessToken, 'Cf-Access-Jwt-Assertion': creds.accessToken };
    if (valid(creds.clientId) && valid(creds.clientSecret) && !creds.accessToken)
      return {
        'CF-Access-Client-Id': creds.clientId,
        'CF-Access-Client-Secret': creds.clientSecret,
      };
  } catch {
    /* Provider errors may contain secrets. */
  }
  throw new ReleaseError(4, 'Cannot obtain valid operator credentials');
}
/** Redirects are never followed, including on public requests. Bounds decoded response bytes. */
export const nodeHttpTransport: HttpTransport = async (request) => {
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body ? Buffer.from(request.body) : undefined,
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
