import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { numbers } from './execution-contract.js';
import { parseOrderedPythonJson } from './ordered-json.js';

let inputObserver: ((root: string, path: string) => void) | undefined;
/** Record files and trees consulted by synchronous validators, including registry-defined paths. */
export function captureInputPaths<T>(
  root: string,
  operation: () => T,
): { value: T; paths: string[] } {
  const base = resolve(root),
    physical = realpathSync(base),
    paths = new Set<string>();
  const previous = inputObserver;
  inputObserver = (observedRoot, path) => {
    previous?.(observedRoot, path);
    if (observedRoot === base) paths.add(resolve(physical, relative(base, path)));
  };
  try {
    return { value: operation(), paths: [...paths] };
  } finally {
    inputObserver = previous;
  }
}

/** Resolve repository-relative paths without allowing traversal or symlink escapes. */
export function safePath(root: string, path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((p) => p === '..' || p === '.')
  )
    throw new Error(`unsafe path: ${path}`);
  const base = resolve(root),
    out = resolve(base, path),
    rel = relative(base, out);
  if (!rel || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw new Error(`unsafe path: ${path}`);
  let current = base;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink in path: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  inputObserver?.(base, out);
  return out;
}
export function files(root: string, path: string, excludeReleases = false): string[] {
  const start = safePath(root, path);
  if (!existsSync(start)) return [];
  const out: string[] = [];
  function visit(dir: string, rel: string): void {
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (excludeReleases && !rel && ent.name === 'releases') continue;
      const name = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) throw new Error(`symlink in path: ${path}/${name}`);
      if (ent.isDirectory()) visit(join(dir, ent.name), name);
      else if (ent.isFile()) out.push(name);
    }
  }
  visit(start, '');
  return out.sort();
}
/** Python json.loads(parse_constant=...) rejects NaN and Infinity tokens. */
export function strictJson(text: string): unknown {
  let inString = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    const m = /^(?:NaN|Infinity|-Infinity)(?![\w])/.exec(text.slice(i));
    if (m) {
      const error = new Error(`non-finite number ${m[0]} in JSON`);
      error.name = 'ValueError';
      throw error;
    }
  }
  return parseOrderedPythonJson(text);
}

export class Context {
  private jsonCache = new Map<string, any>();
  private textCache = new Map<string, string>();
  private routeCache?: Routes;
  constructor(
    readonly root: string,
    readonly buildDate = '2026-11-08',
    readonly dataDir = 'data/release',
  ) {
    realpathSync(root);
    safePath(root, dataDir);
  }
  sourceExists(rel: string): boolean {
    return existsSync(safePath(this.root, `data/originals/${rel}`));
  }
  sourceBytes(rel: string): Buffer {
    return readFileSync(safePath(this.root, `data/originals/${rel}`));
  }
  dataDirectory(rel: string): string[] {
    return readdirSync(safePath(this.root, `${this.dataDir}/${rel}`)).sort();
  }
  dataFiles(): string[] {
    return files(this.root, this.dataDir, true);
  }
  jsonFiles(): string[] {
    return this.dataFiles().filter((f) => f.endsWith('.json'));
  }
  bytes(rel: string): Buffer {
    return readFileSync(safePath(this.root, `${this.dataDir}/${rel}`));
  }
  text(rel: string): string {
    if (!this.textCache.has(rel))
      this.textCache.set(
        rel,
        new TextDecoder('utf-8', { fatal: true }).decode(this.bytes(rel)).replace(/\r\n?/g, '\n'),
      );
    return this.textCache.get(rel)!;
  }
  get(rel: string): any {
    if (!this.jsonCache.has(rel)) {
      const obj: unknown = strictJson(this.text(rel));
      this.jsonCache.set(rel, rel.split('/').at(-1) === 'execution.json' ? numbers(obj) : obj);
    }
    return this.jsonCache.get(rel);
  }
  exists(rel: string): boolean {
    return existsSync(safePath(this.root, `${this.dataDir}/${rel}`));
  }
  proto(rel: string): unknown {
    const name = rel.startsWith('src/') ? rel.slice(4) : rel;
    return strictJson(readFileSync(safePath(this.root, `data/inputs/${name}`), 'utf8'));
  }
  routes(): Routes {
    return (this.routeCache ??= new Routes(
      JSON.parse(readFileSync(safePath(this.root, 'apps/web/app/lib/routes.json'), 'utf8')),
    ));
  }
}
export class Routes {
  private entries: {
    id: string;
    segments: { literal?: string; re?: RegExp; optional: boolean }[];
  }[];
  constructor(catalog: any) {
    this.entries = catalog.routes
      .filter((r: any[]) => r[2] !== null)
      .map((r: any[]) => ({
        id: r[0],
        segments: r[2]
          .split('/')
          .filter(Boolean)
          .map((s: string) => {
            const m = /^:(\w+)(?:\(([^)]+)\))?(\?)?$/.exec(s);
            return m
              ? { re: m[2] ? new RegExp(`^(?:${m[2]})$`) : undefined, optional: !!m[3] }
              : { literal: s, optional: false };
          }),
      }));
    this.entries.sort((a, b) => b.segments.length - a.segments.length);
  }
  match(href: string): string | null {
    const parts = (href.startsWith('#') ? href.slice(1) : href)
      .split('?')[0]!
      .split('/')
      .filter(Boolean);
    for (const { id, segments } of this.entries) {
      if (
        parts.length < segments.filter((s) => !s.optional).length ||
        parts.length > segments.length
      )
        continue;
      if (
        segments.every((s, i) =>
          parts[i] === undefined
            ? s.optional
            : s.literal !== undefined
              ? s.literal === parts[i]!.toLowerCase()
              : !s.re || s.re.test(parts[i]!) || s.re.test(parts[i]!.toLowerCase()),
        )
      )
        return id;
    }
    return null;
  }
}
