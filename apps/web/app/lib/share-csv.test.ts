import { expect, it } from 'vitest';
import { csvFor } from '../../client/share.js';
import { parseCsv } from '../../../../tests/e2e/helpers.ts';

it('exports UTF-8 BOM, CRLF, single-line cells and the required provenance columns', () => {
  const csv = csvFor({
    source: ['minfin'],
    period: '2027 · евро',
    scope: 'kfp',
    table: {
      columns: ['Показател', 'Стойност'],
      rows: [['ред\nс продължение', 12.5]],
    },
  });
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  const [header, row] = parseCsv(csv.slice(1));
  expect(header).toEqual([
    'Показател',
    'Стойност',
    'период',
    'единица',
    'обхват',
    'издание',
    'статус',
    'източник',
  ]);
  expect(row).toHaveLength(header!.length);
  expect(row![0]).toBe('ред с продължение');
  expect(row![1]).toBe('12,5');
  expect(row!.at(-1)).not.toBe('');
});
it('guards spreadsheet formulas without changing numeric negative values', () => {
  const values = ['=1+1', '+cmd', '-cmd', '@SUM(A1)', '\tcmd', '＝cmd', '＋cmd', '－cmd', '＠cmd'];
  const rows = parseCsv(
    csvFor({
      table: { columns: ['Текст'], rows: [...values.map((v) => [v]), [-3.08]] },
    }).slice(1),
  );
  for (const row of rows.slice(1, -1)) expect(row[0]).toMatch(/^'/);
  expect(rows.at(-1)![0]).toBe('-3,08');
});
