// Attribution follows the selected record and the provenance of the displayed cells.
import { selectPeriod } from '../periods.js';
import { html } from '../html.js';
import { date } from '../format.js';

const TABLES = {
  III_1: 'Табл. III-1',
  annex1_execution2026: 'Приложение 1',
  annex3_mln: 'Приложение 3',
  annex3_pct_gdp: 'Приложение 3 (% от БВП)',
};
const norm = (text) =>
  String(text)
    .toLowerCase()
    .replace(/^р-ди/, 'разходи')
    .replace(/[^а-яa-z0-9]/g, '');
const SECTION = { functions: 'По функции', rows: 'По икономически вид' };

export function annualLocations(record, provenance, { sections, functionLabel } = {}) {
  const selected = sections || [Object.keys(record?.series || {}).length ? 'series' : 'rows'];
  return selected
    .map((section) => {
      const rows =
        section === 'series'
          ? Object.values(record.series || {})
          : (record[section] || [])
              .filter((row) => !functionLabel || norm(row.label) === norm(functionLabel))
              .map((row) => row.cell);
      const tables = new Map();
      for (const cell of rows) {
        const entry = provenance?.entries?.[cell?.provenance];
        const source = provenance?.documents?.[entry?.document]?.source;
        if (
          !entry ||
          typeof entry.table !== 'string' ||
          entry.period !== record.periodKey ||
          !record.sourceRefs?.includes(source)
        )
          continue;
        const pages = tables.get(entry.table) || new Set();
        if (Number.isInteger(entry.page)) pages.add(entry.page);
        tables.set(entry.table, pages);
      }
      const text = [...tables]
        .map(
          ([table, pages]) =>
            `${TABLES[table] || table}${pages.size ? `, стр. ${[...pages].sort((a, b) => a - b).join(', ')}` : ''}`,
        )
        .join('; ');
      return text ? `${sections ? `${SECTION[section] || section}: ` : ''}${text}.` : '';
    })
    .filter(Boolean)
    .join(' ');
}

export function annualSourceText(record, options = {}) {
  if (!record?.available) return '';
  const published = record.publication ? ` Публикация от ${date(record.publication)} г.` : '';
  if (!record.legacy && record.sourceRefs?.includes('budget2027')) {
    const scope =
      record.status === 'law'
        ? `Приет закон за ${record.year} г.`
        : record.status === 'expected'
          ? `Очаквано изпълнение за ${record.year} г.; оценка на МФ, не отчет.`
          : record.status === 'draft'
            ? `Проект за ${record.year} г.; не е приет закон.`
            : `Прогноза за ${record.year} г.`;
    const locations = annualLocations(record, options.provenance, options);
    return `${scope} Източник: МФ, АСБП 2027–2029.${published}${locations ? ` ${locations}` : ''}`;
  }
  if (record.legacy && ['plan', 'draft', 'forecast'].includes(record.vintage))
    return `Исторически проект за 2026 г. и прогнози към него.${published} Приетият закон може да се различава от проекта.`;
  return `Отчетни данни за ${record.year} г. от историческата серия.${published}`;
}

export function annualSource(ctx, dataset, options = {}) {
  const record =
    dataset?.records?.find((r) => r.periodKey === ctx.period.key) ||
    selectPeriod(dataset, ctx.period.key);
  return html`${annualSourceText(record, {
    provenance: ctx.data['budget2027-provenance'],
    ...options,
  })}`;
}
