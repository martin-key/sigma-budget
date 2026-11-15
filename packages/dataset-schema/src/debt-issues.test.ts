import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { debtIssuesGuard, validDebtIsin } from './debt-issues.js';
const load = () =>
  JSON.parse(
    readFileSync(new URL('../../../data/release/debt-issues.json', import.meta.url), 'utf8'),
  );
it('accepts the published debt snapshot', () => expect(debtIssuesGuard(load())).toBe(true));
for (const field of [
  'meta',
  'schema',
  'sourceSha256',
  'sourceUrl',
  'domestic',
  'external',
  'auctions',
  'maturity',
  'stock',
  'differences',
  'limitations',
  'validation',
])
  it('rejects missing ' + field, () => {
    const d = load();
    delete d[field];
    expect(debtIssuesGuard(d)).toBe(false);
  });
for (const v of [null, [], false, 1, 'bad'])
  it('rejects a non-object ' + JSON.stringify(v), () => expect(debtIssuesGuard(v)).toBe(false));
for (const [name, change] of Object.entries({
  asOf: (d: any): unknown => (d.meta.asOf = '2026-08-31'),
  originalBucket: (d: any): unknown => (d.maturity[1].originalTenths = 'bad'),
  absentBucket: (d: any): unknown => delete d.maturity[1].originalTenths,
  printedDash: (d: any): unknown => (d.maturity[0].originalTenths = 0),
  oversizedBucket: (d: any): unknown => (d.maturity[0].residualTenths = 1001),
  id: (d: any): unknown => (d.meta.id = 'D00'),
  status: (d: any): unknown => (d.meta.status = 'pending'),
  mock: (d: any): unknown => (d.meta.mock = true),
  schema: (d: any): unknown => (d.schema = 'other'),
  sha: (d: any): unknown => (d.sourceSha256 = 'x'),
  url: (d: any): unknown => (d.sourceUrl = 'other'),
  domesticCount: (d: any): unknown => d.domestic.pop(),
  externalCount: (d: any): unknown => d.external.pop(),
  auctionCount: (d: any): unknown => d.auctions.pop(),
  domesticRow: (d: any): unknown => (d.domestic[0] = {}),
  externalRow: (d: any): unknown => (d.external[0] = {}),
  auctionRow: (d: any): unknown => (d.auctions[0] = {}),
  currency: (d: any): unknown => (d.domestic[0].currency = 'USD'),
  externalCurrency: (d: any): unknown => (d.external[0].currency = 'BGN'),
  amount: (d: any): unknown => (d.domestic[0].nominal = 0),
  fraction: (d: any): unknown => (d.external[0].nominal = 0.1),
  date: (d: any): unknown => (d.domestic[0].maturity = '2026-02-30'),
  order: (d: any): unknown => (d.external[0].maturity = '2000-01-01'),
  isin: (d: any): unknown => (d.domestic[0].isin = 'invalid'),
  externalIsin: (d: any): unknown => (d.external[0].isins = ['XS1208855880']),
  duplicate: (d: any): unknown => (d.domestic[1].isin = d.domestic[0].isin),
  emptyIsins: (d: any): unknown => (d.external[0].isins = []),
  auctionIsin: (d: any): unknown => (d.auctions[0].isin = 'invalid'),
  auctionOrder: (d: any): unknown => (d.auctions[0].maturity = '2000-01-01'),
  auctionAmount: (d: any): unknown => (d.auctions[0].approved = d.auctions[0].offered + 1),
  duplicateAuction: (d: any): unknown => (d.auctions[1] = d.auctions[0]),
  buckets: (d: any): unknown => d.maturity.pop(),
  bucketRow: (d: any): unknown => (d.maturity[0] = {}),
  stock: (d: any): unknown => (d.stock.domestic = -1),
  difference: (d: any): unknown => (d.differences.domesticStock = 'x'),
  limitation: (d: any): unknown => (d.limitations = [1]),
  validation: (d: any): unknown => (d.validation = [{}]),
  statusCheck: (d: any): unknown => (d.validation[0].outcome = 'OK'),
}))
  it('rejects ' + name, () => {
    const d = load();
    change(d);
    expect(debtIssuesGuard(d)).toBe(false);
  });
it('rejects malformed ISIN strings and dates', () => {
  expect(validDebtIsin('invalid')).toBe(false);
  const d = load();
  d.domestic[0].issueDate = 'not-a-date';
  expect(debtIssuesGuard(d)).toBe(false);
});
