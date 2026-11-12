// The existing block, table, chart and sharing components, fed only by the November publication.
import { html } from '../html.js';
import { num, money } from '../format.js';
import { block } from '../ui/block.js';
import { dataTable, updateRows, tableData } from '../ui/table.js';
import { chart } from '../ui/chart.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { pendingState, errorState } from '../ui/states.js';
import { field, textInput, selectInput } from '../ui/forms.js';
import { disclosure } from '../ui/disclosure.js';
import {
  institutions,
  cellValue,
  strictSum,
  headline,
  municipalRows,
  stateDebt,
  provenanceUrl,
  FRAMEWORK,
  MUNICIPAL_COLUMNS,
  DELEGATED_COLUMNS,
} from '../budget-2027.js';
import { periodByKey, DEFAULT_PERIOD } from '../periods.js';
import { dataHref } from '../data.js';
import { norm, lat } from '../searchlib.js';

const labels = { bill: 'Основен проект', billMc: 'Вариант на Министерския съвет' };
const variantOf = (ctx) => (ctx.query.variant === 'billMc' ? 'billMc' : 'bill');
const source = ['budget2027'];
const gap = (title, text) => pendingState({ title, text, source });
const publication = (doc) =>
  html`<p>
      МФ, 06.11.2026. Проектът за 2027 г. не е приет закон. Прогнозите са за 2028–2029 г. Сумите и
      празните клетки следват съответната таблица.
    </p>
    <p>
      <a href="${dataHref('budget2027-provenance')}"
        >Произход на клетките, PDF страници и SHA-256 на оригиналния ZIP архив и двата PDF
        документа</a
      >.
    </p>`;
const namedScope = (key, label, long = label, note) => ({ key, label, long, note, gl: null });
function scopeFor(ctx, id) {
  if (ctx.route.id === 'S17')
    return id === 's17-limits-2027'
      ? namedScope(
          'budget-and-debt-limits',
          'Държавен бюджет и дълг',
          'Предложени граници за фискалния резерв и държавния дълг по законопроекта',
        )
      : 'zdd';
  if (['S20', 'S21'].includes(ctx.route.id))
    return namedScope(
      'municipal-transfers',
      'Трансфери към общините',
      'Трансфери от държавния бюджет към общинските бюджети',
    );
  if (ctx.route.id === 'S12')
    return namedScope(
      'fiscal-measures',
      'Фискални мерки',
      `${id === 's12-II_7' ? 'Приходни' : 'Разходни'} мерки по АСБП 2027–2029`,
    );
  if (id === 's34-projects')
    return namedScope(
      'investment-projects',
      'Инвестиционни проекти',
      'Инвестиционни проекти по законопроекта за държавния бюджет',
    );
  if (ctx.route.id === 'S34' || ctx.params?.code === 'art1')
    return namedScope(
      'state-budget',
      'Държавен бюджет',
      'Държавен бюджет по законопроекта за ЗДБРБ',
    );
  return namedScope(
    'institution-budgets',
    'Бюджети на ведомствата',
    'Бюджети на ведомствата по законопроекта за ЗДБРБ, не е целият бюджет',
    'не е целият бюджет',
  );
}
const base = (ctx, id, title, body, extra = {}) =>
  block({
    id,
    title,
    body,
    scope: scopeFor(ctx, id),
    source,
    asOf: ctx.data.budget2027?.publication,
    status: ctx.period.status === 'forecast' ? 'forecast' : 'real',
    statusLabel: ctx.period.label,
    share: { period: ctx.period.key, unit: 'хил. €' },
    ...extra,
  });
// Cell provenance (hash and link) is for verification: it stays in the CSV export, not on screen.
const originCol = {
  key: 'provenance',
  label: 'Произход',
  csvOnly: true,
  fmt: (v, r) => (v ? html`<a href="${r.origin}">${v}</a>` : 'Няма публикувана клетка'),
};
const cellRow = (label, cell, extra = {}) => ({
  label,
  value: cellValue(cell),
  provenance: cell?.provenance || '',
  origin: provenanceUrl(cell),
  ...extra,
});
const frameworkRow = (key) => ({
  period: periodByKey(key).label,
  _status: periodByKey(key).status === 'forecast' ? 'forecast' : 'real',
});
const frameworkStatus = { status: 'real', statusLabel: 'Законопроект 2027 и прогноза 2028–2029' };
export const cellColumns = (unit = 'хил. €') => [
  { key: 'label', label: 'Показател' },
  { key: 'value', label: 'Стойност', unit, num: true, d: 1 },
  originCol,
  { key: 'origin', label: 'Връзка към произхода', csvOnly: true },
];
const rowsTable = (id, rows, unit) =>
  dataTable({
    id,
    caption: 'Публикувани стойности',
    columns: [
      ...cellColumns(unit),
      ...(rows.some((r) => r.variant) ? [{ key: 'variant', label: 'Вариант' }] : []),
    ],
    rows,
  });
const billRows = (rows, variant) =>
  (rows || []).map((r) =>
    cellRow(`${r.no || ''} ${r.label}`, r.cell, { variant: labels[variant] }),
  );
