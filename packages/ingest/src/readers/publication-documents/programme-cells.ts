import type { ProgrammeRow } from './programme-tokens.js';
import { pythonFloatSum } from '../../common/numbers.js';
import { pythonRound } from '../../common/format.js';
export interface ProgrammeCell {
  values: number[] | null;
  method: string;
  cands: number[][] | null;
  tokens: number[];
  pages: number[];
}
export type ProgrammeCells = Map<string, { key: [string, string]; cell: ProgrammeCell }>;
export function consistent(v: number[], tol = 0.15): boolean {
  return (
    v.length === 9 &&
    [
      v[0]! - v[1]! - v[2]!,
      v[3]! - v[4]! - v[5]!,
      v[6]! - v[7]! - v[8]!,
      v[0]! - v[3]! - v[6]!,
    ].every((x) => Math.abs(x) <= tol)
  );
}
export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const walk = (at: number, p: number[]) => {
    if (p.length === k) {
      out.push(p);
      return;
    }
    for (let i = at; i < n; i++) walk(i + 1, [...p, i]);
  };
  if (k <= n) walk(0, []);
  return out;
}
const vectorKey = (v: number[]) => JSON.stringify(v),
  eq = (a: number[], b: number[]) => vectorKey(a) === vectorKey(b);
const distinct = (vs: number[][]) => [...new Map(vs.map((v) => [vectorKey(v), v])).values()];
const sorted = (vs: number[][]) =>
  vs.sort((a, b) => {
    for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  });
function spread(tokens: number[]): number[][] {
  const out: number[][] = [];
  for (const pos of combinations(9, tokens.length)) {
    const v = Array<number>(9).fill(0);
    pos.forEach((p, i) => (v[p] = tokens[i]!));
    if (consistent(v)) out.push(v);
  }
  return distinct(out);
}
function centroids(xs: number[]) {
  const groups: number[][] = [];
  for (const x of xs.slice().sort((a, b) => a - b)) {
    const last = groups.at(-1);
    if (last && x - last.at(-1)! <= 8) last.push(x);
    else groups.push([x]);
  }
  return groups.map((g) => pythonFloatSum(g) / g.length);
}
const nearest = (xs: number[], x: number) =>
  xs.reduce((best, _, i) => (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x) ? i : best), 0);
