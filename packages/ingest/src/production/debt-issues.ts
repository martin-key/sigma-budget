import { validDebtIsin as validIsin } from '@sigma-budget/dataset-schema';
export { validDebtIsin as validIsin } from '@sigma-budget/dataset-schema';
import differences from './debt-source-differences.json' with { type: 'json' };
import { join } from 'node:path';
import { readPinnedFile } from '../readers/workbooks/index.js';
import { readPdf, type PdfDocument, type PdfPage } from '../readers/pdf/index.js';
import { metadata } from '../common/metadata.js';
import type { ExecutionContext } from '../release-build/types.js';
function need(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}
const ws = (s: string) => s.replace(/\s+/gu, ' ').trim();
const integer = (s: string, scale = 1) => {
  need(/^\d[\d ]*(?:\.\d+)?$/.test(s.trim()), 'Invalid debt amount: ' + s);
  const n = Number(s.replaceAll(' ', '')) * scale;
  need(Number.isSafeInteger(n), 'Non-integral debt amount');
  return n;
};
const date = (s: string) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(s);
  need(m, 'Invalid debt date');
  const result = `${m[3]!.length === 2 ? '20' : ''}${m[3]}-${m[2]}-${m[1]}`;
  need(new Date(result).toISOString().slice(0, 10) === result, 'Invalid calendar date');
  return result;
};
function lines(p: PdfPage) {
  const result: { y: number; chars: { text: string; origin: [number, number] }[]; text: string }[] =
    [];
  for (const c of p.blocks.flatMap((b) =>
    b.lines.flatMap((l) => l.spans.flatMap((s) => s.chars)),
  )) {
    let line = result.find((l) => Math.abs(l.y - c.origin[1]) < 2);
    if (!line) {
      line = { y: c.origin[1], chars: [], text: '' };
      result.push(line);
    }
    line.chars.push(c);
  }
  for (const l of result) {
    l.chars.sort((a, b) => a.origin[0] - b.origin[0]);
    l.text = ws(l.chars.map((c) => c.text).join(''));
  }
  return result.sort((a, b) => a.y - b.y);
}
export function parseDebtIssues(pdf: PdfDocument, buildDate: string) {
  need(pdf.pages.length === 21, 'Debt bulletin page count');
  const domestic = lines(pdf.pages[6]!)
    .filter((l) => /^.+ BG\d{10} EUR /.test(l.text))
    .map((l) => {
      const m =
        /^(.*?) (BG\d{10}) (EUR) (\d{2}\.\d{2}\.\d{4}) (\d{2}\.\d{2}\.\d{4}) (.*?) ([\d.]+) ([\d.]+)% ([\d.]+) ([\d.]+)%$/.exec(
          l.text,
        );
      need(m, 'Domestic debt row layout');
      const amounts = m[6]!.match(/\d[\d ]*\.\d{2}/g)!;
      need(amounts.length === 3, 'Domestic amount columns');
      return {
        originalMaturity: m[1]!,
        isin: m[2]!,
        currency: m[3]!,
        issueDate: date(m[4]!),
        maturity: date(m[5]!),
        offered: integer(amounts[0]!, 1000),
        bids: integer(amounts[1]!, 1000),
        nominal: integer(amounts[2]!, 1000),
        price: Number(m[7]),
        coupon: Number(m[8]),
        coverage: Number(m[9]),
        yield: Number(m[10]),
      };
    });
  need(domestic.length === 13, 'Domestic debt row count');
  const auctions = lines(pdf.pages[7]!)
    .filter((l) => /^\d{2}\.\d{2}\.26 /.test(l.text))
    .map((l) => {
      const m =
        /^(\S+) (\S+) (BG\d{10}) EUR ([\d.]+)% (\S+) (\S+) (\d+) г\. (.*?) ([\d.]+) ([\d.]+)% ([\d.]+)$/.exec(
          l.text,
        );
      need(m, 'Auction row layout');
      const a = m[8]!.match(/\d[\d ]*\.\d{2}/g)!;
      need(a.length === 3, 'Auction amount columns');
      return {
        date: date(m[1]!),
        settlement: date(m[2]!),
        isin: m[3]!,
        coupon: Number(m[4]),
        issueDate: date(m[5]!),
        maturity: date(m[6]!),
        offered: integer(a[0]!, 1000),
        bids: integer(a[1]!, 1000),
        approved: integer(a[2]!, 1000),
        price: Number(m[9]),
        yield: Number(m[10]),
        coverage: Number(m[11]),
      };
    });
  need(auctions.length === 12, 'Auction row count');
  const external = [];
  for (const page of [pdf.pages[13]!, pdf.pages[14]!]) {
    const ls = lines(page),
      maturity = ls.find((l) => l.text.startsWith('Падеж '))!;
    need(maturity, 'External maturity header');
    const text = maturity.chars.map((c) => c.text).join('');
    const hits = [...text.matchAll(/\d{2}\.\d{2}\.\d{4}/g)];
    const centers = hits.map((m) => maturity.chars[m.index!]!.origin[0] + 14);
    const bounds = [
      centers[0]! - 30,
      ...centers.slice(1).map((v, i) => (v + centers[i]!) / 2),
      page.width,
    ];
    const get = (column: number, y0: number, y1: number) =>
      ws(
        ls
          .filter((l) => l.y >= y0 && l.y < y1)
          .map((l) =>
            l.chars
              .filter((c) => c.origin[0] >= bounds[column]! && c.origin[0] < bounds[column + 1]!)
              .map((c) => c.text)
              .join(''),
          )
          .join(' '),
      );
    const nom = ls.find((l) => l.text.startsWith('Номинал ') && !l.text.startsWith('Номинал ('))!,
      post = ls.find((l) => l.text.startsWith('Номинал (след'))!,
      isin = ls.find((l) => l.text.startsWith('ISIN '))!;
    for (let c = 0; c < hits.length; c++) {
      const base = integer(get(c, nom.y - 1, nom.y + 1).replace('*', ''));
      const reopened = get(c, post.y + 2, post.y + 7);
      const amount = reopened === '-' ? base : integer(reopened);
      const reopening = get(c, nom.y + 19, nom.y + 24);
      need(
        base + (reopening === '-' ? 0 : integer(reopening)) === amount,
        'External reopening total',
      );
      const ids = get(c, isin.y - 7, isin.y + 14).match(/XS\d{10}/g)!;
      need(ids?.length, 'External ISIN cell');
      const currency = get(c, nom.y - 24, nom.y - 17);
      need(currency === 'EUR' || currency === 'USD', 'External currency');
      external.push({
        isins: ids,
        currency,
        maturity: date(hits[c]![0]),
        nominal: amount,
        issueDate: date(
          get(c, maturity.y - 30, maturity.y - 10)
            .match(/\d{2}\.\d{2}\.\d{4}/g)!
            .sort((a, b) => date(a).localeCompare(date(b)))[0]!,
        ),
        page: page.number,
      });
    }
  }
  need(external.length === 17, 'External debt row count');
  const stockLines = lines(pdf.pages[4]!);
  const stock = (name: string) => {
    const l = stockLines.find((l) => l.text.startsWith(name));
    need(l, 'Debt stock row ' + name);
    const a = l.text.match(/\d[\d ]*\.\d/g)!;
    need(a.length === 6, 'Debt stock columns');
    return integer(a.at(-1)!, 1000000);
  };
  const domesticStock = stock('І. ДЦК, емитирани на вътрешния пазар'),
    externalStock = stock('І. ДЦК, емитирани на МКП');
  need(stock('Вътрешен държавен дълг') === domesticStock, 'Domestic stock subtotal');
  const externalComponentDifference =
    stock('Външен държавен дълг') - externalStock - stock('ІІ. Заеми');
  need(
    stock('Общо държавен дълг ') -
      stock('Вътрешен държавен дълг') -
      stock('Външен държавен дълг') ===
      0,
    'Government stock total',
  );
  const maturity = lines(pdf.pages[5]!)
    .filter((l) => /^(До 1 година|От 1 до 5 години|От 5 до 10 години|Над 10 години) /.test(l.text))
    .map((l) => {
      const m = /^(.*?) (-|[\d.]+%) ([\d.]+)%$/.exec(l.text);
      need(m, 'Maturity bucket row');
      return {
        label: m[1]!,
        ...(m[2] === '-' ? {} : { originalTenths: integer(m[2]!.replace('%', ''), 10) }),
        residualTenths: integer(m[3]!, 10),
      };
    });
  need(maturity.length === 4, 'Maturity bucket count');
  const ids = [...domestic.map((r) => r.isin), ...external.flatMap((r) => r.isins)];
  need(ids.every(validIsin), 'ISIN check digit');
  need(new Set(ids).size === ids.length, 'Duplicate debt ISIN');
  need(
    [...domestic, ...external].every((r) => r.maturity > r.issueDate),
    'Maturity precedes issue',
  );
  need(
    new Set(auctions.map((r) => r.date + '/' + r.isin)).size === auctions.length,
    'Duplicate auction',
  );
  for (const a of auctions) {
    const d = domestic.find((d) => d.isin === a.isin);
    need(
      d &&
        a.date.startsWith('2026-') &&
        a.settlement >= a.date &&
        a.settlement <= '2026-09-30' &&
        a.issueDate === d.issueDate &&
        a.maturity === d.maturity &&
        a.coupon === d.coupon,
      'Auction identity/date',
    );
  }
  for (const d of domestic.filter((d) => d.issueDate.startsWith('2026'))) {
    const a = auctions.filter((a) => a.isin === d.isin);
    need(a.length, 'Missing auctions');
    for (const [key, col] of [
      ['offered', 'offered'],
      ['bids', 'bids'],
      ['nominal', 'approved'],
    ] as const)
      need(a.reduce((n, r) => n + r[col], 0) === d[key], 'Auction/issue sum ' + key);
  }
  const differencesFound = {
    externalStockComponents: externalComponentDifference,
    domesticStock: domestic.reduce((n, r) => n + r.nominal, 0) - domesticStock,
    originalMaturity: maturity.reduce((n, r) => n + (r.originalTenths ?? 0), 0) - 1000,
    residualMaturity: maturity.reduce((n, r) => n + r.residualTenths, 0) - 1000,
  };
  const registered = (differences as Record<string, { differences: Record<string, number> }>)[
    pdf.sha256
  ];
  need(
    registered && JSON.stringify(registered.differences) === JSON.stringify(differencesFound),
    'Unregistered debt source difference',
  );
  return {
    meta: metadata('D38', 'Държавен дълг: емисии и аукциони', buildDate, {
      source: ['minfin'],
      asOf: '2026-09-30',
      sourceNote: 'МФ, месечен бюлетин за септември 2026 г.; предварителни данни по номинал.',
      unit: 'EUR; USD',
    }),
    schema: 'debt-issues/1',
    sourceSha256: pdf.sha256,
    sourceUrl: 'https://www.minfin.bg/upload/65462/Bulletin_GovDebt_09-2026_bg.pdf',
    domestic,
    auctions,
    external,
    maturity,
    stock: { domestic: domesticStock, external: externalStock },
    differences: differencesFound,
    limitations: [
      'Към 30.09.2026 г., по номинал, предварителни данни на МФ. Това е моментна снимка, а не времеви ред.',
      'Бюлетинът посочва емисия XS2890436087 в USD; тя не е превалутирана. Общият EUR сбор, включващ тази емисия, не може да бъде сверен без непубликуван в бюлетина курс.',
      'Матуритетната структура е отпечатаната структура на целия държавен дълг по срокове, а не годишен график на плащанията по емисиите. Таблиците за притежатели не са погасителен график.',
      'Държавният дълг по бюлетина на МФ има различен обхват от консолидирания дълг на сектор „Държавно управление“ по Евростат.',
    ],
    validation: [
      {
        check: 'Външни емисии: общ EUR сбор',
        outcome: 'неизпълнимо',
        reason: 'Емисия в USD без публикувана EUR равностойност или валутен курс.',
      },
      {
        check: 'Външни емисии: EUR подсбор',
        outcome: 'неизпълнимо',
        reason: 'В таблицата няма отпечатан отделен EUR подсбор.',
      },
    ],
  };
}
export function readDebtIssues(context: Readonly<ExecutionContext>) {
  const f = context.inputs.find(
    (f) => f.path === 'data/originals/debt/Bulletin_GovDebt_09-2026_bg.pdf',
  );
  need(f, 'Missing debt bulletin');
  return parseDebtIssues(
    readPdf(
      readPinnedFile({
        path: join(context.preparedInputRoot ?? context.exportRoot, f.path),
        sha256: f.sha256,
      }),
    ),
    context.buildDate,
  );
}

