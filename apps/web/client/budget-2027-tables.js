// budget2027-tables.json (D37): the printed tables of the 06.11.2026 publication that budget2027.json leaves out —
// the 2027–2029 ceilings by budget organisation (Annexes 4–8 of the motives), the bill's captioned tables (arts. 2, 6, 11,
// 16, 49 and 50) and further АСБП tables. Every number is a cell {value, unit, provenance} of the shared provenance index
// (budget2027-provenance.json); this module only selects and formats them. A missing file or cell prints a gap or a dash.
import { html } from './html.js';
import { num, DASH } from './format.js';
import { periodByKey } from './periods.js';
import { cellValue } from './budget-2027.js';

export const TABLES = 'budget2027-tables';
export const tablesOf = (ctx) => ctx.data?.[TABLES] || null;

/** Bulgarian names of the measures printed in Annexes 7 and 8 (three columns per year) */
const MEASURES = { net: 'общо (нето)', expenditure: 'разходи', transfer: 'трансфери (нето)' };

/** the printed columns of a table that carry cells; `index` is the cell key */
export function publishedColumns(doc, table) {
  return (doc?.forecastColumns?.[table] || [])
    .map((c, index) => ({ ...c, index }))
    .filter((c) => c.period);
}
export const columnLabel = (c) =>
  `${periodByKey(c.period)?.label || c.year}${c.measure && MEASURES[c.measure] ? ' · ' + MEASURES[c.measure] : ''}`;

/** a published number; an empty printed cell prints a dash. Not a link: its provenance record is an API answer for machines, the
    reader finds the source of the table under its „Източник“ button (the record itself is in budget2027-provenance) */
export function cellText(cell, d = 1) {
  const v = cellValue(cell);
  if (v == null) return html`<span class="muted" title="Празна печатна клетка">${DASH}</span>`;
  return html`${num(v, d)}`;
}

/** rows of a forecast table for dataTable: one numeric column per published column */
export function forecastTable(doc, table, { columns, rows, d = () => 1 } = {}) {
  const cols = columns || publishedColumns(doc, table);
  const source = (doc?.forecast?.[table] || []).map((r, i) => ({ ...r, index: i }));
  const picked = rows ? rows.map((i) => source[i]).filter(Boolean) : source;
  return {
    columns: [
      { key: 'label', label: 'Показател' },
      { key: 'unit', label: 'Единица' },
      ...cols.map((c) => ({
        key: 'c' + c.index,
        label: columnLabel(c),
        num: true,
        fmt: (v, r) => cellText(r['_c' + c.index], d(r, c)),
      })),
    ],
    rows: picked.map((r) => {
      const out = { label: r.label, unit: '', _index: r.index };
      for (const c of cols) {
        const cell = r.cells?.[String(c.index)];
        out['c' + c.index] = cellValue(cell);
        out['_c' + c.index] = cell;
        if (cell?.unit && !out.unit) out.unit = cell.unit;
      }
      return out;
    }),
  };
}

/** the ceiling row (Annex 4 or 5) of a bill article, with its 2027–2029 cells by period */
export function ceilingOf(doc, article) {
  const ref = doc?.ceilingArticles?.[String(article)];
  const row = ref && doc.forecast?.[ref.table]?.[ref.row];
  if (!row) return null;
  const cells = {};
  for (const c of publishedColumns(doc, ref.table))
    cells[c.period] = row.cells?.[String(c.index)] || null;
  return {
    table: ref.table,
    row: ref.row,
    label: row.label,
    cells,
    recommended: ref.table === 'annex5',
  };
}

/** every printed row of Annexes 4 and 5 for one period, with the bill article it belongs to (null for the funds) */
export function ceilingRows(doc, period) {
  const articleOf = {};
  for (const [article, ref] of Object.entries(doc?.ceilingArticles || {}))
    articleOf[`${ref.table}/${ref.row}`] = article;
  return ['annex4', 'annex5'].flatMap((table) => {
    const column = publishedColumns(doc, table).find((c) => c.period === period);
    return (doc?.forecast?.[table] || []).map((r, i) => ({
      table,
      label: r.label,
      article: articleOf[`${table}/${i}`] || null,
      part: /^в\s*т\.\s*ч\./i.test(r.label),
      cell: column ? r.cells?.[String(column.index)] || null : null,
    }));
  });
}

/** the captioned tables printed inside one budget of the bill (judiciary bodies, arts. 6, 11 and 16) */
export function captionedTables(doc, variant, article) {
  const b = doc?.budgets?.[variant]?.[String(article)];
  return (b?.captions || []).map((c) => ({
    ...c,
    rows: (b[c.section] || []).slice(c.first, c.first + c.count),
  }));
}
