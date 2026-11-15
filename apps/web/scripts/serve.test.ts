import { mkdtempSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { startStaticServer, staticRoot } from './serve.ts';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-static-'));
  dirs.push(dir);
  return dir;
}
test('composition links public assets, built JS and immutable release data without copying', () => {
  const root = directory();
  for (const dir of ['apps/web/public', 'apps/web/build/client/js', 'data/release'])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'apps/web/public/index.html'), 'shell');
  const target = staticRoot(root);
  expect(readlinkSync(join(target, 'data'))).toBe(join(root, 'data/release'));
  expect(readlinkSync(join(target, 'js'))).toBe(join(root, 'apps/web/build/client/js'));
  expect(readlinkSync(join(target, 'index.html'))).toBe(join(root, 'apps/web/public/index.html'));
  expect(staticRoot(root)).toBe(target);
  rmSync(join(target, 'js'));
  symlinkSync(join(root, 'apps/web/public'), join(target, 'js'));
  staticRoot(root);
  expect(readlinkSync(join(target, 'js'))).toBe(join(root, 'apps/web/build/client/js'));
});
test('Python path rules, GET/HEAD, MIME, query, cache, missing files and composed symlinks', async () => {
  const dir = directory(),
    outside = directory();
  const put = (name: string, body: string) => writeFileSync(join(dir, name), body);
  put('index.html', 'shell');
  put('screen.html', 'screen');
  put('other.html', 'other');
  mkdirSync(join(dir, 'nested'));
  put('nested/index.html', 'nested');
  for (const ext of ['js', 'css', 'json', 'csv', 'xml', 'svg', 'woff2', 'unknown'])
    put('asset.' + ext, ext);
  mkdirSync(join(dir, 'listing.json'));
  put('listing.json/item.txt', 'entry');
  for (const ext of ['gz', 'bz2', 'xz', 'Z', 'br']) put('asset.json.' + ext, 'compressed fixture');
  put('asset.map', 'map');
  put('име.html', 'unicode');
  put('encoded.js', 'encoded');
  writeFileSync(join(outside, 'core.json'), '{}');
  symlinkSync(outside, join(dir, 'data'));
  const site = await startStaticServer(dir);
  try {
    for (const [path, body, type] of [
      ['/', 'shell', 'text/html; charset=utf-8'],
      ['/index.html', 'shell', 'text/html'],
      ['/screen?x=1', 'screen', 'text/html; charset=utf-8'],
      ['/screen/', 'screen', 'text/html; charset=utf-8'],
      ['/nested', 'nested', 'text/html; charset=utf-8'],
      ['/nested/', 'nested', 'text/html; charset=utf-8'],
      ['/missing', 'shell', 'text/html; charset=utf-8'],
      ['/vedomstvo/0200/0200.01.00', 'shell', 'text/html; charset=utf-8'],
      ['/embed/prognoza.s13-deficit', 'shell', 'text/html; charset=utf-8'],
      ['/embed/test.json', 'shell', 'text/html; charset=utf-8'],
      ['/missing.abcdef', 'shell', 'text/html; charset=utf-8'],
      ['/missing.123', 'shell', 'text/html; charset=utf-8'],
      ['/%D0%B8%D0%BC%D0%B5', 'unicode', 'text/html; charset=utf-8'],
      ['/encoded%2Ejs', 'encoded', 'text/javascript'],
      ['/data/core.json', '{}', 'application/json'],
      ...Object.entries({
        gz: 'application/gzip',
        bz2: 'application/x-bzip2',
        xz: 'application/x-xz',
        Z: 'application/octet-stream',
        br: 'application/json',
      }).map(([ext, type]) => ['/asset.json.' + ext, 'compressed fixture', type]),
      ['/asset.map', 'map', 'application/octet-stream'],
      ...Object.entries({
        js: 'text/javascript',
        css: 'text/css',
        json: 'application/json',
        csv: 'text/csv',
        xml: 'text/xml',
        svg: 'image/svg+xml',
        woff2: 'font/woff2',
        unknown: 'application/octet-stream',
      }).map(([ext, type]) => ['/asset.' + ext, ext, type]),
    ]) {
      const response = await fetch(site.url + path);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toBe(body);
      expect(response.headers.get('content-type'), path).toBe(type);
      expect(response.headers.get('cache-control'), path).toBe('no-cache');
      expect(response.headers.get('content-length'), path).toBe(String(Buffer.byteLength(body)));
      const head = await fetch(site.url + path, { method: 'HEAD' });
      expect(head.status, path).toBe(200);
      expect(await head.text()).toBe('');
      expect(head.headers.get('content-type'), path).toBe(type);
      expect(head.headers.get('content-length'), path).toBe(String(Buffer.byteLength(body)));
    }
    for (const path of ['/missing.json', '/data/missing.json', '/missing.js?query=1']) {
      const response = await fetch(site.url + path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type')).toBe('text/html;charset=utf-8');
      expect(await response.text()).toContain('Error code: 404');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect((await fetch(site.url + path, { method: 'HEAD' })).status).toBe(404);
    }
    const listingRedirect = await fetch(site.url + '/listing.json?x=1', { redirect: 'manual' });
    expect(listingRedirect.status).toBe(301);
    expect(listingRedirect.headers.get('location')).toBe('/listing.json/?x=1');
    // A trailing slash no longer matches FILE_EXT, so it receives the app shell.
    expect(await (await fetch(site.url + '/listing.json/')).text()).toBe('shell');
    const response = await fetch(site.url + '/asset.js');
    expect(
      (
        await fetch(site.url + '/asset.js', {
          headers: { 'If-Modified-Since': response.headers.get('last-modified')! },
        })
      ).status,
    ).toBe(304);
    // SimpleHTTPRequestHandler ignores Range and returns the complete file.
    expect(
      await (await fetch(site.url + '/asset.js', { headers: { Range: 'bytes=0-0' } })).text(),
    ).toBe('js');
    expect((await fetch(site.url + '/', { method: 'POST' })).status).toBe(501);
  } finally {
    await site.close();
  }
});

/** Send the literal request target, without fetch/URL normalizing encoded dot segments. */
async function rawGet(url: string, path: string) {
  return new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
    const req = request(url, { path }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () =>
        resolve({
          status: response.statusCode!,
          body: Buffer.concat(chunks).toString('utf8'),
          location: response.headers.location,
        }),
      );
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('plain-handler mode has no shell or HTML rename and preserves directory/file semantics', async () => {
  const dir = directory();
  // No root index: plain mode must not try reading a shell during startup.
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested/index.html'), 'nested');
  mkdirSync(join(dir, 'htm'));
  writeFileSync(join(dir, 'htm/index.htm'), 'htm');
  mkdirSync(join(dir, 'listing'));
  writeFileSync(join(dir, 'listing/a & b.txt'), 'entry');
  writeFileSync(join(dir, 'screen.html'), 'screen');
  // The static root of the browser checks is composed of directory symlinks (data, js).
  const outside = directory();
  writeFileSync(join(outside, 'core.json'), '{}');
  symlinkSync(outside, join(dir, 'data'));
  const site = await startStaticServer(dir, 0, { fallback: false });
  try {
    for (const path of ['/missing', '/screen', '/embed/test.json', '/vedomstvo/0200/0200.01.00']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(site.url + path, { method });
        expect(response.status, path).toBe(404);
        expect(response.headers.get('content-type'), path).toBe('text/html;charset=utf-8');
        expect(response.headers.get('cache-control'), path).toBeNull();
        if (method === 'HEAD') expect(await response.text(), path).toBe('');
        else expect(await response.text(), path).toContain('Error code: 404');
      }
    }
    const redirect = await fetch(site.url + '/nested?x=1', { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/nested/?x=1');
    for (const [path, body] of [
      ['/screen.html', 'screen'],
      ['/nested/', 'nested'],
      ['/htm/', 'htm'],
    ]) {
      const response = await fetch(site.url + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
      expect(response.headers.get('content-type')).toBe('text/html');
    }
    const linked = await fetch(site.url + '/data/core.json');
    expect(linked.status).toBe(200);
    expect(await linked.text()).toBe('{}');
    expect(linked.headers.get('content-type')).toBe('application/json');
    expect((await fetch(site.url + '/data', { redirect: 'manual' })).status).toBe(301);
    // A trailing slash after a file name is not that file.
    expect((await fetch(site.url + '/screen.html/')).status).toBe(404);
    // Leading slashes collapse, so the directory redirect cannot name another host.
    const doubled = await rawGet(site.url, '//nested?x=1');
    expect(doubled.status).toBe(301);
    expect(doubled.location).toBe('/nested/?x=1');
    const listing = await fetch(site.url + '/listing/');
    expect(listing.status).toBe(200);
    expect(await listing.text()).toContain('<a href="a%20%26%20b.txt">a &amp; b.txt</a>');
    const head = await fetch(site.url + '/listing/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  } finally {
    await site.close();
  }
});

for (const fallback of [false, true])
  test(`traversal, symlink boundary and NUL (fallback=${fallback})`, async () => {
    const dir = directory(),
      outside = directory();
    writeFileSync(join(dir, 'index.html'), 'shell');
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    writeFileSync(join(outside, 'secret'), 'outside without extension');
    symlinkSync(join(outside, 'secret'), join(dir, 'escape'));
    const site = await startStaticServer(dir, 0, { fallback });
    try {
      for (const path of [
        '/..%2f../secret.txt',
        '/%2e%2e/secret.txt',
        '/..%2f' + basename(outside) + '/secret.txt',
      ]) {
        const response = await rawGet(site.url, path);
        expect(response.status, path).toBe(404);
        expect(response.body, path).not.toContain('outside');
      }
      for (const path of ['/..%2f..', '/%2e%2e']) {
        const response = await rawGet(site.url, path);
        expect(response.status, path).toBe(fallback ? 200 : 301);
        if (fallback) expect(response.body, path).toBe('shell');
        else expect((await rawGet(site.url, path + '/')).body, path).toBe('shell');
      }
      const escaped = await rawGet(site.url, '/escape');
      expect(escaped.status).toBe(200);
      // The fallback's resolver rejects external symlinks for path addresses;
      // SimpleHTTPRequestHandler deliberately follows them as ordinary files.
      expect(escaped.body).toBe(fallback ? 'shell' : 'outside without extension');
      for (const path of ['/x%00', '/x%00.json']) {
        const response = await rawGet(site.url, path);
        expect(response.status, path).toBe(404);
        expect(response.body).toContain('Error code: 404');
      }
      // A name the file system refuses is a missing file, not the end of the process.
      const refused = await rawGet(site.url, '/' + 'a'.repeat(300) + '.json');
      expect(refused.status).toBe(404);
      expect(refused.body).toContain('Error code: 404');
      expect(await (await fetch(site.url + '/index.html')).text()).toBe('shell'); // process survives
    } finally {
      await site.close();
    }
  });
