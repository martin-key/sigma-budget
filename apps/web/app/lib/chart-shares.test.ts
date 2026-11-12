import { expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { chart } from '../../client/ui/chart.js';
import { foldShares } from '../../client/calc.js';

const number = (text: string | null | undefined) =>
  Number(
    String(text)
      .replace(/[\s  %]/g, '')
      .replace(',', '.'),
  );

it('folds a pie tail into one share: the sum of the tail’s apportioned shares', () => {
  expect(foldShares([50, 30, 10, 5, 5], 3)).toEqual([50, 30, 10, 10]);
  expect(foldShares([60, 40], 3)).toEqual([60, 40]);
  expect(foldShares([60, 40, null, null], 2)).toEqual([60, 40, null]);
});

it('a folded donut shows the same share for a part in its legend and in its table', () => {
  // twelve equal parts: 100 / 12 is 8,33…, so four parts get 8,4 and eight get 8,3
  const data = Array.from({ length: 12 }, (_, i) => ({ name: `Част ${i + 1}`, value: 1 }));
  const { document } = parseHTML(
    `<div>${String(chart({ id: 'test-pie', type: 'donut', legendValues: true, data }))}</div>`,
  );
  const legend = [...document.querySelectorAll('.lg-pct')].map((el) => number(el.textContent));
  const table = [...document.querySelectorAll('#test-pie-t tbody tr')].map((tr) =>
    number(tr.lastElementChild?.textContent),
  );
  expect(table).toHaveLength(12);
  expect(legend).toHaveLength(9);
  expect(Math.round(table.reduce((a, v) => a + v, 0) * 10) / 10).toBe(100);
  expect(legend.slice(0, 8)).toEqual(table.slice(0, 8));
  expect(legend[8]).toBe(Math.round(table.slice(8).reduce((a, v) => a + v, 0) * 10) / 10);
});
