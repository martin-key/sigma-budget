import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { download, publicUrl } from './transport.js';
import { validateBytes } from './formats.js';
const url = 'https://finite.example.test/file';
const valid = Buffer.from('{"ok":true}');
const validate = (b: Buffer) => {
  validateBytes('file.json', b);
};
describe('bounded public-source transport', () => {
  it.each([401, 403, 404, 400, 204])('does not retry permanent HTTP %s', async (status) => {
    let calls = 0;
    await expect(
      download(
        url,
        {
          transport: async () => {
            calls++;
            return { status, body: valid };
          },
        },
        validate,
      ),
    ).rejects.toThrow('HTTP ' + status);
    expect(calls).toBe(1);
  });
  it('retries transient responses and 200 wrong-format bodies; records actual attempt count', async () => {
    let calls = 0;
    const result = await download(
      url,
      {
        transport: async () => ({
          status: ++calls === 1 ? 503 : 200,
          body: calls === 2 ? Buffer.from('<html>error</html>') : valid,
        }),
      },
      validate,
    );
    expect(result.bytes).toEqual(valid);
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });
  it('bounds attempts and sanitizes transport failures', async () => {
    let calls = 0;
    await expect(
      download(
        url,
        {
          attempts: 2,
          transport: async () => {
            calls++;
            throw new Error('opaque unsafe response detail');
          },
        },
        validate,
      ),
    ).rejects.toThrow('Source transport failed after 2 attempt(s)');
    expect(calls).toBe(2);
    await expect(download(url, { attempts: 6 }, validate)).rejects.toThrow(/limit/);
    await expect(download(url, { timeoutMs: 30_001 }, validate)).rejects.toThrow(/limit/);
  });
  it('aborts a stalled transport within a finite deadline', async () => {
    let aborted = false;
    await expect(
      download(
        url,
        {
          attempts: 1,
          timeoutMs: 10,
          transport: ({ signal }) =>
            new Promise((_, reject) =>
              signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('aborted'));
              }),
            ),
        },
        validate,
      ),
    ).rejects.toThrow(/deadline/);
    expect(aborted).toBe(true);
  });
  it('rejects cross-source redirects before fetching them, and follows an explicitly allowlisted hop', async () => {
    const target = 'https://other.example.test/data';
    let calls = 0;
    const transport = async () => {
      calls++;
      return calls % 2 === 1
        ? { status: 302, headers: { location: target }, body: Buffer.alloc(0) }
        : { status: 200, body: valid };
    };
    await expect(download(url, { attempts: 1, transport }, validate)).rejects.toThrow(
      /allowlisted/,
    );
    expect(calls).toBe(1);
    calls = 0;
    const result = await download(url, { transport, allowedRedirects: [target] }, validate);
    expect(result.url).toBe(target);
    expect(calls).toBe(2);
  });
  it.each([
    'http://public.example.test/file',
    'https://name:password@example.test',
    'https://example.test/a#fragment',
    'https://example.test/?token=secret',
  ])('rejects unsupported or credential URL %s', (value) =>
    expect(() => publicUrl(value)).toThrow(),
  );
  it('limits streamed bytes even with missing/misleading content-length', async () => {
    let closed = false;
    async function* body() {
      try {
        yield Buffer.alloc(5);
        yield Buffer.alloc(5);
      } finally {
        closed = true;
      }
    }
    await expect(
      download(
        url,
        { attempts: 1, maxBytes: 6, transport: async () => ({ status: 200, body: body() }) },
        validate,
      ),
    ).rejects.toThrow(/byte limit/);
    expect(closed).toBe(true);
    await expect(
      download(
        url,
        {
          attempts: 1,
          maxBytes: 6,
          transport: async () => ({ status: 200, headers: { 'Content-Length': '7' }, body: valid }),
        },
        validate,
      ),
    ).rejects.toThrow(/byte limit/);
  });
  it('rejects a truncated declared body rather than creating a successful receipt', async () => {
    await expect(
      download(
        url,
        {
          attempts: 1,
          transport: async () => ({
            status: 200,
            headers: { 'content-length': String(valid.length + 1) },
            body: valid,
          }),
        },
        validate,
      ),
    ).rejects.toThrow(/content length/);
  });
  it.each(['gzip', 'br'])('rejects malformed or unsupported %s encoding', async (encoding) => {
    await expect(
      download(
        url,
        {
          attempts: 1,
          transport: async () => ({
            status: 200,
            headers: { 'content-encoding': encoding },
            body: valid,
          }),
        },
        validate,
      ),
    ).rejects.toThrow(/gzip|encoding/);
  });
  it('bounds gzip expansion while retaining both valid wire and decoded bytes', async () => {
    const wire = gzipSync(valid);
    const transport = async () => ({
      status: 200,
      headers: { 'content-encoding': 'gzip' },
      body: wire,
    });
    const result = await download(url, { transport }, validate);
    expect(result.wire).toEqual(wire);
    expect(result.bytes).toEqual(valid);
    await expect(
      download(url, { attempts: 1, transport, maxDecodedBytes: 4 }, validate),
    ).rejects.toThrow(/gzip/);
  });
  it.each([
    ['file.pdf', '<html>captcha</html>'],
    ['file.xls', '%PDF fake'],
    ['file.xml', '<?xml version="1.0"?><html>error</html>'],
    ['file.json', '{broken'],
    ['file.html', '<html><title>Just a moment</title></html>'],
    ['file.html', '<html><form><input type="password"></form></html>'],
    ['file.html', '<html>Verify you are human</html>'],
  ])('rejects false source data for %s', (path, body) =>
    expect(() => validateBytes(path, Buffer.from(body))).toThrow(),
  );
  it('runs the real Node transport only against an owned ephemeral loopback server', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/gzip') {
        res.writeHead(200, { 'content-encoding': 'gzip' });
        res.end(gzipSync(valid));
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: '/gzip' });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No ephemeral port');
      const base = `http://127.0.0.1:${address.port}`;
      const result = await download(
        base + '/redirect',
        { allowLocalHttp: true, allowedRedirects: [base + '/gzip'], attempts: 1, timeoutMs: 1000 },
        validate,
      );
      expect(result.bytes).toEqual(valid);
      expect(result.encoding).toBe('gzip');
      await expect(
        download(
          base + '/missing',
          { allowLocalHttp: true, attempts: 1, timeoutMs: 1000 },
          validate,
        ),
      ).rejects.toThrow('HTTP 404');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done())));
    }
  });
});
