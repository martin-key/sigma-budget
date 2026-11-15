export const P02_EXPECTED =
  'Месечен бюджетен бюлетин на МФ (PDF), https://www.minfin.bg/bg/statistics/12';
export const P02_TITLE = 'Месечни данни за ДОО, НЗОК и общините';
export const P02_REASON =
  'Месечни сборове за социалноосигурителните фондове и общините се публикуват в месечния бюджетен бюлетин на МФ (PDF). Месечна серия по съставни бюджети за ДОО, НЗОК и общините не е включена в това издание. Порталът представя държавния бюджет месечно, а подсекторите — тримесечно. За централното правителство през 2025 г. връзката на МФ предоставя таблицата за 2024 г.; данни за 2025 г. не са включени.';
import type { GraphStage } from '../build/graph.js';

/**
 * Launch wording of production releases.
 *
 * The builders keep the migrated historical wording, which the frozen migration oracles prove against the Python
 * reference. Production revises that wording here, per stage and before anything is derived from it (search index,
 * RSS, catalog sizes), so the published texts are final without rewriting the migration evidence.
 */
export type LaunchRevision = readonly [from: string | RegExp, to: string];

const P04 =
  /Отчетът за (\S+) (\d{4}) г\. още не е добавен: страницата на МФ с месечните отчети се отваря само през браузър \(отказ 403 към автоматични заявки\), а последният наличен файл е за (\S+) (\d{4}) г\./g;
const P04_TEXT =
  'Последният месечен отчет в портала е за $3 $4 г. Отчетът за $1 $2 г. не е включен.';
const LAW_NEXT =
  /Проектът за държавния бюджет за 2027 г\. и АСБП 2027–2029, публикувани от МФ на (\S+), вече са на екрана „Бюджет 2027 \(проект\)“\. Хронологията на обсъждането и решенията на Народното събрание за 2027 г\. още не е извлечена\. Проектът не е приет закон\./g;
const LAW_NEXT_TEXT =
  'Проектът за държавния бюджет за 2027 г. и АСБП 2027–2029, публикувани от МФ на $1, са на екрана „Бюджет 2027 (проект)“. Хронологията на обсъждането и решенията на Народното събрание за 2027 г. не е включена в портала. Проектът не е приет закон.';
// Both the production and the frozen glossary snapshots already have 69 terms, so the source glue keeps them as revised here.
const GLOSSARY: readonly LaunchRevision[] = [
  [
    'Речник с 64 термина на работна група „Бюджет на светло“:',
    'Речник на СИГМА Бюджет с 64 термина:',
  ],
  ['още не е окончателно прието', 'не е окончателно прието'],
  [
    'Строителството и плащанията тепърва предстоят.',
    'Одобрената сума е разрешение за разход, а не извършено плащане.',
  ],
  ['Той още не е приет.', 'Той не е приет.'],
  ['Още 5 термина (от 65 до 69)', 'Допълнителни 5 термина (от 65 до 69)'],
];

/** Revisions by graph stage, applied in order to every string of that stage's output. */
export const LAUNCH_REVISIONS: Readonly<Record<string, readonly LaunchRevision[]>> = {
  editorial: [
    ...GLOSSARY,
    [
      'Текстът на пътеводителя на работна група „Бюджет на светло“ е дословно от оригинала:',
      'Пътеводител на СИГМА Бюджет:',
    ],
    ['В тази версия имената на екраните', 'Имената на екраните'],
    [/^Работна група „Бюджет на светло“$/, 'СИГМА Бюджет'],
  ],
  revenue: [
    [
      'Изпълнението по видове данъци (ДДС, ДДФЛ, корпоративен данък, акцизи) предстои: месечният отчет в .xls дава само общата сума на данъчните приходи.',
      'Месечната разбивка по видове данъци е за държавния бюджет. Данните за КФП по подсектори са тримесечни.',
    ],
  ],
  budgets: [
    ['Програмите предстои да бъдат добавени', 'Програми без данни в портала'],
    [
      'Таблиците на документа са в нестандартен формат (липсват кодове на програмите или кодовете и числата са пренесени на нов ред) и още не са разчетени.',
      'Програмите на ведомството не са включени в портала. Налични са общите суми по бюджета му.',
    ],
  ],
  debt: [
    [' Съпоставката между редовете предстои да бъде проверена от експерт по публични финанси.', ''],
    [
      'Падежите и емисиите на държавните ценни книжа предстоят: регистърът на Министерството на финансите не се изтегля автоматично.',
      'Падежите и емисиите на държавните ценни книжа не са включени в портала.',
    ],
  ],
  rates: [
    [
      'данъчната основа не е в източниците на проекта, затова данъкът е отбелязан като предстоящ.',
      'данъкът не е включен в калкулатора.',
    ],
    ['и размерът му още не е определен.', 'и размерът му не е определен.'],
    [
      'Сценарият „Пенсионер“ и данъкът при самоосигуряване и договор за управление предстоят.',
      'Сценарият „Пенсионер“ и данъкът при самоосигуряване и договор за управление не са включени в калкулатора.',
    ],
  ],
  law: [
    [LAW_NEXT, LAW_NEXT_TEXT],
    [
      'Съдържанието и ефектът на предложенията още не са обработени (P07).',
      'Съдържанието и фискалният ефект на предложенията не са представени в портала (P07).',
    ],
  ],
  components: [
    ['Отделни таблици към месечната информация за КФП, minfin.bg', P02_EXPECTED],
    ['Месечно изпълнение по съставни бюджети (държавен бюджет, ДОО, НЗОК, общини)', P02_TITLE],
    [
      'Месечните отчети, които са извлечени, дават консолидираната програма, националния бюджет и европейските средства. Разбивката на националния бюджет по съставни бюджети е в отделни таблици на МФ, които още не са извлечени.',
      P02_REASON,
    ],
  ],
  // The feed copies the already revised law note.
  feed: [
    [P04, P04_TEXT],
    ['Прототип с примерни данни, където е отбелязано.', 'Данни от официални източници.'],
  ],
  core: [
    [P04, P04_TEXT],
    [
      'Ядро: източници, предстоящи набори и основни числа',
      'Ядро: източници, показатели без данни и основни числа',
    ],
  ],
  search: [['Предстои · ', 'Без данни · ']],
  // The catalog lists the pending sets from the loader input, not from the revised core.
  catalog: [[P04, P04_TEXT]],
};

