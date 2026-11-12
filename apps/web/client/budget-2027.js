// Release-local presentation of the pinned November bill. No money comes from historical DTOs.
import { dataHref } from './data.js';
export const FRAMEWORK = ['2027.draft', '2028.forecast', '2029.forecast'];
export const isFramework = (ctx) => FRAMEWORK.includes(ctx.period.key);
export const cellValue = (cell) =>
  typeof cell?.value === 'number' && Number.isFinite(cell.value) ? cell.value : null;
export const strictSum = (cells) =>
  cells.length && cells.every((c) => cellValue(c) !== null)
    ? cells.reduce((s, c) => s + Math.round(c.value * 10), 0) / 10
    : null;
export function provenanceUrl(cell) {
  if (!cell?.provenance) return '';
  const base = dataHref('budget2027-provenance');
  const release = /^\/data\/releases\/([a-f0-9]{64})\/data\//.exec(base);
  return release
    ? `/api/releases/${release[1]}/provenance/budget2027/${cell.provenance}`
    : `${base}#${cell.provenance}`;
}
export const headline = (budget, section) =>
  budget?.rows?.find((r) => r.no === section + '.')?.cell;
// Stable spender codes identify institutions, not article numbers. Article 32 is new in this bill.
export const ARTICLE_BY_CODE = Object.freeze({
  '0100': 3,
  '0200': 5,
  '0300': 6,
  '0400': 7,
  '0500': 4,
  '0600': 2,
  1000: 9,
  1100: 10,
  1200: 11,
  1300: 12,
  1400: 13,
  1500: 14,
  1600: 15,
  1700: 16,
  1800: 17,
  1900: 18,
  2000: 19,
  2100: 23,
  2200: 24,
  2300: 25,
  2400: 21,
  2500: 26,
  3000: 27,
  3200: 28,
  3300: 29,
  3400: 30,
  3700: 31,
  3800: 33,
  3900: 34,
  4000: 8,
  4100: 35,
  4200: 36,
  4300: 37,
  4400: 38,
  4500: 39,
  4600: 40,
  4700: 43,
  4800: 41,
  5300: 42,
  7100: 22,
  7400: 20,
  8200: 45,
  8300: 44,
  8400: 46,
  8500: 47,
  8600: 48,
});
export function institutions(doc, variant = 'bill') {
  // billMc is intentionally sparse: absent articles are never copied from bill.
  return Object.entries(doc?.budgets?.[variant] || {})
    .filter(([a]) => Number(a) >= 2)
    .map(([article, b]) => ({
      ...b,
      article: Number(article),
      code:
        Object.keys(ARTICLE_BY_CODE).find((k) => ARTICLE_BY_CODE[k] === Number(article)) ||
        `art${article}`,
      revenue: headline(b, 'I'),
      expenditure: headline(b, 'II'),
      transfers: headline(b, 'III'),
    }));
}
const homoglyphs = {
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
  y: 'у',
};
export const municipalName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[abcehkmoptxy]/g, (c) => homoglyphs[c])
    .replace(/[^а-я0-9]/g, '')
    .replace(/^община/, '');
export function municipalRows(doc, identities) {
  const aliases = { добричка: 'добричселска', столичнаобщина: 'столична', бобовдол: 'бобовдол' };
  const key = (n) => aliases[municipalName(n)] || municipalName(n);
  return (doc?.municipal?.art52 || []).map((r) => {
    let matches = (identities?.items || []).filter((m) =>
      [m.name, m.lawName].filter(Boolean).some((n) => key(n) === key(r.name)),
    );
    if (matches.length > 1)
      matches = matches.filter(
        (m) => municipalName(m.region) === municipalName(r.region.replace(/^ОБЛАСТ\s+/i, '')),
      );
    const identity = matches.length === 1 ? matches[0] : null;
    const detail = doc.municipal.art53?.find((x) => x.name === r.name && x.region === r.region);
    return {
      ...r,
      id: identity?.id,
      regionId: identity?.regionId,
      displayName: identity?.name || r.name,
      // the bill prints „ОБЛАСТ БЛАГОЕВГРАД“; the screen uses the region name of the identity
      regionName: identity?.region || r.region,
      delegated: detail?.cells || [],
    };
  });
}
export function stateDebt(doc, key) {
  const column = { '2026.expected': 1, '2027.draft': 2, '2028.forecast': 3, '2029.forecast': 4 }[
    key
  ];
  if (column == null || !doc?.forecast?.VI_1) return null;
  const cells = doc.forecast.VI_1.map((r) => r.cells?.[column]);
  return {
    total: cells[0],
    pctGdp: cells[1],
    external: cells[2],
    externalPctGdp: cells[3],
    domestic: cells[4],
    domesticPctGdp: cells[5],
  };
}
export const MUNICIPAL_COLUMNS = [
  'Общо',
  'Делегирани дейности',
  'Изравнителна субсидия',
  'Зимно поддържане',
  'Капиталови разходи',
];
export const DELEGATED_COLUMNS = [
  'Делегирани дейности общо',
  'Общи държавни служби',
  'в т.ч. кметове',
  'в т.ч. общинска администрация',
  'Отбрана и сигурност',
  'Образование',
  'Здравеопазване',
  'Социални дейности',
  'Култура и спорт',
  'Икономически дейности',
];
