import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../release-data', async () => {
  const { diskRelease } = await import('./disk-release');
  return { releaseData: vi.fn(async () => diskRelease()) };
});
import { releaseData } from '../release-data';
import { rateLimitMcp } from '../release-rate-limit';
import { mcp, INSTRUCTIONS, MAX_BODY, PROTOCOL_VERSIONS } from './handler';

const URL_ = 'https://budget.example/mcp';
const local = { ENVIRONMENT: 'local' } as Env;
function post(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: raw ?? JSON.stringify(body),
  });
}
const send = (req: Request, env: Env = local) => mcp(req, env, new URL(req.url));
const rpc = (method: string, params?: unknown, id: unknown = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the protocol', () => {
  it('initializes with the asked version, a session and the instructions', async () => {
    const res = await send(post(rpc('initialize', { protocolVersion: '2025-06-18' })));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Mcp-Session-Id')).toMatch(/^[0-9a-f]{32}$/);
    const { result } = (await res.json()) as { result: Record<string, any> };
    expect(result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'sigma-budget', title: 'СИГМА Бюджет' },
      instructions: INSTRUCTIONS,
    });
    expect(INSTRUCTIONS).toMatch(/не ги замествай с нула/);
  });
  it('answers an unknown version with the newest one and keeps a valid session', async () => {
    const session = 'a'.repeat(32);
    const res = await send(
      post(rpc('initialize', { protocolVersion: '1999-01-01' }), { 'Mcp-Session-Id': session }),
    );
    expect(res.headers.get('Mcp-Session-Id')).toBe(session);
    expect(((await res.json()) as any).result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    const other = await send(post(rpc('initialize'), { 'Mcp-Session-Id': 'not-ours' }));
    expect(other.headers.get('Mcp-Session-Id')).toMatch(/^[0-9a-f]{32}$/);
  });
  it('accepts notifications and responses without an answer', async () => {
    for (const body of [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 7, result: {} },
    ]) {
      const res = await send(post(body));
      expect(res.status).toBe(202);
      expect(await res.text()).toBe('');
    }
  });
  it('pings and lists the tools', async () => {
    expect(await (await send(post(rpc('ping', undefined, 'p')))).json()).toEqual({
      jsonrpc: '2.0',
      id: 'p',
      result: {},
    });
    const list = (await (await send(post(rpc('tools/list')))).json()) as any;
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('get_data');
  });
  it('calls a tool on the release of the request', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await send(
      post(rpc('tools/call', { name: 'search', arguments: { query: 'тайна-заявка-42 ДДС' } })),
    );
    expect(res.headers.get('X-Release-Id')).toBe('disk');
    const { result } = (await res.json()) as any;
    expect(result.isError).toBeUndefined();
    expect(Array.isArray(result.structuredContent.results)).toBe(true);
    expect(log).toHaveBeenCalledWith(
      'mcp_tool',
      'search',
      'ok',
      expect.any(Number),
      expect.any(Number),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('тайна-заявка-42');
    const none = await send(post(rpc('tools/call', { name: 'about_data' })));
    expect(((await none.json()) as any).result.structuredContent.release_id).toBe('disk');
  });
  it('says the data cannot be read when the release cannot', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(releaseData).mockRejectedValueOnce(new Error('D1 down'));
    const res = await send(post(rpc('tools/call', { name: 'about_data', arguments: {} })));
    const { result } = (await res.json()) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/не могат да бъдат прочетени/);
    expect(error).toHaveBeenCalledWith('mcp_release_unavailable', 'Error');
  });
  it('refuses an unknown tool, method or argument shape', async () => {
    const error = async (body: unknown) => ((await (await send(post(body))).json()) as any).error;
    expect(await error(rpc('tools/call', { name: 'delete_all' }))).toMatchObject({ code: -32602 });
    expect(await error(rpc('tools/call', { name: 'search', arguments: [1] }))).toMatchObject({
      code: -32602,
    });
    expect(await error(rpc('resources/list'))).toMatchObject({ code: -32601 });
  });
  it('refuses what is not one JSON-RPC request', async () => {
    const status = async (req: Request) => {
      const res = await send(req);
      return [res.status, ((await res.json()) as any).error.code];
    };
    expect(await status(post(null, {}, '{'))).toEqual([400, -32700]);
    expect(
      await status(
        new Request(URL_, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: new Uint8Array([0xff]),
        }),
      ),
    ).toEqual([400, -32700]);
    expect(await status(post([rpc('ping')]))).toEqual([400, -32600]);
    expect(await status(post({ id: 1, method: 'ping' }))).toEqual([400, -32600]);
    expect(await status(post({ jsonrpc: '2.0', id: {}, method: 'ping' }))).toEqual([400, -32600]);
    expect(await status(post({ jsonrpc: '2.0', id: 1 }))).toEqual([400, -32600]);
    expect(await status(post(rpc('ping'), { 'Content-Type': 'text/plain' }))).toEqual([
      415, -32600,
    ]);
    expect(await status(post(rpc('ping'), { 'MCP-Protocol-Version': '2024-01-01' }))).toEqual([
      400, -32600,
    ]);
    expect(await status(post(rpc('ping'), { 'Content-Length': String(MAX_BODY + 1) }))).toEqual([
      413, -32600,
    ]);
    expect(await status(post(null, {}, JSON.stringify({ pad: 'x'.repeat(MAX_BODY) })))).toEqual([
      413, -32600,
    ]);
  });
  it('takes only POST', async () => {
    for (const method of ['GET', 'DELETE', 'PUT', 'HEAD', 'OPTIONS']) {
      const res = await send(new Request(URL_, { method }));
      expect(res.status, method).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
    }
  });
});

