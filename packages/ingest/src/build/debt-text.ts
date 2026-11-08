import type { Json } from '@sigma-budget/dataset-schema';
import { pythonRound } from '../common/format.js';
import { type CleanPage } from './fiscal.js';
import { GROUPS, SECTORS, SECTOR_LABELS } from './debt-definitions.js';
const years = [2024, 2025, 2026, 2027, 2028];
const getPage = (pages: CleanPage[], n: number): string => {
  const p = pages.find((x) => x.page === n);
  if (!p) throw new Error(`PDF page ${n} is missing`);
  return p.body;
};
const flat = (s: string) => s.replace(/\s+/gu, ' ');
function decimalNumber(s: string, field = 'number'): number {
  const token = s.trim();
  // Python float accepts decimal/exponent spellings and digit separators,
  // but not JavaScript's empty, hexadecimal, binary or octal number strings.
  if (!/^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/.test(token))
    throw new Error(`invalid ${field} ${s}`);
  const value = Number(token.replaceAll('_', ''));
  if (!Number.isFinite(value)) throw new Error(`invalid ${field} ${s}`);
  return value;
}
const num = (s: string) => decimalNumber(s.replaceAll(' ', '').replace(',', '.'));
function search(pattern: RegExp, text: string): string[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const found = [...text.matchAll(new RegExp(pattern.source, flags))];
  if (found.length !== 1)
    throw new Error(
      `pattern ${pattern.source.slice(0, 70)} matched ${found.length} times (expected 1)`,
    );
  return found[0]!.slice(1);
}
export function parseDebtStructure(pages: CleanPage[]): Record<string, Json> {
  const lines = getPage(pages, 144)
      .split('\n')
      .map((x) => x.trim()),
    idx = lines.indexOf('Показатели');
  if (
    idx < 0 ||
    lines.slice(idx + 1, idx + 6).join(',') !== years.join(',') ||
    lines.slice(idx + 6, idx + 11).join(',') !== 'Отчет,Отчет,Проект,Прогноза,Прогноза'
  )
    throw new Error('Табл. VI-2 header changed');
  const values = (label: string) => {
    const hits = lines.flatMap((x, i) => (x === label ? [i] : []));
    if (hits.length !== 1) throw new Error(`Табл. VI-2 label ${label} found ${hits.length} times`);
    return lines.slice(hits[0]! + 1, hits[0]! + 6);
  };
  const deviations: Record<string, number> = {};
  const groups = GROUPS.map(([id, label, rows]) => {
    const sums = [0, 0, 0, 0, 0];
    const result = rows.map(([rid, source, name]) => {
      const vals = values(source).map((s) => {
        if (s === '-') return null;
        if (!s.endsWith('%')) throw new Error(`unexpected percent cell ${s}`);
        return decimalNumber(s.slice(0, -1).replace(',', '.'), 'percent cell');
      });
      vals.forEach((v, i) => {
        sums[i]! += v ?? 0;
      });
      return {
        id: rid,
        label: name,
        years: years.filter((_, i) => vals[i] !== null),
        values: vals.filter((v): v is number => v !== null),
      };
    });
    deviations[id] = pythonRound(Math.max(...sums.map((s) => Math.abs(s - 100))), 2);
    return { id, label, rows: result };
  });
  const printed = values('дълга в обращение /в години/');
  const months = printed.map((s) => {
    const [y, m] = search(/^(\d+) г\. и (\d+) м\.$/, s);
    return 12 * Number(y) + Number(m);
  });
  const prose = flat(getPage(pages, 143));
  for (const needle of ['39,4%', '30,4%', '26,1%', '4,1%', '91,7%', '95,9%', '81,6%'])
    if (!prose.includes(needle)) throw new Error(`p.143 no longer repeats ${needle}`);
  return {
    groups,
    avgMaturity: { label: 'Средна продължителност на дълга в обращение', years, months, printed },
    maxDeviationFrom100: deviations,
  };
}
export function parseDebtInterest(pages: CleanPage[]): Record<string, Json> {
  const t = flat(getPage(pages, 144));
  const a = search(
    /през 2024 г\. възлизат на ([\d ]+,\d) млн\. евро \(([\d ]+,\d) млн\. евро по външния и ([\d ]+,\d) млн\. евро по вътрешния\)/,
    t,
  );
  const b = search(
    /през 2025 г\. [-–] на ([\d ]+,\d) млн\. евро \(([\d ]+,\d) млн\. евро по външния и ([\d ]+,\d) млн\. евро по вътрешния/,
    t,
  );
  const c = search(/достигне до ([\d,]+)% \(при ([\d,]+)% в края на 2024/, t);
  return {
    years: [2024, 2025],
    totalMln: [num(a[0]!), num(b[0]!)],
    externalMln: [num(a[1]!), num(b[1]!)],
    domesticMln: [num(a[2]!), num(b[2]!)],
    pctGdpPrinted: { '2024': num(c[1]!), '2028': num(c[0]!) },
  };
}
export function parseGuaranteedDebt(pages: CleanPage[]): Record<string, Json> {
  const t = flat(getPage(pages, 145));
  const tot = search(
    /намалява до ниво от ([\d ]+,\d) млн\. евро от ([\d ]+,\d) млн\. евро през 2024 г\. Съотношението му спрямо БВП също отбелязва спад до ([\d,]+)% от ([\d,]+)%/,
    t,
  );
  const ext = search(
    /външният държавногарантиран дълг възлиза на ([\d ]+,\d) млн\. евро \(при ([\d ]+,\d) млн\. евро през 2024 г\.\), а вътрешният на ([\d ]+,\d) млн\. евро \(при ([\d ]+,\d) млн\. евро през 2024/,
    t,
  );
  const [guarantees] = search(
    /са издадени нови държавни гаранции в общ размер на ([\d ]+,\d) млн\. евро/,
    t,
  );
  const i = t.indexOf('През годината превес имат'),
    j = t.indexOf('докато през 2024 г.'),
    k = t.indexOf('В рамките на ограничението', j);
  if (i < 0 || j < i || k < j) throw new Error('guaranteed debt sector boundaries missing');
  const extract = (s: string) =>
    Object.fromEntries(
      [...s.matchAll(/сектор „([^“]+)“ [-–] ([\d,]+)%/g)].map((m) => [m[1]!, num(m[2]!)]),
    );
  const a = extract(t.slice(i, j)),
    b = extract(t.slice(j, k)),
    names = SECTORS.map((x) => x[1]).sort();
  if (
    Object.keys(a).sort().join('|') !== names.join('|') ||
    Object.keys(b).sort().join('|') !== names.join('|')
  )
    throw new Error('guaranteed debt sector list changed');
  const labels: Record<string, string> = SECTOR_LABELS;
  return {
    years: [2024, 2025],
    totalMln: [num(tot[1]!), num(tot[0]!)],
    pctGdpPrinted: [num(tot[3]!), num(tot[2]!)],
    externalMln: [num(ext[1]!), num(ext[0]!)],
    domesticMln: [num(ext[3]!), num(ext[2]!)],
    newGuarantees2025Mln: num(guarantees!),
    sectors: SECTORS.map(([id, n]) => ({ id, label: labels[id]!, values: [b[n]!, a[n]!] })),
  };
}
export function parseNewDebt(pages: CleanPage[]): Record<string, Json> {
  const t39 = flat(getPage(pages, 139)),
    t = flat([139, 140, 141].map((n) => getPage(pages, n)).join(' '));
  const [total, eur, dom, st] = search(
    /Поетият нов дълг през 2025 г\. е в размер на ([\d ]+,\d) млн\. евро, от които ([\d ]+,\d) млн\. евро [-–] еврооблигации на външните пазари, ([\d ]+,\d) млн\. евро \([\d ]+,\d млн\. лв\.\) [-–] емисии ДЦК, деноминирани в лева, на вътрешния пазар, ([\d ]+,\d) млн\. евро [-–] ратифицирани структурни/,
    t39,
  );
  const [repay] = search(
    /погашения към външни и вътрешни кредитори достигат ([\d,]+) млрд\. евро/,
    t39,
  );
  const [limit26] = search(
    /планираният максимален размер на новия държавен дълг, който може да бъде поет през годината е до ([\d,]+) млрд\. евро/,
    t,
  );
  const [n27, n28, r27, r28] = search(
    /съответно от ([\d,]+) млрд\. евро и ([\d,]+) млрд\. евро годишно, като дългът в обращение, който ще бъде рефинансиран е в размер на ([\d,]+) млрд\. евро за 2027 г\. и ([\d,]+) млрд\. евро за 2028/,
    t,
  );
  const [end26] = search(
    /ограничение за максималния размер на държавния дълг към края на годината до ([\d,]+) млрд\. евро/,
    t,
  );
  const [total26] = search(
    /деноминирани в евро, с общ номинален размер от ([\d ]+,\d) млн\. евро, от които/,
    t,
  );
  const months = [
    ...t.matchAll(
      /през (януари|февруари|март|април) - ДЦК, с общ номинален размер от ([\d ]+,\d) млн\. евро/g,
    ),
  ].map((m) => ({ month: m[1]!, mln: num(m[2]!) }));
  const [may] = search(
    /през май [-–] 10-годишни ДЦК с номинален размер от ([\d ]+,\d) млн\. евро/,
    t,
  );
  months.push({ month: 'май', mln: num(may!) });
  if (months.map((m) => m.month).join(',') !== 'януари,февруари,март,април,май')
    throw new Error('2026 domestic issues month list changed');
  const uses = search(
    /ще бъдат насочени за (рефинан?сиране на дълга в обращение), (покриване на бюджетен дефицит, включително за префинансиране по Плана за възстановяване и устойчивост на Република България), за (придобиване на дялове, акции и съучастия)\s*\d*\s*и (други финансиращи операции)/,
    t,
  );
  uses[0] = uses[0]!.replace('рефинасиране', 'рефинансиране');
  return {
    uses,
    y2025: {
      totalMln: num(total!),
      parts: [
        {
          id: 'eurobonds',
          label: 'Еврооблигации на международните капиталови пазари',
          mln: num(eur!),
        },
        {
          id: 'domesticBonds',
          label: 'ДЦК на вътрешния пазар (деноминирани в лева)',
          mln: num(dom!),
        },
        {
          id: 'structuralLoans',
          label:
            'Структурни програмни заеми (Европейска инвестиционна банка, Банка за развитие на Съвета на Европа)',
          mln: num(st!),
        },
      ],
      repaymentsBln: num(repay!),
    },
    plan: [
      { year: 2026, kind: 'limit', bln: num(limit26!) },
      { year: 2027, kind: 'plan', bln: num(n27!), refinancedBln: num(r27!) },
      { year: 2028, kind: 'plan', bln: num(n28!), refinancedBln: num(r28!) },
    ],
    limitEnd2026Bln: num(end26!),
    issued2026: { months, totalMln: num(total26!) },
  };
}
/** Debt limits in the independently extracted adopted-law paragraph stream. */
export function parseDebtLawLimits(paragraphs: string[]): Record<string, Json> {
  const articles: Record<number, string[]> = {};
  for (const p of paragraphs) {
    const m = /^Чл\. (\d+)\. (.*)$/.exec(p);
    if (m) (articles[Number(m[1])] ??= []).push(m[2]!);
  }
  const article = (n: number) => {
    const v = articles[n] ?? [];
    if (v.length !== 1) throw new Error(`ЗДБ 2026: art. ${n} found ${v.length} times`);
    return v[0]!;
  };
  const one = (n: number, pattern: RegExp) => {
    const m = pattern.exec(article(n));
    if (!m) throw new Error(`ЗДБ 2026: art. ${n} changed`);
    return m.slice(1);
  };
  const [reserve] = one(
    65,
    /^Минималният размер на фискалния резерв към 31 декември 2026 г\. е в размер на ([\d,]+) млрд\. евро\.$/,
  );
  const [cap] = one(
    66,
    /^Максималният размер на държавния дълг към края на 2026 г\. не може да надвишава ([\d,]+) млрд\. евро\.$/,
  );
  const [newDebt, safe] = one(
    67,
    /^\(1\) Максималният размер на новия държавен дълг, който може да бъде поет през годината по реда на Закона за държавния дълг, е ([\d,]+) млрд\. евро, в това число заем в размер до ([\d ]+,\d) млн\. евро за получаване на финансова подкрепа по линия на инструмента „Мерки за сигурността на Европа \(SAFE\)/,
  );
  const [guarantees] = one(
    69,
    /^\(1\) Максималният размер на новите държавни гаранции, които могат да бъдат поети по реда на Закона за държавния дълг през 2026 г\., е до ([\d ]+) млн\. евро\.$/,
  );
  const [all] = one(
    71,
    /^Максималният размер на новите държавни гаранции, които могат да бъдат издадени по реда на чл\. 69 и 70, е до ([\d ]+)\s*млн\. евро\.$/,
  );
  return {
    reserveMinBln: num(reserve!),
    debtCapEnd2026Bln: num(cap!),
    newDebtBln: num(newDebt!),
    safeLoanMln: num(safe!),
    newGuaranteesMln: num(guarantees!),
    guaranteesAllMln: num(all!),
  };
}