const unavailable = (ctx) =>
  ctx.failed?.includes('budget2027')
    ? {
        body: errorState({
          title: 'Данните за проекта не се заредиха',
          text: 'Опитай отново.',
          retry: true,
        }),
      }
    : !ctx.data.budget2027
      ? {
          body: gap(
            'Това издание няма данните за проекта за 2027',
            'Избери издание с публикацията на МФ от 06.11.2026. Исторически числа не заместват липсващите данни.',
          ),
        }
      : null;
const keep = (ctx, over = {}) => ({ ...ctx.query, per: ctx.period.key, ...over });
const municipalScreen = (ctx) => ['S20', 'S21'].includes(ctx.route.id);
const listQuery = (ctx, over = {}) => {
  const keys = municipalScreen(ctx)
    ? ['q', 'oblast', 'sort', 'dir']
    : ['q', 'variant', 'sort', 'dir'];
  return {
    ...Object.fromEntries(keys.filter((k) => ctx.query[k]).map((k) => [k, ctx.query[k]])),
    per: ctx.period.key === DEFAULT_PERIOD ? null : ctx.period.key,
    ...over,
  };
};
export const billListHref = (ctx) =>
  ctx.href(municipalScreen(ctx) ? 'S20' : 'S10', {}, listQuery(ctx));
const listCrumbs = (ctx, title) => [
  { label: municipalScreen(ctx) ? 'Моята община' : 'Кой харчи?', href: billListHref(ctx) },
  { label: title },
];
const cleanSearch = (q) =>
  String(q || '')
    .slice(0, 80)
    .trim();
const matches = (text, query) => {
  const name = norm(text),
    latin = lat(name);
  return norm(cleanSearch(query))
    .split(' ')
    .filter(Boolean)
    .every((word) => (/[a-z]/i.test(word) ? latin : name).includes(word));
};
function institutionRows(ctx, items = institutions(ctx.data.budget2027, variantOf(ctx))) {
  return items
    .filter((i) => matches(`${i.name} ${i.code}`, ctx.query.q))
    .map((i) => ({
      name: i.name,
      variant: labels[variantOf(ctx)],
      code: i.code,
      article: i.article,
      revenue: cellValue(i.revenue),
      expenditure: cellValue(i.expenditure),
      provenance: i.expenditure?.provenance || '',
      origin: provenanceUrl(i.expenditure),
      _href: (s) =>
        ctx.href(
          'S11',
          { code: i.code },
          listQuery(ctx, { sort: s.sortBy, dir: s.sortBy ? s.dir : null }),
        ),
    }));
}
function municipalRegion(ctx, all) {
  const requested = ctx.query.oblast || '';
  const found = all.find((m) => m.region === requested || m.regionId === requested);
  return found ? found.regionId || found.region : '';
}
function municipalityRows(ctx, all = municipalRows(ctx.data.budget2027, ctx.data.municipalities)) {
  const region = municipalRegion(ctx, all);
  return all
    .filter(
      (m) =>
        matches(`${m.displayName} ${m.name}`, ctx.query.q) &&
        (!region || m.region === region || m.regionId === region),
    )
    .map((m) => ({
      name: m.displayName,
      region: m.region,
      ...Object.fromEntries(m.cells.map((c, i) => ['v' + i, cellValue(c)])),
      provenance: m.cells[0]?.provenance,
      origin: provenanceUrl(m.cells[0]),
      _href: m.id
        ? (s) =>
            ctx.href(
              'S21',
              { code: m.id },
              listQuery(ctx, {
                oblast: region || null,
                sort: s.sortBy,
                dir: s.sortBy ? s.dir : null,
              }),
            )
        : undefined,
    }));
}
const resultCount = (ctx, n) =>
  municipalScreen(ctx) ? `Намерени общини: ${num(n)}.` : `Намерени ведомства: ${num(n)}.`;
const searchHint = 'Списъкът се филтрира, докато пишеш. Може и с латински букви.';
// One search box (ids `${prefix}-q` / `${prefix}-count`, button `data-${prefix}-clear`); wired by wireSearch.
const searchBox = (ctx, prefix, label, count) => html`${field({
  id: `${prefix}-q`,
  label,
  hint: searchHint,
  control: textInput({
    id: `${prefix}-q`,
    name: 'q',
    type: 'search',
    value: ctx.query.q || '',
    hint: searchHint,
    autocomplete: 'off',
  }),
})}<p class="small" id="${prefix}-count" role="status">${count}</p>
<p><button type="button" class="btn btn-sm" data-${prefix}-clear${cleanSearch(ctx.query.q) ? '' : html` disabled`}>Изчисти търсенето</button></p>`;
const searchField = (ctx, rows, label) =>
  searchBox(ctx, 'bill', label, resultCount(ctx, rows.length));
const variantControl = (ctx) =>
  field({
    id: 'bill-variant',
    label: 'Вариант на законопроекта',
    control: selectInput({
      id: 'bill-variant',
      name: 'variant',
      query: 'variant',
      value: variantOf(ctx),
      options: [
        { value: 'bill', label: 'Основен проект' },
        { value: 'billMc', label: 'Вариант на МС' },
      ],
    }),
  });

