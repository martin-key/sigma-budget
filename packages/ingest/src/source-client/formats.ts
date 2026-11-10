import { extname } from 'node:path';

export type ByteKind =
  | 'pdf'
  | 'zip'
  | 'xls'
  | '7z'
  | 'json'
  | 'xml'
  | 'html'
  | 'text'
  | 'empty'
  | 'gzip';
export function byteKind(bytes: Uint8Array): ByteKind {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 4).equals(Buffer.from('%PDF'))) return 'pdf';
  if (b.subarray(0, 2).equals(Buffer.from('PK'))) return 'zip';
  if (b.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) return 'xls';
  if (b.subarray(0, 6).equals(Buffer.from('377abcaf271c', 'hex'))) return '7z';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  const text = b
    .subarray(0, 8192)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  if (!b.length) return 'empty';
  if (/^[{[]/.test(text)) return 'json';
  if (/<html\b|<!doctype\s+html/.test(text)) return 'html';
  if (/^<\?xml\s/.test(text)) return 'xml';
  return 'text';
}
const kinds: Record<string, ByteKind> = {
  pdf: 'pdf',
  xls: 'xls',
  xlsx: 'zip',
  docx: 'zip',
  zip: 'zip',
  '7z': '7z',
  json: 'json',
  jsonld: 'json',
  geojson: 'json',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  txt: 'text',
  csv: 'text',
};
export function validateBytes(path: string, bytes: Buffer, format?: string): ByteKind {
  const want = kinds[extname(path).slice(1).toLowerCase()] ?? kinds[format ?? ''];
  if (!want) throw new Error('No byte-kind validator for ' + path);
  const got = byteKind(bytes);
  if (got !== want) throw new Error(`Wrong format: expected ${want}, received ${got}`);
  if (got === 'json') {
    const doc: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''),
    );
    if (typeof doc !== 'object' || doc === null) throw new Error('Expected JSON object or array');
  }
  if (got === 'html') {
    const text = bytes.toString('utf8');
    if (
      /<input\b[^>]*type\s*=\s*["']?password|<title[^>]*>\s*(?:just a moment|access denied|sign in|log\s*in)|cf-chl-|captcha|verify you are human|проверка за сигурност/i.test(
        text,
      )
    )
      throw new Error('Login or challenge HTML is not source data');
  }
  return got;
}