interface Layout {
  cents: number[];
  cols: number[];
}
function pageLayout(rows: ProgrammeRow[]): Layout | null {
  const usable = rows.filter((r) => r.x1.length === r.tokens.length),
    xs = usable.flatMap((r) => r.x1);
  if (!xs.length) return null;
  const cents = centroids(xs);
  if (cents.length > 9) return null;
  const ids = usable
    .map((r) => ({ tokens: r.tokens, ci: r.x1.map((x) => nearest(cents, x)) }))
    .filter(
      (r) => new Set(r.ci).size === r.ci.length && r.ci.every((c, i) => !i || c >= r.ci[i - 1]!),
    );
  if (ids.length < 2) return null;
  const scored = combinations(9, cents.length)
    .map((cols) => ({
      cols,
      ok: ids.filter((r) => {
        const v = Array<number>(9).fill(0);
        r.ci.forEach((c, i) => (v[cols[c]!] = r.tokens[i]!));
        return consistent(v);
      }).length,
    }))
    .sort((a, b) => b.ok - a.ok);
  const best = scored[0]!;
  return best.ok >= 0.75 * ids.length && (!scored[1] || scored[1].ok < best.ok)
    ? { cents, cols: best.cols }
    : null;
}
function place(r: ProgrammeRow, l: Layout | null): number[] | null {
  if (!l || r.x1.length !== r.tokens.length) return null;
  const ci = r.x1.map((x) => nearest(l.cents, x));
  if (new Set(ci).size !== ci.length) return null;
  const v = Array<number>(9).fill(0);
  ci.forEach((c, i) => (v[l.cols[c]!] = r.tokens[i]!));
  return v;
}
function header(r: ProgrammeRow): number[] | null {
  if (!r.hdr || r.x1.length !== r.tokens.length) return null;
  const v = Array<number>(9).fill(0),
    used = new Set<number>(),
    windows = [
      [-100, -20],
      [-3, 21],
      [40, 100],
    ];
  for (let i = 0; i < r.tokens.length; i++) {
    const x = r.x1[i]!,
      g = nearest(r.hdr, x - 12),
      d = x - 12 - r.hdr[g]!,
      c = windows.findIndex(([lo, hi]) => d >= lo! && d <= hi!);
    if (c < 0 || used.has(g * 3 + c)) return null;
    used.add(g * 3 + c);
    v[g * 3 + c] = r.tokens[i]!;
  }
  return v;
}
type Resolution = { method: string; v: number[] | null; cands: number[][] | null };
function resolve(r: ProgrammeRow, l: Layout | null): Resolution {
  const toks = r.tokens;
  if (toks.length === 9)
    return {
      method: consistent(toks) ? 'full' : 'bad',
      v: consistent(toks) ? toks.slice() : null,
      cands: null,
    };
  const sols = spread(toks);
  if (!sols.length) return { method: 'bad', v: null, cands: null };
  if (sols.length === 1) return { method: 'unique', v: sols[0]!, cands: null };
  const v = place(r, l);
  return v && consistent(v) && sols.some((s) => eq(s, v))
    ? { method: 'calibrated', v, cands: null }
    : { method: 'ambiguous', v: null, cands: sols };
}
export function programmeCells(rows: ProgrammeRow[]): {
  cells: ProgrammeCells;
  conflicts: [string, string][];
} {
  const pages = new Map<number, ProgrammeRow[]>();
  for (const r of rows) {
    const rs = pages.get(r.page) ?? [];
    rs.push(r);
    pages.set(r.page, rs);
  }
  const layouts = new Map([...pages].map(([pn, rs]) => [pn, pageLayout(rs)]));
  const results = rows.map((r) => resolve(r, layouts.get(r.page) ?? null));
  const stats = new Map<number, { agree: number; disagree: number; own: boolean }>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!,
      res = results[i]!;
    if (!['full', 'unique', 'calibrated'].includes(res.method) || !r.hdr) continue;
    const v = header(r);
    if (!v) continue;
    const st = stats.get(r.page) ?? { agree: 0, disagree: 0, own: false };
    st.own ||= r.hdr_own;
    if (
      eq(
        v.map((n) => pythonRound(n, 1)),
        res.v!.map((n) => pythonRound(n, 1)),
      )
    )
      st.agree++;
    else st.disagree++;
    stats.set(r.page, st);
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!,
      res = results[i]!,
      st = stats.get(r.page) ?? { agree: 0, disagree: 0 };
    const own = pages.get(r.page)!.some((r) => r.hdr_own);
    if (res.method === 'ambiguous' && r.hdr && !st.disagree && (own || st.agree >= 2)) {
      const v = header(r);
      if (v && consistent(v) && res.cands!.some((s) => eq(s, v)))
        results[i] = { method: 'header', v, cands: null };
    }
  }
  const groups = new Map<
    string,
    { key: [string, string]; rs: ProgrammeRow[]; res: Resolution[] }
  >();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.label === null) continue;
    const key: [string, string] = [
        r.label,
        r.code === 'total' || r.code.endsWith('.00.00') ? 'total' : r.code,
      ],
      id = JSON.stringify(key),
      g = groups.get(id) ?? { key, rs: [], res: [] };
    g.rs.push(r);
    g.res.push(results[i]!);
    groups.set(id, g);
  }
  const cells: ProgrammeCells = new Map(),
    conflicts: [string, string][] = [],
    order = ['full', 'unique', 'calibrated', 'header'];
  for (const [id, g] of groups) {
    const solved = g.res.filter((r) => order.includes(r.method)),
      vs = distinct(solved.map((r) => r.v!)),
      cell: ProgrammeCell = {
        values: null,
        method: 'bad',
        cands: null,
        tokens: g.rs[0]!.tokens,
        pages: [...new Set(g.rs.map((r) => r.page))].sort((a, b) => a - b),
      };
    if (vs.length === 1) {
      cell.values = vs[0]!;
      cell.method = solved.reduce((a, b) =>
        order.indexOf(a.method) < order.indexOf(b.method) ? a : b,
      ).method;
    } else if (vs.length > 1) {
      const full = distinct(solved.filter((r) => r.method === 'full').map((r) => r.v!));
      if (full.length === 1) {
        cell.values = full[0]!;
        cell.method = 'full';
      } else {
        conflicts.push(g.key);
        continue;
      }
    } else {
      const amb = g.res.filter((r) => r.method === 'ambiguous').map((r) => r.cands!);
      if (amb.length) {
        let common = amb[0]!;
        for (const a of amb.slice(1)) common = common.filter((s) => a.some((v) => eq(v, s)));
        if (common.length === 1) {
          cell.values = common[0]!;
          cell.method = 'unique';
        } else {
          cell.method = 'ambiguous';
          cell.cands = sorted(distinct(common.length ? common : amb[0]!));
        }
      }
    }
    if (
      cell.values &&
      g.res.some((r) => r.method === 'ambiguous' && !r.cands!.some((s) => eq(s, cell.values!)))
    ) {
      conflicts.push(g.key);
      cell.values = null;
      cell.method = 'bad';
    }
    cells.set(id, { key: g.key, cell });
  }
  return { cells, conflicts };
}
const policy = (k: string) =>
  k !== 'total' && k.length === 10 && k.endsWith('.00') && k.slice(5, 7) !== '00';