export function institutionView(ctx) {
  if (unavailable(ctx)) return unavailable(ctx);
  const doc = ctx.data.budget2027,
    variant = variantOf(ctx),
    items = institutions(doc, variant);
  if (ctx.period.key !== '2027.draft')
    return {
      body: gap(
        'Няма индивидуални бюджети за този период',
        'Публикуваните бюджети по членове са проект за 2027 г. Няма индивидуална разбивка за 2028–2029 г.',
      ),
    };
  const specific = ctx.route.id === 'S11';
  const all = institutions(doc);
  const selected = specific
    ? all.find((i) => i.code === ctx.params.code) ||
      (ctx.params.code === 'art1' ? { code: 'art1', article: 1, name: 'Държавен бюджет' } : null)
    : null;
  if (specific && !selected) ctx.notFound();
  const b = specific ? doc.budgets?.[variant]?.[selected.article] : null;
  if (specific && (!b || ctx.params.program))
    return {
      title: selected.name,
      crumbs: listCrumbs(ctx, selected.name),
      body: html`${variantControl(ctx)}${gap(
        ctx.params.program
          ? 'Няма пълен програмен архив за 2027–2029'
          : 'Няма публикуван бюджет в този вариант',
        'Основният проект и вариантът на Министерския съвет са отделни. Липсващи членове и програми не се попълват от друг вариант или от 2026 г.',
      )}`,
    };
  if (specific)
    return {
      title: selected.article === 1 ? 'Държавен бюджет по чл. 1 (проект 2027)' : b.name,
      crumbs: listCrumbs(
        ctx,
        selected.article === 1 ? 'Държавен бюджет по чл. 1 (проект 2027)' : b.name,
      ),
      lede: `Чл. ${selected.article} от проекта за държавния бюджет за 2027 г. ${labels[variant]}. Всички суми са в хил. евро.`,
      body: html`${variantControl(ctx)}${base(
        ctx,
        's11-budget-2027',
        `Бюджет по чл. ${selected.article}`,
        rowsTable('s11-bill-rows', billRows(b.rows, variant)),
        { sub: labels[variant] },
      )}
      ${base(
        ctx,
        's11-policies-2027',
        'Разпределение по политики и органи',
        rowsTable('s11-bill-policies', billRows(b.policiesRows, variant)),
      )}
      ${base(
        ctx,
        's11-commitments-2027',
        'Ангажименти и нови задължения',
        rowsTable('s11-bill-commitments', billRows(b.commitmentRows, variant)),
      )}
      ${gap(
        'Програмите за 2027–2029 не са налични в пълен архив',
        'Показани са разпределенията, отпечатани в законопроекта. Пълните програмни бюджети за новия период липсват.',
      )}${publication(doc)}`,
    };
  const rows = institutionRows(ctx, items);
  const total = strictSum(items.map((i) => i.expenditure)),
    rev = strictSum(items.map((i) => i.revenue));
  const columns = [
    { key: 'name', label: 'Ведомство' },
    { key: 'article', label: 'Член' },
    { key: 'code', label: 'Код' },
    { key: 'variant', label: 'Вариант' },
    { key: 'expenditure', label: 'Разходи', unit: 'хил. €', num: true, d: 1 },
    { key: 'revenue', label: 'Собствени приходи', unit: 'хил. €', num: true, d: 1 },
    originCol,
    { key: 'origin', label: 'Връзка към произхода', csvOnly: true },
  ];
  const spec = {
    id: 's10-bill-chart',
    title: 'Най-големите бюджети в проекта за 2027',
    type: 'barh',
    unit: 'млн. €',
    d: 1,
    categories: [...items]
      .sort((a, b) => cellValue(b.expenditure) - cellValue(a.expenditure))
      .slice(0, 10)
      .map((i) => i.name),
    series: [
      {
        name: 'Разходи',
        color: '--exp',
        data: [...items]
          .sort((a, b) => cellValue(b.expenditure) - cellValue(a.expenditure))
          .slice(0, 10)
          .map((i) => (cellValue(i.expenditure) == null ? null : i.expenditure.value / 1000)),
      },
    ],
    height: 500,
  };
  return {
    lede: 'Бюджетите на ведомствата по проекта за 2027 г. Основният проект и алтернативата на Министерския съвет се разглеждат отделно.',
    answer: `${labels[variant]}: ${items.length} публикувани бюджета на ведомства. Сбор на разходите: ${money(total == null ? null : total / 1000)}.`,
    body: html`${variantControl(ctx)}${base(
      ctx,
      's10-bill-totals',
      'Бюджетите на ведомствата общо',
      kpiGrid([
        kpi({ label: 'Публикувани бюджети', value: items.length }),
        kpi({ label: 'Разходи общо', value: total, unit: 'хил. €', d: 1 }),
        kpi({ label: 'Собствени приходи', value: rev, unit: 'хил. €', d: 1 }),
      ]),
      {
        sub: `${labels[variant]}. Сборът е изчислен от отпечатаните заглавни редове по членове 2–48; не е целият държавен бюджет. ${variant === 'billMc' ? 'Показан е само публикуваният чл. 2 от варианта на МС.' : 'За чл. 5 липсва отпечатан приходен ред, затова общият сбор на собствените приходи не е наличен.'}`,
      },
    )}
      ${base(
        ctx,
        's10-bill-list',
        'Всички ведомства',
        html`${searchField(ctx, rows, 'Намери ведомство')}${dataTable({
          id: 's10-bill-table',
          caption: `Проект 2027 · ${labels[variant]}`,
          columns,
          rows,
          sortable: true,
          query: true,
          sortBy: ctx.query.sort,
          dir: ctx.query.dir,
          empty: 'Няма ведомства за това търсене. Провери името или изчисти търсенето.',
        })}`,
      )}
      ${base(ctx, 's10-bill-shares', 'Най-големите бюджети', chart(spec), {
        share: { chart: spec.id, period: ctx.period.key, unit: 'млн. €' },
      })}
      <p>
        <a href="${ctx.href('S11', { code: 'art1' }, keep(ctx))}">Държавният бюджет по чл. 1</a>
      </p>
      ${gap('Няма пълен програмен архив за 2027–2029', doc.gaps.programmes)}${publication(doc)}`,
  };
}

