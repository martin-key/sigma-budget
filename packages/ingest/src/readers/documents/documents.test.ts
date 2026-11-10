import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLegalHtml, parseLegalDocx } from './index.js';
import { parseXml } from './xml.js';

/** Owned minimal OOXML test archive. No production evidence is synthesized. */
function zip(entries: [string, string][]): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const filename = Buffer.from(name),
      bytes = Buffer.from(text),
      crc = crc32(bytes);
    const l = Buffer.alloc(30),
      c = Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(bytes.length, 18);
    l.writeUInt32LE(bytes.length, 22);
    l.writeUInt16LE(filename.length, 26);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(bytes.length, 20);
    c.writeUInt32LE(bytes.length, 24);
    c.writeUInt16LE(filename.length, 28);
    c.writeUInt32LE(offset, 42);
    local.push(l, filename, bytes);
    central.push(c, filename);
    offset += l.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const doc = (body: string) => `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`;
const archive = (text: string) => zip([['word/document.xml', text]]);

describe('raw legal documents', () => {
  it('preserves HTML paragraph/table order, entities and empty physical cells', () => {
    const html = `<table><tr><td><p>Чл. 1. Първи&nbsp;член</p><table><tr><td>№</td><td>Приходи</td><td>1 000,1</td></tr><tr><td></td><td>Нулеви</td><td>0</td></tr></table><p>Чл. 2.<br>Следващ</p></td></tr></table>`;
    expect(parseLegalHtml(html)).toEqual([
      ['p', 'Чл. 1. Първи член'],
      [
        't',
        [
          ['№', 'Приходи', '1 000,1'],
          ['', 'Нулеви', '0'],
        ],
      ],
      ['p', 'Чл. 2. Следващ'],
    ]);
  });
  it('retains DOCX physical cells/merges and splits prose rows without inventing cells', () => {
    const bytes = archive(
      doc(
        `<w:bookmarkStart w:id="1"/>${p('Чл. 1. Законопроект')}<w:tbl><w:tr><w:tc>${p('Увод')}</w:tc><w:tc>${p('')}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr>${p('Приходи')}</w:tc><w:tc>${p('1 000,1')}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>${p('')}</w:tc><w:tc>${p('–')}</w:tc></w:tr></w:tbl>${p('Чл. 2. Следващ')}<w:bookmarkEnd w:id="1"/>`,
      ),
    );
    const result = parseLegalDocx(bytes);
    expect(result.blocks).toEqual([
      ['p', 'Чл. 1. Законопроект'],
      ['p', 'Увод'],
      [
        't',
        [
          ['Приходи', '1 000,1'],
          ['', '–'],
        ],
      ],
      ['p', 'Чл. 2. Следващ'],
    ]);
    expect(result.tables[0]?.rows[1]?.[0]).toEqual({
      text: 'Приходи',
      gridSpan: 2,
      verticalMerge: 'restart',
    });
    expect(result.tables[0]?.rows[2]?.[0]?.verticalMerge).toBe('continue');
    expect(result.member.path).toBe('word/document.xml');
  });
  it('retains nested table identity independently of the legal projection', () => {
    const result = parseLegalDocx(
      archive(
        doc(
          `${p('Чл. 1. Законопроект')}<w:tbl><w:tr><w:tc>${p('Външна')}<w:tbl><w:tr><w:tc>${p('Вътрешна')}</w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>`,
        ),
      ),
    );
    expect(result.tables.map((t) => [t.index, t.parentTable])).toEqual([
      [0, null],
      [1, 0],
    ]);
    expect(result.tables[1]?.rows[0]?.[0]?.text).toBe('Вътрешна');
  });
  it('rejects missing/duplicate ZIP main parts and CRC corruption', () => {
    expect(() => parseLegalDocx(zip([['elsewhere.xml', doc(p('Чл. 1.'))]]))).toThrow(/missing/);
    const text = doc(p('Чл. 1.'));
    expect(() =>
      parseLegalDocx(
        zip([
          ['word/document.xml', text],
          ['word/document.xml', text],
        ]),
      ),
    ).toThrow(/duplicate/);
    const broken = archive(text);
    const at = broken.indexOf(Buffer.from('Чл. 1.'));
    broken[at] = broken[at]! ^ 1;
    expect(() => parseLegalDocx(broken)).toThrow(/CRC/);
  });
  it('rejects wrong-format documents, malformed XML and unsupported content', () => {
    expect(() => parseLegalHtml('<p>HTTP access denied</p>')).toThrow(/article 1/);
    expect(() => parseLegalDocx(Buffer.from('<html>denied</html>'))).toThrow(/ZIP/);
    expect(() => parseLegalDocx(archive('<document><body/></document>'))).toThrow(/namespace/);
    expect(() => parseLegalDocx(archive(doc(p('Чл. 1.') + '<w:altChunk/>')))).toThrow(
      /Unsupported/,
    );
    expect(() => parseXml('<a><b></a>')).toThrow();
  });
  it('rejects DTD and external entities without fetching', () => {
    expect(() => parseXml('<!DOCTYPE a SYSTEM "https://invalid.test/source"><a/>')).toThrow(
      /DOCTYPE/,
    );
    expect(() => parseXml('<a>&unknown;</a>')).toThrow();
  });
});
