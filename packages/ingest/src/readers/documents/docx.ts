import { crc32 } from 'node:zlib';
import { zipMember } from '../../build/annual-lineage.js';
import type { GazetteBlock } from '../../build/law-types.js';
import { parseXml, descendants, type XmlNode } from './xml.js';
import { splitParagraphRows, whitespace } from './html.js';
import { utf8 } from '../snapshots/pinned.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const word = (node: XmlNode, name: string) => node.uri === W && node.local === name;
const children = (node: XmlNode, name: string) => node.children.filter((n) => word(n, name));

/** Reuse the bounded archive reader, additionally verify the main part's CRC
 * and physical local flags/CRC/sizes (or the declared data-descriptor flag). */
function documentMember(bytes: Uint8Array): Buffer {
  const name = 'word/document.xml',
    b = Buffer.from(bytes);
  const result = zipMember(b, name);
  let end = b.length - 22;
  while (
    end >= 0 &&
    !(b.readUInt32LE(end) === 0x06054b50 && end + 22 + b.readUInt16LE(end + 20) === b.length)
  )
    end--;
  let p = b.readUInt32LE(end + 16);
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    const n = b.readUInt16LE(p + 28),
      extra = b.readUInt16LE(p + 30),
      comment = b.readUInt16LE(p + 32);
    if (b.subarray(p + 46, p + 46 + n).toString('utf8') === name) {
      const local = b.readUInt32LE(p + 42),
        flags = b.readUInt16LE(p + 8);
      if (
        b.readUInt32LE(p + 16) !== crc32(result) ||
        b.readUInt16LE(local + 6) !== flags ||
        (!(flags & 8) &&
          [14, 18, 22].some(
            (offset, j) => b.readUInt32LE(local + offset) !== b.readUInt32LE(p + [16, 20, 24][j]!),
          ))
      )
        throw new Error('DOCX member CRC or local header mismatch');
    }
    p += 46 + n + extra + comment;
  }
  return result;
}

function paragraphText(node: XmlNode): string {
  const out: string[] = [];
  for (const child of descendants(node)) {
    if (word(child, 't')) out.push(child.content.filter((c) => typeof c === 'string').join(''));
    else if (['tab', 'br', 'cr'].some((n) => word(child, n))) out.push(' ');
  }
  return whitespace(out.join(''));
}

export interface PhysicalCell {
  text: string;
  gridSpan: number;
  verticalMerge: 'restart' | 'continue' | null;
}
export interface PhysicalTable {
  /** Index among all physical w:tbl elements, in XML order. */
  index: number;
  parentTable: number | null;
  rows: PhysicalCell[][];
}
export interface DocxDocument {
  blocks: GazetteBlock[];
  /** No merged-cell expansion, deduplication or guessed blank-cell values. */
  tables: PhysicalTable[];
  member: { path: 'word/document.xml'; bytes: number; crc32: number };
}

/** Transitional OOXML main document. Header/footer, drawing/EMF, equations,
 * numbering/styles and tracked-deletion rendering are not reconstructed. */
export function parseLegalDocx(bytes: Uint8Array): DocxDocument {
  const member = documentMember(bytes),
    root = parseXml(utf8(member));
  if (!word(root, 'document')) throw new Error('DOCX main part has wrong namespace/root');
  const bodies = children(root, 'body');
  if (bodies.length !== 1) throw new Error('DOCX main part must have one body');
  const body = bodies[0]!,
    tables: PhysicalTable[] = [];
  const physicalIndices = new Map<XmlNode, number>();
  const value = (node: XmlNode | undefined) => node?.attributes[`{${W}}val`];
  function physical(node: XmlNode, parent: number | null): void {
    let current = parent;
    if (word(node, 'tbl')) {
      current = tables.length;
      physicalIndices.set(node, current);
      const rows = children(node, 'tr').map((tr) =>
        children(tr, 'tc').map((tc): PhysicalCell => {
          const properties = children(tc, 'tcPr')[0];
          const span = properties ? children(properties, 'gridSpan')[0] : undefined;
          const merge = properties ? children(properties, 'vMerge')[0] : undefined;
          const gridSpan = span ? Number(value(span)) : 1;
          const verticalMerge = merge ? (value(merge) ?? 'continue') : null;
          if (
            !Number.isSafeInteger(gridSpan) ||
            gridSpan < 1 ||
            gridSpan > 1024 ||
            ![null, 'restart', 'continue'].includes(verticalMerge)
          )
            throw new Error('Invalid DOCX cell properties');
          return {
            text: [...descendants(tc)]
              .filter((n) => word(n, 'p'))
              .map(paragraphText)
              .filter(Boolean)
              .join(' '),
            gridSpan,
            verticalMerge: verticalMerge as PhysicalCell['verticalMerge'],
          };
        }),
      );
      tables.push({ index: current, parentTable: parent, rows });
    }
    for (const child of node.children) physical(child, current);
  }
  physical(body, null);
  const blocks: GazetteBlock[] = [];
  for (const child of body.children) {
    if (word(child, 'p')) {
      const text = paragraphText(child);
      if (text) blocks.push(['p', text]);
    } else if (word(child, 'tbl'))
      blocks.push([
        't',
        tables[physicalIndices.get(child)!]!.rows.map((r) => r.map((c) => c.text)),
      ]);
    else if (!['sectPr', 'bookmarkStart', 'bookmarkEnd'].some((n) => word(child, n)))
      throw new Error(`Unsupported DOCX body block: ${child.local}`);
  }
  const ordered = splitParagraphRows(blocks);
  if (!ordered.some((b) => b[0] === 'p' && /^Чл\.\s*1\./u.test(b[1])))
    throw new Error('Legal DOCX has no article 1');
  return {
    blocks: ordered,
    tables,
    member: { path: 'word/document.xml', bytes: member.length, crc32: crc32(member) },
  };
}