function municipalTable(ctx, id, title, entries, names) {
  return base(
    ctx,
    id,
    title,
    rowsTable(
      id + '-table',
      entries.map((c, i) => cellRow(names[i], c)),
    ),
  );
}
export function municipalityView(ctx) {
  if (unavailable(ctx)) return unavailable(ctx);
  const doc = ctx.data.budget2027,
    all = municipalRows(doc, ctx.data.municipalities),
    specific = ctx.route.id === 'S21';
  if (specific && ctx.period.key !== '2027.draft')
    return {
      body: gap(
        'Няма индивидуално общинско разпределение за този период',
        doc.gaps.municipalForecast,
      ),
    };
  const totals = () =>
    municipalTable(
      ctx,
      's20-totals-2027',
      'Общи бюджетни взаимоотношения по чл. 52',
      doc.municipalTotals.art52,
      MUNICIPAL_COLUMNS,
    );
  if (specific) {
    const m = all.find((x) => x.id === String(ctx.params.code).toUpperCase());
    if (!m) ctx.notFound();
    return {
      title: `Община ${m.displayName}${all.filter((x) => x.displayName === m.displayName).length > 1 ? ' · ' + m.region : ''}`,
      crumbs: listCrumbs(ctx, `Община ${m.displayName}`),
      lede: 'Проект 2027: основните бюджетни взаимоотношения по чл. 52 и разбивката на делегираните дейности по чл. 53. Сумите са в хил. евро.',
      body: html`${municipalTable(
        ctx,
        's21-transfers-2027',
        'Бюджетни взаимоотношения по чл. 52',
        m.cells,
        MUNICIPAL_COLUMNS,
      )}${municipalTable(
        ctx,
        's21-delegated-2027',
        'Делегирани дейности по чл. 53',
        m.delegated,
        DELEGATED_COLUMNS,
      )}
        <p>
          Чл. 53 разпределя делегираните дейности от чл. 52. Двете суми не се събират. Кметовете и
          администрацията са част от общите държавни служби.
        </p>
        ${publication(doc)}`,
    };
  }
  const forecast = doc.forecast.annex9 || [];
  const frows = forecast.flatMap((r) =>
    FRAMEWORK.map((key, i) => cellRow(r.label, r.cells?.[i], frameworkRow(key))),
  );
  const forecastBlock = base(
    ctx,
    's20-municipal-framework',
    'Общинска рамка 2027–2029',
    dataTable({
      id: 's20-framework-table',
      caption: 'Приложение 9, общински рамки, хил. евро',
      columns: [{ key: 'period', label: 'Период' }, ...cellColumns()],
      rows: frows,
    }),
    {
      sub: 'Приложение 9 към АСБП. Подредовете „от тях“ са включени в общите суми.',
      ...frameworkStatus,
      share: { period: '2027.draft / 2028.forecast / 2029.forecast', unit: 'хил. €' },
    },
  );
  if (ctx.period.key !== '2027.draft')
    return {
      lede: 'Общите общински рамки от АСБП 2027–2029. Индивидуалните разпределения са публикувани само за проекта за 2027 г.',
      body: html`${forecastBlock}${gap(
        'Няма индивидуално общинско разпределение за 2028–2029',
        doc.gaps.municipalForecast,
      )}${publication(doc)}`,
    };
  const region = municipalRegion(ctx, all);
  const rows = municipalityRows(ctx, all);
  const columns = [
    { key: 'name', label: 'Община' },
    { key: 'region', label: 'Област' },
    ...MUNICIPAL_COLUMNS.map((label, i) => ({
      key: 'v' + i,
      label,
      unit: 'хил. €',
      num: true,
      d: 1,
    })),
    originCol,
    { key: 'origin', label: 'Връзка към произхода', csvOnly: true },
  ];
  return {
    lede: 'Трансферите към всички 265 общини по чл. 52 от проекта за 2027 г. Делегираните дейности са разпределени по чл. 53; не са допълнителен трансфер.',
    body: html`${totals()}${base(
      ctx,
      's20-list-2027',
      'Всички общини',
      html`${searchField(ctx, rows, 'Намери община')}
      ${ctx.query.oblast && !region ? html`<p class="small">Непозната област. Търсенето е във всички области.</p>` : ''}
      ${field({
        id: 'bill-oblast',
        label: 'Област',
        control: selectInput({
          id: 'bill-oblast',
          name: 'oblast',
          query: 'oblast',
          value: region,
          options: [
            { value: '', label: 'Всички области' },
            ...[...new Map(all.map((m) => [m.regionId || m.region, m.region])).entries()].map(
              ([value, label]) => ({ value, label }),
            ),
          ],
        }),
      })}${dataTable({
        id: 's20-bill-table',
        caption: 'Проект 2027, чл. 52',
        columns,
        rows,
        sortable: true,
        query: true,
        sortBy: ctx.query.sort,
        dir: ctx.query.dir,
        empty: 'Няма общини за тези филтри. Промени областта или изчисти търсенето.',
      })}`,
    )}${forecastBlock}${publication(doc)}`,
  };
}

