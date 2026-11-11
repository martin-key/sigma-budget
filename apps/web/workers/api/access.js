// Cloudflare Access for the operator API (docs/approach-specification.md, section 8.2). Access sits in front of /admin/*, but the Worker
// checks the token itself as well: the same Worker answers on workers.dev and preview addresses, where Access may not be in front.
//   the token: header Cf-Access-Jwt-Assertion (or the cookie CF_Authorization), RS256, signed by a key of the team (ACCESS_ISSUER +
//   /cdn-cgi/access/certs); iss = ACCESS_ISSUER, aud contains ACCESS_AUD, exp in the future, nbf/iat not in the future.
//   the role: a member of the Cloudflare account is not an operator by that alone. OPERATORS (e-mails) and SERVICE_TOKENS (client ids of
//   Access service tokens, for automation) list who may upload and publish in this environment.
// ACCESS_JWKS (a JSON key set) replaces the fetch of the certs: the local checks sign test tokens with a key made for the run.
const SKEW = 60; // seconds of clock difference accepted
let certs = { at: 0, keys: null };

const b64url = (s) =>
  Uint8Array.from(
    atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
const list = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

async function keySet(env) {
  if (env.ACCESS_JWKS) return JSON.parse(env.ACCESS_JWKS).keys;
  if (certs.keys && Date.now() - certs.at < 600000) return certs.keys;
  const res = await fetch(new URL('/cdn-cgi/access/certs', env.ACCESS_ISSUER));
  if (!res.ok) throw new Error('access certs: HTTP ' + res.status);
  certs = { at: Date.now(), keys: (await res.json()).keys };
  return certs.keys;
}

function tokenOf(request) {
  const h = request.headers.get('Cf-Access-Jwt-Assertion');
  if (h) return h;
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie') || '');
  return m ? m[1] : null;
}

/** -> { ok: true, operator, kind } or { ok: false, status, error }. Never logs or returns the token. */
export async function operator(request, env) {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD)
    return {
      ok: false,
      status: 503,
      error: 'the operator API is not configured in this environment',
    };
  const token = tokenOf(request);
  if (!token) return { ok: false, status: 401, error: 'no Access token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, status: 401, error: 'malformed token' };
  let head, claims, signature;
  try {
    head = json(b64url(parts[0]));
    claims = json(b64url(parts[1]));
    signature = b64url(parts[2]);
  } catch {
    return { ok: false, status: 401, error: 'malformed token' };
  }
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (
    !record(head) ||
    !record(claims) ||
    typeof head.kid !== 'string' ||
    !head.kid ||
    typeof claims.iss !== 'string' ||
    !(
      typeof claims.aud === 'string' ||
      (Array.isArray(claims.aud) && claims.aud.every((x) => typeof x === 'string'))
    ) ||
    !Number.isFinite(claims.exp) ||
    ['nbf', 'iat'].some((k) => claims[k] !== undefined && !Number.isFinite(claims[k])) ||
    ['email', 'common_name'].some(
      (k) => claims[k] !== undefined && typeof claims[k] !== 'string',
    ) ||
    parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))
  )
    return { ok: false, status: 401, error: 'malformed token' };
  if (head.alg !== 'RS256') return { ok: false, status: 401, error: 'unexpected algorithm' };
  const jwk = (await keySet(env)).find((k) => k.kid === head.kid);
  if (!jwk) return { ok: false, status: 401, error: 'unknown signing key' };
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  let good;
  try {
    good = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      new TextEncoder().encode(parts[0] + '.' + parts[1]),
    );
  } catch {
    return { ok: false, status: 401, error: 'malformed signature' };
  }
  if (!good) return { ok: false, status: 401, error: 'bad signature' };
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== env.ACCESS_ISSUER) return { ok: false, status: 401, error: 'wrong issuer' };
  if (!aud.includes(env.ACCESS_AUD)) return { ok: false, status: 401, error: 'wrong audience' };
  if (!(claims.exp > now - SKEW)) return { ok: false, status: 401, error: 'expired' };
  if ((claims.nbf && claims.nbf > now + SKEW) || (claims.iat && claims.iat > now + SKEW))
    return { ok: false, status: 401, error: 'not valid yet' };
  if (claims.email && list(env.OPERATORS).includes(String(claims.email).toLowerCase()))
    return { ok: true, operator: String(claims.email).toLowerCase(), kind: 'person' };
  if (
    claims.common_name &&
    list(env.SERVICE_TOKENS).includes(String(claims.common_name).toLowerCase())
  )
    return { ok: true, operator: 'service:' + claims.common_name, kind: 'service' };
  return { ok: false, status: 403, error: 'not an operator of this environment' };
}

/** the public journal names a role and a stable pseudonym, never the operator */
export async function pseudonym(operatorId) {
  const d = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sigma-budget:' + operatorId)),
  );
  return 'operator-' + [...d.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
