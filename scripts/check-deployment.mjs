// Public GET only: never receives Cloudflare credentials. Allow DNS/certificate propagation after deploy.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';

export async function checkDeployment(
  origin,
  releaseId,
  {
    fetchSite = fetch,
    now = Date.now,
    wait = setTimeout,
    timeoutMs = 180_000,
    intervalMs = 5_000,
  } = {},
) {
  const url = new URL('/', origin);
  const deadline = now() + timeoutMs;
  let last = 'no response';
  while (now() < deadline) {
    try {
      const response = await fetchSite(url, {
        redirect: 'error',
        headers: { 'User-Agent': 'deployment-check', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - now()))),
      });
      const actual = response.headers.get('X-Release-Id');
      await response.body?.cancel();
      if (response.status === 200 && actual === releaseId) {
        console.log(`Deployed site verified: ${url} (X-Release-Id: ${releaseId})`);
        return;
      }
      last = `HTTP ${response.status}, X-Release-Id: ${actual ?? '<missing>'}`;
    } catch (error) {
      last = error?.cause?.code ?? error.message;
    }
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(intervalMs, remaining));
  }
  throw new Error(
    `Deployed site verification failed for ${url}: expected HTTP 200 and X-Release-Id ${releaseId}; ${last}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { origin: { type: 'string' } } });
    if (!values.origin) throw new Error('--origin is required');
    const { release_id: releaseId } = JSON.parse(
      readFileSync(new URL('../data/release/releases/current.json', import.meta.url), 'utf8'),
    );
    await checkDeployment(values.origin, releaseId);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