export function debtChart2027(ctx) {
  const doc = ctx.data.budget2027;
  if (!doc) return null;
  return {
    id: 's17-zdd',
    title: 'Държавен дълг по ЗДД, 2027–2029',
    type: 'bar',
    unit: 'млн. €',
    d: 1,
    categories: FRAMEWORK.map((k) => periodByKey(k).label),
    series: [
      {
        name: 'Външен дълг',
        color: '--data',
        data: FRAMEWORK.map((k) => cellValue(stateDebt(doc, k)?.external)),
      },
      {
        name: 'Вътрешен дълг',
        color: 2,
        data: FRAMEWORK.map((k) => cellValue(stateDebt(doc, k)?.domestic)),
      },
    ],
    stack: true,
    table: {
      columns: [{ key: 'period', label: 'Период' }, ...cellColumns('млн. €')],
      rows: FRAMEWORK.flatMap((key) => {
        const d = stateDebt(doc, key);
        return ['total', 'external', 'domestic'].map((name, i) =>
          cellRow(['Държавен дълг', 'Външен дълг', 'Вътрешен дълг'][i], d?.[name], {
            period: periodByKey(key).label,
          }),
        );
      }),
    },
  };
}
export function debtView(ctx) {
  if (unavailable(ctx)) return unavailable(ctx);
  const doc = ctx.data.budget2027,
    d = stateDebt(doc, ctx.period.key),
    spec = debtChart2027(ctx);
  const debtRows = [
    'total',
    'pctGdp',
    'external',
    'externalPctGdp',
    'domestic',
    'domesticPctGdp',
  ].map((name, i) =>
    cellRow(
      [
        'Държавен дълг',
        'Държавен дълг / БВП',
        'Външен дълг',
        'Външен дълг / БВП',
        'Вътрешен дълг',
        'Вътрешен дълг / БВП',
      ][i],
      d?.[name],
      { unit: d?.[name]?.unit },
    ),
  );
  const limits =
    ctx.period.key === '2027.draft'
      ? base(
          ctx,
          's17-limits-2027',
          'Предложени граници за 2027 г.',
          rowsTable(
            's17-limits-table',
            Object.entries(doc.debtLimits).map(([a, c]) =>
              cellRow(
                `Чл. ${a}: ${{ 66: 'минимален фискален резерв', 67: 'максимален държавен дълг в края на годината', 68: 'максимален нов държавен дълг' }[a]}`,
                c,
              ),
            ),
            'млрд. €',
          ),
          {
            sub: 'Граници по законопроекта, не приет закон и не прогноза. Чл. 66 е минимум; чл. 67 и 68 са максимуми.',
            share: { period: '2027.draft', unit: 'млрд. €' },
          },
        )
      : gap(
          'Няма предложени законови граници за 2028–2029',
          'Законопроектът определя граници само за 2027 г.',
        );
  const maastricht = ctx.query.obhvat === 'maastricht';
  return {
    lede: 'Прогноза на МФ от 06.11.2026: държавен дълг по ЗДД за 2027–2029 и отделно предложените граници на законопроекта за 2027 г.',
    body: html`${field({
      id: 's17-scope',
      label: 'Обхват на дълга',
      control: selectInput({
        id: 's17-scope',
        name: 'obhvat',
        query: 'obhvat',
        value: maastricht ? 'maastricht' : 'zdd',
        options: [
          { value: 'zdd', label: 'Държавен дълг' },
          { value: 'maastricht', label: 'Дълг по Маастрихт' },
        ],
      }),
    })}
      ${
        maastricht
          ? gap(
              'Няма съпоставим периоден ред по Маастрихт в този набор',
              'Таблица VI-1 е държавен дълг по ЗДД. Тя не е консолидираният дълг на сектор „Държавно управление“. Историческите отчети по Маастрихт остават достъпни при избор на отчетен период.',
            )
          : html`${base(
              ctx,
              's17-debt-2027',
              `Държавен дълг · ${ctx.period.label}`,
              dataTable({
                id: 's17-debt-table',
                caption: 'Таблица VI-1, АСБП 2027–2029',
                rowUnitKey: 'unit',
                columns: [...cellColumns(''), { key: 'unit', label: 'Единица' }],
                rows: debtRows,
              }),
              {
                status: 'forecast',
                statusLabel: 'Прогноза на МФ',
                share: { period: ctx.period.key, unit: 'По редове' },
              },
            )}${base(ctx, 's17-b-zdd', 'Държавен дълг 2027–2029', chart(spec), {
              status: 'forecast',
              statusLabel: 'Прогноза на МФ',
              share: {
                chart: spec.id,
                period: '2027.draft / 2028.forecast / 2029.forecast',
                unit: 'млн. €',
              },
            })}`
      }
      ${limits}
      <p>
        Прогнозните стойности от таблица VI-1 се различават от законовите тавани. Дяловете от БВП са
        отпечатаните в същата таблица. Историческите тримесечни отчети и месечното финансиране не са
        прогноза за 2027.
      </p>
      ${publication(doc)}`,
  };
}
/* ------------------------------------------------------------------ S34 · investment projects (Appendix 2) */
// Sum of the printed cells only (tenths, as published); an empty cell is not a zero and is left out.
const printedSum = (cells) => {
  const xs = cells.filter((c) => cellValue(c) !== null);
  return xs.length ? xs.reduce((sum, c) => sum + Math.round(c.value * 10), 0) / 10 : null;
};
const toMln = (v) => (v == null ? null : v / 1000);
// "Министерство на транспорта и съобщенията/Национална компания „…“" → the company that carries out the project
const shortInstitution = (name) =>
  (name.includes('/') ? name.slice(name.indexOf('/') + 1) : name)
    .replace(/^Национална компания /, 'НК ')
    .replace(/^Държавно предприятие /, 'ДП ')
    .replace(/^Министерство на /, 'М-во на ')
    .replace(/^“/, '„')
    .trim();
