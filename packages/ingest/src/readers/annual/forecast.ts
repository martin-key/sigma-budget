import { annualValue } from './json.js';
import {
  assert,
  spans,
  search,
  pdfTables,
  textInBox,
  words,
  midY,
  midX,
  type PdfDocument,
  type PdfPage,
  type PositionedSpan,
} from '../pdf/index.js';
import type { Extraction } from '../../build/annual-lineage.js';
import { TABLE_VINTAGES, STATUS_HEADERS } from './forecast-schema.js';
import { validateForecast } from './forecast-checks.js';
export type RecordData = Record<string, any>;
export interface ForecastRow extends RecordData {
  label: string;
  page: number;
  y: number;
  printed: (string | null)[];
  values: (number | null)[];
  units: (string | null)[];
}
export interface ForecastTable extends RecordData {
  caption: string;
  pages: number[];
  columns: RecordData[];
  rows: ForecastRow[];
}
export interface ForecastExtraction {
  source: Extraction['source'];
  tables: Record<string, ForecastTable>;
  [key: string]: any;
}
const round = (n: number) => Math.round(n * 100) / 100;
const sort = (a: PositionedSpan, b: PositionedSpan) => a.y - b.y || a.x - b.x;
const min = (xs: number[], fallback: number) => Math.min(...xs, fallback);
export function forecastNumber(s: string): number | null {
  const t = s.replace(/\s/gu, '').replace(/−/g, '-').replace('%', '');
  return /^[−-]?\d+(?:,\d+)?$/.test(t) ? Number(t.replace(',', '.')) : null;
}
function locate(doc: PdfDocument, caption: string): number {
  const hits = doc.pages.filter((p) => p.number > 5 && p.text.includes(caption));
  assert(hits.length === 1, `caption ${caption}: ${hits.map((p) => p.number)}`);
  return hits[0]!.number - 1;
}
export function columns(sp: PositionedSpan[], year: number, after = 0): PositionedSpan[] {
  const candidates = sp.filter(
    (s) => (s.text === String(year) || s.text === `${year} г.`) && s.y > after,
  );
  assert(candidates.length, `no year header ${year}`);
  const y = Math.min(...candidates.map((s) => s.y));
  return sp
    .filter((s) => Math.abs(s.y - y) < 3 && /^202\d(?: г\.)?$/.test(s.text))
    .sort((a, b) => a.x - b.x);
}
function makeRow(
  page: PdfPage,
  label: string,
  cells: PositionedSpan[][],
  unit: string,
): ForecastRow {
  const printed = cells.map(
    (c) =>
      c
        .slice()
        .sort(sort)
        .map((s) => s.text)
        .join(' ') || null,
  );
  return {
    label,
    page: page.number,
    y: round(cells.flat().length ? Math.min(...cells.flat().map((s) => s.y)) : 0),
    printed,
    values: printed.map((t) => (t ? forecastNumber(t) : null)),
    units: printed.map((t) => (t?.endsWith('%') && unit !== '%' ? '% от БВП' : unit)),
  };
}
function extractRows(
  page: PdfPage,
  heads: PositionedSpan[],
  ymin: number,
  ymax: number,
  edge: number,
  unit = 'млн. €',
  textCells = false,
): ForecastRow[] {
  const sp = spans(page).filter((s) => ymin < s.y && s.y < ymax),
    centers = heads.map((h) => h.x);
  const col = (x: number) =>
    centers.reduce((a, c, i) => (Math.abs(x - c) < Math.abs(x - centers[a]!) ? i : a), 0);
  let data = sp.filter((s) => s.x0 > edge).map((s) => ({ ...s, col: col(s.x) }));
  if (textCells) {
    data = data.filter((s) => s.x0 > 400);
    const labels = sp.filter((s) => 84 < s.x0 && s.x0 < 330).sort(sort);
    let starts = [
      ...sp.filter((s) => s.x0 < 85 && /^\d+(?:\.\d+)*\.$/.test(s.text)).map((s) => s.y),
      ...labels.filter((s) => s.text.startsWith('- ')).map((s) => s.y),
    ];
    starts = starts
      .map((y) =>
        Math.max(...labels.filter((s) => y - 9 <= s.y && s.y <= y + 1).map((s) => s.y), -Infinity),
      )
      .map((v, i) => (Number.isFinite(v) ? v : starts[i]!))
      .sort((a, b) => a - b);
    const groups: PositionedSpan[][] = [];
    for (const s of labels) {
      if (!groups.length || starts.some((y) => groups.at(-1)!.at(-1)!.y + 1 < y && y <= s.y + 1))
        groups.push([]);
      groups.at(-1)!.push(s);
    }
    const bounds = groups.map((g) => g[0]!.y - 2);
    if (page.number === 183)
      for (let i = 0; i < groups.length; i++) {
        const label = groups[i]!.map((s) => s.text).join(' ');
        if (label.startsWith('Акциз на течност') || label.startsWith('Акциз на нагреваемо изделие'))
          bounds[i]! -= 23;
        else if (
          label.startsWith('- съдържащ никотин до') ||
          label.startsWith('- съдържащ никотин над')
        )
          bounds[i]! -= 29;
      }
    const rows: ForecastRow[] = [];
    if (data.length && Math.min(...data.map((s) => s.y)) < bounds[0]!)
      rows.push({
        ...makeRow(
          page,
          '(continued)',
          heads.map((_, k) => data.filter((s) => s.col === k && s.y < bounds[0]!)),
          unit,
        ),
        continuation: true,
        band: [ymin, bounds[0]],
      });
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!,
        lo = bounds[i]!,
        hi = bounds[i + 1] ?? ymax;
      const codes = sp.filter(
        (t) => t.x0 < 85 && /^\d+(?:\.\d+)*\.$/.test(t.text) && Math.abs(t.y - g[0]!.y) < 9,
      );
      rows.push({
        ...makeRow(
          page,
          g.map((s) => s.text).join(' '),
          heads.map((_, k) => data.filter((s) => s.col === k && lo <= s.y && s.y < hi)),
          unit,
        ),
        band: [round(lo), round(hi)],
        continuation: !starts.some((y) => Math.abs(y - g[0]!.y) < 2),
        source_no: codes[0]?.text.replace(/\.$/, '') ?? null,
      });
    }
    return rows;
  }
  const used = new Set<number>();
  data.forEach((s, i) => {
    if (/^\d{1,2}$/.test(s.text)) {
      const next = data
        .map((t, j) => ({ t, j }))
        .filter(
          ({ t }) =>
            t.col === s.col && 2 < t.y - s.y && t.y - s.y < 13 && /^\d{3},\d+$/.test(t.text),
        );
      if (next.length === 1) {
        next[0]!.t.text = s.text + ' ' + next[0]!.t.text;
        used.add(i);
      }
    }
  });
  data = data.filter(
    (s, i) =>
      !used.has(i) &&
      (forecastNumber(s.text) !== null || s.text === '-' || s.text.includes(' г. и ')),
  );
  const groups: (typeof data)[] = [];
  for (const s of data.sort(sort)) {
    if (!groups.length || s.y - groups.at(-1)![0]!.y > 3) groups.push([]);
    groups.at(-1)!.push(s);
  }
  const labels = sp.filter((s) => s.x0 <= edge),
    ignored = new Set([
      'млн. евро',
      'млн. eвро',
      'Брутен вътрешен продукт',
      'Пазар на труда и цени',
      'Платежен баланс',
      'Паричен сектор',
    ]);
  return groups.map((g, i) => {
    const lo = i ? (groups[i - 1]![0]!.y + g[0]!.y) / 2 : ymin,
      hi = i + 1 === groups.length ? ymax : (g[0]!.y + groups[i + 1]![0]!.y) / 2;
    return makeRow(
      page,
      labels
        .slice()
        .sort(sort)
        .filter((s) => lo <= s.y && s.y < hi && !ignored.has(s.text))
        .map((s) => s.text)
        .join(' '),
      heads.map((_, k) => g.filter((s) => s.col === k)),
      unit,
    );
  });
}
const yearColumns = (heads: PositionedSpan[], unit: string) =>
  heads.map((h) => ({ year: Number(h.text.slice(0, 4)), unit }));
