// How to read each data file, for `describe_dataset` (apps/web/workers/mcp/tools.ts). The catalog lists only the top-level keys of a file;
// this says what the keys mean, which one is the key to look a row up by, in what unit the numbers are, and gives paths for `get_data`
// that exist in the file (apps/web/workers/mcp/formats.test.ts reads every example path in the published files of data/release/).
// The formats themselves are in docs/data-spec.md.

export interface Format {
  /** how the file is read, in a few sentences */
  read: string[];
  /** paths for get_data; `part` for the sets with one file per institution */
  examples: { path: string; what: string; part?: string }[];
}

const CELL =
  'Клетка от законопроекта е `{value, unit, provenance}`: `provenance` е номерът на записа за `explain_number` като `budget2027/<номер>`.';
const PERIODS =
  '`byPeriod` е ключът за година и статус: `2026.law` (законът за 2026 г.), `2026.expected` (очакваното изпълнение), `2027.draft` (законопроектът), `2028.forecast` и `2029.forecast` (прогнози).';

export const FORMATS: Record<string, Format> = {
  outlook: {
    read: [
      'Рамката на КФП и макропрогнозата по години.',
      PERIODS,
      '`series` на всеки период дава приходите, разходите, салдото, лихвите, финансирането, първичното салдо и БВП.',
      CELL,
    ],
    examples: [
      {
        path: '/byPeriod/2027.draft/series',
        what: 'основните показатели по законопроекта за 2027 г.',
      },
      { path: '/byPeriod/2026.law/series/balance', what: 'салдото на КФП по закона за 2026 г.' },
      { path: '/years', what: 'годините на по-старите масиви по години' },
    ],
  },
  revenue: {
    read: [
      'Приходите на КФП по видове.',
      '`rows` са редовете на Приложение 3 (`id`, `label`, `mln` в млн. € и `pctGdp` в % от БВП), подредени по `years`.',
      '`groups` са осемте групи приходи (ДДС, акцизи, данъци върху доходите…).',
      PERIODS,
      CELL,
    ],
    examples: [
      { path: '/groups', what: 'групите приходи по години' },
      { path: '/byPeriod/2027.draft/groups', what: 'групите приходи по законопроекта за 2027 г.' },
      { path: '/rows/0', what: 'общият ред на приходите' },
    ],
  },
  expenditure: {
    read: [
      'Разходите на КФП по функции, по икономически вид и по COFOG.',
      '`functions.items` са функциите (образование, здравеопазване…), а стойностите са по `functions.years`.',
      PERIODS,
      CELL,
    ],
    examples: [
      { path: '/functions/items', what: 'разходите по функции' },
      { path: '/byPeriod/2027.draft/functions', what: 'функциите по законопроекта за 2027 г.' },
      { path: '/economic', what: 'разходите по икономически вид' },
    ],
  },
  execution: {
    read: [
      'Месечното изпълнение на КФП: натрупано от началото на годината, в млн. €, като десетични низове („33898.456“).',
      'Пътят `/data/<година>/<kfp|nat|eu>/<ред>` дава масив по месеци: индекс 0 е януари. `kfp` е цялата КФП, `nat` е националният бюджет, `eu` са средствата от ЕС.',
      'Редовете са в `/rows` (`id`, `label`). `monthly` е стойността само за месеца, `latest` е последният месец с процента от плана и ръста спрямо година по-рано, а `plan2026` е годишният план.',
      '`pendingMonths` са месеците, които още не са публикувани: за тях няма числа, а не нули.',
      'Произходът на стойност е `explain_number` с `data/<ГГГГ-ММ>/<kfp|nat|eu>/<ред>`, например `data/2026-09/kfp/rev`.',
    ],
    examples: [
      { path: '/rows', what: 'редовете на отчета' },
      { path: '/data/2026/kfp/rev', what: 'приходите на КФП по месеци на 2026 г., натрупано' },
      { path: '/latest/kfp/rev', what: 'приходите към последния месец, планът и изпълнението в %' },
      { path: '/pendingMonths', what: 'месеците, които предстоят' },
    ],
  },
  ministries: {
    read: [
      'Бюджетите на 46-те първостепенни разпоредители по закона, в хил. €.',
      '`items[]`: `id` е четирицифреният код на ведомството (`0100` е Народното събрание), `art` е членът в закона, `revKhil`, `expKhil` и `transfersKhil` са приходите, разходите и трансферите, `policies` са политиките.',
      'Програмният бюджет на едно ведомство е в набора `ministries-programs`, с `part` = кода.',
    ],
    examples: [
      { path: '/items/0', what: 'първото ведомство' },
      { path: '/totals', what: 'сборовете' },
    ],
  },
  'ministries-programs': {
    read: [
      'Един файл на ведомство: `get_data` с `part` = кода на ведомството (`0100`, `1000`…), в хил. €.',
      '`cols` са деветте колони на таблицата в програмния бюджет. `total` и `policies[].values` са по години, а всяка година е масив в реда на `cols`.',
      '`policies[].programs` са програмите. `null` е празна клетка в документа, не нула.',
    ],
    examples: [
      { part: '0100', path: '/cols', what: 'колоните' },
      { part: '0100', path: '/policies/0', what: 'първата политика с програмите ѝ' },
      { part: '0100', path: '/total', what: 'общият сбор по години' },
    ],
  },
  programs: {
    read: [
      'Програмите на всички ведомства като таблица: `fields` са колоните, а `items` са редове-масиви в същия ред.',
      'Sentinels: `-1` означава „няма данни“, `-101` означава, че ръстът не може да се изчисли.',
    ],
    examples: [
      { path: '/fields', what: 'колоните' },
      { path: '/items/0', what: 'първият ред' },
      { path: '/sentinels', what: 'стойностите за „няма данни“' },
    ],
  },
  municipalities: {
    read: [
      'Трансферите от държавния бюджет за 265-те общини по закона.',
      '`items[]`: `id` (например `BGS01`), `name`, `region`, `population` и `transfers` по видове. `perCapita` е на човек.',
      '`regions` са областите. Единицата е в `meta.unit`.',
    ],
    examples: [
      { path: '/items/0', what: 'първата община' },
      { path: '/totals', what: 'сборовете' },
      { path: '/columns', what: 'видовете трансфери' },
    ],
  },
  law: {
    read: [
      'Законът за държавния бюджет.',
      '`art1.lines` е чл. 1 (приходи, разходи, салдо): `bill` е законопроектът, `law` е приетият закон, `diff` е разликата.',
      '`budgets[]` са бюджетите на ведомствата по чл. 2 и следващите (`id` е кодът). `timeline`, `proposals` и `bills` са пътят на закона.',
    ],
    examples: [
      { path: '/art1/lines', what: 'чл. 1 на закона' },
      { path: '/budgets/0', what: 'първият бюджет на ведомство' },
      { path: '/timeline', what: 'пътят на закона' },
    ],
  },
  measures: {
    read: [
      'Мерките в бюджета: `items[]` с `id`, `name`, `text`, вид и оценка на ефекта. `groups` ги групират.',
    ],
    examples: [
      { path: '/items/0', what: 'първата мярка' },
      { path: '/totals', what: 'сборовете' },
    ],
  },
  debt: {
    read: [
      'Държавният дълг: `zdd` (по Закона за държавния дълг), `maastricht` (по критериите от Маастрихт), `quarterly`, `structure`, `limits` и `newDebt`.',
      '`latest` е последната стойност на всеки обхват. `scopes` и `defaultScope` казват кой обхват какво включва.',
    ],
    examples: [
      { path: '/latest', what: 'последните стойности' },
      { path: '/limits', what: 'лимитите' },
    ],
  },
  rates: {
    read: [
      'Ставките на данъците и осигуровките.',
      '`scenarios[]` са видовете доход (трудов договор и др.) със ставките и източника. `incomeTax`, `tzpb` и `minInsurableIncome` са таблиците.',
    ],
    examples: [
      { path: '/scenarios/0', what: 'трудов договор' },
      { path: '/incomeTax', what: 'данъкът върху доходите' },
    ],
  },
  budget2027: {
    read: [
      'Законопроектът за 2027 г. по членове.',
      '`/budgets/bill/<член>`: `1` е държавният бюджет, а членът на ведомство е `art` в `ministries.json` (кодът не е ключ тук). Всеки ред има `cell`.',
      '`municipal.art52` и `art53` са общините (по име и област), `projects` са капиталовите проекти, `forecast` са прогнозите.',
      CELL,
    ],
    examples: [
      { path: '/budgets/bill/1/name', what: 'името на член 1' },
      { path: '/budgets/bill/1/rows/0', what: 'приходите на държавния бюджет' },
      { path: '/projects/0', what: 'първият проект' },
    ],
  },
  'state-budget': {
    read: [
      'Месечните отчети на държавния бюджет.',
      '`tables[]` по `year` и `period` (месец): всеки ред е `{row, label, eur}`, а `eur` е масив по `columns` в единицата от `unit`. `source` е стойността в оригинала (`sourceIntegerScale`).',
      '`null` е празна клетка в отчета.',
    ],
    examples: [
      { path: '/tables/0/columns', what: 'колоните на първия отчет' },
      { path: '/tables/0/rows/0', what: 'първият ред' },
      { path: '/limitations', what: 'ограниченията' },
    ],
  },
  'kfp-subsectors': {
    read: [
      'Тримесечните отчети на КФП по подсектори.',
      '`tables[]` по `scope` (`central`, `consolidated`, `local`, `social`), `year` и `period` (тримесечие), със същите редове като `state-budget`.',
      '`missing` са липсващите отчети.',
    ],
    examples: [
      { path: '/tables/0/scope', what: 'обхватът на първия отчет' },
      { path: '/missing', what: 'липсващите отчети' },
    ],
  },
  components: {
    read: [
      'Съставните бюджети на КФП: `budgets` (държавен, ДОО, НЗОК, общини, сметки за средства от ЕС, други), `transfers` между тях и `nationalVsEu`.',
    ],
    examples: [
      { path: '/budgets/state', what: 'държавният бюджет' },
      { path: '/transfers', what: 'трансферите' },
    ],
  },
  'debt-issues': {
    read: [
      'Емисиите на държавни ценни книжа: `domestic[]` и `external[]` по ISIN, и `auctions[]`.',
    ],
    examples: [{ path: '/domestic/0', what: 'първата вътрешна емисия' }],
  },
  'gva-sectors': {
    read: ['Добавената стойност по отрасли и БВП: `branches`, `gva` и `gdp` по `years`.'],
    examples: [
      { path: '/years', what: 'годините' },
      { path: '/branches', what: 'отраслите' },
    ],
  },
  'indirect-tax-parameters': {
    read: ['Ставките на ДДС и акцизите за горива и цигари: `vat`, `fuels`, `cigarettes`.'],
    examples: [{ path: '/vat', what: 'ДДС' }],
  },
  glossary: {
    read: [
      'Речникът: `terms[]` със `slug`, `title`, `def` и `example`. По-удобно е `fetch` с `term:<slug>`.',
    ],
    examples: [{ path: '/terms/0', what: 'първият термин' }],
  },
  'budget2027-provenance': {
    read: [
      'Произходът на всяка клетка на законопроекта: документ, страница, таблица, отпечатано число.',
      'Не го чети цял: `explain_number` с `budget2027/<номер>` дава записа.',
    ],
    examples: [{ path: '/documents', what: 'документите' }],
  },
  'execution-provenance': {
    read: [
      'Откъде е всяка стойност на месечното изпълнение: лист, колона и ред в отчета на МФ.',
      '`explain_number` с `data/<ГГГГ-ММ>/<kfp|nat|eu>/<ред>` дава клетката и оригинала.',
    ],
    examples: [
      { path: '/columns', what: 'колоните на отчета' },
      { path: '/rows', what: 'редовете на отчета' },
    ],
  },
};

/** the generic note for a set without its own: the catalog's keys are enough */
export const GENERIC: Format = {
  read: [
    'Ключовете на най-горно ниво са в `schema`. Започни с `get_data` без `path`, за да видиш структурата, и после поискай по-тесен път.',
  ],
  examples: [],
};