const projectCells = (r) => FRAMEWORK.map((_, i) => r.cells[i]);
const projectColumns = (unit, d) => [
  {
    key: 'name',
    label: 'Проект',
    fmt: (v, r) => html`${v}<span class="proj-inst small muted">${r.institution}</span>`,
  },
  { key: 'institution', label: 'Ведомство', csvOnly: true },
  { key: 'id', label: 'Номер в приложението', csvOnly: true },
  ...FRAMEWORK.map((key, i) => ({
    key: 'y' + i,
    label: periodByKey(key).label,
    unit,
    num: true,
    d,
  })),
  { key: 'note', label: 'Бележка', csvOnly: true },
];
const projectRow = (r, scale) => ({
  id: r.id,
  name: r.name,
  institution: r.institution,
  ...Object.fromEntries(
    projectCells(r).map((c, i) => ['y' + i, cellValue(c) == null ? null : scale(c.value)]),
  ),
  note: Object.values(r.gaps || {}).join(' '),
});
const projectRows = (ctx, projects) =>
  projects
    .filter((r) => matches(`${r.name} ${r.institution} ${r.id}`, ctx.query.q))
    .map((r) => projectRow(r, (v) => v));
const projectCount = (n) => `Намерени проекти: ${num(n)}.`;
function projectsBlocks(ctx, doc) {
  const projects = doc.projects || [];
  const sums = FRAMEWORK.map((key) => cellValue(doc.projectAnnualSums?.[key]));
  const byInstitution = new Map();
  for (const r of projects)
    byInstitution.set(r.institution, [...(byInstitution.get(r.institution) || []), r.cells[0]]);
  const ranked = [...byInstitution]
    .map(([name, cells]) => ({ name, value: printedSum(cells) }))
    .filter((x) => x.value != null)
    .sort((a, b) => b.value - a.value);
  const SHOWN = 6;
  const others = printedSum(ranked.slice(SHOWN).map((x) => ({ value: x.value })));
  const parts = [
    ...ranked.slice(0, SHOWN),
    ...(others == null ? [] : [{ name: 'Други ведомства', value: others }]),
  ];
  const top = ranked[0];
  const spec = {
    id: 's34-projects-by-institution',
    title: 'По ведомства, 2027',
    type: 'barh',
    unit: 'млн. €',
    d: 0,
    categories: parts.map((x) =>
      x.name === 'Други ведомства' ? x.name : shortInstitution(x.name),
    ),
    series: [{ name: '2027', color: '--exp', data: parts.map((x) => toMln(x.value)) }],
    // Long ministry names wrap instead of being cut: room for up to three lines per bar.
    labelWidth: 'auto',
    labelOverflow: 'break',
    height: 60 * parts.length + 40,
  };
  const biggest = [...projects]
    .sort((a, b) => (printedSum(projectCells(b)) ?? 0) - (printedSum(projectCells(a)) ?? 0))
    .slice(0, 10);
  const status = {
    ...frameworkStatus,
    share: { period: '2027.draft / 2028.forecast / 2029.forecast', unit: 'млн. €' },
  };
  // One block: the three year totals, where the 2027 money goes, the ten largest projects and, folded, the full list.
  return base(
    ctx,
    's34-projects',
    'Инвестиционни проекти 2027–2029',
    html`${kpiGrid(
      FRAMEWORK.map((key, i) => kpi({ label: periodByKey(key).label, mln: toMln(sums[i]), d: 2 })),
    )}
    ${
      sums[0] != null && top
        ? html`<p>
            Законопроектът предвижда ${money(toMln(sums[0]))} за ${num(projects.length)} инвестиционни
            проекта през 2027 г. Най-голяма част е за ${top.name}: ${money(toMln(top.value))}.
          </p>`
        : ''
    }
    ${chart(spec)}
    <h3>Най-големите проекти</h3>
    <p class="small muted">Подредени по сумата за трите години, в милиони евро.</p>
    ${dataTable({
      id: 's34-projects-table',
      caption: 'Десетте проекта с най-голяма сума за 2027–2029, в млн. евро',
      columns: projectColumns('млн. €', 1),
      rows: biggest.map((r) => projectRow(r, (v) => v / 1000)),
      note: '— сумата за годината не е посочена в законопроекта.',
    })}
    ${disclosure({
      id: 's34-all-projects',
      title: `Всички ${num(projects.length)} инвестиционни проекта`,
      open: !!cleanSearch(ctx.query.q),
      body: html`${searchBox(ctx, 's34', 'Намери проект', projectCount(projectRows(ctx, projects).length))}
        <p class="small muted">Сумите са в хиляди евро.</p>
        ${dataTable({
          id: 's34-project-details',
          caption: `Приложение 2, ${num(projects.length)} проекта, в хил. евро`,
          columns: projectColumns('хил. €', 1),
          rows: projectRows(ctx, projects),
          empty: 'Няма проекти за това търсене. Провери думите или изчисти търсенето.',
          note: '— сумата за годината не е посочена в законопроекта.',
        })}`,
    })}`,
    {
      sub: 'Сбор на годишните суми на проектите от Приложение 2 на законопроекта. Законопроектът не дава общ ред, а празните клетки не означават нулев разход.',
      ...status,
      // The block's CSV is the full project list (not the chart above it).
      share: {
        ...status.share,
        unit: 'хил. €',
        table: () =>
          tableData({
            columns: projectColumns('хил. €', 1),
            rows: projects.map((r) => projectRow(r, (v) => v)),
          }),
      },
    },
  );
}
export const mountProjectSearch = (root, ctx) =>
  wireSearch(root, ctx, {
    prefix: 's34',
    table: 's34-project-details',
    rows: () => projectRows(ctx, ctx.data.budget2027?.projects || []),
    count: projectCount,
  });
