import { SearchRows } from '../build/aggregation-search.js';
import { formatMoney, formatThousands } from '../common/format.js';
import { isNumber } from '../io/data.js';

/** Keep the existing 250 KB budget with every programme searchable. Full source
 * names remain in D09; only repeated boilerplate is omitted from search labels. */
export function compactProgrammeSearch(base: any, index: any, ministries: any) {
  const fields = Object.fromEntries(index.fields.map((key: string, i: number) => [key, i])),
    names = new Map(ministries.items.map((m: any) => [m.id, m.short]));
  const programmeRows = new SearchRows();
  for (const row of index.items) {
    const code = String(row[fields.code]),
      id = String(row[fields.ministry]),
      name = row[fields.name];
    if (!name) throw new Error('Programme search requires a source name');
    const title = String(name).replace(
      /^(?:Бюджетна програма\s+|Политика в областта на\s+|Политика за\s+|Програма \d+\.\s*|Функционална област \S+\s+)/u,
      '',
    );
    const level = row[fields.level],
      value = row[fields.y2026];
    if (!names.has(id)) throw new Error('Programme search requires a known agency');
    if (value !== index.sentinels.noData && !isNumber(value))
      throw new Error('Programme search has a non-numeric source amount');
    const amount =
      value === index.sentinels.noData
        ? ''
        : Math.abs(value) >= 1000
          ? formatMoney(value / 1000)
          : formatThousands(value, 1);
    programmeRows.add(
      'institutions',
      title,
      `${names.get(id)} ${code}`,
      amount,
      id === '7400' ? 'Прогноза 2026' : 'Проект 2026',
      'real',
      `#/vedomstvo/${id}${level === 'policy' ? '' : '/' + code}`,
    );
  }
  const position = base.items.findIndex((r: any[]) => r[0] === 1);
  if (position < 0) throw new Error('Programme search insertion point absent');
  const result = {
    ...base,
    items: [...base.items.slice(0, position), ...programmeRows.rows, ...base.items.slice(position)],
  };
  if (programmeRows.rows.length !== index.items.length)
    throw new Error('Programme search lost or duplicated a row');
  if (Buffer.byteLength(JSON.stringify(result) + '\n') >= 250000)
    throw new Error('Production search index exceeds the unchanged 250000 B budget');
  return result;
}
