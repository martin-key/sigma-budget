// The check groups of a release (validation.json) as „Проверка на данните“ (S35) shows them: the group in plain Bulgarian, how many checks it
// ran and the result. The technical summary of each group stays in validation.json, which the screen lists with the other files.
const GROUPS = {
  INPUTS: 'Входните файлове и техните SHA-256',
  ENVELOPE: 'Общата структура на файловете с данни',
  NUMBERS: 'Числата и празните стойности',
  SIZES: 'Размерът на файловете',
  PRIVACY: 'Без лични данни',
  GLOSSARY: 'Речник',
  CORE: 'Основните числа',
  KFP: 'Месечните отчети по КФП',
  ANNEX3: 'Приложение 3: рамката на КФП',
  REVENUE: 'Приходи',
  EXPENDITURE: 'Разходи',
  MEASURES: 'Мерки',
  BUDGET2027: 'Бюджет 2027: проект на МФ',
  LAW: 'Законопроект и закон',
  BUDGETS: 'Бюджетите на ведомствата',
  PROGRAMS: 'Програмни бюджети',
  DEBT: 'Държавен дълг',
  MUNIC: 'Общини',
  SEBRA: 'СЕБРА: дневни плащания',
  COMPONENTS: 'Съставни бюджети и трансфери',
  RATES: 'Данъци и осигуровки: ставки',
  SEARCH: 'Индекс за търсене',
  FEED: 'Новото в данните (RSS)',
  CATALOG: 'Каталог на данните',
  INDIRECT: 'Косвени данъци',
  CONTRACT: 'Произходът на числата от месечните отчети',
  REGISTRY: 'Регистрите на източниците и наборите',
  PROTO: 'Примерни набори',
};
const RESULT = { OK: 'наред', PASS: 'наред', WARN: 'с предупреждения', FAIL: 'с грешки' };

/** one row per group: {label, checks, status}; an unknown group keeps its own name, an unknown result its own word */
export const checkRows = (groups) =>
  (groups || []).map((g) => {
    const n = /^(\d+) checks?\b/.exec(g.summary || '');
    return {
      label: GROUPS[g.group] || g.group,
      checks: n ? Number(n[1]) : null,
      status: RESULT[g.status] || g.status,
    };
  });
