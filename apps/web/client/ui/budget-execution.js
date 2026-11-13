import { html } from '../html.js';
import { block } from './block.js';
import { dataTable } from './table.js';
import { disclosure } from './disclosure.js';
import { num, DASH } from '../format.js';
const SCOPES = {
  consolidated: 'Консолидирана КФП',
  central: 'Централно правителство',
  social: 'Социалноосигурителни фондове (ДОО и НЗОК)',
  local: 'Местни власти',
};
const money = (v) => (v === null || v === undefined ? DASH : num(v, 3));
export function budgetExecution(ctx) {
  const monthly = ctx.data['state-budget'],
    quarterly = ctx.data['kfp-subsectors'];
  if (!monthly || !quarterly) return '';
  const monthlyTables = monthly.tables.map((t) => {
    const rows = t.rows.filter((r) => r.row >= 9 && r.row <= (t.year === 2025 ? 19 : 18));
    return disclosure({
      id: `state-${t.year}-${t.period}`,
      title: `${t.year} г., месец ${t.period}`,
      body: dataTable({
        id: `state-table-${t.year}-${t.period}`,
        caption: 'Държавен бюджет, натрупано от януари, млн. €',
        columns: [
          { key: 'label', label: 'Показател' },
          { key: 'law', label: 'Закон', num: true, fmt: money },
          { key: 'execution', label: 'Изпълнение', num: true, fmt: money },
        ],
        rows: rows.map((r) => ({ label: r.label, law: r.eur[0], execution: r.eur[1] })),
      }),
    });
  });
  const subsectors = quarterly.tables.map((t) =>
    disclosure({
      id: `quarter-${t.scope}-${t.year}`,
      title: `${SCOPES[t.scope]}, ${t.year} г.`,
      body: dataTable({
        id: `quarter-table-${t.scope}-${t.year}`,
        caption: 'Потоци за отделното тримесечие, млн. €',
        columns: [
          { key: 'label', label: 'Показател' },
          ...t.columns.map((c, i) => ({
            key: c.id,
            label: c.id,
            num: true,
            fmt: (_, r) => money(r.eur[i]),
          })),
        ],
        rows: t.rows
          .filter((r) =>
            [
              8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 23, 26, 28, 40, 41, 42, 44, 47, 49,
            ].includes(r.row),
          )
          .map((r) => ({ label: r.label, eur: r.eur })),
      }),
    }),
  );
  return html`${block({ id: 'state-budget-taxes', title: monthly.meta.title, source: monthly.meta.source, asOf: monthly.meta.asOf, body: html`<p>${monthly.limitations.join(' ')}</p><p>Законът е годишен, а изпълнението е натрупано от януари до съответния месец. „—“ означава празна клетка в оригинала.</p>${monthlyTables}` })}${block({ id: 'kfp-subsector-taxes', title: quarterly.meta.title, source: quarterly.meta.source, asOf: quarterly.meta.asOf, body: html`<p>${quarterly.limitations.join(' ')}</p><p>${quarterly.missing[0].reason}</p>${subsectors}` })}`;
}
