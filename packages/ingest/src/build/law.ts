import { roundNumber } from '../io/data.js';
import type { LawDataset, LawEvidence, LawKey } from './law-types.js';
export type * from './law-types.js';
import { metadata } from '../common/metadata.js';
import { sources } from '../common/sources.js';
import { articleOne, budgetRows, budgetTotals } from './law-articles.js';
import { lawChanges } from './law-changes.js';
import { gazetteFacts, next2027, parliamentFacts } from './law-evidence.js';
import { kinds } from './law-kinds.js';

type Data = Record<string, any>;
const laws: Data = { zdb: [167157, 'ЗДБ'], zbdoo: [167156, 'ЗБДОО'], zbnzok: [167155, 'ЗБНЗОК'] };
const page = (id: number) => `https://www.parliament.bg/bg/bills/ID/${id}`;
const files = 'https://www.parliament.bg/bills/52/';
const months = [
  'януари',
  'февруари',
  'март',
  'април',
  'май',
  'юни',
  'юли',
  'август',
  'септември',
  'октомври',
  'ноември',
  'декември',
];
function dtext(date?: string, to?: string, month?: string) {
  if (month) {
    const [y, m] = month.split('-');
    return `${months[Number(m) - 1]} ${y} г.`;
  }
  const [y, m, d] = date!.split('-').map(Number);
  if (!to) return `${d} ${months[m! - 1]} ${y} г.`;
  const [y2, m2, d2] = to.split('-').map(Number);
  if (y === y2 && m === m2) return `${d}–${d2} ${months[m! - 1]} ${y} г.`;
  return `${d} ${months[m! - 1]} – ${d2} ${months[m2! - 1]} ${y2} г.`;
}
function event(kind: string, title: string, date?: string, options: Data = {}): Data {
  const { to, month, detail, ref, source, href, phase = 'parliament' } = options;
  return {
    kind,
    phase,
    ...(date ? { date } : {}),
    ...(to ? { dateTo: to } : {}),
    ...(month ? { month } : {}),
    dateText: dtext(date, to, month),
    title,
    ...(detail ? { detail } : {}),
    ...(ref ? { ref } : {}),
    ...(href ? { href } : {}),
    source: source || ['parliament'],
  };
}
export function buildLaw(evidence: LawEvidence, buildDate: string): LawDataset {
  const L = evidence.law,
    P: Data = {},
    DV: Data = {};
  for (const [key, [id]] of Object.entries(laws) as [LawKey, [number, string]][]) {
    P[key] = parliamentFacts(id, evidence.parliament[key]);
    DV[key] = gazetteFacts(evidence.dvBlocks[key]);
  }
  const rows = budgetRows(L, evidence.ministries),
    totals = budgetTotals(rows, L),
    art1 = articleOne(L);
  const { changes, reconciliation } = lawChanges(L, rows, art1);
  const bills = Object.entries(laws).map(([key, [id, short]]: any) => {
    const p = P[key],
      dv = DV[key];
    if (p.issue !== dv.issue || p.adopted !== dv.adopted)
      throw new Error(`${key}: Parliament and gazette disagree`);
    return {
      id: key,
      short,
      sign: p.sign,
      title: p.title,
      lawTitle: p.lawTitle,
      submitted: p.submitted,
      firstReading: p.first,
      secondReading: p.second,
      adopted: p.adopted,
      decree: { no: dv.decree, issued: dv.issued },
      gazette: { issue: dv.issue, date: dv.date },
      inForce: { from: dv.general, exceptions: dv.inForce },
      counts: { committeeReports: p.reports, opinions: p.opinions, proposals: p.proposals.length },
      page: page(id),
      law: (sources as Data)[key].url,
      source: ['parliament', key],
    };
  });
  const z = P.zdb,
    bo = P.zbdoo,
    nz = P.zbnzok,
    zd = DV.zdb,
    dd = DV.zbdoo,
    nd = DV.zbnzok;
  const reportDates = Object.keys(z.reportDates),
    proposalDates = z.proposals.map((p: Data) => p.date);
  const fixed = [
    [z.submitted, '2026-07-01'],
    [z.first, '2026-07-15'],
    [z.second, ['2026-07-23', '2026-07-24']],
    [z.adopted, '2026-07-24'],
    [z.report2, ['2026-07-22']],
    [bo.adopted, '2026-07-22'],
    [nz.adopted, '2026-07-22'],
    [bo.first, '2026-07-10'],
    [nz.first, '2026-07-10'],
    [zd.date, '2026-07-31'],
    [dd.date, '2026-07-28'],
    [nd.date, '2026-07-28'],
    [reportDates[0], '2026-07-07'],
    [reportDates.at(-1), '2026-07-10'],
    [proposalDates[0], '2026-07-16'],
    [proposalDates.at(-1), '2026-07-20'],
  ];
  for (const [got, want] of fixed)
    if (JSON.stringify(got) !== JSON.stringify(want))
      throw new Error('Unexpected Parliament or gazette date');
  if (
    JSON.stringify([
      z.reports,
      z.opinions,
      z.proposals.length,
      z.reportAuthors,
      z.committees.length,
    ]) !== JSON.stringify([22, 70, 69, 22, 24])
  )
    throw new Error('Budget bill counts changed');
  const byDate: Data = {};
  for (const p of z.proposals) byDate[p.date] = (byDate[p.date] ?? 0) + 1;
  const leading = z.committees.filter((c: Data) => c.role === 'водеща').map((c: Data) => c.name);
  if (!leading.length) throw new Error('Missing leading committee');
  const pre = 'prehistory',
    motives = 'Мотиви към законопроекта (АСБП 2026–2028), стр. ';
  const timeline = [
    event('procedure', 'Министерският съвет приема бюджетната процедура за 2026 г.', '2025-07-17', {
      ref: 'Решение № 474 на Министерския съвет',
      source: ['asbp'],
      phase: pre,
      detail: motives + '5.',
    }),
    event(
      'bill',
      'Първоначалните проекти на бюджетни закони за 2026 г. са внесени в Народното събрание',
      undefined,
      {
        month: '2025-11',
        source: ['asbp'],
        phase: pre,
        detail: 'Одобрени от Министерския съвет. ' + motives + '5.',
      },
    ),
    event('bill', 'Проектите са оттеглени', '2025-12-02', {
      ref: 'Решение № 839 на Министерския съвет',
      source: ['asbp'],
      phase: pre,
      detail:
        'Според мотивите на Министерството на финансите: поради липса на консенсус със социалните партньори относно някои от предлаганите консолидационни мерки. ' +
        motives +
        '5.',
    }),
    event(
      'bill',
      'Министерският съвет одобрява повторно законопроект за държавния бюджет за 2026 г. и АСБП 2026–2028',
      '2025-12-08',
      {
        ref: 'Решение № 860 на Министерския съвет',
        source: ['asbp'],
        phase: pre,
        detail:
          'Законопроектът не е разгледан в Народното събрание поради последвалата оставка на правителството. ' +
          motives +
          '5.',
      },
    ),
    event(
      'extension-law',
      'Министерският съвет одобрява проект на удължителен закон',
      '2025-12-15',
      {
        ref: 'Решение № 886 на Министерския съвет',
        source: ['asbp'],
        phase: pre,
        detail:
          'Закон за събирането на приходи и извършването на разходи през 2026 г. до приемането на Закона за държавния бюджет на Република България за 2026 г., Закона за бюджета на държавното обществено осигуряване за 2026 г. и Закона за бюджета на Националната здравноосигурителна каса за 2026 г. ' +
          motives +
          '5.',
      },
    ),
    event('extension-law', 'Народното събрание приема удължителния закон', '2025-12-17', {
      ref: 'обн., ДВ бр. 113 от 23.12.2025 г.',
      source: ['asbp'],
      phase: pre,
      detail: motives + '5.',
    }),
    event('extension-law', 'Народното събрание приема промени в удължителния закон', '2026-03-18', {
      ref: 'обн., ДВ бр. 30 от 27.03.2026 г.',
      source: ['asbp'],
      phase: pre,
      detail:
        'Удължен е срокът на действие на закона до приемането на редовен бюджет. Предвидена е възможност Министерският съвет да сключи с Европейската комисия споразумение за заем до 3 261,7 млн. € по инструмента SAFE, при условие за последваща ратификация. ' +
        motives +
        '6.',
    }),
    event('politics', 'Парламентарни избори', '2026-04-19', {
      source: ['asbp'],
      phase: pre,
      detail: motives + '6.',
    }),
    event('politics', 'Сформиран е редовен кабинет', '2026-05-08', {
      source: ['asbp'],
      phase: pre,
      detail:
        'Една от първите задачи е да се изготвят законопроект за държавния бюджет за 2026 г. и АСБП 2026–2028. ' +
        motives +
        '6–7.',
    }),
    event(
      'submitted',
      'Законопроектът за държавния бюджет е внесен в Народното събрание',
      z.submitted,
      {
        ref: '№ ' + z.sign,
        href: page(167157),
        detail: `Внесен е заедно със законопроектите за бюджета на ДОО (№ ${bo.sign}) и на НЗОК (№ ${nz.sign}).`,
      },
    ),
    event('committees', 'Комисиите разглеждат законопроекта за първо гласуване', '2026-07-07', {
      to: '2026-07-10',
      detail: `Законопроектът е разпределен на ${z.committees.length} комисии; водеща е ${leading[0]}. ${z.reportAuthors} комисии внасят доклад за първо гласуване. В комисиите постъпват още ${z.opinions} становища.`,
    }),
    event('plenary-1', 'Първо гласуване на законопроектите за бюджета на ДОО и на НЗОК', bo.first, {
      detail: 'И двата законопроекта са приети.',
    }),
    event('plenary-1', 'Първо гласуване на законопроекта за държавния бюджет в залата', z.first, {
      detail: 'Законопроектът е приет на първо гласуване.',
    }),
    event('proposals', 'Предложения между първо и второ гласуване', '2026-07-16', {
      to: '2026-07-20',
      detail: `${z.proposals.length} предложения: ${andList(Object.entries(byDate).map(([d, n]) => `${n} на ${dtext(d).split(' ').slice(0, 2).join(' ')}`))} ${dtext(Object.keys(byDate)[0]).slice(-7)}`,
    }),
    event(
      'committee-2',
      'Комисията по бюджет и финанси приема доклад за второ гласуване',
      z.report2[0],
    ),
    event('adopted', 'Приети са законите за бюджета на ДОО и на НЗОК', bo.adopted, {
      detail: 'Второ гласуване в залата.',
    }),
    event('plenary-2', 'Второ гласуване на законопроекта за държавния бюджет', z.second[0], {
      to: z.second.at(-1),
    }),
    event('adopted', 'Законът за държавния бюджет е приет', z.adopted, {
      detail: 'Приет на второ гласуване.',
    }),
    event('gazette', 'ДВ бр. 68: Закон за бюджета на ДОО и Закон за бюджета на НЗОК', dd.date, {
      source: ['zbdoo', 'zbnzok'],
      href: (sources as Data).zbdoo.url,
      detail: `Указ № ${dd.decree} и № ${nd.decree}, издадени на ${dtext(dd.issued)}`,
    }),
    event(
      'gazette',
      'ДВ бр. 69: Закон за държавния бюджет на Република България за 2026 г.',
      zd.date,
      {
        source: ['zdb'],
        href: (sources as Data).zdb.url,
        detail: `Указ № ${zd.decree}, издаден на ${dtext(zd.issued)} Законът влиза в сила от 1 януари 2026 г., с изключения (§ 48).`,
      },
    ),
    {
      kind: 'execution',
      phase: 'execution',
      ongoing: true,
      dateText: 'Продължава',
      title: 'Изпълнение на бюджета: месечни отчети на консолидираната фискална програма',
      href: '#/izpalnenie',
      source: ['kfp'],
      detail: 'Министерството на финансите публикува отчет за изпълнението на КФП всеки месец.',
    },
  ];
  const timelineDates = timeline.filter((e) => !e.ongoing).map((e) => e.date || e.month + '-01');
  if (JSON.stringify(timelineDates) !== JSON.stringify([...timelineDates].sort()))
    throw new Error('Timeline is not chronological');
  const gazette = [
    {
      issue: 113,
      year: 2025,
      date: '2025-12-23',
      laws: [
        'Закон за събирането на приходи и извършването на разходи през 2026 г. (удължителен закон)',
      ],
      source: ['asbp'],
    },
    {
      issue: 30,
      year: 2026,
      date: '2026-03-27',
      laws: ['Изменение и допълнение на удължителния закон'],
      source: ['asbp'],
    },
    {
      issue: dd.issue,
      year: 2026,
      date: dd.date,
      laws: ['ЗБДОО', 'ЗБНЗОК'],
      source: ['zbdoo', 'zbnzok'],
    },
    { issue: zd.issue, year: 2026, date: zd.date, laws: ['ЗДБ'], source: ['zdb'] },
  ];
  if (evidence.archiveBytes != null && roundNumber(evidence.archiveBytes / 1e6, 0) !== 63)
    throw new Error('Archive size is no longer about 63 MB');
  const documents = [
    { kind: 'bill', title: `Законопроект № ${z.sign} (документ .docx)`, url: files + z.docx[0] },
    {
      kind: 'bill',
      title: `Законопроект като внесен (PDF, № ${z.pdf[0].slice(0, -4)} от 01.07.2026 г.)`,
      url: files + z.pdf[0],
    },
    {
      kind: 'archive',
      title: 'Архив с приложенията към законопроекта (ZIP, около 63 MB)',
      url: files + z.archive,
    },
    {
      kind: 'page',
      title: 'Законопроектът в Народното събрание: движение, доклади, становища',
      url: page(167157),
    },
    {
      kind: 'law',
      title:
        'Закон за държавния бюджет на Република България за 2026 г. (ДВ бр. 69 от 31.07.2026 г.)',
      url: (sources as Data).zdb.url,
    },
    {
      kind: 'law',
      title:
        'Закон за бюджета на държавното обществено осигуряване за 2026 г. (ДВ бр. 68 от 28.07.2026 г.)',
      url: (sources as Data).zbdoo.url,
    },
    {
      kind: 'law',
      title:
        'Закон за бюджета на Националната здравноосигурителна каса за 2026 г. (ДВ бр. 68 от 28.07.2026 г.)',
      url: (sources as Data).zbnzok.url,
    },
  ];
  const proposals = {
    count: z.proposals.length,
    byDate,
    urlPattern: files + '{file}',
    note: 'Връзки към документите на Народното събрание. Съдържанието и ефектът на предложенията още не са обработени (P07).',
    items: z.proposals.map((p: Data) => ({ no: p.no, date: p.date, file: p.file })),
  };
  const counts = {
    committeeReports: z.reports,
    opinions: z.opinions,
    proposals: z.proposals.length,
    reportDates: z.reportDates,
    opinionDates: z.opinionDates,
    proposalDates: byDate,
    committees: { total: z.committees.length, leading: leading[0], reported: z.reportAuthors },
    opinionsNote:
      'Становищата са постъпили в комисиите от организации и институции; докладите са на комисиите.',
  };
  const dba = rows.filter((r) => r.changed).length;
  if (dba !== 4) throw new Error(`Expected 4 differing budgets, got ${dba}`);
  return {
    meta: metadata(
      'D10+D11',
      'Как се прие бюджетът: законопроект срещу закон и законодателният път',
      buildDate,
      {
        source: ['bill', 'zdb', 'parliament', 'asbp'],
        sourceNote:
          'Законопроектът (внесен на 01.07.2026 г.) е сравнен ред по ред с приетия закон (ДВ бр. 69 от 31.07.2026 г.). Датите на докладите, четенията и предложенията са от Народното събрание; предисторията до внасянето е по мотивите на Министерството на финансите (стр. 5–7).',
        asOf: '2026-07-31',
        unit: 'хил. €',
        extra: { pending: ['P07'] },
      },
    ),
    note: `„Законопроект“ е текстът, внесен на 01.07.2026 г. (№ ${z.sign}); „закон“ е приетият на 24.07.2026 г. текст (ДВ бр. 69 от 31.07.2026 г.). От 46-те бюджета по чл. 2–47 различават се ${dba} (чл. 2, 3, 16 и 17); чл. 1 (държавният бюджет) се променя от тях. Програмните бюджети към законопроекта са друг документ: те са сравнени със закона във файловете на ведомствата.`,
    versions: {
      bill: { label: 'Законопроект', date: z.submitted, ref: z.sign, url: files + z.docx[0] },
      law: {
        label: 'Закон',
        date: z.adopted,
        ref: 'ДВ бр. 69 от 31.07.2026 г.',
        url: (sources as Data).zdb.url,
      },
    },
    art1,
    budgets: rows,
    totals,
    changes,
    reconciliation,
    bills,
    timeline,
    kinds,
    counts,
    gazette,
    documents,
    proposals,
    next: next2027(),
    pending: ['P07'],
  } as unknown as LawDataset;
}
function andList(items: string[]) {
  if (!items.length) throw new Error('Empty list');
  return items.length === 1 ? items[0] : items.slice(0, -1).join(', ') + ' и ' + items.at(-1);
}
