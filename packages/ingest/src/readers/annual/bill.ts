import { annualValue } from './json.js';
import { assert, pdfTables, ws, midX, midY, textInBox, type PdfDocument } from '../pdf/index.js';
import type { BillExtraction, SourceDescriptor } from '../../build/annual-lineage.js';
import { decimalSum } from '../../build/fiscal-annual.js';
export type Data = Record<string, any>;
const NUMBER = /-?\d+(?:[\s\u00a0]\d+)*,\d+/g;
const monetary = (s: string) => /^-?\d+(?:[\s\u00a0]\d+)*,\d+$/.test(s);
export function billNumber(s: string): number | null {
  const t = s.replace(/\s+/gu, '').replace(/[−–]/g, '-');
  if (!t || t === '-') return null;
  assert(/^-?\d+(?:,\d+)?$/.test(t), `unparsed amount: ${s}`);
  return Number(t.replace(',', '.'));
}
const latin = Object.fromEntries(
  [...'ABCEHKMOPTXaceopxyk'].map((c, i) => [c, [...'АВСЕНКМОРТХасеорхук'][i]!]),
);
function fold(s: string): string {
  return ws(s)
    .split(' ')
    .map((t) => (/[Ѐ-ӿ]/.test(t) ? [...t].map((c) => latin[c] ?? c).join('') : t))
    .join(' ');
}
const squash = (s: string) =>
  fold(s)
    .toUpperCase()
    .replace(/І/g, 'I')
    .replace(/Ѝ/g, 'И')
    .replace(/[\s\-–—−.(),:;"„“”«»'’/+]+/g, '');
const roman = (s: string) => {
  const t = ws(s).toUpperCase().replace(/І/g, 'I').replace(/Х/g, 'X').replace(/\.+$/, '');
  return /^[IVX]+$/.test(t) ? t : '';
};
const headline = (rows: Data[]) => {
  const out: Data = {};
  const labels: Record<string, string> = {
    rev: 'ПРИХОДИПОМОЩИИДАРЕНИЯ',
    exp: 'РАЗХОДИ',
    transfers: 'БЮДЖЕТНИВЗАИМООТНОШЕНИЯ',
    eucontrib: 'ВНОСКАВОБЩИЯБЮДЖЕТНАЕВРОПЕЙСКИЯСЪЮЗ',
    balance: 'БЮДЖЕТНОСАЛДО',
    financing: 'ОПЕРАЦИИВЧАСТТАНАФИНАНСИРАНЕТО',
  };
  for (const r of rows)
    if (roman(r.no))
      for (const [k, label] of Object.entries(labels))
        if (squash(r.text).startsWith(label) && !(k in out)) out[k] = r.value;
  return out;
};
class Checks {
  results: Data[] = [];
  equal(label: string, parts: (number | null)[], total: number | null): void {
    assert(total !== null && parts.every((v) => v !== null), `${label}: missing amount`);
    const delta = decimalSum([...(parts as number[]), -total]),
      tolerance = (parts.length + 1) / 20;
    assert(Math.abs(delta) <= tolerance, `${label}: delta ${delta}, tolerance ${tolerance}`);
    this.results.push({ check: label, delta, tolerance });
  }
}
function physical(doc: PdfDocument): { stream: [number, 'p' | 't', any][]; tables: Data[] } {
  const stream: [number, 'p' | 't', any][] = [],
    tables: Data[] = [];
  for (const page of doc.pages) {
    const events: { y: number; kind: 'p' | 't'; value: any }[] = [];
    for (const t of pdfTables(page)) {
      const cells = t.rawCells.map((r) => r.map(ws));
      t.rows.forEach((row, i) => {
        const boxes = row.filter((b) => b !== null);
        if (!boxes.length) return;
        const right = Math.max(...boxes.map((b) => b[2]));
        if (right < t.bbox[2] - 5 && cells[i]!.some(monetary)) {
          const y0 = Math.min(...boxes.map((b) => b[1])),
            y1 = Math.max(...boxes.map((b) => b[3])),
            tail = ws(textInBox(page, [right, y0, page.width, y1]));
          if (monetary(tail)) cells[i]![cells[i]!.length - 1] = tail;
        }
      });
      if (
        !cells.some((r) =>
          r.some((c) => /-?\d+(?:[\s\u00a0]\d+)*,\d+/.test(c) || c.includes('Показатели')),
        )
      )
        continue;
      const rec = { id: tables.length, page: page.number, bbox: t.bbox, rawCells: cells };
      tables.push(rec);
      events.push({ y: t.bbox[1], kind: 't', value: rec });
    }
    for (const b of page.blocks) {
      const lines = b.lines.filter((l) => {
        const x = midX(l.bbox),
          y = midY(l.bbox);
        return (
          y <= 550 &&
          !events.some(
            (t) =>
              t.kind === 't' &&
              t.value.bbox[0] - 1 <= x &&
              x <= t.value.bbox[2] + 1 &&
              t.value.bbox[1] - 1 <= y &&
              y <= t.value.bbox[3] + 1,
          )
        );
      });
      const text = ws(lines.map((l) => l.spans.map((s) => s.text).join('')).join(' '));
      if (text && text !== String(page.number))
        events.push({ y: lines[0]!.bbox[1], kind: 'p', value: text });
    }
    for (const e of events.sort((a, b) => a.y - b.y)) {
      if (e.kind === 'p') {
        stream.push([page.number, 'p', e.value]);
        continue;
      }
      let chunk: string[][] = [];
      for (const raw of e.value.rawCells) {
        const occupied = raw.filter(Boolean);
        if (occupied.length && /^(?:\(\d+\)|Чл\.)/.test(occupied[0])) {
          if (chunk.length) {
            stream.push([page.number, 't', { ...e.value, rawCells: chunk }]);
            chunk = [];
          }
          stream.push([page.number, 'p', occupied[0]]);
        } else chunk.push(raw);
      }
      if (chunk.length) stream.push([page.number, 't', { ...e.value, rawCells: chunk }]);
    }
  }
  return { stream, tables };
}
function budgetRows(table: Data): Data[] {
  const out: Data[] = [];
  for (const raw of table.rawCells) {
    const cells: string[] = raw.filter(Boolean);
    if (!cells.length) continue;
    if (!monetary(cells.at(-1)!)) {
      assert(!cells.some(monetary), `page ${table.page}: amount before unexpected cell: ${cells}`);
      if (cells.length === 1 && /^в\s*т\.\s*ч\.[,:]?$/i.test(cells[0]!)) {
        out.push({ no: '', text: cells[0], value: null, page: table.page, table: table.id });
        continue;
      }
      if (cells.length >= 2 && (roman(cells[0]!) || /^\d+(?:\.\d+)*\.$/.test(cells[0]!)))
        out.push({
          no: cells[0],
          text: ws(cells.slice(1).join(' ')),
          value: null,
          page: table.page,
          table: table.id,
        });
      continue;
    }
    const value = billNumber(cells.at(-1)!),
      prefix = cells.slice(0, -1),
      no =
        prefix.length && /^(?:[IVXІХ]+\.|\d+(?:\.\d+)*\.?)$/.test(prefix[0]!)
          ? prefix.shift()!
          : '';
    if (prefix[0] === no) prefix.shift();
    out.push({ no, text: ws(prefix.join(' ')), value, page: table.page, table: table.id });
  }
  return out;
}
function records(stream: [number, 'p' | 't', any][]): {
  arts: Record<string, Data[]>;
  misc: Record<string, Data[]>;
} {
  const arts: Record<string, Data[]> = {},
    misc: Record<string, Data[]> = {};
  let current: Data | undefined,
    mode = 'main',
    article: number | undefined;
  for (const [page, kind, val] of stream) {
    if (kind === 'p') {
      const m = /^Чл\.\s*(\d+)\./.exec(val);
      if (m) {
        article = Number(m[1]);
        current = undefined;
      }
      const h =
        /Чл\.\s*(\d+)\.\s*(?:\(1\)\s*)?Приема\s+(?:бюджета на (.*?) за 2027 г\.|държавния бюджет)/s.exec(
          val,
        );
      if (h) {
        article = Number(h[1]);
        current = {
          article,
          name: h[2] ? ws(h[2]) : 'Държавен бюджет',
          pages: [],
          rows: [],
          policiesRows: [],
          bodiesRows: [],
          commitmentRows: [],
          extraRows: [],
          amountParagraphs: [],
        };
        (arts[article === undefined ? 'None' : String(article)] ??= []).push(current);
        mode = 'main';
      }
      const amounts = [...val.matchAll(NUMBER)].map((m: RegExpMatchArray) => billNumber(m[0]));
      if (current) {
        if (amounts.length) current.amountParagraphs.push({ page, text: val, amounts });
        if (/Утвърждава (?:разпределение на )?разходите .*по ал\.\s*1/.test(val)) {
          mode = 'policies';
          current.policiesKind = val.includes('политики') ? 'policies' : 'areas';
        } else if (val.includes('Определя бюджетните разходи на органите')) mode = 'bodies';
        else if (val.includes('Утвърждава максималните размери на ангажиментите')) mode = 'commit';
        else if (!h && /^\(\d+\)/.test(val) && article !== 1) mode = 'extra';
        if (!current.pages.includes(page)) current.pages.push(page);
      } else
        (misc[article === undefined ? 'None' : String(article)] ??= []).push({
          page,
          text: val,
          amounts,
        });
    } else if (current) {
      current.pages = [...new Set([...current.pages, page])].sort((a: any, b: any) => a - b);
      const key = (
        {
          main: 'rows',
          policies: 'policiesRows',
          bodies: 'bodiesRows',
          commit: 'commitmentRows',
          extra: 'extraRows',
        } as Record<string, string>
      )[mode]!;
      current[key].push(...budgetRows(val));
    } else
      (misc[article === undefined ? 'None' : String(article)] ??= []).push({ page, table: val.id });
  }
  for (const occurrences of Object.values(arts))
    for (const b of occurrences) {
      let section = '';
      for (const r of b.rows) {
        section = roman(r.no) || section;
        r.sec = section;
      }
      b.headline = headline(b.rows);
      b.lines = b.rows.map((r: Data) => [r.sec, r.no.replace(/\.$/, ''), r.text, r.value]);
      b.policies = [];
      b.bodies = [];
      b.policyTotal = null;
      b.bodiesTotal = null;
      for (const [key, out, total] of [
        ['policiesRows', 'policies', 'policyTotal'],
        ['bodiesRows', 'bodies', 'bodiesTotal'],
      ] as const)
        for (const r of b[key]) {
          if (squash(r.text).startsWith('ВСИЧКО')) {
            b[total] = r.value;
            continue;
          }
          const item: Data = {
            n: r.no.replace(/\.$/, ''),
            name: r.text,
            khil: r.value,
            page: r.page,
          };
          if (out === 'policies' && b[out].length && !/^\d+$/.test(item.n))
            (b[out].at(-1).parts ??= []).push(item);
          else b[out].push(item);
        }
      const cm = b.commitmentRows;
      b.commitments = cm.length === 2 ? { entered: cm[0].value, new: cm[1].value } : null;
    }
  return { arts, misc };
}
function municipal(
  tables: Data[],
  start: number,
  end: number,
  cols: string[],
  checks: Checks,
): Data {
  const rows: Data[] = [],
    pages: number[] = [];
  let total: number[] | undefined, region: string | undefined;
  for (const t of tables) {
    if (t.page < start || t.page > end) continue;
    pages.push(t.page);
    for (const raw of t.rawCells) {
      const cells: string[] = raw.filter(Boolean);
      if (!cells.length) continue;
      if (cells[0]!.startsWith('ОБЛАСТ')) {
        region = cells[0];
        continue;
      }
      if (
        cells.length === 1 &&
        region &&
        cells[0] === cells[0]!.toUpperCase() &&
        !cells[0]!.startsWith('ВСИЧКО')
      ) {
        region = ws(region + ' ' + cells[0]);
        continue;
      }
      if (cells.length !== cols.length + 1 || !cells.slice(1).every(monetary)) {
        assert(!cells.some(monetary), `municipal page ${t.page}: ${cells}`);
        continue;
      }
      const values = cells.slice(1).map(billNumber) as number[];
      if (squash(cells[0]!).startsWith('ВСИЧКО')) total = values;
      else
        rows.push({
          name: cells[0],
          region: squash(cells[0]!) === 'СТОЛИЧНАОБЩИНА' ? 'ОБЛАСТ СОФИЯ (СТОЛИЦА)' : region,
          values,
          page: t.page,
        });
    }
  }
  assert(rows.length === 265, `municipal ${start}: ${rows.length} rows`);
  assert(
    new Set(rows.map((r) => JSON.stringify([fold(r.region), fold(r.name)]))).size === 265,
    'duplicate municipality',
  );
  assert(total, 'missing municipal total');
  cols.forEach((col, j) =>
    checks.equal(
      `municipal ${start} column ${col}`,
      rows.map((r) => r.values[j]),
      total![j]!,
    ),
  );
  for (const r of rows) {
    const v = r.values;
    checks.equal(
      `municipal ${start} ${r.region} ${r.name}`,
      v.length === 5 ? v.slice(1) : [v[1], ...v.slice(4)],
      v[0],
    );
    if (v.length === 10) checks.equal(`municipal admin ${r.name}`, v.slice(2, 4), v[1]);
  }
  return { cols, rows, total, pages: [...new Set(pages)].sort((a, b) => a - b) };
}
function projects(tables: Data[]): Data {
  const rows: Data[] = [];
  for (const t of tables) {
    if (t.page < 126) continue;
    for (const raw of t.rawCells as string[][]) {
      if (raw.length === 8 && /^\d+$/.test(raw[0]!))
        rows.push({
          n: Number(raw[0]),
          id: raw[1],
          name: raw[2],
          values: raw.slice(3, 6).map(billNumber),
          indicator: raw[6],
          institution: raw[7],
          pages: [t.page],
        });
      else if (raw.length === 8 && !raw.slice(0, 2).some(Boolean) && raw.slice(2).some(Boolean)) {
        assert(rows.length, 'project continuation without previous row');
        for (const [j, key] of [
          [2, 'name'],
          [6, 'indicator'],
          [7, 'institution'],
        ] as const)
          rows.at(-1)![key] = ws(rows.at(-1)![key] + ' ' + raw[j]);
        assert(!raw.slice(3, 6).some(Boolean), 'amount in unnumbered project continuation');
        rows.at(-1)!.pages = [...new Set([...rows.at(-1)!.pages, t.page])].sort(
          (a: any, b: any) => a - b,
        );
      } else assert(!raw.some(monetary), `unparsed project page ${t.page}: ${raw}`);
    }
  }
  assert(rows.length === 226 && rows.every((r, i) => r.n === i + 1), 'project sequence incomplete');
  assert(new Set(rows.map((r) => r.id)).size === rows.length, 'duplicate project id');
  return {
    article: 108,
    annex: 2,
    years: [2027, 2028, 2029],
    unit: 'хил. евро',
    rows,
    pages: Array.from({ length: 34 }, (_, i) => 126 + i),
  };
}
function validate(arts: Record<string, Data[]>, checks: Checks): void {
  assert(
    Object.keys(arts).length === 48 &&
      Array.from({ length: 48 }, (_, i) => arts[String(i + 1)]).every(Boolean),
    'budget-defining article sequence differs',
  );
  for (const [a, occ] of Object.entries(arts)) {
    assert(occ.length === (['1', '2'].includes(a) ? 2 : 1), `article ${a} occurrence count`);
    occ.forEach((b, i) => {
      const label = `article ${a} occurrence ${i + 1}`,
        h = b.headline;
      assert('exp' in h, `${label}: headline missing`);
      if (a !== '1') {
        assert(b.policies.length && b.policyTotal !== null, `${label}: missing policies`);
        assert(b.commitments, `${label}: missing commitments`);
        checks.equal(
          label + ' policy total',
          b.policies.map((p: Data) => p.khil),
          b.policyTotal,
        );
        checks.equal(label + ' expenditure vs policies', [h.exp], b.policyTotal);
        for (const p of b.policies)
          if (p.parts?.length && p.parts.every((x: Data) => x.n))
            checks.equal(
              label + ' programme ' + p.n,
              p.parts.map((x: Data) => x.khil),
              p.khil,
            );
      }
      const totals = b.extraRows.filter((r: Data) => squash(r.text).startsWith('ВСИЧКО'));
      if (totals.length) {
        assert(totals.length === 1, label + ': unexpected supplemental totals');
        checks.equal(
          label + ' supplemental table total',
          b.extraRows
            .filter((r: Data) => /^\d+$/.test(r.no.replace(/\.$/, '')))
            .map((r: Data) => r.value),
          totals[0].value,
        );
      }
      if (b.bodies.length)
        checks.equal(
          label + ' judiciary bodies',
          b.bodies.map((p: Data) => p.khil),
          b.bodiesTotal,
        );
      checks.equal(
        label + ' balance',
        [h.rev ?? 0, -h.exp, (a === '1' ? -1 : 1) * (h.transfers ?? 0), -(h.eucontrib ?? 0)],
        h.balance,
      );
      checks.equal(label + ' financing', [h.balance, h.financing], 0);
      for (const section of ['I', 'II', 'III', 'V', 'VI']) {
        const rows = b.rows.filter((r: Data) => r.sec === section);
        let children = rows.filter((r: Data) => /^\d+\.$/.test(r.no)).map((r: Data) => r.value);
        if (a === '1' && section === 'III')
          children = children.map((v: number, j: number) => (j === 0 ? v : -v));
        if (children.length && children.every((v: number | null) => v !== null))
          checks.equal(label + ' section ' + section, children, rows[0].value);
      }
      for (let j = 0; j < b.rows.length; j++) {
        const parent = b.rows[j],
          n = parent.no.replace(/\.$/, '');
        if (parent.sec !== 'I' || !/^\d+(?:\.\d+)*$/.test(n) || parent.value === null) continue;
        const following: Data[] = [];
        for (const row of b.rows.slice(j + 1)) {
          const rn = row.no.replace(/\.$/, '');
          if (row.no && !rn.startsWith(n + '.')) break;
          following.push(row);
        }
        const dots = (s: string) => s.split('.').length - 1,
          children = following
            .filter(
              (r) =>
                r.no.replace(/\.$/, '').startsWith(n + '.') &&
                dots(r.no.replace(/\.$/, '')) === dots(n) + 1,
            )
            .map((r) => r.value);
        const partial = [parent, ...following]
          .filter((r) => !r.no || r === parent || dots(r.no.replace(/\.$/, '')) === dots(n) + 1)
          .some((r) => /в\s*т\.\s*ч/i.test(r.text));
        if (children.length && !partial)
          checks.equal(label + ' components ' + parent.sec + '/' + n, children, parent.value);
      }
    });
  }
  assert(arts['1']![0]!.headline.rev === 30942719.3, 'article 1 revenue anchor');
  assert(arts['1']![0]!.headline.exp === 18345717.4, 'article 1 expenditure anchor');
}
function coverage(doc: PdfDocument, stream: [number, 'p' | 't', any][], tables: Data[]): Data[] {
  const count = (text: string) => {
    const m = new Map<string, number>();
    for (const t of text.matchAll(/\d+,\d+/g)) m.set(t[0], (m.get(t[0]) ?? 0) + 1);
    return m;
  };
  return doc.pages.map((p) => {
    const texts = [
        ...tables.filter((t) => t.page === p.number).map((t) => t.rawCells.flat().join(' ')),
        ...stream.filter(([pn, k]) => pn === p.number && k === 'p').map((v) => v[2]),
      ],
      printed = count(p.text),
      captured = count(texts.join(' '));
    const missing = [...printed].filter(([k, n]) => (captured.get(k) ?? 0) < n);
    assert(
      !missing.length,
      `page ${p.number}: uncovered decimal tokens ${JSON.stringify(missing)}`,
    );
    return {
      page: p.number,
      decimalTokens: [...printed.values()].reduce((a, b) => a + b, 0),
      unparsed: 0,
    };
  });
}
export function extractBill(doc: PdfDocument, source: SourceDescriptor): BillExtraction & Data {
  assert(doc.pages.length === 159, 'PDF page count changed');
  const { stream, tables } = physical(doc),
    { arts, misc } = records(stream),
    otherTables: Data = {};
  for (const [a, items] of Object.entries(misc))
    if (a === '49' || a === '50')
      otherTables[a] = items
        .filter((item) => 'table' in item)
        .flatMap((item) => budgetRows(tables[item.table]!));
  const coverageResults = coverage(doc, stream, tables),
    checks = new Checks();
  validate(arts, checks);
  for (const variant of ['bill', 'billMc']) {
    const budgets = Object.entries(arts)
      .filter(([a]) => a !== '1')
      .map(([, occ]) => occ[variant === 'billMc' && occ.length === 2 ? 1 : 0]!);
    checks.equal(
      variant + ' spending-unit expenditure aggregate vs printed distribution totals',
      budgets.map((b) => b.headline.exp),
      decimalSum(budgets.map((b) => b.policyTotal)),
    );
  }
  const debt = otherTables['50'];
  assert(debt, 'article 50 debt table');
  checks.equal(
    'article 50 total',
    debt.filter((r: Data) => /^\d+$/.test(r.no)).map((r: Data) => r.value),
    debt.at(-1).value,
  );
  const university = debt.find((r: Data) => r.no === '5');
  checks.equal(
    'article 50 university subgroups',
    debt
      .filter((r: Data) => r.text.startsWith('А)') || r.text.startsWith('Б)'))
      .map((r: Data) => r.value),
    university.value,
  );
  checks.equal(
    'article 50 university detail',
    debt.filter((r: Data) => r.no.startsWith('5.')).map((r: Data) => r.value),
    university.value,
  );
  const muni = {
    art52: municipal(
      tables,
      79,
      89,
      ['total', 'delegated', 'equalizing', 'winterRoads', 'capital'],
      checks,
    ),
    art53: municipal(
      tables,
      90,
      100,
      [
        'delegated',
        'admin',
        'mayors',
        'adminStaff',
        'defence',
        'education',
        'health',
        'social',
        'culture',
        'economy',
      ],
      checks,
    ),
  };
  muni.art52.rows.forEach((a: Data, i: number) => {
    const b = muni.art53.rows[i];
    assert(
      fold(a.region) === fold(b.region) && fold(a.name) === fold(b.name),
      'municipality identity mismatch',
    );
    checks.equal('delegated cross-table ' + a.name, [a.values[1]], b.values[0]);
  });
  const sums = Object.fromEntries(
    ['bill', 'billMc'].map((variant) => [
      variant,
      {
        budgets: 47,
        expKhil: decimalSum(
          Object.entries(arts)
            .filter(([a]) => a !== '1')
            .map(([, occ]) => occ[variant === 'billMc' && occ.length === 2 ? 1 : 0]!.headline.exp),
        ),
        revKhil: decimalSum(
          Object.entries(arts)
            .filter(([a]) => a !== '1')
            .map(
              ([, occ]) => occ[variant === 'billMc' && occ.length === 2 ? 1 : 0]!.headline.rev ?? 0,
            ),
        ),
      },
    ]),
  );
  return annualValue({
    year: 2027,
    unit: 'хил. евро',
    source,
    bill: Object.fromEntries(Object.entries(arts).map(([a, occ]) => [a, occ[0]])),
    billMc: Object.fromEntries(
      Object.entries(arts)
        .filter(([, occ]) => occ.length === 2)
        .map(([a, occ]) => [a, occ[1]]),
    ),
    municipal: muni,
    projects: projects(tables),
    articles: misc,
    otherTables,
    tables,
    sums,
    checks: checks.results,
    coverage: coverageResults,
    limitations: [
      'The PDF prints no standalone aggregate revenue/expenditure total for articles 2–48. Expenditure aggregate is checked against the sum of their printed distribution totals; revenue is checked per budget.',
      'Annex 2 prints no overall or per-year project total; all 226 numbered rows and three annual cells are checked for completeness.',
    ],
    tolerance: '0.05 thousand EUR per independently rounded printed cell, including total',
  } as unknown as BillExtraction & Data);
}
