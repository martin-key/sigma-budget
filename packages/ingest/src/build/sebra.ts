import type { Json } from '@sigma-budget/dataset-schema';
import { metadata } from '../common/metadata.js';
import { pythonRound } from '../common/format.js';

/** XLSX rows and page listing are captured by the unchanged Python readers. */
export interface SebraCode {
  code: string;
  name: string;
  count: number;
  eur: number;
}
export interface SebraListingFile {
  label: string;
  day: string;
  listedOn: string;
  sizeKb: number;
  format: string;
}
export interface SebraEvidence {
  listing: {
    section: string;
    sectionPublished: string;
    page: string;
    retrieved: string;
    files: SebraListingFile[];
  };
  files: Record<string, { bytes: number; rows: Record<string, string>[] } | undefined>;
  latest: string;
  latestExpected: { count: number; eur: number };
}
interface Total {
  count: number;
  eur: number;
}
interface Section {
  title: string;
  day: string;
  codes: SebraCode[];
  total: Total | null;
}
interface Organisation extends Total {
  name: string;
  code: string;
  byCode: SebraCode[];
}
interface Day extends Total {
  day: string;
  ministry: string;
  ministryCode: string;
  byCode: SebraCode[];
  byOrganisation: Organisation[];
}
const cyrMap: Record<string, string> = Object.fromEntries(
  'eaopcxykBHMTAEOPCXK'.split('').map((c, i) => [c, 'еаорсхукВНМТАЕОРСХК'[i]!]),
);
function cyr(value: string): string {
  return value
    .replaceAll('\u00a0', ' ')
    .trim()
    .split(/\s+/u)
    .map((word) => (/[А-Яа-я]/u.test(word) ? [...word].map((c) => cyrMap[c] ?? c).join('') : word))
    .join(' ');
}
function num(value: string | undefined): number {
  if (!value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    throw new Error('Invalid SEBRA amount');
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Invalid SEBRA amount');
  return n;
}
function count(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new Error('Invalid SEBRA count');
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid SEBRA count');
  return n;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sortedCodes = (codes: SebraCode[]) =>
  [...codes].sort((a, b) => b.eur - a.eur || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
function totalsMatch(items: Total[], total: Total): boolean {
  return (
    sum(items.map((x) => x.count)) === total.count &&
    Math.abs(sum(items.map((x) => x.eur)) - total.eur) <= 0.005
  );
}
export function parseSebraDay(rows: Record<string, string>[]): Day {
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const row of rows) {
    const a = row.A ?? '',
      c = row.C ?? '';
    if (c.startsWith('Период:')) {
      const m = /^Период: (\d\d)\.(\d\d)\.(\d{4}) - (\d\d)\.(\d\d)\.(\d{4})$/.exec(c);
      if (!m || m[1] !== m[4] || m[2] !== m[5] || m[3] !== m[6])
        throw new Error('Unexpected SEBRA period');
      current = { title: cyr(a), day: `${m[3]}-${m[2]}-${m[1]}`, codes: [], total: null };
      sections.push(current);
    } else if (current && a.startsWith('Общо:')) {
      current.total = { count: count(row.C), eur: pythonRound(num(row.D), 2) };
      current = undefined;
    } else if (current && a !== 'Код' && row.D !== undefined && row.B !== undefined) {
      current.codes.push({
        code: a,
        name: cyr(row.B),
        count: count(row.C),
        eur: pythonRound(num(row.D), 2),
      });
    }
  }
  if (sections.length < 2 || sections.some((s) => !s.total))
    throw new Error('Unexpected SEBRA layout');
  if (new Set(sections.map((s) => s.day)).size !== 1) throw new Error('SEBRA periods disagree');
  for (const section of sections)
    if (!totalsMatch(section.codes, section.total!))
      throw new Error('SEBRA categories do not add up');
  const [top, ...orgs] = sections;
  if (
    !totalsMatch(
      orgs.map((o) => o.total!),
      top!.total!,
    )
  )
    throw new Error('SEBRA organisations do not add up');
  for (const code of top!.codes)
    if (
      !totalsMatch(
        orgs.flatMap((o) => o.codes.filter((c) => c.code === code.code)),
        code,
      )
    )
      throw new Error('SEBRA category differs across organisations');
  const ministry = /^(.+?) \( (\d{3}\*+) \)$/.exec(top!.title);
  if (!ministry) throw new Error('Invalid SEBRA ministry');
  const byOrganisation = orgs
    .map((o): Organisation => {
      const m = /^(.+?) \( (\d{10}) \)$/.exec(o.title);
      if (!m) throw new Error('Invalid SEBRA organisation');
      return { name: m[1]!, code: m[2]!, ...o.total!, byCode: sortedCodes(o.codes) };
    })
    .sort((a, b) => b.eur - a.eur || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  if (
    [ministry[1]!, ...byOrganisation.map((o) => o.name), ...top!.codes.map((c) => c.name)].some(
      (x) => /[A-Za-z]/.test(x),
    )
  )
    throw new Error('Latin letters in SEBRA names');
  return {
    day: top!.day,
    ministry: ministry[1]!,
    ministryCode: ministry[2]!,
    ...top!.total!,
    byCode: sortedCodes(top!.codes),
    byOrganisation,
  };
}
export function buildSebra(input: SebraEvidence, buildDate: string): Record<string, Json> {
  const listing = structuredClone(input.listing);
  if (listing.files.length !== 3 || new Set(listing.files.map((f) => f.day)).size !== 3)
    throw new Error('SEBRA listing changed');
  const days: Day[] = [],
    sizes: Record<string, number> = {};
  for (const f of listing.files) {
    const file = input.files[f.day];
    if (!file) {
      if (f.day === input.latest) throw new Error('Latest SEBRA file missing');
      continue;
    }
    if (!Number.isSafeInteger(file.bytes) || pythonRound(file.bytes / 1024, 2) !== f.sizeKb)
      throw new Error('SEBRA file size mismatch');
    const day = parseSebraDay(file.rows);
    if (day.day !== f.day) throw new Error('SEBRA file date mismatch');
    sizes[f.day] = file.bytes;
    days.push(day);
  }
  const latest = days.find((d) => d.day === input.latest);
  if (
    !latest ||
    latest.count !== input.latestExpected.count ||
    latest.eur !== input.latestExpected.eur
  )
    throw new Error('Latest SEBRA summary changed');
  if (new Set(days.map((d) => d.ministry)).size !== 1)
    throw new Error('SEBRA ministry differs between days');
  const codes = new Map<string, SebraCode>();
  for (const day of days)
    for (const x of day.byCode) {
      const prev = codes.get(x.code) ?? { code: x.code, name: x.name, count: 0, eur: 0 };
      if (prev.name !== x.name) throw new Error('SEBRA category descriptions differ');
      prev.count += x.count;
      prev.eur += x.eur;
      codes.set(x.code, prev);
    }
  const overall = {
    count: sum(days.map((d) => d.count)),
    eur: pythonRound(sum(days.map((d) => d.eur)), 2),
    byCode: sortedCodes([...codes.values()].map((c) => ({ ...c, eur: pythonRound(c.eur, 2) }))),
  };
  if (Math.abs(sum(overall.byCode.map((c) => c.eur)) - overall.eur) > 0.005)
    throw new Error('SEBRA overall categories do not add up');
  const outDays = days.map((d) => ({
    date: d.day,
    label: listing.files.find((f) => f.day === d.day)!.label,
    count: d.count,
    eur: d.eur,
    byCode: d.byCode,
    byOrganisation: d.byOrganisation,
  }));
  const publication = {
    ...listing,
    files: listing.files.map((f) => ({
      ...f,
      bytes: sizes[f.day] ?? null,
      parsed: f.day in sizes,
    })),
  };
  const ministry = latest.ministry;
  return {
    meta: metadata('D24', 'Плащания по СЕБРА: дневни обобщения на МИДТ', buildDate, {
      source: ['sebra'],
      sourceNote:
        'Министерство на иновациите и дигиталната трансформация, страница „СЕБРА 2026“: дневни обобщения на плащанията (xlsx) за 27, 28 и 31 август 2026 г.',
      asOf: input.latest,
      unit: '€',
    }),
    period: { from: input.latest, to: input.latest },
    ministry: ministry.startsWith('М-во ') ? ministry.replace('М-во ', 'Министерство ') : ministry,
    ministryPrinted: ministry,
    ministryCode: latest.ministryCode,
    publisher: 'Министерство на иновациите и дигиталната трансформация',
    total: { count: latest.count, eur: latest.eur },
    byCode: latest.byCode,
    byOrganisation: latest.byOrganisation,
    days: outDays,
    overall,
    overallLabel: `Сборът на публикуваните дни (${outDays.map((d) => d.label.replace(' 2026 г.', '')).join(', ')}), не на целия месец`,
    publication,
    notes: [
      'Файловете са дневни обобщения по категория плащане и по бюджетна организация. Получатели и отделни плащания в тях няма.',
      `В заглавието на файловете институцията е записана като „${ministry}“ (код ${latest.ministryCode}); обобщенията са публикувани на страницата на Министерство на иновациите и дигиталната трансформация.`,
      'Кодът на категорията е както е във файла: първите две цифри са категорията, „xxxx“ е частта от кода, която файлът не показва.',
      'На 1 октомври 2026 г. страницата показва само документите за август 2026 г. и само три дни от тях (27, 28 и 31 август): това не е пълният месец и не са пълните разходи на министерството. Сумите са в евро.',
    ],
    check: {
      daysParsed: days.length,
      daysListed: listing.files.length,
      categoriesAddUp: true,
      organisationsAddUp: true,
      fileSizesMatchListing: true,
    },
  } as unknown as Record<string, Json>;
}
