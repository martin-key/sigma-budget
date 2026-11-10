/** Node-only physical PDF reader. Coordinates are PDF points, top-left origin.
 * MuPDF decodes the supplied bytes; no OCR, source fetching or capture fallback. */
import mupdf, { type Path, type Matrix } from 'mupdf';
import { createHash } from 'node:crypto';
import { ruledTables, type PdfTable } from './tables.js';
export type Box = [number, number, number, number];
export interface PdfChar {
  text: string;
  bbox: Box;
  origin: [number, number];
}
export interface PdfSpan {
  text: string;
  bbox: Box;
  font: string;
  size: number;
  bold: boolean;
  chars: PdfChar[];
}
export interface PdfLine {
  bbox: Box;
  wmode: number;
  direction: [number, number];
  spans: PdfSpan[];
}
export interface PdfBlock {
  bbox: Box;
  lines: PdfLine[];
}
export interface PdfEdge {
  axis: 'h' | 'v';
  at: number;
  lo: number;
  hi: number;
}
export interface PdfPage {
  number: number;
  bbox: Box;
  width: number;
  height: number;
  text: string;
  blocks: PdfBlock[];
  edges: PdfEdge[];
  pathBounds: Box[];
}
export interface PdfDocument {
  sha256: string;
  engine: 'mupdf@1.26.4';
  method: string;
  pages: PdfPage[];
  metadata: Record<string, string>;
}
export interface PdfLimits {
  maxBytes?: number;
  maxPages?: number;
  maxChars?: number;
  maxPathsPerPage?: number;
}
export const union = (boxes: Box[]): Box => [
  Math.min(...boxes.map((b) => b[0])),
  Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])),
  Math.max(...boxes.map((b) => b[3])),
];
export const midX = (b: Box) => (b[0] + b[2]) / 2;
export const midY = (b: Box) => (b[1] + b[3]) / 2;
export const ws = (s: string | null | undefined) => (s ?? '').replace(/\s+/gu, ' ').trim();
export function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function textInBox(page: PdfPage, box: Box): string {
  return page.blocks
    .flatMap((b) => b.lines)
    .map((l) =>
      l.spans
        .flatMap((s) => s.chars)
        .filter(
          (c) =>
            midX(c.bbox) >= box[0] &&
            midX(c.bbox) < box[2] &&
            midY(c.bbox) >= box[1] &&
            midY(c.bbox) < box[3],
        )
        .map((c) => c.text)
        .join(''),
    )
    .filter((t) => t.trim())
    .join('\n');
}
export function search(page: PdfPage, needle: string): Box[] {
  const hits: Box[] = [];
  for (const b of page.blocks)
    for (const l of b.lines) {
      const chars = l.spans.flatMap((s) => s.chars),
        text = chars.map((c) => c.text).join('');
      let start = 0,
        at: number;
      while ((at = text.indexOf(needle, start)) >= 0) {
        hits.push(union(chars.slice(at, at + needle.length).map((c) => c.bbox)));
        start = at + needle.length;
      }
    }
  return hits;
}
export interface PositionedSpan {
  text: string;
  x: number;
  x0: number;
  y: number;
  bold: boolean;
}
/** Monetary fragments retain their printed separators and exact character extents. */
export function spans(page: PdfPage): PositionedSpan[] {
  const result: PositionedSpan[] = [];
  for (const b of page.blocks)
    for (const l of b.lines)
      for (const s of l.spans) {
        for (const m of s.text.matchAll(/\S(?:.*?\S)?(?=\s{2,}|\s*$)/gu)) {
          const chars = s.chars.slice(m.index, m.index + m[0].length);
          const money = [...m[0].matchAll(/[−-]?\d+(?:\s+\d{3})*,\d+%?/gu)];
          const tokens =
            money.length > 1 && !m[0].replace(/[−-]?\d+(?:\s+\d{3})*,\d+%?/gu, '').trim()
              ? money
              : [{ 0: m[0], index: 0 }];
          for (const t of tokens) {
            const part = chars.slice(t.index!, t.index! + t[0]!.length),
              text = t[0]!.trim();
            const baseline = l.spans[0]?.chars[0]?.origin[1] ?? 0;
            const superscript = (s.chars[0]?.origin[1] ?? baseline) < baseline - s.size * 0.1;
            if (!text || text === String(page.number) || (superscript && /^\d+$/.test(text)))
              continue;
            result.push({
              text,
              x: (part[0]!.bbox[0] + part.at(-1)!.bbox[2]) / 2,
              x0: part[0]!.bbox[0],
              y: midY(s.bbox),
              bold: s.bold,
            });
          }
        }
      }
  return result;
}
export function words(page: PdfPage): { text: string; bbox: Box }[] {
  return page.blocks
    .flatMap((b) => b.lines)
    .flatMap((l) => {
      const chars = l.spans.flatMap((s) => s.chars),
        text = chars.map((c) => c.text).join('');
      return [...text.matchAll(/\S+/gu)].map((m) => ({
        text: m[0],
        bbox: union(chars.slice(m.index, m.index + m[0].length).map((c) => c.bbox)),
      }));
    });
}
const tableCache = new WeakMap<PdfPage, PdfTable[]>();
export function pdfTables(page: PdfPage): PdfTable[] {
  let tables = tableCache.get(page);
  if (!tables) {
    tables = ruledTables(page);
    tableCache.set(page, tables);
  }
  return tables;
}
export function readPdf(bytes: Uint8Array, limits: PdfLimits = {}): PdfDocument {
  const bound = (n: number | undefined, d: number) => {
    assert(n === undefined || (Number.isSafeInteger(n) && n > 0), 'Invalid PDF limit');
    return n ?? d;
  };
  const maxBytes = bound(limits.maxBytes, 32 * 1024 * 1024),
    maxPages = bound(limits.maxPages, 500),
    maxChars = bound(limits.maxChars, 5_000_000),
    maxPaths = bound(limits.maxPathsPerPage, 30_000);
  assert(bytes.length > 5 && bytes.length <= maxBytes, 'PDF byte limit');
  assert(Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-', 'Invalid PDF header');
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    assert(!doc.needsPassword(), 'Encrypted PDF is unsupported');
    const count = doc.countPages();
    assert(count > 0 && count <= maxPages, 'PDF page limit');
    const metadata: Record<string, string> = {};
    for (const k of [
      'format',
      'info:Title',
      'info:Author',
      'info:Creator',
      'info:Producer',
      'info:CreationDate',
      'info:ModDate',
    ]) {
      const v = doc.getMetaData(k);
      if (v) metadata[k] = v;
    }
    const pages: PdfPage[] = [];
    let chars = 0;
    for (let i = 0; i < count; i++) {
      const page = doc.loadPage(i);
      try {
        const bbox = page.getBounds(),
          blocks: PdfBlock[] = [],
          edges: PdfEdge[] = [],
          pathBounds: Box[] = [];
        const st = page.toStructuredText('preserve-whitespace,preserve-ligatures');
        let block: PdfBlock, line: PdfLine, span: PdfSpan | undefined;
        try {
          st.walk({
            beginTextBlock: (b) => {
              block = { bbox: b, lines: [] };
              blocks.push(block);
            },
            beginLine: (b, wmode, direction) => {
              line = { bbox: b, spans: [], wmode, direction };
              block.lines.push(line);
              span = undefined;
            },
            onChar: (text, origin, font, size, q) => {
              try {
                chars += text.length;
                assert(chars <= maxChars, 'PDF character limit');
                const b: Box = [
                  Math.min(q[0], q[2], q[4], q[6]),
                  Math.min(q[1], q[3], q[5], q[7]),
                  Math.max(q[0], q[2], q[4], q[6]),
                  Math.max(q[1], q[3], q[5], q[7]),
                ];
                const name = font.getName(),
                  bold = font.isBold();
                if (
                  !span ||
                  span.font !== name ||
                  span.size !== size ||
                  span.bold !== bold ||
                  Math.abs((span.chars[0]?.origin[1] ?? origin[1]) - origin[1]) > 0.1
                ) {
                  span = { text: '', bbox: b, font: name, size, bold, chars: [] };
                  line.spans.push(span);
                }
                span.chars.push({ text, bbox: b, origin });
                span.text += text;
                span.bbox = union([span.bbox, b]);
              } finally {
                font.destroy();
              }
            },
          });
          const text = blocks
            .flatMap((b) => b.lines)
            .map((l) => l.spans.map((s) => s.text).join('') + '\n')
            .join('');
          const transform = (p: number[], m: number[]): [number, number] => [
            Math.fround(p[0]! * m[0]! + p[1]! * m[2]! + m[4]!),
            Math.fround(p[0]! * m[1]! + p[1]! * m[3]! + m[5]!),
          ];

          const path = (p: Path, m: Matrix) => {
            assert(pathBounds.length < maxPaths, 'PDF path limit');
            let points: [number, number][] = [],
              contours: [number, number][][] = [];
            p.walk({
              moveTo: (x, y) => {
                if (points.length) contours.push(points);
                points = [transform([x, y], m)];
              },
              lineTo: (x, y) => points.push(transform([x, y], m)),
              closePath: () => {
                if (points.length) points.push(points[0]!);
              },
              curveTo: () => {},
            });
            if (points.length) contours.push(points);

            const all = contours.flat();
            if (!all.length) return;
            const box: Box = [
              Math.min(...all.map((p) => p[0])),
              Math.min(...all.map((p) => p[1])),
              Math.max(...all.map((p) => p[0])),
              Math.max(...all.map((p) => p[1])),
            ];
            pathBounds.push(box);
            const add = (a: number[], b: number[]) => {
              let x0 = Math.max(bbox[0], Math.min(a[0]!, b[0]!)),
                x1 = Math.min(bbox[2], Math.max(a[0]!, b[0]!)),
                y0 = Math.max(bbox[1], Math.min(a[1]!, b[1]!)),
                y1 = Math.min(bbox[3], Math.max(a[1]!, b[1]!));
              if (x1 < x0 || y1 < y0) return;
              if (y1 - y0 <= 3 && x1 > x0)
                edges.push({ axis: 'h', at: (y0 + y1) / 2, lo: x0, hi: x1 });
              else if (x1 - x0 <= 3 && y1 > y0)
                edges.push({ axis: 'v', at: (x0 + x1) / 2, lo: y0, hi: y1 });
            };
            for (const contour of contours) {
              const xs = new Set(contour.map((p) => p[0])),
                ys = new Set(contour.map((p) => p[1]));
              if (xs.size === 2 && ys.size === 2 && contour.length >= 4) {
                const b = box,
                  w = b[2] - b[0],
                  h = b[3] - b[1];
                if (w <= 3 && w < h) add([(b[0] + b[2]) / 2, b[1]], [(b[0] + b[2]) / 2, b[3]]);
                else if (h <= 3 && h < w) add([b[0], (b[1] + b[3]) / 2], [b[2], (b[1] + b[3]) / 2]);
                else for (let j = 1; j < contour.length; j++) add(contour[j - 1]!, contour[j]!);
              } else for (let j = 1; j < contour.length; j++) add(contour[j - 1]!, contour[j]!);
            }
          };
          const device = new mupdf.Device({
            fillPath: (p, _e, m, colorspace) => {
              try {
                path(p, m);
              } finally {
                p.destroy();
                colorspace.destroy();
              }
            },
            strokePath: (p, stroke, m, colorspace) => {
              try {
                path(p, m);
              } finally {
                p.destroy();
                colorspace.destroy();
                stroke.destroy();
              }
            },
          });
          try {
            page.run(device, mupdf.Matrix.identity);
          } finally {
            try {
              device.close();
            } finally {
              device.destroy();
            }
          }
          pages.push({
            number: i + 1,
            bbox,
            width: bbox[2] - bbox[0],
            height: bbox[3] - bbox[1],
            text,
            blocks,
            edges,
            pathBounds,
          });
        } finally {
          st.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      engine: 'mupdf@1.26.4',
      method: 'MuPDF structured-text characters/font metrics and axis-aligned vector grid; no OCR',
      pages,
      metadata,
    };
  } finally {
    doc.destroy();
  }
}