function reviseText(text: string, revisions: readonly LaunchRevision[], used: Set<number>): string {
  revisions.forEach(([from, to], index) => {
    const next = typeof from === 'string' ? text.split(from).join(to) : text.replace(from, to);
    if (next !== text) used.add(index);
    text = next;
  });
  return text;
}

/** Copies plain objects, arrays and maps with revised strings; bytes and other values are kept as they are. */
function reviseValue(
  value: unknown,
  revisions: readonly LaunchRevision[],
  used: Set<number>,
): unknown {
  if (typeof value === 'string') return reviseText(value, revisions, used);
  if (Array.isArray(value)) return value.map((item) => reviseValue(item, revisions, used));
  if (value instanceof Map)
    return new Map([...value].map(([key, item]) => [key, reviseValue(item, revisions, used)]));
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, reviseValue(item, revisions, used)]),
    );
  return value;
}

/**
 * Wraps the stages named in `revisions`. `used` collects `stage#index` for every revision that changed a string,
 * so tests can prove that no revision is stale.
 */
export function reviseLaunchTexts(
  stages: readonly GraphStage[],
  revisions: Readonly<Record<string, readonly LaunchRevision[]>> = LAUNCH_REVISIONS,
  used = new Set<string>(),
): GraphStage[] {
  const ids = new Set(stages.map((stage) => stage.id));
  for (const id of Object.keys(revisions))
    if (!ids.has(id)) throw new Error(`Launch texts name an unknown stage: ${id}`);
  return stages.map((stage) => {
    const own = revisions[stage.id];
    if (!own) return stage;
    return {
      ...stage,
      run: (read) => {
        const hits = new Set<number>();
        const result = reviseValue(stage.run(read), own, hits);
        for (const index of hits) used.add(`${stage.id}#${index}`);
        return result;
      },
    };
  });
}

/** The complete production programme inventory replaces the catalog's zero-pending sentence. */
export function reviseProgrammeCatalog(value: unknown): unknown {
  const used = new Set<number>();
  const result = reviseValue(
    value,
    [
      [
        /За 0 от (\d+) бюджета програмите не са включени \(P03\)\./gu,
        'Програмите за 2026 г. са включени за всички $1 ведомства. Историческите години са представени според разчетените таблици.',
      ],
      [
        /Индекс на \d+ програми от програмните бюджети:/gu,
        'Индекс на политиките и програмите от програмните бюджети:',
      ],
    ],
    used,
  );
  if (used.size !== 2) throw new Error('Stale complete-programme catalog wording');
  return result;
}
/** Final source description before the core and derived stages consume it. */
export function reviseProgrammeSources(value: unknown): unknown {
  const used = new Set<number>();
  const result = reviseValue(
    value,
    [
      [
        'Общите суми съответстват на закона.',
        'Таблиците са към законопроекта. Съпоставката с приетия закон и отклоненията в документите са показани във ведомствените файлове.',
      ],
    ],
    used,
  );
  if (used.size !== 1) throw new Error('Stale programme source wording');
  return result;
}
