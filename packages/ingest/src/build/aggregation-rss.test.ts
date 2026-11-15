import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildRss, editorialSiteName, rssDate, type RssFeed } from './aggregation-rss.js';

const fixture = resolve(import.meta.dirname, '../../test/fixtures/aggregation-rss');
const siteName = editorialSiteName(
  JSON.parse(readFileSync(resolve(fixture, '../aggregation/inputs/glossary.json'), 'utf8')),
);
const cases = JSON.parse(readFileSync(join(fixture, 'cases.json'), 'utf8')) as Record<
  string,
  { base: string; feed: RssFeed }
>;

describe('RSS donor serializer', () => {
  it.each(Object.entries(cases))(
    'matches Python UTF-8 bytes and XML semantics: %s',
    (name, input) => {
      const xml = buildRss(input.feed, input.base, '2026-11-08', siteName);
      const oracle = JSON.parse(readFileSync(join(fixture, 'oracle', `${name}.json`), 'utf8')) as {
        xml: string;
      };
      expect(Buffer.from(xml)).toEqual(Buffer.from(oracle.xml));
      const dir = mkdtempSync(join(tmpdir(), 'rss-parity-'));
      try {
        const file = join(dir, 'candidate.xml');
        writeFileSync(file, xml);
        const python = process.env.PYTHON312 || 'python3.12';
        const result = spawnSync(
          python,
          [join(fixture, 'generate_oracle.py'), '--check', '--compare', file, '--case', name],
          { encoding: 'utf8' },
        );
        expect(result.error?.message ?? result.stderr).toBe('');
        expect(result.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
  it('matches Python integer date tokens', () => {
    expect(rssDate(' 2_024 -٠٢-+29 ')).toBe('Thu, 29 Feb 2024 12:00:00 +0000');
  });
  it('rejects invalid dates and unknown categories', () => {
    for (const day of ['2026-02-29', '2024-13-01', '0000-01-01', '2026-11', 'x-1-1'])
      expect(() => rssDate(day)).toThrow();
    expect(() =>
      buildRss(
        {
          kinds: [],
          events: [{ id: 'x', date: '2026-01-01', kind: 'missing', title: 'x', href: '#/x' }],
        },
        'https://example.test',
        '2026-11-08',
        siteName,
      ),
    ).toThrow(/kind/);
  });
});

it('derives historical and current product names from their editorial inputs', () => {
  const current = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../../data/inputs/glossary.json'), 'utf8'),
  );
  expect(siteName).toBe('Бюджет на светло');
  expect(editorialSiteName(current)).toBe('СИГМА Бюджет');
  const feed = { kinds: [], events: [] };
  expect(
    buildRss(feed, 'https://example.test/', '2026-11-08', editorialSiteName(current)),
  ).toContain('<title>СИГМА Бюджет: какво е ново</title>');
  expect(buildRss(feed, 'https://example.test/', '2026-11-08', 'Other & <site>')).toContain(
    '<title>Other &amp; &lt;site&gt;: какво е ново</title>',
  );
  for (const input of [
    {},
    { source: { footer: 'missing delimiter' } },
    { source: { footer: ' | empty' } },
  ])
    expect(() => editorialSiteName(input)).toThrow(/editorial site identity/);
});
