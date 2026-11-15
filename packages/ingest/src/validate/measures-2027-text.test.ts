import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipMember } from '../build/annual-lineage.js';
import { readPdf } from '../readers/pdf/index.js';
import { sha256 } from '../readers/annual/index.js';

type Entry = {
  id: string;
  starts: string;
  name: string;
  text: string;
  quote: string;
  law?: string;
  page: number;
  to?: number;
  tablePage: number;
};
const root = resolve(import.meta.dirname, '../../../..');
const member = 'ZDBRB-2027/4-UMTBF-2027-2029-motivi.pdf';
const norm = (text: string) =>
  text
    .replace(/(?<=[А-Яа-яA-Za-z])-\n(?=[а-яa-z])/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
const numbers = (text: string) => new Set(norm(text).match(/\d+(?: \d{3})*(?:,\d+)?/gu) ?? []);
let measures: Record<string, Entry[]>;
let laws: Record<string, string>;
let release: any;
let provenance: any;
const pages = new Map<number, string>();
const json = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8'));
beforeAll(async () => {
  const loaded = await import(pathToFileURL(join(root, 'apps/web/client/measures-2027.js')).href);
  measures = loaded.MEASURES_2027;
  laws = loaded.LAWS;
  release = await json('data/release/budget2027.json');
  provenance = await json('data/release/budget2027-provenance.json');
  const bytes = zipMember(
    await readFile(join(root, 'data/originals/budget_2027/ZDBRB-2027.zip')),
    member,
  );
  expect(provenance.documents.forecast.member).toBe(member);
  expect(sha256(bytes)).toBe(provenance.documents.forecast.memberSha256);
  const doc = readPdf(bytes);
  for (let n = 40; n < 56; n++)
    pages.set(n, norm(doc.pages[n - 1]!.text).replace(new RegExp(`^${n} `), ''));
}, 120_000);
function each() {
  return Object.entries(measures).flatMap(([table, entries]) =>
    entries.map((entry, i) => ({ table, entry, row: release.forecast[table][i] })),
  );
}
function assertQuote(entry: Entry) {
  const last = entry.to ?? entry.page;
  expect(last, entry.id).toBeGreaterThanOrEqual(entry.page);
  const text = Array.from({ length: last - entry.page + 1 }, (_, i) =>
    pages.get(entry.page + i),
  ).join(' ');
  expect(text, entry.id).toContain(norm(entry.quote));
  expect(pages.get(entry.page), entry.id).toContain(norm(entry.quote).slice(0, 60));
}
it('has one unique editorial entry for each printed measure, excluding the total', () => {
  const ids: string[] = [];
  for (const [table, entries] of Object.entries(measures)) {
    const rows = release.forecast[table];
    expect(rows.at(-1).label, table).toBe('Общо:');
    expect(entries, table).toHaveLength(rows.length - 1);
    ids.push(...entries.map((e) => e.id));
  }
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
});
it('keeps starts aligned with each printed row in its position', () => {
  for (const { entry, row } of each())
    expect(norm(row.label).startsWith(norm(entry.starts)), entry.id).toBe(true);
});
it('finds every complete verbatim quote on its cited PDF pages and its start on the first page', () => {
  for (const { entry } of each()) assertQuote(entry);
});
it('binds tablePage to every published cell of the same measure', () => {
  for (const { entry, row } of each()) {
    const actual = new Set(
      Object.values(row.cells).map((c: any) => provenance.entries[c.provenance].page),
    );
    expect(actual, entry.id).toEqual(new Set([entry.tablePage]));
  }
});
it('requires every named law in the law catalogue and the quote or printed row', () => {
  for (const { entry, row } of each()) {
    if (!entry.law) continue;
    expect(Object.hasOwn(laws, entry.law), entry.id).toBe(true);
    const source = norm(entry.quote + ' ' + row.label);
    expect(
      source.includes(entry.law) || source.includes(entry.law.replace(/^Закон /u, 'Закона ')),
      entry.id,
    ).toBe(true);
  }
});
it('takes every editorial number from that measure quote or printed row', () => {
  for (const { entry, row } of each()) {
    const source = new Set([...numbers(entry.quote), ...numbers(row.label)]);
    for (const field of ['name', 'text'] as const) {
      for (const number of numbers(entry[field]))
        expect(source.has(number), entry.id + ': ' + field + ' ' + number).toBe(true);
    }
  }
});
it('rejects one changed digit in a quote', () => {
  const entry = structuredClone(measures.II_7![0]!);
  entry.quote = entry.quote.replace(/\d/u, (digit) => String((Number(digit) + 1) % 10));
  expect(() => assertQuote(entry)).toThrow();
});
