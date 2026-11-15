import references from './programme-references.json' with { type: 'json' };
import registry from './programme-differences.json' with { type: 'json' };
import { metaGuard } from './guards.js';

export interface ProgrammeCellRow {
  page: number;
  printedCode: string;
  kind: 'total' | 'policy' | 'program';
  name: string;
  values: (number | null)[];
}
export interface ProgrammeSource {
  code: string;
  file: string;
  sourceSha256: string;
  rows: ProgrammeCellRow[];
}
export const programmeReferences = references as Record<string, ProgrammeSource>;
export const supplementaryProgrammeCodes = Object.keys(programmeReferences).sort();
export const programmeColumns = [
  'consTotal',
  'consPrb',
  'consOther',
  'deptTotal',
  'deptPrb',
  'deptOther',
  'admTotal',
  'admPrb',
  'admOther',
];
const columnNames = [
  'консолидирани разходи — общо',
  'консолидирани разходи — бюджет на ПРБ',
  'консолидирани разходи — други средства',
  'ведомствени разходи — общо',
  'ведомствени разходи — бюджет на ПРБ',
  'ведомствени разходи — други средства',
  'администрирани разходи — общо',
  'администрирани разходи — бюджет на ПРБ',
  'администрирани разходи — други средства',
];
export function programmeEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const x = Object.keys(a).sort(),
    y = Object.keys(b).sort();
  return (
    x.length === y.length &&
    x.every((k, i) => k === y[i] && programmeEqual((a as any)[k], (b as any)[k]))
  );
}
export function programmeProjection(source: ProgrammeSource) {
  const policies: any[] = [];
  let parent: any = null,
    ordinal = 0;
  for (const row of source.rows.filter((r) => r.kind !== 'total')) {
    const code =
      source.code === '0100'
        ? row.kind === 'policy'
          ? `${source.code}.${String(++ordinal).padStart(2, '0')}.00`
          : `${source.code}.${String(ordinal).padStart(2, '0')}.${String(Number(/\d+$/u.exec(row.printedCode)![0])).padStart(2, '0')}`
        : source.code + row.printedCode.slice(4);
    const node: any = {
      code,
      name: row.name,
      kind: row.kind,
      printedCode: row.printedCode,
      values: { '2026': [...row.values] },
    };
    if (row.kind === 'policy') {
      node.programs = [];
      policies.push(node);
      parent = node;
    } else if (parent && (source.code === '0100' || code.slice(0, 7) === parent.code.slice(0, 7)))
      parent.programs.push(node);
    else {
      policies.push(node);
      parent = null;
    }
  }
  return { total: { '2026': [...source.rows[0]!.values] }, policies };
}
export function programmeAccounting(source: ProgrammeSource) {
  const differences: Record<string, number> = {},
    unavailable: string[] = [];
  const check = (key: string, total: number | null, parts: (number | null)[]) => {
    if (total === null || parts.some((x) => x === null)) {
      unavailable.push(key);
      return;
    }
    const delta =
      Math.round(total * 10) - parts.reduce<number>((s, x) => s + Math.round(x! * 10), 0);
    if (delta !== 0) differences[key] = delta;
  };
  source.rows.forEach((r, i) => {
    for (let j = 0; j < 9; j += 3)
      check(`row/${i}/split/${j}`, r.values[j]!, [r.values[j + 1]!, r.values[j + 2]!]);
    for (let j = 0; j < 3; j++)
      check(`row/${i}/sectors/${j}`, r.values[j]!, [r.values[j + 3]!, r.values[j + 6]!]);
  });
  const { policies } = programmeProjection(source);
  for (const p of policies.filter((p) => p.kind === 'policy'))
    for (let j = 0; j < 9; j++)
      check(
        `policy/${p.code}/${j}`,
        p.values['2026'][j],
        p.programs.map((n: any) => n.values['2026'][j]),
      );
  for (let j = 0; j < 9; j++)
    check(
      `total/${j}`,
      source.rows[0]!.values[j]!,
      policies.map((p) => p.values['2026'][j]),
    );
  check(
    'programmes/prb',
    source.rows[0]!.values[1]!,
    source.rows.filter((r) => r.kind === 'program').map((r) => r.values[1]!),
  );
  return { differences, unavailable };
}
const amount = (tenths: number) =>
  (tenths / 10).toLocaleString('bg-BG', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function programmeYearLabels(code: string) {
  return [
    'Отчет 2023',
    'Отчет 2024',
    'Закон 2025',
    code === '7400' ? 'Прогноза 2026' : 'Проект 2026',
    'Прогноза 2027',
    'Прогноза 2028',
  ];
}
export function programmeVintage(code: string) {
  return [
    'actual',
    'actual',
    'plan',
    code === '7400' ? 'forecast' : 'plan',
    'forecast',
    'forecast',
  ];
}
export function programmeNotes(source: ProgrammeSource) {
  const accounting = programmeAccounting(source),
    notes = [
      `Показана е таблицата за 2026 г. от програмния бюджет към законопроекта (страници ${[...new Set(source.rows.map((r) => r.page))].join(', ')}). Сумите по приетия закон се показват отделно и не се заменят с проектните.`,
    ];
  if (source.code === '7400')
    notes.push(
      'Заглавието в оригинала определя таблицата за ' +
        Object.keys(programmeProjection(source).total)[0] +
        ' г. като прогноза. Стойностите са представени с това означение, отделно от приетия закон.',
    );
  if (source.code === '0100')
    notes.push(
      'Документът означава функционалните области и програмите с поредни номера; кодовете за навигация са местни означения на портала.',
    );
  if (
    source.rows.some(
      (r) =>
        r.kind !== 'total' &&
        /^\d{4}/u.test(r.printedCode) &&
        !r.printedCode.startsWith(source.code),
    )
  )
    notes.push(
      'В документа две програми са отпечатани с префикс 7500 в бюджета на МИДТ (7400). Отпечатаните означения са запазени; връзките в портала използват префикса на ведомството.',
    );
  for (const [key, delta] of Object.entries(accounting.differences)) {
    const bits = key.split('/');
    let target: string;
    if (bits[0] === 'row') {
      const row = source.rows[Number(bits[1])]!;
      target = `„${row.name}“ (${row.printedCode}), ${columnNames[Number(bits[3])]}`;
    } else if (bits[0] === 'policy')
      target = `сбор на програмите в ${bits[1]}, ${columnNames[Number(bits[2])]}`;
    else if (bits[0] === 'total')
      target = `сбор на политиките и самостоятелните програми, ${columnNames[Number(bits[1])]}`;
    else target = 'сбор на всички програми по бюджета на ПРБ';
    notes.push(
      `Разлика в оригиналната таблица: ${target}. Отпечатаният общ ред е с ${amount(Math.abs(delta))} хил. € ${delta > 0 ? 'по-висок' : 'по-нисък'} от сбора на съставните редове/колони. Стойностите са запазени без корекция.`,
    );
  }
  if (accounting.unavailable.length)
    notes.push(
      'Празните клетки в оригинала остават без стойност (—). Сбор, който изисква такава клетка, не се сверява; тя не се приема за нула.',
    );
  return notes;
}
export function programmeSupplementGuard(value: unknown): value is Record<string, any> {
  const d = value as any;
  const source: ProgrammeSource | undefined = d && programmeReferences[d.id];
  if (
    !source ||
    d.sourceContract !== 'programme-supplement/1' ||
    !metaGuard(d.meta) ||
    d.meta.id !== 'D09' ||
    d.meta.unit !== 'хил. €' ||
    d.meta.status !== 'real' ||
    d.meta.mock !== false ||
    !programmeEqual(d.meta.source, ['prb'])
  )
    return false;
  const projection = programmeProjection(source),
    accounting = programmeAccounting(source);
  return (
    programmeEqual(
      Object.keys(d).sort(),
      [
        'meta',
        'id',
        'art',
        'name',
        'short',
        'tier',
        'years',
        'yearLabels',
        'vintage',
        'cols',
        'policiesKind',
        'total',
        'policies',
        'yearsComplete',
        'check',
        'skipped',
        'skippedTotal',
        'doc',
        'sourceContract',
        'sourceAudit',
        'accounting',
        'notes',
      ].sort(),
    ) &&
    d.tier === 'source-verified' &&
    typeof d.art === 'number' &&
    typeof d.name === 'string' &&
    typeof d.short === 'string' &&
    typeof d.policiesKind === 'string' &&
    programmeEqual(d.sourceAudit, { sourceSha256: source.sourceSha256, rows: source.rows }) &&
    programmeEqual(d.total, projection.total) &&
    programmeEqual(d.policies, projection.policies) &&
    programmeEqual(d.accounting, accounting) &&
    programmeEqual(accounting.differences, (registry as any)[source.sourceSha256]?.differences) &&
    programmeEqual(d.notes, programmeNotes(source)) &&
    programmeEqual(d.years, [2023, 2024, 2025, 2026, 2027, 2028]) &&
    programmeEqual(d.yearLabels, programmeYearLabels(source.code)) &&
    programmeEqual(d.vintage, programmeVintage(source.code)) &&
    programmeEqual(d.cols, programmeColumns) &&
    programmeEqual(d.yearsComplete, [2026]) &&
    programmeEqual(d.skipped, []) &&
    d.skippedTotal === 0 &&
    d.doc?.file === source.file &&
    d.doc?.archiveUrl === 'https://www.parliament.bg/bills/52/52-602-01-19.zip' &&
    programmeEqual(
      Object.keys(d.doc).sort(),
      ['file', 'pages', 'pagesByYear', 'archive', 'archiveUrl'].sort(),
    ) &&
    typeof d.doc.archive === 'string' &&
    programmeEqual(d.doc.pages, [...new Set(source.rows.map((r) => r.page))]) &&
    programmeEqual(d.doc.pagesByYear, { '2026': d.doc.pages }) &&
    typeof d.check?.zdbExp === 'number' &&
    programmeEqual(d.check, {
      prbTotal2026: source.rows[0]!.values[1],
      zdbExp: d.check.zdbExp,
      matchesLaw: d.check.zdbExp === source.rows[0]!.values[1],
      sourceDifferences: Object.keys(accounting.differences).length,
      unavailableChecks: accounting.unavailable.length,
    })
  );
}
export function programmeSupplementCounts(documents: unknown[]) {
  const valid = documents.filter(programmeSupplementGuard) as any[];
  return {
    budgets: valid.length,
    differ: valid.filter((d) => !d.check.matchesLaw).length,
    policies: valid.reduce(
      (s, d) => s + d.policies.filter((p: any) => p.kind === 'policy').length,
      0,
    ),
    programs: valid.reduce(
      (s, d) => s + d.sourceAudit.rows.filter((r: ProgrammeCellRow) => r.kind === 'program').length,
      0,
    ),
  };
}
