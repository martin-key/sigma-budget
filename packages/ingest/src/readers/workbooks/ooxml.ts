import { posix } from 'node:path';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { zipMember } from '../../build/annual-lineage.js';

export interface OoxmlCell {
  /** Exact <v> text, before IEEE-754 decoding (or a shared-string index). */
  rawValue?: string;
  formula?: string;
}
const main = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
]);
const attribute = (tag: SaxesTagNS, local: string) =>
  Object.values(tag.attributes).find((a) => a.local === local)?.value;
function xml(
  bytes: Uint8Array,
  member: string,
  open: (tag: SaxesTagNS) => void,
  text: (value: string) => void = () => {},
  close: (tag: SaxesTagNS) => void = () => {},
): void {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw new Error('DOCTYPE is not allowed in workbook XML');
  });
  parser.on('opentag', open);
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', close);
  parser.write(zipMember(bytes, member).toString('utf8')).close();
}
/** Supplement the workbook engine with exact OOXML scalar tokens. Names are resolved
 * through relationships, so reordered sheets and non-positional targets remain correct.
 */
export function ooxmlCells(bytes: Uint8Array): Record<string, Record<string, OoxmlCell>> {
  const sheets = new Map<string, string>(),
    relationships = new Map<string, string>();
  xml(bytes, 'xl/workbook.xml', (tag) => {
    if (main.has(tag.uri) && tag.local === 'sheet') {
      const name = attribute(tag, 'name'),
        rid = attribute(tag, 'id');
      if (!name || !rid || sheets.has(name)) throw new Error('Missing or duplicate OOXML sheet');
      sheets.set(name, rid);
    }
  });
  xml(bytes, 'xl/_rels/workbook.xml.rels', (tag) => {
    if (tag.local !== 'Relationship') return;
    const type = attribute(tag, 'Type');
    if (!type?.endsWith('/worksheet')) return;
    const id = attribute(tag, 'Id'),
      target = attribute(tag, 'Target');
    if (!id || !target || relationships.has(id) || attribute(tag, 'TargetMode') === 'External')
      throw new Error('Invalid workbook worksheet relationship');
    const path = posix.normalize(target.startsWith('/') ? target.slice(1) : 'xl/' + target);
    if (!path.startsWith('xl/') || path.includes('\\'))
      throw new Error('Unsafe workbook worksheet target');
    relationships.set(id, path);
  });
  const output: Record<string, Record<string, OoxmlCell>> = Object.create(null);
  for (const [name, rid] of sheets) {
    const member = relationships.get(rid);
    if (!member) throw new Error(`Missing worksheet relationship: ${name}`);
    const cells: Record<string, OoxmlCell> = Object.create(null);
    let address: string | undefined,
      cell: OoxmlCell | undefined,
      field: 'rawValue' | 'formula' | undefined;
    xml(
      bytes,
      member,
      (tag) => {
        if (!main.has(tag.uri)) return;
        if (tag.local === 'c') {
          address = attribute(tag, 'r');
          if (!address || !/^[A-Z]+[1-9][0-9]*$/.test(address) || cells[address])
            throw new Error('Missing or duplicate OOXML cell coordinate');
          cell = {};
          cells[address] = cell;
        } else if (cell && (tag.local === 'v' || tag.local === 'f')) {
          field = tag.local === 'v' ? 'rawValue' : 'formula';
          if (cell[field] !== undefined) throw new Error('Duplicate workbook scalar/formula');
          cell[field] = '';
        }
      },
      (value) => {
        if (cell && field) cell[field] += value;
      },
      (tag) => {
        if (!main.has(tag.uri)) return;
        if (tag.local === 'c') {
          address = undefined;
          cell = undefined;
          field = undefined;
        } else if (tag.local === 'v' || tag.local === 'f') field = undefined;
      },
    );
    output[name] = cells;
  }
  return output;
}
