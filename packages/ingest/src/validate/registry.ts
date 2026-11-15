import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseYaml } from '../io/registry.js';
import { files, protectDeclaredInput, rejectInputInventory, safePath } from './context.js';
import { pyRepr as repr, pyTruth as truth } from './checks.js';

const access = new Set(['auto', 'auto-bg', 'browser-only', 'supplied', 'reference', 'generated']);
const acquisition = new Set([
  'auto',
  'fetch',
  'fetch-bg',
  'import',
  'supplied',
  'reference',
  'generated',
]);
const status = new Set(['real', 'mock', 'pending']);
const other = /^(network|git tag mock-v\d+|every output of the release)$/;
const absolute =
  /(?<![\p{L}\p{N}_.])(?:\/Users\/[^/\s'"]+\/|\/home\/[a-z][\p{L}\p{N}_-]*\/|[A-Za-z]:\\(?:Users|home)\\)/u;
const duplicate = (a: string[]) => [...new Set(a.filter((v, i) => a.indexOf(v) !== i))].sort();
function glob(pattern: string, path: string): boolean {
  let r = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') r += '.*';
    else if (c === '?') r += '.';
    else if (c === '[') {
      let end = pattern.indexOf(']', i + 1);
      if (end < 0) r += '\\[';
      else {
        let content = pattern.slice(i + 1, end);
        if (content.startsWith('!')) content = '^' + content.slice(1);
        r += `[${content}]`;
        i = end;
      }
    } else r += c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(r + '$', 's').test(path);
}
/** A producer is a Python module command; module names cannot escape the tree. */
export function script(entry: string): string {
  if (
    [
      'packages/ingest/src/production/taxes-reader.ts',
      'packages/ingest/src/production/taxes.ts',
      'packages/ingest/src/production/debt-issues.ts',
      'packages/ingest/src/production/programmes.ts',
    ].includes(entry)
  )
    return entry;
  if (!entry) return entry;
  const parts =
    entry.match(/(?:[^\s'\"]+|'[^']*'|"[^"]*")+/g)?.map((x) => x.replace(/^(['"])(.*)\1$/, '$2')) ??
    [];
  if (parts.length < 3 || parts[0] !== 'python' || parts[1] !== '-m')
    throw new Error(`producer must be a python -m command: ${entry}`);
  const module = parts[2]!;
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(module))
    throw new Error(`unsafe producer module: ${module}`);
  return `pipeline/${module.replaceAll('.', '/')}.py`;
}
class Report {
  constructor(private readonly observer?: () => void) {}
  errors: string[] = [];
  ok(cond: unknown, msg: string): boolean {
    this.observer?.();
    if (!cond) this.errors.push(msg);
    return !!cond;
  }
}
const file = (root: string, p: string): boolean => {
  if (!p) return false;
  const path = safePath(root, p);
  return existsSync(path) && statSync(path).isFile();
};
export interface RegistryResult {
  errors: string[];
  gaps: Record<string, string[]>;
  describedInputs: string[];
  sourceExceptions: Record<string, string>;
}
export interface RegistryOptions {
  trackedPaths?: string[];
  /** Owned candidate data, separate from authenticated source/code. */
  outputRoot?: string;
  /** Lifecycle owns this one metadata route after manifest hashing. */
  lifecycleMetadata?: boolean;
  onCheck?: () => void;
}
export function validateRegistry(root: string, options: RegistryOptions = {}): RegistryResult {
  const pointer = 'data/release/releases/current.json';
  const read = (p: string) => {
    if (options.lifecycleMetadata && p === pointer) return '{}';
    return readFileSync(
      safePath(
        p.startsWith('data/release/') && options.outputRoot ? options.outputRoot : root,
        p.startsWith('data/release/') && options.outputRoot ? 'data/' + p.slice(13) : p,
      ),
      'utf8',
    );
  };
  let sreg: any, dreg: any;
  const pins: Record<string, string> = Object.create(null);
  try {
    sreg = parseYaml(read('data/sources.yaml'));
    dreg = parseYaml(read('data/datasets.yaml'));
    for (const line of read('data/originals.sha256').split(/\r?\n/)) {
      const idx = line.indexOf('  ');
      if (idx >= 0 && line.slice(idx + 2)) pins[line.slice(idx + 2)] = line.slice(0, idx);
    }
    // Collect the whole declared input closure before any producer/path check can throw.
    for (const path of Object.keys(pins)) protectDeclaredInput(root, path);
    const declaredRows = (value: unknown): Record<string, any>[] => {
      if (value == null) return [];
      if (!Array.isArray(value)) {
        rejectInputInventory(root);
        return [];
      }
      return value.filter((entry) => {
        if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) return true;
        rejectInputInventory(root);
        return false;
      });
    };
    for (const source of declaredRows(sreg.sources))
      for (const entry of declaredRows(source.files)) protectDeclaredInput(root, entry.path, true);
    for (const entry of declaredRows(sreg.intermediates)) {
      protectDeclaredInput(root, entry?.path, true);
      protectDeclaredInput(root, entry?.decision);
    }
    for (const entry of declaredRows(dreg.datasets)) {
      protectDeclaredInput(root, entry?.schema);
      if (Array.isArray(entry?.files))
        for (const path of entry.files) protectDeclaredInput(root, path, true);
      else if (entry.files != null) rejectInputInventory(root);
    }
  } catch (error) {
    rejectInputInventory(root);
    throw error;
  }
  const r = new Report(options.onCheck),
    sources = sreg.sources as any[],
    inter = (sreg.intermediates || []) as any[],
    ds = dreg.datasets as any[];
  const ids = sources.map((s) => s.id),
    ipaths = inter.map((i) => i.path),
    patterns: { pat: string; owner: string; entry: any }[] = [];
  r.ok(!duplicate(ids).length, `sources: duplicate ids ${repr(duplicate(ids))}`);
  for (const s of sources) {
    for (const k of ['id', 'title', 'access', 'acquisition', 'files'])
      r.ok(k in s, `source ${s.id ?? 'None'}: no ${k}`);
    r.ok(access.has(s.access), `source ${s.id}: access ${repr(s.access)}`);
    r.ok(acquisition.has(s.acquisition), `source ${s.id}: acquisition ${repr(s.acquisition)}`);
    for (const p of (s.parser || '').split(', '))
      if (p) r.ok(file(root, script(p)), `source ${s.id}: parser ${p} does not exist`);
    for (const f of s.files || [])
      patterns.push({ pat: f.path, owner: `source ${s.id}`, entry: f });
  }
  r.ok(!duplicate(ipaths).length, 'intermediates: duplicate paths');
  const known = new Set([...ids, ...ipaths]);
  for (const i of inter) {
    patterns.push({ pat: i.path, owner: 'intermediate', entry: i });
    if (i.category != null) {
      r.ok(i.category === 'described-input', `unknown intermediate category: ${i.path}`);
      r.ok(
        ['data/inputs/editorial/guide.json', 'data/inputs/editorial/glossary.json'].includes(
          i.path,
        ),
        `described inputs must be explicitly reviewed editorial text: ${i.path}`,
      );
      r.ok(i.decision && file(root, i.decision), `missing described-input decision: ${i.path}`);
      const valid =
        file(root, i.path) &&
        createHash('sha256')
          .update(readFileSync(safePath(root, i.path)))
          .digest('hex') === i.sha256;
      r.ok(valid, `described-input hash mismatch: ${i.path}`);
      r.ok(
        truth(i.provenance) && !truth(i.producer) && !truth(i.inputs),
        `described-input requires provenance and no producer/dependencies: ${i.path}`,
      );
    }
    r.ok(
      i.producer == null || file(root, script(i.producer)),
      `intermediate ${i.path}: producer ${i.producer ?? 'None'} does not exist`,
    );
    r.ok(
      typeof i.reproducible === 'boolean',
      `intermediate ${i.path}: reproducible must be true or false`,
    );
    r.ok(
      i.producer != null || !truth(i.reproducible),
      `intermediate ${i.path}: reproducible without a producer`,
    );
    for (const x of i.inputs || [])
      r.ok(known.has(x) || other.test(x), `intermediate ${i.path}: unknown input ${x}`);
  }
  for (const p of Object.keys(pins)) {
    const owners = patterns.filter((e) => glob(e.pat, p)).map((e) => e.owner);
    r.ok(
      owners.length === 1,
      `${p} is pinned in originals.sha256 but ${!owners.length ? 'registered nowhere' : `registered ${owners.length} times (${owners.join(', ')})`}`,
    );
  }
  for (const { pat, owner, entry } of patterns) {
    // Paths in registries are repository-relative, including glob patterns.
    if (pat.startsWith('/') || pat.includes('\\') || pat.split('/').includes('..'))
      throw new Error(`unsafe registry path: ${pat}`);
    const hits = Object.keys(pins).filter((p) => glob(pat, p));
    if (pat.startsWith('data/originals/') || pat.startsWith('data/inputs/'))
      r.ok(
        hits.length || entry.pinned === false,
        `${owner}: ${pat} matches no line of originals.sha256`,
      );
    else
      r.ok(
        'sha256' in entry || entry.pinned === false,
        `${owner}: ${pat} has no sha256 and does not say \`pinned: false\``,
      );
  }
  const cat = JSON.parse(read('data/release/catalog.json')),
    catalog: Record<string, [any, string[]]> = Object.create(null);
  for (const d of cat.datasets) {
    const cfiles = d.file ? [d.file] : (d.parts || []).map((p: any) => p.file);
    catalog[d.slug] = [
      d,
      cfiles.map((f: string) => `data/release/${f.startsWith('data/') ? f.slice(5) : f}`),
    ];
  }
  const data = [
      ...files(options.outputRoot ?? root, options.outputRoot ? 'data' : 'data/release').map(
        (f) => `data/release/${f}`,
      ),
      ...(options.lifecycleMetadata ? [pointer] : []),
    ],
    owner: Record<string, string[]> = Object.fromEntries(data.map((f) => [f, []]));
  const dids = ds.map((d) => d.id),
    allKnown = new Set([...known, ...dids]);
  r.ok(!duplicate(dids).length, `datasets: duplicate ids ${repr(duplicate(dids))}`);
  for (const d of ds) {
    const did = d.id,
      pats = d.files || [];
    r.ok(status.has(d.status), `dataset ${did}: status ${repr(d.status)}`);
    for (const pat of pats) {
      if (pat.startsWith('/') || pat.includes('\\') || pat.split('/').includes('..'))
        throw new Error(`unsafe registry path: ${pat}`);
      const hits = data.filter((f) => glob(pat, f));
      r.ok(hits.length || d.status === 'pending', `dataset ${did}: no file matches ${pat}`);
      for (const f of hits) owner[f]!.push(did);
    }
    if (d.status === 'pending') {
      r.ok(
        truth(d.reason) && truth(d.expected),
        `dataset ${did}: a pending set needs reason and expected`,
      );
      r.ok(
        !pats.some((p: string) => data.some((f) => glob(p, f))),
        `dataset ${did}: pending but has files`,
      );
    } else {
      r.ok(
        file(root, script(d.producer || '')),
        `dataset ${did}: producer ${d.producer ?? 'None'} does not exist`,
      );
      for (const layer of d.layers || [])
        r.ok(file(root, script(layer)), `dataset ${did}: layer ${layer} does not exist`);
      r.ok(
        truth(d.rebuild) || truth(d.notRebuilt),
        `dataset ${did}: neither rebuild nor notRebuilt`,
      );
      r.ok(truth(d.inputs), `dataset ${did}: no inputs`);
      for (const x of d.inputs || [])
        r.ok(allKnown.has(x) || other.test(x), `dataset ${did}: unknown input ${x}`);
      for (const k of ['schema', 'scope']) r.ok(truth(d[k]), `dataset ${did}: no ${k}`);
      if (truth(d.schema))
        r.ok(file(root, d.schema), `dataset ${did}: schema ${d.schema} does not exist`);
    }
    for (const s of d.sources || [])
      r.ok(known.has(s) && ids.includes(s), `dataset ${did}: unknown source ${s}`);
    if (truth(d.catalogId)) {
      if (
        !r.ok(
          did in catalog,
          `dataset ${did} claims catalog id ${d.catalogId} but catalog.json has no slug ${did}`,
        )
      )
        continue;
      const [c, cfiles] = catalog[did]!;
      r.ok(
        c.id === d.catalogId,
        `dataset ${did}: catalog id ${d.catalogId}, catalog.json says ${c.id}`,
      );
      r.ok(
        c.status === d.status,
        `dataset ${did}: status ${d.status}, catalog.json says ${c.status}`,
      );
      r.ok(
        JSON.stringify(c.screens || []) === JSON.stringify(d.screens || []),
        `dataset ${did}: screens differ from catalog.json`,
      );
      for (const k of ['period', 'unit'])
        if (truth(c[k]))
          r.ok(
            c[k] === d[k],
            `dataset ${did}: ${k} ${repr(d[k])}, catalog.json says ${repr(c[k])}`,
          );
      const mine = pats.flatMap((p: string) => data.filter((f) => glob(p, f))).sort();
      r.ok(
        JSON.stringify([...cfiles].sort()) === JSON.stringify(mine),
        `dataset ${did}: files differ from catalog.json`,
      );
    } else r.ok(!(did in catalog), `dataset ${did} is in catalog.json but has no catalogId`);
    for (const f of pats.flatMap((p: string) =>
      data.filter((f) => glob(p, f) && f.endsWith('.json')),
    )) {
      const meta = JSON.parse(read(f)).meta;
      if (meta && typeof meta === 'object' && !Array.isArray(meta) && 'status' in meta)
        r.ok(
          meta.status === d.status,
          `${f}: meta.status ${meta.status}, the registry says ${d.status}`,
        );
    }
  }
  for (const slug of Object.keys(catalog))
    r.ok(dids.includes(slug), `catalog.json dataset ${slug} is not registered`);
  for (const [f, o] of Object.entries(owner))
    r.ok(
      o.length === 1,
      `${f} belongs to ${!o.length ? 'no dataset' : `${o.length} datasets (${o.join(', ')})`}`,
    );
  let tracked: string[];
  try {
    tracked =
      options.trackedPaths ??
      execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean);
  } catch {
    tracked = [];
    r.errors.push('git ls-files failed: the absolute-path check needs a git checkout');
  }
  for (const rel of tracked) {
    if (
      !['pipeline/', 'apps/', 'tests/', '.github/'].some((p) => rel.startsWith(p)) ||
      rel === 'pipeline/budget_pipeline/validate/registry.py'
    )
      continue;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        readFileSync(safePath(root, rel)),
      );
      for (const [index, line] of text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).entries())
        if (absolute.test(line))
          r.errors.push(
            `${rel}:${index + 1}: an absolute path of a machine: ${line.trim().slice(0, 120)}`,
          );
    } catch (e) {
      if (
        !(e instanceof TypeError) &&
        (e as NodeJS.ErrnoException).code !== 'ENOENT' &&
        (e as NodeJS.ErrnoException).code !== 'EISDIR'
      )
        throw e;
    }
  }
  const byId = new Map(ds.map((d) => [d.id, d])),
    byPath = new Map(inter.map((i) => [i.path, i])),
    gaps: Record<string, string[]> = Object.create(null);
  for (const d of ds) {
    if (d.status === 'pending') continue;
    const seen = new Set<string>(),
      todo = [d.id, ...(d.inputs || [])],
      found: string[] = [];
    while (todo.length) {
      const x = todo.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      const i = byPath.get(x),
        dep = byId.get(x);
      if (i) {
        if (!truth(i.reproducible) && i.category !== 'described-input') found.push(x);
        todo.push(...(i.inputs || []));
      } else if (dep) {
        if (truth(dep.notRebuilt) && !truth(dep.rebuild)) found.push(`source-exception:${x}`);
        todo.push(...(dep.inputs || []));
      }
    }
    gaps[d.id] = [...new Set(found)].sort();
  }
  return {
    errors: r.errors,
    gaps,
    describedInputs: inter.filter((i) => i.category === 'described-input').map((i) => i.path),
    sourceExceptions: Object.fromEntries(
      ds
        .filter((d) => d.status !== 'pending' && truth(d.notRebuilt) && !truth(d.rebuild))
        .map((d) => [d.id, d.notRebuilt]),
    ),
  };
}
