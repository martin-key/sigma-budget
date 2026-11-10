import { crc32 } from 'node:zlib';
import { zipMember } from '../../build/annual-lineage.js';
import { assert } from '../pdf/index.js';

export interface EmfText {
  offset: number;
  x: number;
  y: number;
  text: string;
}
/** Actual EMR_EXTTEXTOUTW records. All offsets/counts are bounded to their record,
 * including optional dx arrays. No execution/rendering of GDI records. */
export function readEmfTexts(bytes: Uint8Array): EmfText[] {
  assert(bytes.length >= 88 && bytes.length <= 16 * 1024 * 1024, 'EMF byte limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(
    view.getUint32(0, true) === 1 && view.getUint32(40, true) === 0x464d4520,
    'Invalid EMF header',
  );
  assert(view.getUint32(48, true) === bytes.length, 'EMF declared byte length mismatch');
  const declared = view.getUint32(52, true);
  assert(declared > 1 && declared <= 100_000, 'EMF record limit');
  const texts: EmfText[] = [];
  let offset = 0,
    count = 0,
    eof = false;
  while (offset < bytes.length) {
    assert(offset + 8 <= bytes.length && ++count <= declared, 'Truncated EMF record');
    const type = view.getUint32(offset, true),
      size = view.getUint32(offset + 4, true);
    assert(size >= 8 && size % 4 === 0 && size <= bytes.length - offset, 'Invalid EMF record size');
    if (type === 84) {
      assert(size >= 76, 'Truncated EMR_EXTTEXTOUTW');
      const chars = view.getUint32(offset + 44, true),
        start = view.getUint32(offset + 48, true),
        options = view.getUint32(offset + 52, true),
        dx = view.getUint32(offset + 72, true);
      assert(
        chars <= 1_000_000 && start >= 76 && start <= size && chars * 2 <= size - start,
        'EMF string bounds',
      );
      assert(!(options & 0x10), 'EMF glyph-index text is unsupported');
      if (dx)
        assert(
          dx >= 76 && dx <= size && chars * (options & 0x2000 ? 8 : 4) <= size - dx,
          'EMF advance bounds',
        );
      const text = new TextDecoder('utf-16le', { fatal: true }).decode(
        bytes.subarray(offset + start, offset + start + chars * 2),
      );
      texts.push({
        offset,
        x: view.getInt32(offset + 36, true),
        y: view.getInt32(offset + 40, true),
        text,
      });
    }
    offset += size;
    if (type === 14) {
      eof = true;
      break;
    }
  }
  assert(eof && offset === bytes.length && count === declared, 'EMF EOF/record count mismatch');
  return texts;
}

/** Bounded shared ZIP decoder plus member CRC and local-header consistency. */
export function readFiscalZipMember(bytes: Uint8Array, name: string): Buffer {
  const result = zipMember(bytes, name),
    b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = b.length - 22;
  while (!(b.readUInt32LE(end) === 0x06054b50 && end + 22 + b.readUInt16LE(end + 20) === b.length))
    end--;
  let p = b.readUInt32LE(end + 16);
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    const n = b.readUInt16LE(p + 28),
      extra = b.readUInt16LE(p + 30),
      comment = b.readUInt16LE(p + 32);
    if (b.subarray(p + 46, p + 46 + n).toString('utf8') === name) {
      const local = b.readUInt32LE(p + 42),
        flags = b.readUInt16LE(p + 8);
      assert(
        crc32(result) === b.readUInt32LE(p + 16) &&
          b.readUInt16LE(local + 6) === flags &&
          (flags & 8 ||
            [14, 18, 22].every(
              (at, j) => b.readUInt32LE(local + at) === b.readUInt32LE(p + [16, 20, 24][j]!),
            )),
        'Fiscal ZIP CRC/local header mismatch',
      );
    }
    p += 46 + n + extra + comment;
  }
  return result;
}
