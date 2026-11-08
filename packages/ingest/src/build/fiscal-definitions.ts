// Domain definitions mirrored from the Python fiscal builders.
export const I2_GROUPS = [
  ['gdp', 'Брутен вътрешен продукт'],
  ['labour', 'Пазар на труда и цени'],
  ['external', 'Платежен баланс'],
  ['money', 'Паричен сектор'],
] as const;
export const I2_ROWS = [
  ['gdp', 'БВП (млн. евро)', 'gdp', 0, 'БВП', 'млн. €'],
  ['gdpGrowth', 'БВП (реален растеж, %)', 'gdp', 0, 'Реален растеж на БВП', '%'],
  ['consumption', 'Потребление', 'gdp', 1, 'Потребление', '%'],
  [
    'gfcf',
    'Брутообразуване на основен капитал',
    'gdp',
    1,
    'Инвестиции (брутообразуване на основен капитал)',
    '%',
  ],
  ['exports', 'Износ на стоки и услуги', 'gdp', 1, 'Износ на стоки и услуги', '%'],
  ['imports', 'Внос на стоки и услуги', 'gdp', 1, 'Внос на стоки и услуги', '%'],
  ['employment', 'Заетост (СНС) (%)', 'labour', 0, 'Заетост', '%'],
  ['unemployment', 'Коефициент на безработица (НРС) (%)', 'labour', 0, 'Безработица', '%'],
  ['compensation', 'Компенсации на един нает (%)', 'labour', 0, 'Компенсации на един нает', '%'],
  ['deflator', 'Дефлатор на БВП (%)', 'labour', 0, 'Дефлатор на БВП', '%'],
  ['hicp', 'Средногодишна инфлация (ХИПЦ) (%)', 'labour', 0, 'Инфлация (ХИПЦ), средногодишна', '%'],
  ['currentAccount', 'Текуща сметка (% от БВП)', 'external', 0, 'Текуща сметка', '% от БВП'],
  ['tradeBalance', 'Търговски баланс (% от БВП)', 'external', 0, 'Търговски баланс', '% от БВП'],
  [
    'fdi',
    'Преки чуждестранни инвестиции (% от БВП)',
    'external',
    0,
    'Преки чуждестранни инвестиции',
    '% от БВП',
  ],
  ['loansFirms', 'Вземания от фирми (%)', 'money', 0, 'Вземания от фирми', '%'],
  ['loansHouseholds', 'Вземания от домакинства (%)', 'money', 0, 'Вземания от домакинства', '%'],
] as const;
export const FUNCTION_SHORT = {
  'obshti-sluzhbi': 'Общи държавни служби',
  'otbrana-sigurnost': 'Отбрана и сигурност',
  obrazovanie: 'Образование',
  zdraveopazvane: 'Здравеопазване',
  sotsialni: 'Социално осигуряване и грижи',
  'zhilishtno-sreda': 'Комунално стопанство и околна среда',
  'kultura-sport': 'Култура и спорт',
  ikonomika: 'Икономически дейности',
  drugi: 'Некласифицирани разходи',
} as const;
export const COFOG_NAMES = {
  GF01: 'Общи държавни служби',
  GF0107: 'Операции с публичния дълг',
  GF02: 'Отбрана',
  GF03: 'Обществен ред и сигурност',
  GF04: 'Икономически дейности',
  GF05: 'Опазване на околната среда',
  GF06: 'Жилищно строителство и комунални дейности',
  GF07: 'Здравеопазване',
  GF08: 'Отдих, култура и религия',
  GF09: 'Образование',
  GF10: 'Социална защита',
} as const;
export const COFOG_TO_FUNCTION = {
  GF01: ['obshti-sluzhbi', 'drugi'],
  GF02: ['otbrana-sigurnost'],
  GF03: ['otbrana-sigurnost'],
  GF04: ['ikonomika'],
  GF05: ['zhilishtno-sreda'],
  GF06: ['zhilishtno-sreda'],
  GF07: ['zdraveopazvane'],
  GF08: ['kultura-sport'],
  GF09: ['obrazovanie'],
  GF10: ['sotsialni'],
} as const;
export const FUNCTION_DEFS = [
  [
    'obshti-sluzhbi',
    'Общи държавни служби',
    'byudzhetna-funktsiya',
    ['0100', '0200', '0300', '1000', '1100'],
  ],
  [
    'otbrana-sigurnost',
    'Отбрана и сигурност',
    'byudzhetna-funktsiya',
    ['1200', '1300', '0600', '3000', '3900'],
  ],
  ['obrazovanie', 'Образование', 'byudzhetna-funktsiya', ['1700']],
  ['zdraveopazvane', 'Здравеопазване', 'byudzhetna-funktsiya', ['1600']],
  ['sotsialni', 'Социално осигуряване, подпомагане и грижи', 'byudzhetna-funktsiya', ['1500']],
  ['zhilishtno-sreda', 'Жилищно строителство', 'byudzhetna-funktsiya', ['2100', '1900']],
  ['kultura-sport', 'Култура, спорт', 'byudzhetna-funktsiya', ['1800', '2500']],
  [
    'ikonomika',
    'Икономически дейности и услуги',
    'byudzhetna-funktsiya',
    ['2000', '2200', '2300', '2400', '7100', '7400'],
  ],
  ['drugi', 'Р-ди некласифицирани', 'byudzhetna-funktsiya', []],
] as const;
export const FUNCTION_NAMES = { drugi: 'Разходи, некласифицирани в другите функции' } as const;
export const FUNCTIONS_MINISTRIES_NOTE =
  'Основни ведомства по функцията: ориентир за навигация, не счетоводно разпределение. Бюджетите на ведомствата и функциите са два различни разреза на едни и същи пари.' as const;
export const REVENUE_GROUP_DEFS = [
  ['dds', 'ДДС', ['r.vat'], 'dds'],
  ['osiguritelni', 'Социални и здравни осигуровки', ['r.social'], 'osiguritelni-vnoski'],
  ['nedanachni', 'Неданъчни приходи', ['r.nontax'], 'nedanachni-prihodi'],
  [
    'pomoshti',
    'Помощи и дарения (основно европейски средства)',
    ['r.grants'],
    'bezvazmezdno-finansirane',
  ],
  ['ddfl', 'Данък върху доходите на физическите лица', ['r.pit'], 'danak-varhu-dohodite'],
  ['akcizi', 'Акцизи', ['r.excise'], 'aktsiz'],
  ['korporativen', 'Корпоративен данък', ['r.corp'], 'korporativen-danak'],
  ['drugi', 'Други данъци и мита', ['r.insprem', 'r.customs', 'r.othertax'], 'danak'],
] as const;