import type { Wave13bInput } from '../build/wave13b.js';
export function registerDebtCatalog(input: Wave13bInput, context: Readonly<ExecutionContext>) {
  const a = context.inputs.find((f) => f.path === 'data/originals/debt-issues-acquisition.json');
  need(a, 'Missing debt acquisition');
  const record = JSON.parse(
    readPinnedFile({
      path: join(context.preparedInputRoot ?? context.exportRoot, a.path),
      sha256: a.sha256,
    }).toString(),
  );
  const definition = {
    slug: 'debt-issues',
    file: 'debt-issues.json',
    group: 'execution',
    title: 'Държавен дълг: емисии и аукциони към 30.09.2026 г.',
    desc: 'По номинал, предварителни данни на МФ. USD емисията не е превалутирана.',
    screens: ['S17', 'S35'],
  };
  input.catalog.definitions = [...input.catalog.definitions, definition];
  input.search.authored = {
    ...input.search.authored,
    catalogDefinitions: [...input.search.authored.catalogDefinitions, definition],
  };
  input.catalog.primary.manifest = { ...input.catalog.primary.manifest };
  for (const f of record.files) {
    const key = f.path.replace(/^data\/originals\//, '');
    input.catalog.primary.manifest[key] = { ...f, http_status: 200 };
    input.catalog.primary.manifestFiles = [
      ...input.catalog.primary.manifestFiles,
      [key, key, ['minfin'], ['debt-issues']],
    ];
  }
}
