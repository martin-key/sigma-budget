import { html } from '../html.js';
import { block } from './block.js';
import { dataTable } from './table.js';
import { chart } from './chart.js';
import { num, date } from '../format.js';
export function debtIssues(ctx) {
  const d = ctx.data['debt-issues'];
  if (!d) return '';
  const rows = [
    ...d.domestic.map((r) => ({ ...r, id: r.isin })),
    ...d.external.map((r) => ({ ...r, id: r.isins.join(' / ') })),
  ].sort((a, b) => a.maturity.localeCompare(b.maturity) || a.id.localeCompare(b.id));
  return block({
    id: 'debt-issues-snapshot',
    title: d.meta.title,
    source: ['minfin'],
    asOf: d.meta.asOf,
    body: html`
 <p>Към 30.09.2026 г., по номинал, предварителни данни на МФ. <a href="${d.sourceUrl}">Месечен бюлетин на МФ</a>.</p>
 ${d.limitations.slice(1).map((t) => html`<p>${t}</p>`)}
 ${dataTable({
   id: 'debt-issues-outstanding',
   caption: 'Емисии в обращение, по номинал в посочената валута',
   captionVisible: true,
   columns: [
     { key: 'id', label: 'ISIN' },
     { key: 'currency', label: 'Валута' },
     { key: 'issueDate', label: 'Емитиране', fmt: date },
     { key: 'maturity', label: 'Падеж', fmt: date },
     { key: 'nominal', label: 'Номинал', num: true, fmt: (v) => num(v, 0) },
     {
       key: 'coupon',
       label: 'Купон, %',
       num: true,
       fmt: (v) => (v === undefined ? '—' : num(v, 3)),
     },
   ],
   rows,
 })}
 ${chart({ id: 'debt-issues-maturity', type: 'barh', title: 'Остатъчен матуритет на държавния дълг към 30.09.2026 г.', unit: '%', categories: d.maturity.map((r) => r.label), series: [{ name: 'Дял от държавния дълг', data: d.maturity.map((r) => r.residualTenths / 10) }] })}
 ${dataTable({
   id: 'debt-issues-maturity-table',
   caption: 'Отпечатана матуритетна структура на държавния дълг, %',
   captionVisible: true,
   columns: [
     { key: 'label', label: 'Срок' },
     { key: 'original', label: 'Оригинален матуритет', num: true },
     { key: 'residual', label: 'Остатъчен матуритет', num: true },
   ],
   rows: d.maturity.map((r) => ({
     label: r.label,
     original: r.originalTenths === undefined ? '—' : num(r.originalTenths / 10, 1),
     residual: num(r.residualTenths / 10, 1),
   })),
 })}
 ${dataTable({
   id: 'debt-issues-auctions',
   caption: 'Аукциони през 2026 г. до 30 септември, EUR',
   captionVisible: true,
   columns: [
     { key: 'date', label: 'Дата', fmt: date },
     { key: 'isin', label: 'ISIN' },
     { key: 'offered', label: 'Предложено', num: true, fmt: (v) => num(v, 0) },
     { key: 'approved', label: 'Одобрено', num: true, fmt: (v) => num(v, 0) },
     { key: 'price', label: 'Цена за 100 EUR', num: true, d: 2 },
     { key: 'yield', label: 'Доходност, %', num: true, d: 2 },
     { key: 'coverage', label: 'Покритие', num: true, d: 2 },
   ],
   rows: d.auctions,
 })}
 `,
  });
}
