import { resolve } from 'node:path';
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import * as share from '../../client/share.js';
import { debtIssues } from '../../client/ui/debt-issues.js';
import { num } from '../../client/format.js';
it('shows the dated nominal snapshot, a maturity chart/table and unconverted USD', () => {
  const data = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../../data/release/debt-issues.json'), 'utf8'),
  );
  const spy = vi.spyOn(share, 'attach');
  const text = String(debtIssues({ data: { 'debt-issues': data } }));
  expect(text).toContain('30.09.2026');
  expect(text).toContain('предварителни данни');
  expect(text).toContain('USD');
  expect(text).toContain('не е превалутирана');
  expect(text).toContain('debt-issues-maturity');
  expect(text).toContain('debt-issues-auctions');
  expect(text).toContain('Падеж');
  expect(text).toContain('—');
  const table = spy.mock.calls.find(([id]) => id === 'debt-issues-outstanding')![1] as {
    table: () => { rows: unknown[][] };
  };
  expect(table.table().rows).toHaveLength(30);
  const rows = table.table().rows;
  const usd = rows.find((r) => String(r[0]).includes('XS2890436087'))!;
  expect(usd[1]).toBe('USD');
  const rendered = document.createElement('div');
  rendered.innerHTML = text;
  const auctions = rendered.querySelectorAll('#debt-issues-auctions tbody tr');
  expect(auctions).toHaveLength(data.auctions.length);
  for (const [i, row] of Array.from(auctions).entries()) {
    const cells = row.querySelectorAll('td');
    for (const [offset, field] of ['price', 'yield', 'coverage'].entries())
      expect(cells[3 + offset]?.textContent).toBe(num(data.auctions[i][field], 2));
  }
  expect(text).not.toMatch(/undefined|\[object Object\]/);
  spy.mockRestore();
  expect(debtIssues({ data: {} })).toBe('');
});
