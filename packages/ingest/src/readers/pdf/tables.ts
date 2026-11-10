import { pythonFloatSum } from '../../common/numbers.js';
import {
  type Box,
  type PdfPage,
  type PdfChar,
  type PdfEdge,
  textInBox,
  ws,
  union,
  midY,
  midX,
  assert,
} from './index.js';
export interface PdfTable {
  bbox: Box;
  cells: Box[];
  rows: (Box | null)[][];
  rawCells: string[][];
}
const corners = (b: Box) =>
  [
    [b[0], b[1]],
    [b[0], b[3]],
    [b[2], b[1]],
    [b[2], b[3]],
  ].map((p) => p.join(','));
function cluster<T>(items: T[], key: (x: T) => number, tolerance: number): T[][] {
  const groups: T[][] = [];
  for (const item of items.slice().sort((a, b) => key(a) - key(b))) {
    const g = groups.at(-1);
    if (g && key(item) - key(g.at(-1)!) <= tolerance) g.push(item);
    else groups.push([item]);
  }
  return groups;
}
function cellText(allChars: PdfChar[], box: Box): string {
  const chars = allChars.filter(
    (c) =>
      midX(c.bbox) >= box[0] &&
      midX(c.bbox) < box[2] &&
      midY(c.bbox) >= box[1] &&
      midY(c.bbox) < box[3],
  );
  const lines = cluster(chars, (c) => c.bbox[1], 3);
  return ws(
    lines
      .map((line) => {
        let end = -Infinity,
          text = '';
        for (const c of line.sort((a, b) => a.bbox[0] - b.bbox[0])) {
          if (c.bbox[0] - end > 3 && !text.endsWith(' ')) text += ' ';
          text += c.text;
          end = c.bbox[2];
        }
        return text;
      })
      .join(' '),
  );
}
/** Bordered/Word-layout grids only, using 3pt snap/join/intersection bounds.
 * Blank cells remain empty and merged ownership remains in rows/cells. */
