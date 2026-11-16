/** Literal internal addresses; full-line comments are excluded. */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { match } from '../client/routes.js';
import { redirectHash } from '../client/redirects.js';
export function addresses(text: string, javascript = false): string[] {
  if (javascript) text = text.replace(/^\s*\/\/.*$/gm, '');
  const href = /(?<![\p{L}\p{N}_&])#\/[A-Za-z0-9_\-/.:%+]*(?:\?[A-Za-z0-9_=&,.%:+\-]*)?/gu;
  return [...text.matchAll(href)]
    .map((m) => m[0].replace(/\.+$/, ''))
    .filter((h) => h !== '#/' && h !== '#/:' && h.length >= 3);
}
export function collect(root = fileURLToPath(new URL('../../../', import.meta.url))) {
  const found = new Map<string, Set<string>>();
  for (const directory of ['data/release', 'apps/web/client', 'apps/web/public']) {
    function walk(path: string) {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (entry.name === 'vendor') continue;
        const file = join(path, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (['.js', '.json'].includes(extname(file)))
          for (const h of addresses(readFileSync(file, 'utf8'), extname(file) === '.js')) {
            if (!found.has(h)) found.set(h, new Set());
            found.get(h)!.add(relative(root, file));
          }
      }
    }
    walk(join(root, directory));
  }
  return found;
}
export function destination(h: string) {
  const to = redirectHash(h);
  const path = (to || h).replace(/^#/, '').split('?')[0];
  let id: string | null = null;
  try {
    id = match(path.split('/').filter(Boolean).map(decodeURIComponent))?.route.id ?? null;
  } catch {
    /* malformed escapes are dead */
  }
  if (!path.split('/').filter(Boolean).length) id = 'S01';
  return { h, to, id };
}