describe('the rate limit', () => {
  const limiter = (success: boolean) => {
    const limit = vi.fn(async () => ({ success }));
    return {
      limit,
      env: { ENVIRONMENT: 'production', RELEASE_RATE_LIMITER: { limit } } as unknown as Env,
    };
  };
  it('keys a client by its session, else by its address', async () => {
    const { limit, env } = limiter(true);
    const req = new Request(URL_, { headers: { 'CF-Connecting-IP': '192.0.2.1' } });
    expect(await rateLimitMcp(req, env, 'b'.repeat(32))).toBeNull();
    expect(await rateLimitMcp(req, env, null)).toBeNull();
    expect(await rateLimitMcp(new Request(URL_), env, null)).toBeNull();
    expect(limit.mock.calls.map((c) => (c as unknown as [{ key: string }])[0].key)).toEqual([
      'mcp:' + 'b'.repeat(32),
      'mcp:192.0.2.1',
      'mcp:unknown-client',
    ]);
  });
  it('answers 429 over the limit, before reading the body', async () => {
    const { env } = limiter(false);
    const res = await send(post(rpc('ping')), env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(((await res.json()) as any).error.code).toBe(-32000);
  });
  it('fails closed in production and open elsewhere', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = { limit: async () => Promise.reject(new Error('down')) };
    const req = new Request(URL_);
    expect(await rateLimitMcp(req, { ENVIRONMENT: 'production' } as Env, null)).toBe(503);
    expect(await rateLimitMcp(req, local, null)).toBeNull();
    expect(
      await rateLimitMcp(
        req,
        { ENVIRONMENT: 'production', RELEASE_RATE_LIMITER: broken } as unknown as Env,
        null,
      ),
    ).toBe(503);
    expect(
      await rateLimitMcp(
        req,
        { ENVIRONMENT: 'staging', RELEASE_RATE_LIMITER: broken } as unknown as Env,
        null,
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith('release_rate_limit_unavailable');
    const res = await send(post(rpc('ping')), { ENVIRONMENT: 'production' } as Env);
    expect(res.status).toBe(503);
  });
});
