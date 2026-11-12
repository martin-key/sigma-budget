import { annualSource } from '../ui/annual-source.js';
import { periodIndex, previousPeriodIndex } from '../annual.js';
import { selectPeriod } from '../periods.js';
import { annualGap } from '../ui/annual.js';
// S08 · Функция · #/razhodi/:fn · next S12 · periods all
// One of the nine functions of the КФП: its size, its parts and its years (Табл. III-1 of the motives, D03), the Eurostat history of the same kind of
// spending (D05), the budgets of its main spenders (D04) . Every number is computed from the data files;
// the editorial layer is only the one-line explanations, which measures touch which function and the pointers to the two budgets outside the state budget.
//   units  млн. € / % от БВП through the unit switch for the list and the charts; „на човек“ and „и в лева“ through view.js. The five tiles at the top
//          are fixed (sum · share · % от БВП · на човек · change) because the screen shows all of them at once. The Eurostat history ignores „на човек“.
//   2024   has no column in Табл. III-1: the tiles, the parts and the comparison give way to one note, the rest of the screen still draws.
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { chart } from '../ui/chart.js';
import { ranklist } from '../ui/ranklist.js';
import { disclosure } from '../ui/disclosure.js';
import { callout, ext } from '../ui/cards.js';
import { emptyState, pendingState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';
import { apportion } from '../calc.js';
import { yIndex, change, chartUnit, perCapita, periodStatus } from '../view.js';
import { num, pct, money, moneyParts, delta, date, DASH, NBSP } from '../format.js';

export const needs = ['budget2027-provenance?', 'core', 'outlook', 'expenditure', 'ministries?'];
export const styles = ['s08-funkciya'];

const yr = (y) => `${y}${NBSP}г.`;
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const tidy = (x, k = 1) => Math.round(x * 10 ** k) / 10 ** k;
const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const WORD = {
  law: 'закон',
  expected: 'очаквано',
  draft: 'проект',
  actual: 'отчета',
  prelim: 'предварителния отчет',
  plan: 'плана',
  forecast: 'прогнозата',
};
const COFOG_SCOPE = {
  key: 'cofog',
  label: 'Евростат · COFOG',
  note: 'друг разрез от КФП',
  gl: 'sektor-darzhavno-upravlenie',
};
const MIN_SCOPE = { key: 'dbudget', label: 'Държавен бюджет', note: 'не цялата КФП' };

/** Editorial layer: what is inside a function (plain-language one-liners; the numbers come from the data). */
const FN_WHAT = {
  'obshti-sluzhbi': 'Изпълнителната и законодателната власт, общите служби и науката.',
  'otbrana-sigurnost':
    'Отбраната, полицията и вътрешният ред, съдебната власт, затворите и защитата при бедствия.',
  obrazovanie: 'Детските градини, училищата, университетите и другите образователни дейности.',
  zdraveopazvane: 'Лечението, болниците и общественото здраве.',
  sotsialni: 'Пенсиите, социалните помощи и обезщетения, грижите и заетостта.',
  'zhilishtno-sreda':
    'Благоустройството и комуналните услуги, жилищното строителство и опазването на околната среда.',
  'kultura-sport': 'Културата, спорта, почивните дейности и религиозното дело.',
  ikonomika:
    'Транспорта, енергетиката, селското стопанство, туризма и другите икономически дейности.',
  drugi: 'Разходите, които не се вписват в другите функции.',
};
/** short names of the Eurostat COFOG divisions (the data carries the long official ones) */
const COFOG_SHORT = {
  GF01: 'Общи държавни служби',
  GF02: 'Отбрана',
  GF03: 'Ред и сигурност',
  GF04: 'Икономически дейности',
  GF05: 'Околна среда',
  GF06: 'Жилищно и комунално',
  GF07: 'Здравеопазване',
  GF08: 'Култура и отдих',
  GF09: 'Образование',
  GF10: 'Социална защита',
};
/** the budgets that sit next to the state budget but inside the КФП */
const OWN = {
  zdraveopazvane: {
    src: 'zbnzok',
    text: html`Освен бюджета на министерството, парите за лечение минават и през Националната здравноосигурителна каса (НЗОК). Нейният бюджет е отделен закон, но влиза в ${gl('kfp', 'консолидираната програма')}.`,
  },
  sotsialni: {
    src: 'zbdoo',
    text: html`Освен бюджета на министерството, пенсиите се плащат от държавното обществено осигуряване (ДОО). Неговият бюджет е отделен закон, но влиза в ${gl('kfp', 'консолидираната програма')}.`,
  },
};

// ── the model ──────────────────────────────────────────────────────────────────────────────────────────
/** one function in the selected period; strict: an unknown :fn leads to the „не е намерено“ screen (the page contract callers are lenient and get null) */
function modelOf(ctx, strict) {
  const F = ctx.data?.expenditure?.functions;
  if (!F || !Array.isArray(F.items) || !Array.isArray(F.years)) return null;
  const at = F.items.findIndex((x) => x && x.id === String(ctx.params?.fn ?? ''));
  if (at < 0) {
    if (strict) ctx.notFound();
    return null;
  }
  const it = F.items[at];
  const sel = periodIndex(F, ctx),
    prev = previousPeriodIndex(F, ctx);
  const mln = Array.isArray(it.mln) ? it.mln : [],
    pg = Array.isArray(it.pctGdp) ? it.pctGdp : [];
  const val = sel >= 0 ? (mln[sel] ?? null) : null,
    before = prev >= 0 ? (mln[prev] ?? null) : null;
  const pgSel = sel >= 0 ? (pg[sel] ?? null) : null;
  const share =
    sel >= 0
      ? (apportion(
          F.items.map((x) => x.mln?.[sel] ?? null),
          100,
          1,
        )[at] ?? null)
      : null; // the same rounding as the list on S07
  const parts =
    sel < 0
      ? []
      : (it.parts || [])
          .map((p) => ({ label: upper(p.name), mln: p.mln?.[sel] ?? null }))
          .filter((p) => ok(p.mln))
          .map((p) => ({
            ...p,
            pg: ok(pgSel) && ok(val) && val > 0 ? tidy((pgSel * p.mln) / val, 3) : null,
          }));
  const kinds = F.vintage || [],
    labels = F.yearLabels || F.years.map(String);
  return {
    F,
    it,
    id: it.id,
    name: it.name,
    short: it.short || it.name,
    sel,
    prev,
    mln,
    pg,
    val,
    before,
    pgSel,
    share,
    parts,
    kinds,
    labels,
    years: F.years,
    year: sel >= 0 ? F.years[sel] : ctx.period?.year,
    prevYear: prev >= 0 ? F.years[prev] : null,
    yoy: change(val, before),
    diff: ok(val) && ok(before) ? tidy(val - before, 1) : null,
    prevWord: prev === 0 ? 'програмата' : (WORD[kinds[prev]] ?? ''),
    asOf: ctx.data.expenditure.meta?.asOf,
  };
}

// ── the blocks ─────────────────────────────────────────────────────────────────────────────────────────
function kpiBlock(ctx, M) {
  const st = periodStatus(ctx) === 'forecast' ? 'forecast' : undefined;
  const sum = ok(M.val) ? moneyParts(M.val) : null,
    per = perCapita(ctx, M.val);
  const tiles = [
    kpi({ label: `Разходи през ${yr(M.year)}`, value: sum?.v ?? null, unit: sum?.u, status: st }),
    kpi({
      label: 'Дял от разходите по функции',
      value: ok(M.share) ? num(M.share, 1) : null,
      unit: '%',
      sub: 'От всичките девет функции заедно',
      status: st,
    }),
    kpi({
      label: 'Дял от БВП',
      value: ok(M.pgSel) ? num(M.pgSel, 1) : null,
      unit: '% от БВП',
      gl: 'dyal-ot-bvp',
      status: st,
    }),
    kpi({
      label: 'На човек',
      value: per === DASH ? null : per,
      sub: 'За една година, средно на човек от населението',
      gl: 'razhod-na-chovek',
      status: st,
    }),
  ];
  if (M.prev >= 0) {
    const up = ok(M.diff) && M.diff >= 0;
    tiles.push(
      kpi({
        label: `Спрямо ${yr(M.prevYear)}`,
        value: ok(M.yoy) ? delta(M.yoy, 1) : null,
        status: st,
        sub: ok(M.diff)
          ? `${up ? 'Повече' : 'По-малко'} с ${money(Math.abs(M.diff))} спрямо ${M.prevWord ? `${M.prevWord} за ` : ''}${yr(M.prevYear)}`
          : '',
      }),
    );
  }
  return block({
    id: 's08-kpis',
    title: 'Функцията накратко',
    scope: 'kfp',
    status: periodStatus(ctx),
    source: ctx.data.expenditure.meta.source,
    asOf: M.asOf,
    body: kpiGrid(tiles, { label: 'Функцията накратко' }),
  });
}

function partsBlock(ctx, M) {
  const title = `Какво влиза във функцията, ${yr(M.year)}`;
  const base = {
    id: 's08-pera',
    title,
    scope: 'kfp',
    status: periodStatus(ctx),
    source: ctx.data.expenditure.meta.source,
    asOf: M.asOf,
    sub: FN_WHAT[M.id],
  };
  if (!M.parts.length) {
    return block({
      ...base,
      body: callout({
        kind: 'info',
        body: html`В таблицата към проекта на бюджета тази функция е само един общ ред, без отделни пера.`,
      }),
    });
  }
  const shares = apportion(
    M.parts.map((p) => p.mln),
    100,
    1,
  );
  const sum = M.parts.reduce((a, p) => a + p.mln, 0),
    d = ok(M.val) ? Math.abs(sum - M.val) : 0;
  const list = ranklist({
    id: 's08-rl-pera',
    caption: `Пера на функцията, ${yr(M.year)}`,
    unit: 'mln',
    sort: 'desc',
    categoryLabel: 'Перо',
    items: M.parts.map((p, i) => ({
      label: p.label,
      value: p.mln,
      pctGdp: p.pg,
      share: shares[i],
    })),
  });
  const note =
    d > 0.05
      ? html`<p class="small muted">Сборът на перата (${num(sum, 1)} млн. €) се различава от функцията (${num(M.val, 1)} млн. €) с ${num(d, 1)} млн. € заради закръгляването в източника.</p>`
      : '';
  return block({ ...base, body: html`<div class="s08-stack">${list}${note}</div>` });
}

function yearsBlock(ctx, M) {
  const u = chartUnit(ctx, { pct: true, max: Math.max(0, ...M.mln.filter(ok)) });
  const span = `${M.years[0]}–${M.years[M.years.length - 1]}`;
  const cats = M.labels.map((l) => String(l).replace(/^(\d{4}) /, '$1\n'));
  const flat = M.labels.map((l) =>
    String(l).replace(/^(\d{4}) (.+)$/, (m, y, w) => `${y} (${w.toLowerCase()})`),
  );
  const data = M.mln.map((v, i) => u.conv(v, M.pg[i]));
  const spec = {
    id: 's08-ch-godini',
    type: 'bar',
    title: `${M.short} по години, ${span}`,
    sub: `В ${u.unit}.`,
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    option: u.option(false),
    categories: cats,
    categoryLabel: 'Година',
    series: [{ name: 'Разходи', color: '--exp', data }],
    labels: true,
    legend: false,
    height: 320,
    interval: 0, // four two-line labels always fit: show every one of them, also at 400 px
    views: ['bars', 'line'],
    desc: `Колони по години (${span}). Точните числа са в таблицата под графиката.`,
    table: {
      columns: [
        { key: 'c', label: 'Година' },
        {
          key: 'v',
          label: 'Разходи',
          unit: u.unit,
          d: u.d,
          num: true,
          fmt: (v) => (ok(v) ? u.fmt(v) : DASH),
        },
        ...(u.kind === 'pct' ? [] : [{ key: 'pg', label: '% от БВП', d: 1, num: true }]),
        {
          key: 'yoy',
          label: 'Спрямо предходната година',
          num: true,
          fmt: (v) => (ok(v) ? delta(v, 1) : DASH),
        },
      ],
      rows: flat.map((c, i) => ({
        c,
        v: data[i] ?? null,
        pg: M.pg[i] ?? null,
        yoy: i > 0 ? change(M.mln[i], M.mln[i - 1]) : null,
      })),
    },
  };
  const f = M.kinds.indexOf('forecast');
  const sub =
    f >= 0
      ? `${M.years.slice(f).join(' и ')} са прогноза на Министерството на финансите, не приет план.`
      : '';
  return block({
    id: 's08-godini',
    title: 'По години',
    scope: 'kfp',
    status: periodStatus(ctx),
    source: ctx.data.expenditure.meta.source,
    asOf: M.asOf,
    sub,
    body: chart(spec),
  });
}

/** the Eurostat divisions that overlap this function, 2015–2024 (independent of the selected period) */
function cofogBlock(ctx, M) {
  const C = ctx.data?.expenditure?.cofog;
  if (!C || !Array.isArray(C.years) || !Array.isArray(C.items)) return '';
  const list = C.items.filter(
    (x) =>
      !x.memoOf &&
      Array.isArray(x.kfpFunctions) &&
      x.kfpFunctions.includes(M.id) &&
      Array.isArray(x.mln),
  );
  if (!list.length) return '';
  const u = chartUnit(ctx, {
    pct: true,
    max: Math.max(0, ...list.flatMap((x) => x.mln).filter(ok)),
    person: false,
  });
  const span = `${C.years[0]}–${C.years[C.years.length - 1]}`;
  const spec = {
    id: 's08-ch-cofog',
    type: 'line',
    title: `${list.map((x) => COFOG_SHORT[x.code] ?? x.name).join(' и ')}, ${span}`,
    sub: `В ${u.unit}.`,
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    option: u.option(false),
    categories: C.years.map(String),
    categoryLabel: 'Година',
    series: list.map((x) => ({
      name: COFOG_SHORT[x.code] ?? x.name,
      data: x.mln.map((v, i) => u.conv(v, x.pctGdp?.[i])),
    })),
    labels: false,
    height: 300,
    desc: `Линии по години (${span}). Точните числа са в таблицата под графиката.`,
  };
  return block({
    id: 's08-evrostat',
    title: `По-стари години: данни на Евростат, ${span}`,
    scope: COFOG_SCOPE,
    status: 'real',
    source: ['eurostat'],
    asOf: C.asOf,
    sub: 'Евростат следи същите разходи по друга методика, затова числата не са същите като в таблицата към проекта.',
    body: html`<div class="s08-stack">${chart(spec)}${C.note ? html`<p class="small muted s08-read" data-gl-scan>${C.note}</p>` : ''}</div>`,
  });
}

/** the main spenders of the function (the budgets of the 2026 law) and the two budgets that sit beside the state budget */
function vedBlock(ctx, M) {
  if (ctx.period.key !== '2026.law') return '';
  const title = 'Кой харчи тези пари';
  const doc = ctx.data?.ministries;
  if (!doc || !Array.isArray(doc.items))
    return block({
      id: 's08-vedomstva',
      title,
      status: 'pending',
      body: pendingState({
        title,
        text: 'Бюджетите на ведомствата не са налични в момента. Опитай пак по-късно.',
      }),
    });
  const gdp = ctx.core?.kpis?.gdp,
    g = [gdp?.mlnPrecise, gdp?.mln].find((x) => ok(x) && x > 0) ?? null;
  const by = new Map(doc.items.map((x) => [String(x.id), x]));
  const items = (M.it.ministries || [])
    .map((c) => by.get(String(c)))
    .filter((x) => x && ok(x.expKhil))
    .map((x) => {
      const v = tidy(x.expKhil / 1000, 4);
      return {
        label: x.short || x.name,
        sub: doc.kinds?.[x.kind] ?? '',
        value: v,
        pctGdp: g ? (v / g) * 100 : null,
        href: ctx.href('S11', { code: x.id }),
      };
    });
  const year = Number(String(doc.meta?.asOf || '').slice(0, 4)) || 2026;
  const own = OWN[M.id],
    src = own ? ctx.core?.sources?.[own.src] : null;
  const body = html`<div class="s08-stack">
    ${
      items.length
        ? ranklist({
            id: 's08-rl-ved',
            caption: `Основни бюджети по функцията, закон за ${yr(year)}`,
            unit: 'mln',
            sort: 'desc',
            categoryLabel: 'Бюджет',
            items,
          })
        : callout({
            kind: 'info',
            body: 'За тази функция няма основно ведомство. Тя събира разходите, които не се вписват в другите функции.',
          })
    }
    ${own ? html`<p class="s08-read" data-gl-scan>${own.text}</p>${src?.url ? html`<p>${ext(src.url, src.title)}</p>` : ''}` : ''}
  </div>`;
  return block({
    id: 's08-vedomstva',
    title,
    scope: MIN_SCOPE,
    status: 'real',
    source: own ? ['zdb', own.src] : ['zdb'],
    asOf: doc.meta?.asOf,
    sub:
      M.F.ministriesNote ||
      'Основните ведомства по функцията са ориентир, не счетоводно разпределение.',
    body,
  });
}

function notesBlock(ctx, M) {
  const F = M.F,
    X = ctx.data.expenditure;
  const note = (id) =>
    (Array.isArray(F.notes) ? F.notes.find((n) => n.id === id)?.text : F.notes?.[id]) ?? '';
  const items = [note('base'), note('col2025'), M.id === 'drugi' ? note('drugi') : ''].filter(
    Boolean,
  );
  items.push(annualSource(ctx, X, { sections: ['functions'], functionLabel: M.name }));
  return block({
    id: 's08-notes',
    title: 'Как да четеш числата',
    status: 'real',
    pill: false,
    report: false,
    source: ctx.data.expenditure.meta.source,
    share: false,
    body: html`<ul class="s08-notes" data-gl-scan>${items.map((t) => html`<li>${t}</li>`)}</ul>`,
  });
}

// ── page contract ──────────────────────────────────────────────────────────────────────────────────────
function ledeOf(ctx, M) {
  const what = FN_WHAT[M.id] ?? '';
  if (M.sel < 0 || !ok(M.val))
    return `За ${yr(ctx.period?.year)} няма разбивка по функции в избрания запис. ${what}`.trim();
  const v = money(M.val, { d: 1 }),
    y = yr(M.year),
    what1 = lower(M.short);
  const pg = ok(M.pgSel) ? `, или ${pct(M.pgSel, 1)} от БВП` : '';
  const first =
    {
      prelim: `Според програмата за ${y} за ${what1} са предвидени ${v}${pg}.`,
      plan: `Държавата планира да похарчи ${v} за ${what1} през ${y}${pg}.`,
      forecast: `Според прогнозата за ${what1} през ${y} ще бъдат похарчени ${v}${pg}.`,
    }[M.kinds[M.sel]] ?? `За ${what1} през ${y} са ${v}${pg}.`;
  return `${first} ${what}`.trim();
}

export function crumbs(ctx) {
  const M = modelOf(ctx, false);
  return M ? [{ label: 'Къде отиват парите?', href: ctx.href('S07') }, { label: M.short }] : null;
}

export function render(ctx) {
  if (
    ctx.params?.fn &&
    !ctx.data.expenditure.functions.items.some((item) => item.id === ctx.params.fn)
  )
    ctx.notFound();
  if (selectPeriod(ctx.annualRaw?.expenditure, ctx.period.key).gaps?.functions)
    return {
      title:
        ctx.data.expenditure.functions.items.find((item) => item.id === ctx.params.fn)?.name ||
        'Функция',
      body: annualGap(ctx, ctx.annualRaw.expenditure, ['functions']),
    };
  const M = modelOf(ctx, true);
  if (!M)
    return pendingState({
      title: 'Функция',
      text: 'Данните за разходите не са налични в момента.',
    });
  const intro = html`<p class="s08-read" data-gl-scan>Бюджетът дели разходите на девет ${gl('byudzhetna-funktsiya', 'функции')}: показва за какво са парите, а не кое ведомство ги харчи. Тук е една от тях. Всичките девет са на екрана „<a href="${ctx.href('S07')}">Къде отиват парите?</a>“.</p>`;
  const noCol = callout({
    kind: 'info',
    body: `За ${yr(ctx.period.year)} в избрания запис няма разбивка по функции. Избери ${ctx.period.year < 2025 ? '2025 г. или по-нова година' : 'друг период'}. По-долу са данните на Евростат за по-стари години.`,
  });
  return {
    title: M.name,
    eyebrow: 'Функция на бюджета',
    lede: ledeOf(ctx, M),
    context: 'Консолидирана фискална програма (КФП): разходи по функции',
    body: html`${unitSwitch(ctx, { name: 's08-unit', note: 'Важи за списъците и графиките.' })}
      ${intro}
      ${ok(M.val) ? html`${kpiBlock(ctx, M)}${partsBlock(ctx, M)}` : noCol}
      ${yearsBlock(ctx, M)}${cofogBlock(ctx, M)}${vedBlock(ctx, M)}${notesBlock(ctx, M)}`,
  };
}

export function mount(root, ctx) {
  return bindUnitSwitch(root, ctx, 's08-unit');
}
