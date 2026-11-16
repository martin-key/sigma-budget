/** Same per-client platform mechanism as СИГМА. Missing/error binding fails open locally,
 * but fails closed in production so an operator configuration gap cannot expose expensive reads. */
let warnedMissing = false;
export async function rateLimitReleaseRead(
  request: Request,
  env: Pick<Env, 'RELEASE_RATE_LIMITER' | 'ENVIRONMENT'>,
): Promise<Response | null> {
  let status = 503;
  if (!env.RELEASE_RATE_LIMITER) {
    if (!warnedMissing) {
      console.warn('release_rate_limit_missing_binding');
      warnedMissing = true;
    }
    if (env.ENVIRONMENT !== 'production') return null;
  } else {
    try {
      if (
        (
          await env.RELEASE_RATE_LIMITER.limit({
            // Stable across versions and host aliases; environments use separate namespaces.
            key: request.headers.get('CF-Connecting-IP')?.trim() || 'unknown-client',
          })
        ).success
      )
        return null;
      status = 429;
    } catch {
      console.warn('release_rate_limit_unavailable');
      if (env.ENVIRONMENT !== 'production') return null;
    }
  }
  return Response.json(
    { error: status === 429 ? 'too many release requests' : 'rate limiting unavailable' },
    {
      status,
      headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
    },
  );
}

/** MCP calls (apps/web/workers/mcp/handler.ts) are limited twice. First the address, on its own binding MCP_RATE_LIMITER with a higher ceiling:
 * the assistants call from a few shared addresses of their providers, so the ceiling is per address and not per person. Then the session
 * the server gave the client (else the address) on RELEASE_RATE_LIMITER: the share of one conversation. A session is not verified, so a
 * client that makes up a new one for every call gets new session buckets but stays under the ceiling of its address. Like release reads,
 * a missing or failing binding fails closed in production (the tools read the registry). Returns the status to answer with, or null. */
export async function rateLimitMcp(
  request: Request,
  env: Pick<Env, 'RELEASE_RATE_LIMITER' | 'MCP_RATE_LIMITER' | 'ENVIRONMENT'>,
  session: string | null,
): Promise<429 | 503 | null> {
  const closed = env.ENVIRONMENT === 'production' ? 503 : null;
  const address = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown-client';
  for (const [binding, key] of [
    [env.MCP_RATE_LIMITER, 'mcp:' + address],
    [env.RELEASE_RATE_LIMITER, 'mcp:' + (session || address)],
  ] as const) {
    if (!binding) {
      if (closed) return closed;
      continue;
    }
    try {
      if (!(await binding.limit({ key })).success) return 429;
    } catch {
      console.warn('release_rate_limit_unavailable');
      if (closed) return closed;
    }
  }
  return null;
}

/** Uncached screen renders use the same per-client limiter under their own key, so a burst of new search
 * addresses cannot keep the renderer busy. Unlike release reads it fails open: a missing or failing binding
 * never takes the public pages down (the per-isolate render cap still applies). */
export async function rateLimitRender(
  request: Request,
  env: Pick<Env, 'RELEASE_RATE_LIMITER'>,
): Promise<Response | null> {
  if (!env.RELEASE_RATE_LIMITER) return null;
  try {
    const client = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown-client';
    if ((await env.RELEASE_RATE_LIMITER.limit({ key: 'render:' + client })).success) return null;
  } catch {
    return null;
  }
  return new Response('Твърде много заявки. Опитайте отново след минута.\n', {
    status: 429,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Retry-After': '60',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