export function resolveProgrammeStructure(cells: ProgrammeCells): number {
  const byLabel = new Map<string, string[]>();
  for (const {
    key: [label, key],
  } of cells.values()) {
    const keys = byLabel.get(label) ?? [];
    keys.push(key);
    byLabel.set(label, keys);
  }
  let resolved = 0;
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (const [label, keys] of byLabel)
      for (const parent of ['total', ...keys.filter(policy)]) {
        if (!cells.has(JSON.stringify([label, parent]))) continue;
        const kids = keys.filter((k) =>
          parent === 'total'
            ? policy(k)
            : k !== 'total' && k.startsWith(parent.slice(0, 8)) && !k.endsWith('.00'),
        );
        if (!kids.length) continue;
        const members = [parent, ...kids].map((k) => cells.get(JSON.stringify([label, k]))!.cell),
          opts = members.map((c) =>
            c.values ? [c.values] : c.method === 'ambiguous' ? c.cands : null,
          );
        if (opts.some((o) => !o)) continue;
        const options = opts as number[][][],
          amb = options.map((o, i) => (o.length > 1 ? i : -1)).filter((i) => i >= 0);
        if (!amb.length || amb.reduce((n, i) => n * options[i]!.length, 1) > 50000) continue;
        const base = Array.from({ length: 9 }, (_, c) =>
            pythonFloatSum(
              options.slice(1).flatMap((o, i) => (amb.includes(i + 1) ? [] : [o[0]![c]!])),
            ),
          ),
          keep = new Map(amb.map((i) => [i, new Set<string>()])),
          chosen = options.map((o) => o[0]!);
        const walk = (depth: number) => {
          if (depth === amb.length) {
            const par = chosen[0]!;
            for (let c = 0; c < 9; c++)
              if (
                Math.abs(
                  par[c]! -
                    base[c]! -
                    pythonFloatSum(amb.filter((i) => i !== 0).map((i) => chosen[i]![c]!)),
                ) >
                0.06 * (kids.length + 1)
              )
                return;
            for (const i of amb) keep.get(i)!.add(vectorKey(chosen[i]!));
            return;
          }
          const i = amb[depth]!;
          for (const v of options[i]!) {
            chosen[i] = v;
            walk(depth + 1);
          }
        };
        walk(0);
        for (const i of amb) {
          const narrowed = options[i]!.filter((v) => keep.get(i)!.has(vectorKey(v)));
          if (!narrowed.length) continue;
          const c = members[i]!;
          if (narrowed.length === 1) {
            c.values = narrowed[0]!;
            c.method = 'structure';
            c.cands = null;
            resolved++;
            changed = true;
          } else if (narrowed.length < options[i]!.length) {
            c.cands = narrowed;
            changed = true;
          }
        }
      }
    if (!changed) break;
  }
  return resolved;
}