export function billOverview(ctx) {
  if (unavailable(ctx)) return unavailable(ctx);
  const doc = ctx.data.budget2027,
    variant = variantOf(ctx),
    b = doc.budgets?.[variant]?.['1'];
  if (!b) return { body: gap('Няма държавен бюджет в този вариант', 'Липсва публикуван чл. 1.') };
  if (variant === 'billMc')
    return {
      title: 'Бюджет 2027 · вариант на Министерския съвет',
      lede: 'Самостоятелният вариант на МС съдържа чл. 1 и 2. Липсващите бюджети и приложения не се допълват от основния проект.',
      body: html`${variantControl(ctx)}${base(
        ctx,
        's34-mc-budget',
        'Чл. 1 · вариант на Министерския съвет',
        rowsTable('s34-mc-table', billRows(b.rows, variant)),
      )}
        <p>
          <a href="${ctx.href('S10', {}, { per: '2027.draft', variant: 'billMc' })}"
            >Ведомствени бюджети във варианта на МС</a
          >
        </p>
        ${gap(
          'Няма отделни общински и инвестиционни приложения за този вариант',
          'Избери основния проект, за да разгледаш публикуваните към него приложения.',
        )}
        <p>
          <a href="${ctx.href('S34', {}, { variant: 'bill' })}"
            >Основен проект за бюджет 2027 и АСБП 2027–2029</a
          >
        </p>
        ${publication(doc)}`,
    };
  return {
    title: 'Бюджет 2027',
    lede: 'Официални данни от законопроекта за 2027 г. и АСБП 2027–2029 на Министерството на финансите, публикувани на 06.11.2026. За 2028–2029 г. стойностите са прогноза.',
    body: html`${variantControl(ctx)}${base(
      ctx,
      's34-bill',
      'Държавен бюджет по чл. 1',
      kpiGrid(
        ['I', 'II'].map((s, i) =>
          kpi({
            label: ['Приходи', 'Разходи'][i],
            value: cellValue(headline(b, s)),
            unit: 'хил. €',
            d: 1,
          }),
        ),
      ),
      { sub: labels[variant] },
    )}
      <ul>
        <li><a href="${ctx.href('S10', {}, keep(ctx))}">Бюджети на ведомствата</a></li>
        <li><a href="${ctx.href('S20', {}, { per: '2027.draft' })}">Трансфери към общините</a></li>
        <li>
          <a href="${ctx.href('S17', {}, { per: '2027.draft' })}">Дълг и предложени граници</a>
        </li>
        <li>
          <a href="${ctx.href('S13', {}, { per: '2027.draft' })}">Прогнозна рамка 2027–2029</a>
        </li>
      </ul>
      ${projectsBlocks(ctx, doc)}
      <p>
        <a href="${ctx.href('S34', {}, { dokument: 'plan' })}"
          >Предходна публикация: проект на бюджетен план до ЕК от 15.10.2026</a
        >
      </p>
      ${publication(doc)}`,
  };
}
// Filters a table in place as the reader types and keeps ?q= in the address without re-rendering the screen.
function wireSearch(root, ctx, { prefix, table, rows, count }) {
  const input = root.querySelector(`#${prefix}-q`);
  if (!input) return;
  const clear = root.querySelector(`[data-${prefix}-clear]`);
  const status = root.querySelector(`#${prefix}-count`);
  let timer;
  const change = () => {
    clearTimeout(timer);
    if (clear) clear.disabled = !input.value;
    const query = cleanSearch(input.value);
    if (query === cleanSearch(ctx.query.q)) return;
    ctx.setQuery({ q: query || null }, { rerender: false });
    const list = rows();
    updateRows(table, list);
    if (status) status.textContent = count(list.length);
  };
  const typing = (e) => {
    clearTimeout(timer);
    if (clear) clear.disabled = !input.value;
    if (!e.isComposing) timer = setTimeout(change, 140);
  };
  const key = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      input.value = '';
      change();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      change();
    }
  };
  const reset = () => {
    input.value = '';
    change();
    input.focus();
  };
  input.addEventListener('input', typing);
  input.addEventListener('compositionend', change);
  input.addEventListener('keydown', key);
  clear?.addEventListener('click', reset);
  return () => {
    clearTimeout(timer);
    input.removeEventListener('input', typing);
    input.removeEventListener('compositionend', change);
    input.removeEventListener('keydown', key);
    clear?.removeEventListener('click', reset);
  };
}
export const mountBillSearch = (root, ctx) =>
  wireSearch(root, ctx, {
    prefix: 'bill',
    table: municipalScreen(ctx) ? 's20-bill-table' : 's10-bill-table',
    rows: () => (municipalScreen(ctx) ? municipalityRows(ctx) : institutionRows(ctx)),
    count: (n) => resultCount(ctx, n),
  });

