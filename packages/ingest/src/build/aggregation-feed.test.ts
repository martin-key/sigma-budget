import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { editorialSiteName } from './aggregation-rss.js';
import { buildFeed, type FeedInput } from './aggregation-feed.js';
import { executionNumbers } from './context.js';
import { pendingFromExecution } from './aggregation-core.js';
import { parseJsonStat } from '../io/data.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/aggregation');
const text = (name: string) => readFileSync(resolve(root, name), 'utf8');
const read = (name: string): any => JSON.parse(text(name));
const make = (): FeedInput => ({
  siteName: editorialSiteName(read('inputs/glossary.json')),
  buildDate: '2026-11-08',
  execution: executionNumbers(read('upstream/execution.json')),
  law: read('upstream/law.json'),
  rates: read('upstream/rates.json'),
  debt: read('upstream/debt.json'),
  expenditure: read('upstream/expenditure.json'),
  sebra: read('upstream/sebra.json'),
  budget2027: read('upstream/budget2027.json'),
  annualUpdated: read('archive/originals/eurostat/gov_10dd_edpt1_BG_EU.json').updated,
  quarterUpdated: read('archive/originals/eurostat/gov_10q_ggdebt_BG.json').updated,
  cofogUpdated: read('inputs/cofog_bg.json').updated,
  population: read('inputs/population.json'),
  populationStat: parseJsonStat(text('archive/originals/eurostat/tps00001_BG.json')),
  populationAsOf: read('authored.json').populationAsOf,
  pending: read('authored.json').pending,
});
describe('feed from frozen donor inputs', () => {
  it('matches the complete raw donor and RSS bytes', () => {
    const actual = buildFeed(make());
    expect(actual.feed).toEqual(read('raw/feed.json'));
    expect(actual.rss).toBe(text('raw/feed.xml'));
  });
  it('propagates changed publication, owner text, count and source date', () => {
    const input = make();
    input.budget2027.publication = '2026-11-07';
    input.law.timeline[0]!.title = 'Промяна & <данни>';
    input.sebra.overall.count++;
    input.rates.meta.asOf = '2026-08-13';
    input.annualUpdated='2026-10-22T11:00:00+0200'; input.debt.latest.maastricht.asOf='2026-10-22';
    input.quarterUpdated='2026-10-23T11:00:00+0200'; input.debt.latest.maastricht.quarter.asOf='2026-10-23';
    input.cofogUpdated='2026-09-17T23:00:00+0200';
    const actual = buildFeed(input);
    expect(actual.feed).toEqual(read('mutants/feed-changed.json'));
    expect(actual.rss).toBe(text('mutants/feed-changed.xml'));
  });
  it('uses pending report wording derived from changed execution data', () => {
    const input = make();
    input.execution.pendingMonths[0]!.month = 11;
    input.execution.pendingMonths[0]!.asOf = '2026-11-30';
    input.pending = pendingFromExecution(read('authored.json').pending, input.execution);
    expect(buildFeed(input).feed).toEqual(read('mutants/feed-pending.json'));
  });
  it('rejects future or invalid dates, inconsistent debt and population', () => {
    const a = make();
    a.budget2027.publication = '2026-11-09';
    expect(() => buildFeed(a)).toThrow(/after build/);
    const b = make();
    b.budget2027.publication = '2026-02-30';
    expect(() => buildFeed(b)).toThrow(/invalid date/);
    const c = make();
    c.annualUpdated = '2026-01-01';
    expect(() => buildFeed(c)).toThrow(/debt/);
    const d = make();
    d.population.persons[0] = 1;
    expect(() => buildFeed(d)).toThrow(/population/);
    const e = make();
    const timeline = e.law.timeline.filter((x) => x.phase === 'parliament');
    for (const x of timeline.slice(0, 3)) x.date = '2026-07-01';
    timeline[0]!.kind = 'same';
    timeline[1]!.kind = 'same';
    timeline[2]!.kind = 'same-2';
    expect(() => buildFeed(e)).toThrow(/duplicate/);
    const f = make();
    f.baseUrl = 'https://example.test/path?x=1&y=2';
    expect(buildFeed(f).rss).toContain('https://example.test/path?x=1&amp;y=2/');
  });
});

it('uses the current editorial identity without changing feed events or other RSS bytes', () => {
  const input = make();
  const historical = buildFeed(input);
  const current = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../data/inputs/glossary.json'), 'utf8'));
  input.siteName = editorialSiteName(current);
  const actual = buildFeed(input);
  expect(actual.feed).toEqual(historical.feed);
  expect(actual.rss).toBe(historical.rss.replace(
    '<title>Бюджет на светло: какво е ново</title>',
    '<title>СИГМА Бюджет: какво е ново</title>',
  ));
});
