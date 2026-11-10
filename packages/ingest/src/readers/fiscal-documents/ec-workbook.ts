/** Scoped EC tax named-sheet transport. Uses existing ZIP/XML helpers; no XLS engine. */
import { posix } from 'node:path';
import { parseXml, descendants, xmlText, type XmlNode } from '../documents/xml.js';
import { utf8 } from '../snapshots/pinned.js';
import { assert } from '../pdf/index.js';
import { readFiscalZipMember } from './emf.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const nodes = (n: XmlNode, name: string) =>
  [...descendants(n)].filter((c) => c.uri === M && c.local === name);
export function readEcTaxSheet(bytes: Uint8Array, title: string): Record<string, string> {
  const xml = (name: string) => parseXml(utf8(readFiscalZipMember(bytes, name)));
  const book = xml('xl/workbook.xml'),
    sheets = nodes(book, 'sheet').filter((s) => s.attributes.name === title);
  assert(sheets.length === 1, `EC missing/ambiguous worksheet ${title}`);
  const rid = sheets[0]!.attributes[`{${R}}id`],
    rels = xml('xl/_rels/workbook.xml.rels');
  const matches = rels.children.filter(
    (r) =>
      r.local === 'Relationship' &&
      r.attributes.Id === rid &&
      r.attributes.Type === R + '/worksheet' &&
      !r.attributes.TargetMode,
  );
  assert(matches.length === 1, 'EC invalid worksheet relationship');
  const target = matches[0]!.attributes.Target!;
  assert(target && !target.includes('\\') && !target.includes('\0'), 'EC unsafe worksheet target');
  const path = target.startsWith('/') ? target.slice(1) : posix.normalize('xl/' + target);
  assert(/^xl\/worksheets\/[^/]+\.xml$/u.test(path), 'EC worksheet outside workbook');
  const shared = nodes(xml('xl/sharedStrings.xml'), 'si').map((s) =>
      nodes(s, 't').map(xmlText).join(''),
    ),
    sheet = xml(path),
    result: Record<string, string> = Object.create(null);
  for (const c of nodes(sheet, 'c')) {
    const ref = c.attributes.r;
    assert(
      ref && /^[A-Z]{1,3}[1-9]\d{0,6}$/u.test(ref) && !Object.hasOwn(result, ref),
      'EC invalid/duplicate cell',
    );
    assert(!nodes(c, 'f').length, 'EC formula is unsupported');
    const v = nodes(c, 'v');
    assert(v.length <= 1, 'EC duplicate cell value');
    if (!v.length) continue;
    const text = xmlText(v[0]!);
    let value = text;
    if (c.attributes.t === 's') {
      assert(/^\d+$/u.test(text) && shared[Number(text)] !== undefined, 'EC invalid shared string');
      value = shared[Number(text)]!;
    } else
      assert(c.attributes.t === undefined || c.attributes.t === 'n', 'EC unsupported cell type');
    result[ref] = value;
  }
  return result;
}
