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