export function ruledTables(page: PdfPage): PdfTable[] {
  const allChars = page.blocks
    .flatMap((b) => b.lines)
    .flatMap((l) => l.spans)
    .flatMap((s) => s.chars);
  const edges: PdfEdge[] = page.edges.map((e) => ({ ...e }));
  const bounds = page.pathBounds.slice().sort((a, b) => a[3] - b[3] || a[0] - b[0]);
  while (bounds.length) {
    let b = bounds.shift()!,
      changed = true;
    while (changed) {
      changed = false;
      for (let i = bounds.length - 1; i >= 0; i--) {
        const c = bounds[i]!;
        if (b[0] <= c[2] + 3 && c[0] <= b[2] + 3 && b[1] <= c[3] + 3 && c[1] <= b[3] + 3) {
          b = union([b, c]);
          bounds.splice(i, 1);
          changed = true;
        }
      }
    }
    if (!textInBox(page, b).trim()) continue;
    edges.push(
      { axis: 'h', at: b[1], lo: b[0], hi: b[2] },
      { axis: 'h', at: b[3], lo: b[0], hi: b[2] },
      { axis: 'v', at: b[0], lo: b[1], hi: b[3] },
      { axis: 'v', at: b[2], lo: b[1], hi: b[3] },
    );
  }
  const clipped = edges
    .filter((e) =>
      e.axis === 'v'
        ? e.at >= page.bbox[0] && e.at <= page.bbox[2]
        : e.at >= page.bbox[1] && e.at <= page.bbox[3],
    )
    .map((e) => ({
      ...e,
      lo: Math.max(e.lo, page.bbox[e.axis === 'v' ? 1 : 0]),
      hi: Math.min(e.hi, page.bbox[e.axis === 'v' ? 3 : 2]),
    }));
  const snapped: PdfEdge[] = [];
  for (const axis of ['v', 'h'] as const)
    for (const g of cluster(
      clipped.filter((e) => e.axis === axis && e.hi - e.lo >= 1),
      (e) => e.at,
      3,
    )) {
      const average = pythonFloatSum(g.map((e) => e.at)) / g.length;
      for (const e of g) snapped.push({ ...e, at: e.at + (average - e.at) });
    }
  const merged: PdfEdge[] = [];
  for (const e of snapped.sort(
    (a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.lo - b.lo,
  )) {
    const prev = merged.at(-1);
    if (prev && prev.axis === e.axis && prev.at === e.at && e.lo <= prev.hi + 3)
      prev.hi = Math.max(prev.hi, e.hi);
    else merged.push({ ...e });
  }
  const vs = merged.filter((e) => e.axis === 'v' && e.hi - e.lo >= 3),
    hs = merged.filter((e) => e.axis === 'h' && e.hi - e.lo >= 3);
  const pts = new Map<string, { x: number; y: number; v: Set<PdfEdge>; h: Set<PdfEdge> }>();
  for (const v of vs)
    for (const h of hs)
      if (v.lo <= h.at + 3 && v.hi >= h.at - 3 && v.at >= h.lo - 3 && v.at <= h.hi + 3) {
        const key = [v.at, h.at].join(',');
        let p = pts.get(key);
        if (!p) {
          p = { x: v.at, y: h.at, v: new Set(), h: new Set() };
          pts.set(key, p);
        }
        p.v.add(v);
        p.h.add(h);
      }
  assert(pts.size <= 100_000, 'PDF grid intersection limit');
  const points = [...pts.values()].sort((a, b) => a.x - b.x || a.y - b.y),
    cells: Box[] = [];
  const connected = (a: (typeof points)[number], b: typeof a) =>
    (a.x === b.x && [...a.v].some((e) => b.v.has(e))) ||
    (a.y === b.y && [...a.h].some((e) => b.h.has(e)));
  for (const p of points) {
    let found = false;
    for (const down of points.filter((q) => q.x === p.x && q.y > p.y)) {
      if (!connected(p, down)) continue;
      for (const right of points.filter((q) => q.y === p.y && q.x > p.x)) {
        if (!connected(p, right)) continue;
        const br = pts.get([right.x, down.y].join(','));
        if (br && connected(br, right) && connected(br, down)) {
          cells.push([p.x, p.y, right.x, down.y]);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  const groups: Box[][] = [],
    remaining = cells.slice();
  while (remaining.length) {
    const group = [remaining.shift()!],
      seen = new Set(corners(group[0]!));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i]!;
        if (corners(c).some((p) => seen.has(p))) {
          group.push(c);
          for (const p of corners(c)) seen.add(p);
          remaining.splice(i--, 1);
          changed = true;
        }
      }
    }
    groups.push(group);
  }
  return groups
    .filter(
      (g) =>
        new Set(g.map((b) => b[0])).size > 1 &&
        new Set(g.map((b) => b[2])).size > 1 &&
        textInBox(page, union(g)).trim(),
    )
    .sort((a, b) => union(a)[1] - union(b)[1] || union(a)[0] - union(b)[0])
    .map((cells) => {
      const xs = [...new Set(cells.map((c) => c[0]))].sort((a, b) => a - b),
        ys = [...new Set(cells.map((c) => c[1]))].sort((a, b) => a - b);
      const rows = ys.map((y) =>
        xs.map((x) => cells.find((c) => c[0] === x && c[1] === y) ?? null),
      );
      return {
        bbox: union(cells),
        cells,
        rows,
        rawCells: rows.map((row) => {
          const boxes = row.filter((c): c is Box => c !== null);
          const band = union(boxes);
          const rowChars = allChars.filter(
            (c) => midY(c.bbox) >= band[1] && midY(c.bbox) < band[3],
          );
          return row.map((c) => (c ? cellText(rowChars, c) : ''));
        }),
      };
    });
}
