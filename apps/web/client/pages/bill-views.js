// The existing block, table, chart and sharing components, fed only by the November publication.
import { html } from '../html.js';
import { num, money } from '../format.js';
import { block } from '../ui/block.js';
import { dataTable } from '../ui/table.js';
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
import { periodByKey } from '../periods.js';
import { dataHref } from '../data.js';

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
const base = (ctx, id, title, body, extra = {}) =>
  block({
    id,
    title,
    body,
    source,
    asOf: ctx.data.budget2027?.publication,
    status: ctx.period.status === 'forecast' ? 'forecast' : 'real',
    statusLabel: ctx.period.label,
    share: { period: ctx.period.key, unit: 'хил. €' },
    ...extra,
  });
const originCol = {
  key: 'provenance',
  label: 'Произход',
  fmt: (v, r) => (v ? html`<a href="${r.origin}">${v}</a>` : 'Няма публикувана клетка'),
};
const cellRow = (label, cell, extra = {}) => ({
  label,
  value: cellValue(cell),
  provenance: cell?.provenance || '',
  origin: provenanceUrl(cell),
  ...extra,
});
export const cellColumns = (unit = 'хил. €') => [
  { key: 'label', label: 'Показател' },
  { key: 'value', label: 'Стойност', unit, num: true, d: 1 },
  originCol,
  { key: 'origin', label: 'Връзка към произхода' },
];
const rowsTable = (id, rows, unit) =>
  dataTable({
    id,
    caption: 'Публикувани стойности и произход',
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
  const q = String(ctx.query.q || '')
    .trim()
    .toLocaleLowerCase('bg');
  const filtered = items.filter(
    (i) => !q || `${i.name} ${i.code}`.toLocaleLowerCase('bg').includes(q),
  );
  const rows = filtered.map((i) => ({
    name: i.name,
    variant: labels[variant],
    code: i.code,
    article: i.article,
    revenue: cellValue(i.revenue),
    expenditure: cellValue(i.expenditure),
    provenance: i.expenditure?.provenance || '',
    origin: provenanceUrl(i.expenditure),
    _href: ctx.href('S11', { code: i.code }, keep(ctx)),
  }));
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
    { key: 'origin', label: 'Връзка към произхода' },
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
        html`${field({
          id: 'bill-q',
          label: 'Намери ведомство',
          control: textInput({ id: 'bill-q', name: 'q', type: 'search', value: ctx.query.q || '' }),
        })}${dataTable({
          id: 's10-bill-table',
          caption: `Проект 2027 · ${labels[variant]}`,
          columns,
          rows,
          sortable: true,
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
    FRAMEWORK.map((key, i) => cellRow(r.label, r.cells?.[i], { period: periodByKey(key).label })),
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
  const q = String(ctx.query.q || '').toLocaleLowerCase('bg'),
    region = ctx.query.oblast || '';
  const filtered = all.filter(
    (m) =>
      (!q || `${m.displayName} ${m.name}`.toLocaleLowerCase('bg').includes(q)) &&
      (!region || m.region === region || m.regionId === region),
  );
  const rows = filtered.map((m) => ({
    name: m.displayName,
    region: m.region,
    ...Object.fromEntries(m.cells.map((c, i) => ['v' + i, cellValue(c)])),
    provenance: m.cells[0]?.provenance,
    origin: provenanceUrl(m.cells[0]),
    _href: m.id ? ctx.href('S21', { code: m.id }, { per: ctx.period.key }) : undefined,
  }));
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
    { key: 'origin', label: 'Връзка към произхода' },
  ];
  return {
    lede: 'Трансферите към всички 265 общини по чл. 52 от проекта за 2027 г. Делегираните дейности са разпределени по чл. 53; не са допълнителен трансфер.',
    body: html`${totals()}${base(
      ctx,
      's20-list-2027',
      'Всички общини',
      html`${field({
        id: 'bill-q',
        label: 'Намери община',
        control: textInput({ id: 'bill-q', name: 'q', type: 'search', value: ctx.query.q || '' }),
      })}${field({
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
      ${maastricht
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
            { status: 'forecast', statusLabel: 'Прогноза на МФ', share: { period: ctx.period.key, unit: 'По редове' } },
          )}${base(ctx, 's17-b-zdd', 'Държавен дълг 2027–2029', chart(spec), {
            status: 'forecast',
            statusLabel: 'Прогноза на МФ',
            share: {
              chart: spec.id,
              period: '2027.draft / 2028.forecast / 2029.forecast',
              unit: 'млн. €',
            },
          })}`}
      ${limits}
      <p>
        Прогнозните стойности от таблица VI-1 се различават от законовите тавани. Дяловете от БВП са
        отпечатаните в същата таблица. Историческите тримесечни отчети и месечното финансиране не са
        прогноза за 2027.
      </p>
      ${publication(doc)}`,
  };
}
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
    title: 'Бюджет 2027 (проект)',
    lede: 'Законопроектът и АСБП 2027–2029, публикувани от Министерството на финансите на 06.11.2026. Проектът не е приет закон.',
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
      ${base(
        ctx,
        's34-projects',
        'Инвестиционни проекти 2027–2029',
        dataTable({
          id: 's34-projects-table',
          caption: 'Приложение 2, годишни суми в хил. евро',
          columns: [{ key: 'period', label: 'Период' }, ...cellColumns()],
          rows: FRAMEWORK.map((key) =>
            cellRow('Сбор на публикуваните годишни стойности', doc.projectAnnualSums[key], {
              period: periodByKey(key).label,
            }),
          ),
        }),
        {
          sub: 'Изчислен сбор само на отпечатаните числови клетки в 226 проекта, не отпечатан общ ред. Празните клетки не са оценка за нулев разход. Произходът съдържа всички участващи клетки.',
          share: { period: '2027.draft / 2028.forecast / 2029.forecast', unit: 'хил. €' },
        },
      )}
      ${disclosure({
        id: 's34-all-projects',
        title: 'Всички инвестиционни проекти',
        body: dataTable({
          id: 's34-project-details',
          caption: 'Приложение 2, 226 проекта',
          columns: [
            { key: 'period', label: 'Период' },
            ...cellColumns(),
            { key: 'gap', label: 'Липсваща стойност' },
          ],
          rows: doc.projects.flatMap((r) =>
            FRAMEWORK.map((key, i) =>
              cellRow(`${r.id}: ${r.name}`, r.cells[i], {
                period: periodByKey(key).label,
                gap: r.gaps[i] || '',
              }),
            ),
          ),
        }),
      })}
      <p>
        <a href="${ctx.href('S34', {}, { dokument: 'plan' })}"
          >Предходна публикация: проект на бюджетен план до ЕК от 15.10.2026</a
        >
      </p>
      ${publication(doc)}`,
  };
}
export function mountBillSearch(root, ctx) {
  const input = root.querySelector('#bill-q');
  if (!input) return;
  const change = () => ctx.setQuery({ q: input.value });
  input.addEventListener('change', change);
  const key = (e) => {
    if (e.key === 'Enter') change();
  };
  input.addEventListener('keydown', key);
  return () => {
    input.removeEventListener('change', change);
    input.removeEventListener('keydown', key);
  };
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
        cellRow(r.label, r.cells[k], { period: periodByKey(key).label, gap: r.gaps[k] || '', _id: `s12-${table}-${rowIndex}-${k}` }),
      ),
    );
    return base(
      ctx,
      's12-' + table,
      i === 0 ? 'Приходни мерки 2027–2029' : 'Разходни мерки 2027–2029',
      dataTable({
        id: 's12-' + table + '-table',
        caption: `Таблица ${table.replace('_', '-')}, АСБП 2027–2029`,
        columns: [
          { key: 'period', label: 'Период' },
          ...cellColumns('млн. €'),
          { key: 'gap', label: 'Липсваща стойност' },
        ],
        rows,
      }),
      {
        sub: 'Показани са отпечатаните ефекти и общият ред. Празните клетки не са нула. Знаците и разликите между годините са запазени.',
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