function unitCell(page: PdfPage, y: number): RecordData {
  const candidates = pdfTables(page)
    .flatMap((t) => t.cells)
    .filter(
      (c) =>
        c[0] < 365 && 365 < c[2] && 325 < c[0] && c[0] < 335 && c[2] < 410 && c[1] <= y && y < c[3],
    );
  const unique = [...new Map(candidates.map((c) => [JSON.stringify(c), c])).values()];
  assert(unique.length === 1, `unit cell p${page.number}, y=${y}: ${JSON.stringify(unique)}`);
  const box = unique[0]!;
  return {
    page: page.number,
    bbox: box,
    text: textInBox(page, box).split(/\s/gu).filter(Boolean).join(' ') || null,
  };
}
function annotateAnnex2(table: ForecastTable): void {
  const contexts: RecordData = {},
    counters: Record<string, number> = {};
  let current: string | undefined;
  for (const h of table.headings) {
    const no = h.source_no;
    if (no) {
      const parent = no.includes('.') ? no.slice(0, no.lastIndexOf('.')) : null;
      current = no;
      h.source_id = no;
      h.parent_context = parent ? [{ source_id: parent, label: contexts[parent].label }] : [];
      contexts[no] = h;
    } else {
      assert(current, 'Annex2 child without parent');
      const n = (counters[current] = (counters[current] ?? 0) + 1);
      h.source_id = `${current}/item${n}`;
      h.parent_context = [
        ...contexts[current].parent_context,
        { source_id: current, label: contexts[current].label },
      ];
    }
    h.semantic_label = [...h.parent_context.map((x: RecordData) => x.label), h.label].join(' / ');
  }
  const group11 = table.headings.find(
    (h: RecordData) => h.source_no === '11.1' && h.unit_cell?.text,
  )?.unit_cell;
  assert(group11, 'Annex2 contribution unit');
  contexts['11'].unit_evidence = { ...group11, parent_source_id: '11' };
  contexts['11'].units = Array(4).fill('%');
  for (const r of table.rows) {
    let cell = r.unit_cell;
    if (cell && cell.text === null && r.source_no?.startsWith('11.'))
      cell = { ...group11, parent_source_id: '11' };
    r.unit_evidence = cell;
    r.units = Array(4).fill(cell?.text ?? null);
  }
  table.source_semantics = table.rows.map((r) =>
    Object.fromEntries(
      ['source_id', 'source_no', 'label', 'parent_context', 'semantic_label', 'units'].map((k) => [
        k,
        structuredClone(r[k]),
      ]),
    ),
  );
}
function repairLabels(
  page: PdfPage,
  rows: ForecastRow[],
  edge: number,
  start: number,
  stop: number,
): void {
  for (const r of rows) {
    const candidates: { y0: number; y1: number; text: string }[][] = [];
    for (const b of page.blocks) {
      if (!(b.bbox[1] - 3 <= r.y && r.y <= b.bbox[3] + 3)) continue;
      const lines = b.lines
        .map((l) => ({
          y0: l.bbox[1],
          y1: l.bbox[3],
          text: l.spans
            .filter((s) => s.bbox[0] <= edge)
            .map((s) => s.text.trim())
            .join(' '),
        }))
        .filter(
          (l, i) =>
            b.lines[i]!.spans.some((s) => s.bbox[0] <= edge) &&
            start < (l.y0 + l.y1) / 2 &&
            (l.y0 + l.y1) / 2 < stop,
        );
      if (lines.length) candidates.push(lines);
    }
    if (candidates.length) {
      let lines = candidates.sort(
        (a, b) =>
          Math.abs((a[0]!.y0 + a.at(-1)!.y1) / 2 - r.y) -
          Math.abs((b[0]!.y0 + b.at(-1)!.y1) / 2 - r.y),
      )[0]!;
      const enclosed = rows.filter((a) => lines[0]!.y0 - 3 <= a.y && a.y <= lines.at(-1)!.y1 + 3);
      if (enclosed.length > 1) {
        const pos = enclosed.indexOf(r),
          lo = pos ? (enclosed[pos - 1]!.y + r.y) / 2 : start,
          hi = pos + 1 < enclosed.length ? (enclosed[pos + 1]!.y + r.y) / 2 : stop;
        lines = lines.filter((l) => lo <= (l.y0 + l.y1) / 2 && (l.y0 + l.y1) / 2 < hi);
      }
      r.label = lines
        .map((l) => l.text)
        .join(' ')
        .trim();
    }
  }
}
function repairAnnexLabels(
  page: PdfPage,
  rows: ForecastRow[],
  edge: number,
  start: number,
  stop: number,
): void {
  const labels = spans(page).filter((s) => s.x0 < edge && start < s.y && s.y < stop),
    starts = labels
      .filter((s) => /^\d+(?:\.\d+)*(?:\s|$)/.test(s.text) || s.text.startsWith('в т. ч.'))
      .map((s) => s.y)
      .sort((a, b) => a - b);
  assert(
    starts.length === rows.length,
    `numbered label boundaries p${page.number}: ${starts.length} != ${rows.length}`,
  );
  rows.forEach((r, i) => {
    const lo = starts[i]! - 1,
      hi = starts[i + 1] === undefined ? stop : starts[i + 1]! - 1;
    r.label = labels
      .slice()
      .sort(sort)
      .filter((s) => lo <= s.y && s.y < hi)
      .map((s) => s.text)
      .join(' ');
  });
}
function labelUnit(label: string): string {
  if (label.includes('пр.п.')) return 'пр.п.';
  if (label.includes('% от БВП')) return '% от БВП';
  if (label.includes('%')) return '%';
  if (label.startsWith('Валутен курс ')) return label.slice(13);
  const units = [...label.matchAll(/\(([^()]+)\)/g)];
  assert(units.length, `no source unit in ${label}`);
  return units.at(-1)![1]!;
}
export function extractForecast(
  doc: PdfDocument,
  source: Extraction['source'],
): ForecastExtraction {
  assert(doc.pages.length === 201, 'expected 201 PDF pages');
  const tables: Record<string, ForecastTable> = {};
  const configs: [string, string, number, string, number][] = [
    ['I_2', 'Табл. I-2:', 2024, 'row-specific', 260],
    ['II_1', 'Табл. II-1:', 2025, 'млн. €', 295],
    ['II_2', 'Табл. II-2:', 2025, 'млн. €', 295],
    ['II_3', 'Табл. II-3:', 2025, 'млн. €', 295],
    ['II_5', 'Табл. II-5:', 2026, 'млн. €', 165],
    ['III_1', 'Табл. III-1:', 2026, 'млн. €', 215],
    ['VI_1', 'Табл. VI-1:', 2025, 'млн. €', 215],
    ['VI_2', 'Табл. VI-2:', 2025, '%', 245],
  ];
  for (const [key, caption, first, unit, edge] of configs) {
    const p = doc.pages[locate(doc, caption)]!,
      sp = spans(p),
      cy = search(p, caption)[0]![1];
    let heads = columns(sp, first, cy);
    const hy = Math.max(...heads.map((s) => s.y));
    let end = min(
        sp
          .filter(
            (s) => s.y > hy && (s.text.startsWith('Източник:') || s.text.startsWith('Забележка:')),
          )
          .map((s) => s.y),
        p.height - 35,
      ),
      start = hy + (key === 'I_2' ? 8 : 19);
    if (key === 'II_5') {
      heads = heads.flatMap((h) => [-21, 24].map((dx) => ({ ...h, x: h.x + dx })));
      start = hy + 25;
      end = Math.min(
        end,
        ...sp.filter((s) => s.text.includes('Поради закръгление')).map((s) => s.y),
      );
    }
    const rows = extractRows(p, heads, start, end, edge, unit);
    if (key === 'II_5') {
      const groups: string[][] = [];
      for (const s of sp
        .filter((s) => s.x0 < edge && start < s.y && s.y < end)
        .sort((a, b) => a.y - b.y)) {
        if (/^\d+[ab]?\./.test(s.text)) groups.push([]);
        if (groups.length) groups.at(-1)!.push(s.text);
      }
      assert(groups.length === rows.length, 'ESA row labels');
      rows.forEach((r, i) => (r.label = groups[i]!.filter((x) => !/^\d+$/.test(x)).join(' ')));
    }
    if (key === 'III_1') {
      const groups: PositionedSpan[][] = [];
      for (const s of sp
        .filter((s) => s.x0 <= edge && start < s.y && s.y < end)
        .sort((a, b) => a.y - b.y)) {
        const prev = groups.at(-1)?.at(-1);
        if (!prev || s.text.startsWith('- ') || (s.bold && (!prev.bold || s.y - prev.y > 10)))
          groups.push([]);
        groups.at(-1)!.push(s);
      }
      assert(groups.length === rows.length, `function labels ${groups.length} != ${rows.length}`);
      rows.forEach((r, i) => (r.label = groups[i]!.map((s) => s.text).join(' ')));
    }
    const cols: RecordData[] = yearColumns(
      heads.filter((h) => h.text.startsWith('202')),
      unit,
    );
    if (key === 'I_2')
      for (const r of rows)
        r.units = Array(heads.length).fill(
          r.label.includes('млн.') ? 'млн. €' : r.label.includes('% от БВП') ? '% от БВП' : '%',
        );
    if (key === 'II_5') {
      cols.forEach((c, i) => {
        if (i % 2) Object.assign(c, { unit: '%', measure: 'annual_change_or_gdp_share' });
      });
      rows.forEach(
        (r, i) =>
          (r.units = Array.from({ length: 8 }, (_, j) =>
            j % 2 ? (i < 20 ? '%' : '% от БВП') : 'млн. €',
          )),
      );
    }
    if (key === 'III_1') cols.forEach((c, i) => (c.unit = i < 4 ? 'млн. €' : '% от БВП'));
    tables[key] = { caption, pages: [p.number], columns: cols, rows };
  }
  for (const annex of [1, 2, 3, 4]) {
    const begin = locate(doc, `ПРИЛОЖЕНИЕ № ${annex}:`),
      end = locate(doc, `ПРИЛОЖЕНИЕ № ${annex + 1}:`);
    if (annex === 1)
      for (const [section, year, date] of [
        ['execution2025', 2025, '31.12.2025'],
        ['execution2026', 2026, '30.09.2026'],
      ] as const) {
        const pages = doc.pages.slice(begin, end).filter((p) => p.text.includes(`Отчет ${date}`));
        let rows: ForecastRow[] = [];
        for (const p of pages) {
          const sp = spans(p),
            heads = sp
              .filter((s) => s.text.startsWith('к.'))
              .sort((a, b) => a.x - b.x)
              .slice(1);
          assert(heads.length === 5, 'Annex 1 headers');
          const hy = Math.max(...heads.map((s) => s.y)),
            stop = min(
              sp.filter((s) => s.y > hy && s.text.startsWith('*')).map((s) => s.y),
              p.height - 75,
            );
          rows.push(...extractRows(p, heads, hy + 6, stop, 390));
        }
        const cols = [
          ['закон', 'млн. €', 'КФП'],
          ['отчет', 'млн. €', 'КФП'],
          ['отчет', 'млн. €', 'национален бюджет'],
          ['отчет', 'млн. €', 'ЕС'],
          ['отчет', '% от закона', 'КФП'],
        ].map(([vintage, unit, scope]) => ({ year, vintage, unit, scope }));
        tables[`annex1_${section}`] = {
          caption: 'ПРИЛОЖЕНИЕ № 1:',
          pages: pages.map((p) => p.number),
          columns: cols,
          rows,
        };
      }
    if (annex === 3)
      for (const [suffix, offset, unit] of [
        ['mln', 0, 'млн. €'],
        ['pct_gdp', 2, '% от БВП'],
      ] as const) {
        const rows: ForecastRow[] = [];
        let heads: PositionedSpan[] = [];
        for (let i = begin + offset; i < begin + offset + 2; i++) {
          const p = doc.pages[i]!,
            sp = spans(p);
          heads = columns(sp, 2025);
          const hy = heads[0]!.y,
            stop = min(
              sp.filter((s) => s.text.startsWith('Забележка:')).map((s) => s.y),
              p.height - 35,
            );
          rows.push(...extractRows(p, heads, hy + 22, stop, 450, unit));
        }
        tables[`annex3_${suffix}`] = {
          caption: 'ПРИЛОЖЕНИЕ № 3:',
          pages: [begin + offset + 1, begin + offset + 2],
          columns: yearColumns(heads, unit),
          rows,
        };
      }
    if (annex === 2 || annex === 4) {
      const headings: ForecastRow[] = [],
        rows: ForecastRow[] = [],
        unit = annex === 2 ? 'row-specific' : 'хил. €';
      let heads: PositionedSpan[] = [];
      for (let i = begin; i < end; i++) {
        const p = doc.pages[i]!,
          sp = spans(p);
        heads = columns(sp, annex === 2 ? 2026 : 2027);
        const hy = heads[0]!.y,
          stop = min(
            sp.filter((s) => s.text.startsWith('* Забележка:')).map((s) => s.y),
            p.height - 65,
          );
        let pr = extractRows(
          p,
          heads,
          hy + (annex === 2 ? 34 : 8),
          stop,
          annex === 2 ? 400 : 450,
          unit,
          annex === 2,
        );
        if (annex === 2) {
          for (const r of pr) {
            r.fragments = [{ page: r.page, band: r.band, printed: [...r.printed] }];
            r.unit_cell = r.printed.some(Boolean) ? unitCell(p, r.y) : null;
          }
          headings.push(...pr.filter((r) => !r.continuation));
          pr = pr.filter((r) => r.printed.some(Boolean));
        }
        if (annex === 2 && pr[0]?.continuation && rows.length) {
          const cont = pr.shift()!,
            prev = rows.at(-1)!;
          if (cont.label !== '(continued)') prev.label += ' ' + cont.label;
          prev.continuation_pages ??= [];
          prev.continuation_pages.push(cont.page);
          prev.fragments.push(...cont.fragments);
          cont.printed.forEach((t, c) => {
            if (t) {
              prev.printed[c] = ((prev.printed[c] ?? '') + ' ' + t).trim();
              prev.values[c] = forecastNumber(prev.printed[c]!);
            }
          });
        }
        rows.push(...pr);
      }
      tables[`annex${annex}`] = {
        headings: annex === 2 ? headings : [],
        caption: `ПРИЛОЖЕНИЕ № ${annex}:`,
        pages: Array.from({ length: end - begin }, (_, j) => begin + j + 1),
        columns: yearColumns(heads, unit),
        rows,
      };
    }
  }
  tables.annex1_execution2026!.note =
    'Програма: разчети към ЗДБРБ 2026; printed percentages compare September execution with this law. The estimate discussion is prose, preserved in page_text.';
  tables.annex2!.page_spans = doc.pages
    .slice(locate(doc, 'ПРИЛОЖЕНИЕ № 2:'), locate(doc, 'ПРИЛОЖЕНИЕ № 3:'))
    .map((p) => ({ page: p.number, spans: spans(p) }));
  annotateAnnex2(tables.annex2!);
  tables.annex2!.parse_note =
    'Year-header columns and paragraph bands (centered labels on p.183 handled explicitly); dated rates and page continuations retained. Fragment cells checked internally across rawdict and words.';
  tables.annex3_pct_gdp!.rows.at(-1)!.units = Array(5).fill('млн. €');
  Object.assign(tables, extractRemaining(doc));
  applyVintages(doc, tables);
  const inventory = sourceInventory(doc),
    checks = validateForecast(tables, inventory),
    verification = representations(doc, tables);
  tables.annex2!.parse_status =
    checks.every((c) => c.passed) && verification.mismatches === 0 ? 'checked' : 'failed';
  assert(
    checks.every((c) => c.passed),
    `Forecast validation failed: ${JSON.stringify(checks.filter((c) => !c.passed))}`,
  );
  return annualValue({
    limitations: [
      'Annex 2 mixed/date/formula cells retain printed text; null numeric values do not imply zero. Annex 2 source rows 21 (minimum pension formula) and 23 (pension policy) have blank unit cells, retained as null units. No tables or annexes are excluded.',
    ],
    source,
    tables,
    page_text: doc.pages
      .filter((p) => p.number >= 169)
      .map((p) => ({ page: p.number, text: p.text })),
    checks,
    cross_representation_checks: verification,
    inventory,
    diagnostics: checks.filter((c) => c.source_discrepancy),
  } as ForecastExtraction);
}
const DIFFERENCE = 'difference_from_main_scenario_pct';
function extractRemaining(doc: PdfDocument): Record<string, ForecastTable> {
  const out: Record<string, ForecastTable> = {},
    configs: [string, number[], number | null, string, number][] = [
      ['I_1', [26], 2024, 'row-specific', 290],
      ['I_3', [32], 2025, '%', 260],
      ['I_4', [32], 2025, '%', 260],
      ['II_4', [38], 2026, 'row-specific', 280],
      ['II_6', [43, 44], 2026, 'млн. €', 160],
      ['II_7', [47, 48, 49], 2027, 'млн. €', 370],
      ['II_8', [50], 2027, 'млн. €', 370],
      ['II_9', [51], 2025, '% от БВП', 185],
      ['III_2', [89], 2026, 'млн. €', 300],
      ['IV_1', [136], 2027, 'хил. €', 245],
      ['V_1', [142], 2027, 'млн. €', 310],
      ['V_2', [142], 2027, 'млн. €', 310],
      ['VII_1', [159], null, '%', 280],
      ['VII_2', [162], 2026, 'row-specific', 310],
      ['VII_3', [163], 2026, 'row-specific', 280],
      ['annex5', [197], 2027, 'хил. €', 500],
      ['annex6', [197], 2027, 'хил. €', 500],
      ['annex7', [198], 2027, 'хил. €', 250],
      ['annex8', [199], 2027, 'хил. €', 250],
      ['annex9', [200], 2027, 'хил. €', 500],
      ['annex10', [201], 2025, 'хил. €', 500],
    ];
  for (const [key, pages, first, unit, edge] of configs) {
    const rows: ForecastRow[] = [],
      scenario_headers: RecordData[] = [];
    let cols: RecordData[] = [],
      lastSp: PositionedSpan[] = [];
    const caption = key.startsWith('annex')
      ? `ПРИЛОЖЕНИЕ № ${key.slice(5)}:`
      : 'Табл. ' + key.replace('_', '-') + ':';
    for (let j = 0; j < pages.length; j++) {
      const pn = pages[j]!,
        p = doc.pages[pn - 1]!,
        sp = spans(p);
      lastSp = sp;
      const cy = j === 0 ? search(p, caption)[0]![3] : 0;
      let heads: PositionedSpan[], hy: number;
      if (key === 'VII_1') {
        heads = sp
          .filter((s) => s.text === 'S1' || s.text === 'S2')
          .map((s) => ({ ...s, text: '2027' }));
        hy = Math.max(...heads.map((s) => s.y));
        cols = ['МФ', 'ЕК'].flatMap((provider) =>
          ['S1', 'S2'].map((indicator) => ({ provider, indicator, unit: '%' })),
        );
      } else {
        heads = columns(sp, first!, cy);
        hy = Math.max(...heads.map((s) => s.y));
        if (key === 'I_4' || key === 'II_9') {
          const providers = sp
            .filter((s) => hy < s.y && s.y < hy + 25 && (s.text === 'МФ' || s.text === 'ЕК'))
            .sort((a, b) => a.x - b.x);
          heads = key === 'I_4' ? [heads[0]!, ...providers] : providers;
          cols = [2025, 2026, 2026, 2027, 2027].map((year, c) => ({
            year,
            provider: c % 2 === 1 || c === 0 ? 'МФ' : 'ЕК',
            unit,
          }));
          hy = Math.max(...heads.map((s) => s.y));
        } else if (key === 'II_6') {
          heads = heads.flatMap((h) => [-22, 22].map((dx) => ({ ...h, x: h.x + dx })));
          const cells: PositionedSpan[][] = heads.map(() => []);
          for (const token of sp)
            if (hy + 3 < token.y && token.y < hy + 50 && token.x0 > 160) {
              const c = heads.reduce(
                (a, h, i) => (Math.abs(token.x - h.x) < Math.abs(token.x - heads[a]!.x) ? i : a),
                0,
              );
              cells[c]!.push(token);
            }
          const printed = cells.map((c) =>
            c
              .sort((a, b) => a.y - b.y)
              .map((s) => s.text)
              .join(' '),
          );
          assert(
            JSON.stringify(printed) ===
              JSON.stringify(
                Array.from({ length: 4 }, () => [
                  'Базисен сценарий',
                  'Изменение спрямо основния сценарий, %',
                ]).flat(),
              ),
            `II_6 p${pn}: scenario header changed: ${printed}`,
          );
          scenario_headers.push({ page: pn, printed });
          hy += 40;
          cols = Array.from({ length: 8 }, (_, c) => ({
            year: first! + Math.floor(c / 2),
            measure: c % 2 ? DIFFERENCE : 'baseline',
            unit: c % 2 ? '%' : 'млн. €',
          }));
        } else if (key === 'IV_1') {
          const detail = sp
            .filter(
              (s) => Math.abs(s.y - hy) < 4 && (s.text === 'местни' || s.text === 'делегирани'),
            )
            .sort((a, b) => a.x - b.x);
          heads = [heads[0]!, ...detail, ...heads.slice(1)];
          cols = [
            [2027, 'total'],
            [2027, 'local'],
            [2027, 'delegated'],
            [2028, 'total'],
            [2029, 'total'],
          ].map(([year, scope]) => ({ year, scope, unit }));
        } else if (key === 'annex7' || key === 'annex8') {
          const codes = ['2', '2.1', '2.2', '3', '3.1', '3.2', '4', '4.1', '4.2'],
            chy = Math.min(...sp.filter((s) => s.text === '2.1' && s.y > hy).map((s) => s.y));
          heads = sp
            .filter((s) => Math.abs(s.y - chy) < 3 && codes.includes(s.text))
            .sort((a, b) => a.x - b.x);
          hy = chy;
          cols = Array.from({ length: 9 }, (_, c) => ({
            year: 2027 + Math.floor(c / 3),
            measure: ['net', 'expenditure', 'transfer'][c % 3],
            unit,
          }));
        } else cols = yearColumns(heads, unit);
      }
      let stop = min(
        sp
          .filter(
            (s) =>
              s.y > hy + 4 &&
              ['Източник:', 'Забележка:', 'ПРИЛОЖЕНИЕ №'].some((t) => s.text.startsWith(t)),
          )
          .map((s) => s.y),
        p.height - 35,
      );
      const caps = search(p, 'Табл.').filter((b) => b[1] > hy + 4);
      if (caps.length) stop = Math.min(stop, ...caps.map((b) => b[1]));
      const start = hy + (key === 'II_9' ? 16 : key === 'annex10' ? 22 : 5),
        pr = extractRows(p, heads, start, stop, edge, unit);
      if (key === 'II_9' && pr.length === 6) {
        const a = pr[1]!,
          b = pr[2]!;
        b.printed.forEach((t, c) => {
          if (t !== null) {
            assert(a.printed[c] === null, 'overlapping investment cells');
            a.printed[c] = t;
            a.values[c] = b.values[c]!;
          }
        });
        pr.splice(2, 1);
      }
      repairLabels(p, pr, edge, start, stop);
      if (['annex6', 'annex7', 'annex8'].includes(key)) repairAnnexLabels(p, pr, edge, start, stop);
      if (key === 'II_4') {
        pr[0]!.label = 'Препоръка на Съвета / ' + pr[0]!.label;
        pr[1]!.label = 'Отчетни данни/прогноза / ' + pr[1]!.label;
      }
      for (const r of pr) {
        r.units = cols.map((c) => c.unit);
        if (unit === 'row-specific') {
          if (
            key === 'VII_3' &&
            [
              'Потребление',
              'Брутообразуване на основен капитал',
              'Износ на стоки и услуги',
              'Внос на стоки и услуги',
            ].includes(r.label)
          ) {
            r.parent_label = pr[1]!.label;
            r.units = Array(cols.length).fill(labelUnit(pr[1]!.label));
          } else
            r.units = Array(cols.length).fill(labelUnit(r.label || `${key} p${pn} y${r.y}: EMPTY`));
        }
        if (key === 'II_6' && (r.label.startsWith('17.') || r.label.startsWith('18.'))) {
          r.units = Array.from({ length: 8 }, (_, c) => (c % 2 ? '% от БВП' : 'млн. €'));
          r.measures = Array.from({ length: 8 }, (_, c) => (c % 2 ? 'gdp_share_pct' : 'baseline'));
        }
      }
      if (key === 'annex10') pr.at(-1)!.units = Array(2).fill('% от БВП');
      rows.push(...pr);
    }
    out[key] = { caption, pages, columns: cols, rows };
    if (key === 'II_6') {
      out[key]!.scenario_headers = scenario_headers;
      const share = lastSp.filter((s) => s.text === '% от БВП').sort((a, b) => a.x - b.x);
      assert(share.length === 4, 'II_6 GDP-share subheader changed');
      out[key]!.gdp_share_headers = { page: pages.at(-1), printed: share.map((s) => s.text) };
    }
  }
  return out;
}
function applyVintages(doc: PdfDocument, tables: Record<string, ForecastTable>): void {
  for (const [key, table] of Object.entries(tables)) {
    const statuses =
      (TABLE_VINTAGES as Record<string, (string | null)[]>)[key] ??
      Array(table.columns.length).fill(null);
    assert(statuses.length === table.columns.length, `${key}: status column count`);
    table.columns.forEach((c, i) => {
      delete c.vintage;
      if (statuses[i] !== null) c.vintage = statuses[i];
    });
    const evidence: RecordData[] = [];
    for (const pn of table.pages) {
      const page = doc.pages[pn - 1]!,
        sp = spans(page);
      let lo: number, hi: number;
      if (key.startsWith('annex1_')) {
        const hy = Math.max(...sp.filter((s) => s.text.startsWith('к.')).map((s) => s.y));
        lo = hy - 55;
        hi = hy - 15;
      } else if ('year' in table.columns[0]!) {
        const cy =
            !key.startsWith('annex3_') && pn === table.pages[0]
              ? search(page, table.caption)[0]![3]
              : 0,
          heads = columns(sp, table.columns[0]!.year, cy),
          hy = heads[0]!.y;
        lo = hy - 25;
        hi = hy + 19;
      } else continue;
      const tokens = sp
        .slice()
        .sort((a, b) => a.x - b.x)
        .filter((s) => lo < s.y && s.y < hi)
        .flatMap((s) =>
          [
            ...s.text.matchAll(/Отчетни данни|Отчет|Очакв\.|Очаквано|Проект|Прогноза|Програма/g),
          ].map((m) => m[0]),
        );
      assert(
        JSON.stringify(tokens) ===
          JSON.stringify((STATUS_HEADERS as Record<string, string[]>)[key] ?? []),
        `${key} p${pn}: status headers ${JSON.stringify(tokens)}`,
      );
      evidence.push({ page: pn, band: [lo, hi], printed: tokens });
    }
    table.status_headers = evidence;
  }
}
export function sourceInventory(doc: PdfDocument): RecordData {
  const numbered = [...doc.pages[3]!.text.matchAll(/Табл\.\s*([IVX]+-\d+):/g)].map((m) =>
      m[1]!.replace('-', '_'),
    ),
    annexes = doc.pages
      .filter((p) => p.number >= 6)
      .flatMap((p) =>
        [...p.text.matchAll(/ПРИЛОЖЕНИЕ №\s*(\d+):/g)].map((m) => ({
          id: `annex${m[1]}`,
          page: p.number,
        })),
      );
  assert(numbered.length === 23 && annexes.length === 10, 'source table/annex inventory changed');
  return { numbered_tables: numbered, annexes };
}
function representations(doc: PdfDocument, tables: Record<string, ForecastTable>): RecordData {
  const samples: RecordData[] = [];
  let matched = 0;
  const original = [
    'I_2',
    'II_1',
    'II_2',
    'II_3',
    'II_5',
    'III_1',
    'VI_1',
    'VI_2',
    'annex1_execution2025',
    'annex1_execution2026',
    'annex2',
    'annex3_mln',
    'annex3_pct_gdp',
    'annex4',
  ];
  for (const key of original) {
    const candidates = tables[key]!.rows.filter((r) => !r.continuation_pages).flatMap((row) => {
      const col = row.values.findIndex((v, c) => v !== null && row.printed[c]);
      return col < 0 ? [] : [{ row, col, printed: row.printed[col]!, value: row.values[col]! }];
    });
    for (const i of [0, Math.floor(candidates.length / 2), candidates.length - 1]) {
      const { row, col, printed, value } = candidates[i]!,
        baseline = words(doc.pages[row.page - 1]!)
          .filter((w) => Math.abs(midY(w.bbox) - row.y) < 3)
          .sort((a, b) => a.bbox[0] - b.bbox[0])
          .map((w) => w.text)
          .join(' ');
      const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        pattern = new RegExp(
          '(?<![\\d,])' +
            printed.replace(/−/g, '-').split(/\s+/).map(escape).join('\\s*') +
            '(?![\\d,])',
        );
      assert(
        pattern.test(baseline.replace(/−/g, '-')),
        `words verification ${key} p${row.page}: ${printed} absent at ${row.y}`,
      );
      samples.push({
        table: key,
        page: row.page,
        row: row.label,
        column: col,
        printed,
        value,
        y: row.y,
      });
    }
  }
  for (const row of tables.annex2!.rows)
    for (const f of row.fragments) {
      const page = doc.pages[f.page - 1]!,
        heads = columns(spans(page), 2026);
      for (let c = 0; c < 4; c++) {
        const cell = words(page)
          .filter(
            (w) =>
              f.band[0] <= midY(w.bbox) &&
              midY(w.bbox) < f.band[1] &&
              midX(w.bbox) > 400 &&
              heads.reduce(
                (a, h, i) =>
                  Math.abs(midX(w.bbox) - h.x) < Math.abs(midX(w.bbox) - heads[a]!.x) ? i : a,
                0,
              ) === c,
          )
          .sort(
            (a, b) =>
              Math.round((a.bbox[1] + a.bbox[3]) / 4) - Math.round((b.bbox[1] + b.bbox[3]) / 4) ||
              a.bbox[0] - b.bbox[0],
          )
          .map((w) => w.text)
          .join(' ');
        const norm = (t: string | null) => t?.replace(/\s/gu, '').replace(/−/g, '-') ?? '';
        assert(
          norm(cell) === norm(f.printed[c]),
          `Annex2 words p${f.page} col ${c}: ${cell} != ${f.printed[c]}`,
        );
        matched++;
      }
    }
  return {
    annex2_fragment_cells_matched: matched,
    method:
      'Internal MuPDF.js structured characters/words comparison: first, middle and last numeric rows of the original 14 table views, plus all Annex 2 fragment cells by year and vertical band',
    samples,
    matched: samples.length,
    mismatches: 0,
  };
}
