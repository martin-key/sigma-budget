import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { numbers } from './execution-contract.js';
import { routeCatalogue } from './route-catalogue.js';
import { parseOrderedPythonJson } from './ordered-json.js';
import { throwPythonJsonError } from './json-error.js';

let inputObserver: ((root: string, path: string, rejected?: boolean) => void) | undefined;
/** Record files and trees consulted by synchronous validators, including registry-defined paths. */
export function captureInputPaths<T>(
  root: string,
  operation: () => T,
): { value: T; paths: string[]; rejectedPaths: string[] } {
  const base = resolve(root),
    physical = realpathSync(base),
    paths = new Set<string>(),
    rejectedPaths = new Set<string>();
  const previous = inputObserver;
  inputObserver = (observedRoot, path, rejected) => {
    previous?.(observedRoot, path, rejected);
    if (observedRoot === base) {
      const identity = resolve(physical, relative(base, path));
      paths.add(identity);
      if (rejected) rejectedPaths.add(identity);
    }
  };
  try {
    return { value: operation(), paths: [...paths], rejectedPaths: [...rejectedPaths] };
  } finally {
    inputObserver = previous;
  }
}

/** Resolve repository-relative paths without allowing traversal or symlink escapes. */
export function safePath(root: string, path: string): string {
  const base = resolve(root),
    out = resolve(base, path);
  try {
    if (
      !path ||
      isAbsolute(path) ||
      path.includes('\\') ||
      path.split('/').some((p) => p === '..' || p === '.')
    )
      throw new Error(`unsafe path: ${path}`);
    const rel = relative(base, out);
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
  } catch (error) {
    inputObserver?.(base, out, true);
    throw error;
  }
  inputObserver?.(base, out);
  return out;
}
/** Protect declared inputs before validation can fail at an earlier declaration.
 * A glob protects its closest literal ancestor; rejected paths still reach capture.
 * Observation must not change the validator's original first failure.
 */
export function protectDeclaredInput(root: string, value: unknown, glob = false): void {
  if (value == null || value === '') return;
  if (typeof value !== 'string') {
    rejectInputInventory(root);
    return;
  }
  let path = value;
  if (glob) {
    const wildcard = path.search(/[?*\[]/);
    if (wildcard >= 0) path = path.slice(0, path.lastIndexOf('/', wildcard) + 1);
  }
  if (!path) {
    inputObserver?.(resolve(root), resolve(root));
    return;
  }
  try {
    safePath(root, path);
  } catch {
    // safePath already recorded the rejected declaration. Preserve donor failure order.
  }
}
/** A failed inventory cannot authorize writing a failure report over unknown inputs. */
export function rejectInputInventory(root: string): void {
  const base = resolve(root);
  inputObserver?.(base, base, true);
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
      if (ent.isSymbolicLink()) {
        inputObserver?.(resolve(root), join(dir, ent.name), true);
        throw new Error(`symlink in path: ${path}/${name}`);
      }
      if (ent.isDirectory()) visit(join(dir, ent.name), name);
      else if (ent.isFile()) out.push(name);
    }
  }
  visit(start, '');
  return out.sort();
}
/** Python json.loads(parse_constant=...) rejects NaN and Infinity tokens. */
export function strictJson(text: string): unknown {
  try {
    return parseOrderedPythonJson(text);
  } catch (cause) {
    if (cause instanceof SyntaxError) throwPythonJsonError(text);
    throw cause;
  }
}

export class Context {
  private jsonCache = new Map<string, any>();
  private textCache = new Map<string, string>();
  private routeCache?: Routes;
  constructor(
    readonly root: string,
    readonly buildDate = '2026-11-08',
    readonly dataDir = 'data/release',
    readonly outputRoot = root,
  ) {
    realpathSync(root);
    realpathSync(outputRoot);
    safePath(outputRoot, dataDir);
  }
  sourceExists(rel: string): boolean {
    return existsSync(safePath(this.root, `data/originals/${rel}`));
  }
  sourceBytes(rel: string): Buffer {
    return readFileSync(safePath(this.root, `data/originals/${rel}`));
  }
  dataDirectory(rel: string): string[] {
    return readdirSync(safePath(this.outputRoot, `${this.dataDir}/${rel}`)).sort();
  }
  dataFiles(): string[] {
    return files(this.outputRoot, this.dataDir, true);
  }
  jsonFiles(): string[] {
    return this.dataFiles().filter((f) => f.endsWith('.json'));
  }
  bytes(rel: string): Buffer {
    return readFileSync(safePath(this.outputRoot, `${this.dataDir}/${rel}`));
  }
  text(rel: string): string {
    if (!this.textCache.has(rel))
      this.textCache.set(
        rel,
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
          .decode(this.bytes(rel))
          .replace(/\r\n?/g, '\n'),
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
    return existsSync(safePath(this.outputRoot, `${this.dataDir}/${rel}`));
  }
  proto(rel: string): unknown {
    const name = rel.startsWith('src/') ? rel.slice(4) : rel;
    return strictJson(readFileSync(safePath(this.root, `data/inputs/${name}`), 'utf8'));
  }
  routes(): Routes {
    return (this.routeCache ??= new Routes(
      strictJson(readFileSync(safePath(this.root, 'apps/web/app/lib/routes.json'), 'utf8')),
    ));
  }
}
export class Routes {
  readonly ids: Set<string>;
  private entries: {
    id: string;
    segments: { literal?: string; re?: RegExp; optional: boolean }[];
  }[];
  constructor(catalog: any) {
    const records = routeCatalogue(catalog);
    this.ids = new Set(records.map((r) => r.id));
    this.entries = records
      .filter((r) => r.pattern !== null)
      .map((r) => {
        if (typeof r.pattern !== 'string') {
          const error = new Error(`'${r.patternType}' object has no attribute 'split'`);
          error.name = 'AttributeError';
          throw error;
        }
        return {
          id: r.id,
          segments: r.pattern
            .split('/')
            .filter(Boolean)
            .map((s: string) => {
              const m = /^:(\w+)(?:\(([^)]+)\))?(\?)?$/.exec(s);
              return m
                ? { re: m[2] ? new RegExp(`^(?:${m[2]})$`) : undefined, optional: !!m[3] }
                : { literal: s, optional: false };
            }),
        };
      });
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
