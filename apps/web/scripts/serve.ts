/** Browser-only composition; plain Python file serving or the serve.py path fallback. No data is copied. */
import { createServer } from 'node:http';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { basename, extname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
/** urllib.parse.unquote, including replacement decoding of malformed UTF-8. */
function unquote(value: string) {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) =>
    new TextDecoder().decode(Uint8Array.from(run.slice(1).split('%'), (h) => parseInt(h, 16))),
  );
}

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export function staticRoot(root = ROOT): string {
  const target = join(root, 'tmp/static-site');
  mkdirSync(target, { recursive: true });
  const entries = new Map(
    readdirSync(join(root, 'apps/web/public')).map((name) => [
      name,
      join(root, 'apps/web/public', name),
    ]),
  );
  entries.set('js', join(root, 'apps/web/build/client/js'));
  entries.set('data', join(root, 'data/release'));
  for (const [name, source] of entries) {
    const dest = join(target, name);
    if (
      lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink() &&
      resolve(target, readlinkSync(dest)) !== resolve(source)
    )
      unlinkSync(dest);
    if (!existsSync(dest) && !lstatSync(dest, { throwIfNoEntry: false })) symlinkSync(source, dest);
  }
  return target;
}
const FILE_EXT = /\.[A-Za-z][A-Za-z0-9]{0,4}$/;
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.svg': 'image/svg+xml',
  '.xml': 'text/xml',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.xz': 'application/x-xz',
};
function isFile(path: string) {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}
function contained(base: string, path: string) {
  // Python Path.resolve also resolves symlinks; a composed data/js symlink is deliberately outside base.
  let target = path;
  const tail: string[] = [];
  while (!existsSync(target)) {
    tail.unshift(basename(target));
    const parent = resolve(target, '..');
    if (parent === target) break;
    target = parent;
  }
  const rel = relative(realpathSync(base), resolve(realpathSync(target), ...tail));
  return rel !== '..' && !rel.startsWith('../');
}
export async function startStaticServer(
  directory: string,
  port = 0,
  options: { fallback?: boolean; shell?: Buffer } = {},
) {
  const base = resolve(directory);
  const fallback = options.fallback ?? true;
  const shell = fallback ? (options.shell ?? readFileSync(join(base, 'index.html'))) : undefined;
  const cacheHeaders = fallback ? { 'Cache-Control': 'no-cache' } : {};
  const server = createServer((req, res) => {
    const send = (body: Buffer | string, status = 200, type = 'text/html; charset=utf-8') => {
      res.writeHead(status, {
        'Content-Type': type,
        'Content-Length': Buffer.byteLength(body),
        ...cacheHeaders,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const error = (status: number, message: string, explanation: string) =>
      send(
        `<!DOCTYPE HTML>\n<html lang="en">\n    <head>\n        <meta charset="utf-8">\n        <title>Error response</title>\n    </head>\n    <body>\n        <h1>Error response</h1>\n        <p>Error code: ${status}</p>\n        <p>Message: ${message}.</p>\n        <p>Error code explanation: ${status} - ${explanation}.</p>\n    </body>\n</html>\n`,
        status,
        'text/html;charset=utf-8',
      );
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      error(501, `Unsupported method ('${req.method}')`, 'Server does not support this operation');
      return;
    }
    // http.server collapses leading slashes, so a directory redirect never names another host.
    const url = (req.url ?? '/').replace(/^\/{2,}/, '/');
    const raw = url.split(/[?#]/)[0]!;
    const decoded = unquote(raw);
    if (decoded.includes('\0')) {
      error(404, 'File not found', 'Nothing matches the given URI');
      return;
    }
    // A path the file system refuses (too long a name, a symlink loop, no permission) is a missing file, as in http.server.
    try {
      answer();
    } catch {
      if (res.headersSent) res.destroy();
      else error(404, 'File not found', 'Nothing matches the given URI');
    }
    function answer() {
      const rel = posix.normalize(decoded).replace(/^\/+|\/+$/g, '') || 'index.html';
      if (fallback) {
        let file: string | undefined;
        for (const candidate of [
          join(base, rel),
          join(base, rel + '.html'),
          join(base, rel, 'index.html'),
        ]) {
          if (!contained(base, candidate)) break;
          if (isFile(candidate)) {
            file = candidate;
            break;
          }
        }
        if (file && extname(file) === '.html' && basename(file) !== posix.basename(decoded)) {
          send(readFileSync(file));
          return;
        }
        if (!file && !(FILE_EXT.test(raw) && !raw.startsWith('/embed/'))) {
          send(shell!);
          return;
        }
      }
      // SimpleHTTPRequestHandler's ordinary-file path translation (symlinks allowed).
      let ordinary = join(
        base,
        ...posix
          .normalize(decoded)
          .split('/')
          .filter((p) => p && p !== '.' && p !== '..'),
      );
      if (statSync(ordinary, { throwIfNoEntry: false })?.isDirectory()) {
        if (!raw.endsWith('/')) {
          const suffix = url.slice(raw.length);
          res.writeHead(301, {
            Location: raw + '/' + suffix,
            'Content-Length': '0',
            ...cacheHeaders,
          });
          res.end();
          return;
        }
        const index = ['index.html', 'index.htm'].map((name) => join(ordinary, name)).find(isFile);
        if (index) ordinary = index;
        else {
          const escape = (value: string) =>
            value
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;')
              .replaceAll('"', '&quot;')
              .replaceAll("'", '&#x27;');
          const display = escape(decoded);
          const items = readdirSync(ordinary)
            .sort((a, b) =>
              a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
            )
            .map((name) => {
              const path = join(ordinary, name);
              const dir = statSync(path, { throwIfNoEntry: false })?.isDirectory();
              const link = name + (dir ? '/' : '');
              const label = name + (lstatSync(path).isSymbolicLink() ? '@' : dir ? '/' : '');
              return `<li><a href="${encodeURIComponent(link).replaceAll('%2F', '/').replaceAll("'", '%27')}">${escape(label)}</a></li>`;
            })
            .join('\n');
          send(
            `<!DOCTYPE HTML>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Directory listing for ${display}</title>\n</head>\n<body>\n<h1>Directory listing for ${display}</h1>\n<hr>\n<ul>\n${items ? items + '\n' : ''}</ul>\n<hr>\n</body>\n</html>\n`,
          );
          return;
        }
      } else if (raw.endsWith('/')) {
        // SimpleHTTPRequestHandler: a trailing slash after a file name is not that file.
        error(404, 'File not found', 'Nothing matches the given URI');
        return;
      }
      if (!isFile(ordinary)) {
        error(404, 'File not found', 'Nothing matches the given URI');
        return;
      }
      const stat = statSync(ordinary);
      if (!req.headers['if-none-match'] && req.headers['if-modified-since']) {
        const since = Date.parse(req.headers['if-modified-since']);
        if (Number.isFinite(since) && Math.floor(stat.mtimeMs / 1000) <= Math.floor(since / 1000)) {
          res.writeHead(304, cacheHeaders);
          res.end();
          return;
        }
      }
      res.setHeader('Last-Modified', stat.mtime.toUTCString());
      send(
        readFileSync(ordinary),
        200,
        TYPES[extname(ordinary.replace(/\.br$/, '')).toLowerCase()] ?? 'application/octet-stream',
      );
    }
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      ),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { dir: { type: 'string' }, port: { type: 'string', default: '8000' } },
  });
  const directory = values.dir ? resolve(ROOT, values.dir) : staticRoot();
  const site = await startStaticServer(directory, Number(values.port));
  console.log(`serving ${directory} on ${site.url}/ (Ctrl+C to stop)`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void site.close();
    });
}