// Separate phone presentation: the hidden desktop table still owns the unchanged CSV.
function measureCards(measures) {
  return html`<div class="measure-cards">${measures.map(
    (r) => html`<div class="measure-card">
    <h3>${r.label}</h3>
    <dl>${FRAMEWORK.map((key, k) => html`<div class="measure-value"><dt>${periodByKey(key).label}, млн. €</dt><dd>${cellValue(r.cells[k]) == null ? '—' : num(cellValue(r.cells[k]), 1)}${r.gaps[k] ? html`<small class="muted">${r.gaps[k]}</small>` : ''}</dd></div>`)}</dl>
    <details class="measure-origin"><summary>Произход на стойностите</summary>
      <dl>${FRAMEWORK.map((key, k) => html`<div><dt>${periodByKey(key).label}</dt><dd>${r.cells[k]?.provenance ? html`<a href="${provenanceUrl(r.cells[k])}">${r.cells[k].provenance}</a><p>${provenanceUrl(r.cells[k])}</p>` : 'Няма публикувана клетка'}</dd></div>`)}</dl>
    </details>
  </div>`,
  )}</div>`;
}

export function measuresView(ctx) {
  if (unavailable(ctx)) return unavailable(ctx);
  const doc = ctx.data.budget2027;
  if (ctx.params.id)
    return {
      body: gap(
        'Тази историческа мярка няма идентификатор в проекта за 2027',
        'Мерките от АСБП 2027–2029 са в общия списък.',
      ),
      next: [
        { href: ctx.href('S12', {}, { per: '2027.draft' }), title: 'Мерки в проекта за 2027' },
      ],
    };
  const body = ['II_7', 'II_8'].map((table, i) => {
    const rows = doc.forecast[table].flatMap((r, rowIndex) =>
      FRAMEWORK.map((key, k) =>
        cellRow(r.label, r.cells[k], {
          ...frameworkRow(key),
          gap: r.gaps[k] || '',
          _id: `s12-${table}-${rowIndex}-${k}`,
        }),
      ),
    );
    return base(
      ctx,
      's12-' + table,
      i === 0 ? 'Приходни мерки 2027–2029' : 'Разходни мерки 2027–2029',
      html`<div class="measures-desktop">${dataTable({
        id: 's12-' + table + '-table',
        caption: `Таблица ${table.replace('_', '-')}, АСБП 2027–2029`,
        columns: [
          { key: 'period', label: 'Период' },
          ...cellColumns('млн. €'),
          { key: 'gap', label: 'Липсваща стойност' },
        ],
        rows,
      })}</div>${measureCards(doc.forecast[table])}`,
      {
        sub: 'Показани са отпечатаните ефекти и общият ред. Празните клетки не са нула. Знаците и разликите между годините са запазени.',
        ...frameworkStatus,
        share: { period: '2027.draft / 2028.forecast / 2029.forecast', unit: 'млн. €' },
      },
    );
  });
  return {
    title: 'Мерки в проекта за бюджет 2027',
    lede: 'Приходните и разходните мерки от таблици II-7 и II-8 на АСБП 2027–2029, публикувани от МФ на 06.11.2026. Проектът не е приет закон.',
    body: html`${body}${publication(doc)}
      <p>
        <a href="${ctx.href('S12', {}, { per: '2026.law' })}">Исторически мерки за 2026 г.</a>
      </p>`,
  };
}
