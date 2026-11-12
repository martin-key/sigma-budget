import { cellValue, stateDebt } from '../budget-2027.js';
// S04 · Бюджетът за 5 минути · #/5-minuti · next S06, S03 · periods none
// V5: the former «Пътеводител» (S02) is merged in. Six short scenes with real numbers: (1) revenue against expenditure, (2) where the money comes
// from (100 € as a waffle), (3) where it goes (the functions), (4) deficit -> new debt -> debt, (5) the measures, (6) the execution to the latest
// month. Under each scene «Влез по-дълбоко» does what the guide did: it leads to the EXACT screen (and block) of that indicator, with the guide's own
// «На какво да внимаваш» note (data/guide.json, verbatim). The guide's closing «Петте проверки» ends the page. The old seventh scene (the way to the
// tax calculator) is gone by request; «Моите данъци» stays in the masthead.
// Every scene is a block(): the same heading, scope chip, status pill, source button and „Сподели“ as everywhere else, and `?to=s04-sceneN`
// jumps (the router scrolls, highlights and focuses the section). The pictures are plain HTML/CSS bars and a waffle, never the only
// carrier of a number: the label, the value and a legend are text, so the page reads the same without them.
// Numbers: only from core (kpis, functions, revenueGroups), execution (the 2025 pace), debt (limits, ZDD) and measures; all through the
// format helpers and view.amount, so „% от БВП“, „на човек“ and „и в лева“ apply. A failed optional file turns only its own scene into a note.
// Motion: bars and cells grow once when their scene scrolls into view; nothing moves under prefers-reduced-motion, and nothing is hidden first.
import { selectPeriod, DEFAULT_PERIOD } from '../periods.js';
import { planBasis } from '../exec.js';
import { apportion } from '../calc.js';
import { html, raw } from '../html.js';
import { num, pct, money, date, monthName, NBSP } from '../format.js';
import { byKey, byId, href as routeHref } from '../routes.js';
import { amount } from '../view.js';
import * as share from '../share.js';
import { block } from '../ui/block.js';
import { ranklist } from '../ui/ranklist.js';
import { steps } from '../ui/progress.js';
import { scopeChip } from '../ui/scope.js';
import { errorState } from '../ui/states.js';
import { gl } from '../ui/gl.js';

export const needs = [
  'core',
  'outlook',
  'revenue?',
  'expenditure?',
  'execution?',
  'measures?',
  'debt?',
  'budget2027?',
  'guide?',
];
export const styles = ['s04-5-minuti'];
const href = (id, params = {}, query = {}) => {
  const target = byId[id] || byKey[id];
  const primary = target?.periods === 'all' || target?.periods?.includes?.(DEFAULT_PERIOD);
  return routeHref(id, params, { ...(primary ? { per: DEFAULT_PERIOD } : {}), ...query });
};

const SCENES = [
  { id: 's04-scene1', nav: 'Приходи и разходи', title: 'Повече разходи, отколкото приходи' },
  { id: 's04-scene2', nav: 'Откъде идват парите', title: 'Откъде идват парите' },
  { id: 's04-scene3', nav: 'За какво отиват', title: 'За какво отиват парите' },
  { id: 's04-scene4', nav: 'Дефицит и дълг', title: 'От дефицит до дълг' },
  { id: 's04-scene5', nav: 'Мерките', title: 'Мерките в проекта за 2027 г.' },
  { id: 's04-scene6', nav: 'Изпълнението', title: 'Как върви изпълнението' },
];
const TOTAL = SCENES.length;
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const to = (id) => href('5-minuti', {}, { to: id }); // same-screen jump: the router scrolls, highlights and focuses the block, no re-render
const or = (s) => (s ? html`, или ${s}` : '');

/* ------------------------------------------------------------------ amounts in the visitor's unit */

/** an amount in the unit the visitor chose (euro | % of GDP | per person, + leva); `pctGdp` is what the „% от БВП“ switch needs */
function amt(ctx, mln, pctGdp, d = 1, scale) {
  const pg = ok(pctGdp) && Math.abs(pctGdp) >= 0.01 ? pctGdp : undefined; // a share that rounds to 0,00% is shown in euro instead
  if (ctx.store.get('unit') === 'pct' && pg !== undefined)
    return amount(ctx, { mln, pctGdp: pg, d: Math.abs(pg) < 1 ? 2 : 1 });
  const persons = ctx.data.core?.population?.persons;
  const dd =
    ctx.store.get('perPerson') && ok(persons) ? (Math.abs((mln * 1e6) / persons) < 10 ? 1 : 0) : d;
  return amount(ctx, { mln, d: dd, scale });
}
/** the same amount said the other way: euro next to „% от БВП“ and the share next to euro; `link` makes „БВП“ the glossary link (once per screen) */
function alt(ctx, mln, pctGdp, d = 1, link = false) {
  if (!ok(pctGdp)) return '';
  if (ctx.store.get('unit') === 'pct') return money(mln, { d });
  const p = pct(pctGdp, Math.abs(pctGdp) < 1 ? 2 : 1);
  return link ? html`${p}${NBSP}от${NBSP}${gl('bvp', 'БВП')}` : `${p}${NBSP}от${NBSP}БВП`;
}
const signed = (ctx, mln, pctGdp, d, scale) =>
  (mln > 0 ? '+' : '') + amt(ctx, mln, pctGdp, d, scale);

/** 100 cells for a list of shares that must add to 100 (largest remainder, so the waffle never has 99 or 101 squares) */
function cells100(shares) {
  const total = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map((s) => (s / total) * 100);
  const cells = exact.map(Math.floor);
  let left = 100 - cells.reduce((a, b) => a + b, 0);
  exact
    .map((e, i) => [e - cells[i], i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, left)
    .forEach(([, i]) => cells[i]++);
  return cells;
}

/** the table behind a picture: registered for the block's „Сподели“ (CSV) and named by data-attach on the figure */
const twin = (id, columns, rows, decimalColumns = []) => {
  share.attach(id, { table: () => ({ columns, rows, decimalColumns }) });
  return id;
};

/* ------------------------------------------------------------------ pieces */

/** one bar. The label and the value are text; the track is decoration (aria-hidden).
 *  o: {label, sub, value, kind 'rev'|'exp'|'data', fill 0..100, dash (indicative: dashed outline), gap (dashed continuation, 0..100), tick 0..100} */
function bar(o) {
  const w = (v) => Number(Math.min(100, Math.max(0, v)).toFixed(2));
  const fill = ok(o.fill) && o.fill > 0;
  return html`<div class="s04-bar" data-kind="${o.kind || 'data'}"${ok(o.gap) && o.gap > 0 ? raw(' data-has-gap') : ''}>
    <span class="s04-bar-l">${o.label}${o.sub ? html`<small>${o.sub}</small>` : ''}</span>
    <span class="s04-bar-v">${o.value}</span>
    <span class="s04-track" aria-hidden="true">${fill ? html`<span class="s04-fill" style="--w:${w(o.fill)}%"${o.dash ? raw(' data-dash') : ''}></span>` : ''}${ok(o.gap) && o.gap > 0 ? html`<span class="s04-gap" style="--off:${w(o.fill || 0)}%;--w:${w(o.gap)}%"></span>` : ''}${ok(o.tick) ? html`<span class="s04-tick" style="--at:${w(o.tick)}%"></span>` : ''}</span>
  </div>`;
}

/** «Влез по-дълбоко»: links to the exact screens (and blocks) of this scene's indicators + the guide's note for the step (verbatim from guide.json).
 *  links: [{href, title, text}]; stepNo: the guide step whose «На какво да внимаваш» belongs to the scene (0 = none) */
function deeper(ctx, n, stepNo, links) {
  const note = (ctx.data.guide?.steps || [])
    .find((x) => x.n === stepNo)
    ?.blocks?.find((b) => b.role === 'note');
  return html`<div class="s04-deep">
    <h3 class="s04-deep-h" id="s04-deep-${n}">Влез по-дълбоко</h3>
    <ul class="s04-deep-list">${links.map((l) => html`<li><a class="s04-deep-a" href="${l.href}"><span class="s04-deep-t">${l.title}</span><span class="s04-deep-x">${l.text}</span><span class="s04-deep-ar" aria-hidden="true">→</span></a></li>`)}</ul>
    ${note ? html`<details class="s04-deep-note"><summary>На какво да внимаваш</summary><p>${note.text}</p></details>` : ''}
  </div>`;
}

/** a scene = a block: steps strip, text column (glossary scan on), picture column, «Влез по-дълбоко», link to the next scene */
function scene(n, o) {
  const s = SCENES[n - 1],
    nx = SCENES[n];
  const body = html`<div class="s04-steps" aria-hidden="true">${steps({ current: n, total: TOTAL })}</div>
    <div class="s04-scene">
      <div class="s04-text" data-gl-scan>${o.text}</div>
      <div class="s04-vis">${o.visual}</div>
    </div>
    ${o.deep || ''}
    ${nx ? html`<p class="s04-go"><a href="${to(nx.id)}">Следваща сцена: ${nx.nav}<span aria-hidden="true"> →</span></a></p>` : ''}`;
  return block({
    id: s.id,
    title: o.title || s.title,
    level: 2,
    sub: `Сцена ${n} от ${TOTAL}`,
    scope: o.scope,
    status: o.status,
    source: o.source,
    asOf: o.asOf,
    share: o.share
      ? { text: o.share, period: o.period || '2027.draft', unit: o.unit || 'млн. €' }
      : undefined,
    body,
    cls: 's04-block',
  });
}

/** a scene whose own data did not come: one note in its place, the other scenes stay */
const failed = (n, text) =>
  block({
    id: SCENES[n - 1].id,
    title: SCENES[n - 1].title,
    level: 2,
    sub: `Сцена ${n} от ${TOTAL}`,
    status: false,
    cls: 's04-block',
    body: errorState({ title: 'Тази сцена не може да се покаже', text }),
  });
function guard(n, build) {
  try {
    return build();
  } catch (e) {
    console.error(`S04 scene ${n}`, e);
    return failed(n, 'Останалите сцени работят.');
  }
}

/* ------------------------------------------------------------------ 1 · revenue against expenditure */

function scene1(ctx, core) {
  const k = core.kpis,
    rev = k.revenue.planMln,
    exp = k.expenditure.planMln;
  const gap = ok(k.balance?.planMln) ? -k.balance.planMln : exp - rev;
  const g = (mln) => (mln / k.gdp?.mlnPrecise) * 100;
  const top = Math.max(rev, exp);
  const text = html`
    <p>През ${ctx.period.year} г. държавата планира да събере <strong>${amt(ctx, rev, g(rev))}</strong> приходи и да похарчи <strong>${amt(ctx, exp, g(exp))}</strong>.</p>
    <p>Разликата е <strong>${amt(ctx, gap, g(gap))}</strong>${or(alt(ctx, gap, g(gap), 1, true))}. Така се нарича ${gl('byudzheten-defitsit', 'дефицит')}: държавата харчи повече, отколкото получава.</p>`;
  const id = twin(
    's04-fig1',
    ['Показател', 'Стойност, млн. €'],
    [
      ['Приходи', rev],
      ['Разходи', exp],
      ['Дефицит', gap],
    ],
  );
  const visual = html`<figure class="s04-fig" data-attach="${id}">
    <div class="s04-bars">
      ${bar({ label: html`<a href="${href('prihodi')}">Приходи</a>`, value: amt(ctx, rev, g(rev)), kind: 'rev', fill: (rev / top) * 100, gap: (gap / top) * 100 })}
      ${bar({ label: html`<a href="${href('razhodi')}">Разходи</a>`, value: amt(ctx, exp, g(exp)), kind: 'exp', fill: (exp / top) * 100 })}
    </div>
    <figcaption class="s04-cap">Планирани приходи и разходи на КФП за ${ctx.period.year} г. Пунктираната част е дефицитът: разходи, за които няма приходи.</figcaption>
  </figure>`;
  const deep = deeper(ctx, 1, 1, [
    {
      href: href('izpalnenie'),
      title: byKey.izpalnenie.title,
      text: 'Колко е събрано и похарчено досега, и как се сравнява с миналата година.',
    },
    {
      href: href('izpalnenie', {}, { pokazatel: 'balance' }),
      title: 'Салдото месец по месец',
      text: 'Кога дефицитът расте и кога намалява.',
    },
  ]);
  return scene(1, {
    text,
    visual,
    deep,
    scope: 'kfp',
    source: ['budget2027'],
    asOf: selectPeriod(ctx.annualRaw?.outlook, ctx.period.key).publication,
    share: `През ${ctx.period.year} г. държавата планира приходи от ${money(rev, { d: 1 })} и разходи от ${money(exp, { d: 1 })}; разликата е дефицит от ${money(gap, { d: 1 })}.`,
  });
}

/* ------------------------------------------------------------------ 2 · where the money comes from (100 €) */

// The same colour for each source as on S06 (s06-prihodi.js, ED[id].c), so a tax looks the same on both screens.
const SOURCE_COLOR = {
  dds: 1,
  osiguritelni: 2,
  nedanachni: 3,
  pomoshti: 4,
  ddfl: 5,
  akcizi: 7,
  korporativen: 8,
};
function scene2(ctx, core) {
  // Largest first and „Други“ last, as in the S06 legend (the order in core is the one of another year).
  const groups = Array.isArray(core.revenueGroups)
    ? [...core.revenueGroups].sort(
        (x, y) => (x.id === 'drugi') - (y.id === 'drugi') || (y.share ?? -1) - (x.share ?? -1),
      )
    : [];
  if (!groups.length)
    return block({
      id: 's04-scene2',
      title: SCENES[1].title,
      status: 'pending',
      body: html`<p>${selectPeriod(ctx.annualRaw?.revenue, ctx.period.key).gaps?.groups || 'Няма данни за приходите.'}</p>`,
    });
  const gdp = core.kpis.gdp?.mlnPrecise;
  const cells = cells100(groups.map((g) => g.share ?? g.mln));
  const col = groups.map((g) => String(SOURCE_COLOR[g.id] ?? 'o')); // „others“ (and anything unknown) has the neutral colour
  const squares = groups.flatMap((g, i) =>
    Array.from({ length: cells[i] }, () => html`<span class="s04-cell" data-g="${col[i]}"></span>`),
  );
  const order = groups.map((g, i) => [cells[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const [a, b] = [groups[order[0][1]], groups[order[1][1]]];
  const bothTop = new Set([a.id, b.id]);
  const topTwo = order[0][0] + order[1][0];
  // the names are asserted only when the two biggest really are VAT and the social and health contributions
  const named =
    bothTop.has('dds') && bothTop.has('osiguritelni')
      ? html`<p>Двата най-големи източника — ${gl('dds', 'ДДС')} и социалните и здравните ${gl('osiguritelni-vnoski', 'осигуровки')} — дават заедно <strong>${topTwo} от всеки 100${NBSP}€</strong>.</p>`
      : '';
  const text = html`
    <p>Представи си, че всички приходи на държавата са <strong>100${NBSP}€</strong>. Ето откъде идват — всяко квадратче е 1${NBSP}€.</p>
    ${named}`;
  const id = twin(
    's04-fig2',
    ['Източник на приходите', 'Стойност, млн. €', 'Дял, %'],
    groups.map((g) => [g.name, g.mln, g.share]),
  );
  const visual = html`<figure class="s04-fig s04-fig-waffle" data-attach="${id}">
    <div class="s04-waffle" aria-hidden="true">${squares}</div>
    <ul class="s04-legend">${groups.map((g, i) => html`<li><span class="s04-sw" data-g="${col[i]}" aria-hidden="true"></span><span class="s04-lg-n"><a href="${href('prihodi', { source: g.id })}">${g.name}</a></span><span class="s04-lg-v"><strong>${cells[i]}${NBSP}€</strong><span class="s04-lg-a">${amt(ctx, g.mln, ok(gdp) ? (g.mln / gdp) * 100 : undefined)}</span></span></li>`)}</ul>
    <figcaption class="s04-cap">Приходи на КФП за ${ctx.period.year} г. по видове. Дяловете са закръглени до цели евро така, че да се събират точно до 100${NBSP}€.</figcaption>
  </figure>`;
  const deep = deeper(ctx, 2, 2, [
    {
      href: href('prihodi'),
      title: byKey.prihodi.title,
      text: 'Всичките осем източника, по години и в таблица.',
    },
    {
      href: href('prihodi', { source: a.id }),
      title: a.name,
      text: 'Най-големият източник: кой го плаща и какво значи за теб.',
    },
  ]);
  return scene(2, {
    text,
    visual,
    deep,
    scope: 'kfp',
    source: ['budget2027'],
    asOf: selectPeriod(ctx.annualRaw?.outlook, ctx.period.key).publication,
    share: `От всеки 100 € приходи на КФП през ${ctx.period.year} г.: ${groups.map((g, i) => `${cells[i]} € — ${g.name}`).join('; ')}.`,
  });
}

/* ------------------------------------------------------------------ 3 · where it goes (the functions) */

function scene3(ctx, core) {
  const sorted = [...(core.functions || [])].filter((f) => ok(f.mln)).sort((x, y) => y.mln - x.mln);
  // The shares are apportioned to 100,0 exactly as on S07 („Къде отиват парите?“), so both screens print the same percentage.
  const fnShares = apportion(
    sorted.map((f) => f.mln),
    100,
    1,
  );
  const fns = sorted.map((f, i) => ({ ...f, share: fnShares[i] }));
  if (!fns.length)
    return block({
      id: 's04-scene3',
      title: SCENES[2].title,
      status: 'pending',
      body: html`<p>${selectPeriod(ctx.annualRaw?.expenditure, ctx.period.key).gaps?.functions || 'Няма данни за разходите по функции.'}</p>`,
    });
  const k = core.kpis,
    gdp = k.gdp?.mlnPrecise;
  const top = fns[0];
  const sum = fns.reduce((s, f) => s + f.mln, 0);
  const eu = ctx.data.expenditure?.economic?.rows?.find((r) => r.id === 'x.eucontrib')?.mln?.[
    ctx.data.expenditure?.periodKeys?.indexOf(ctx.period.key)
  ];
  // the EU contribution is the one line of the expenditure that is not a function: it is said only when the parts really add up to the total
  const euLine =
    ok(eu) && Math.abs(sum + eu - k.expenditure.planMln) < 0.2
      ? html`<p>Към тях се добавя вноската на България в бюджета на ЕС — <strong>${amt(ctx, eu, ok(gdp) ? (eu / gdp) * 100 : undefined)}</strong>. Така общите разходи са ${amt(ctx, k.expenditure.planMln, ok(gdp) ? (k.expenditure.planMln / gdp) * 100 : undefined)}.</p>`
      : '';
  const text = html`
    <p>Разходите са разпределени по ${gl('byudzhetna-funktsiya', 'функции')}: според това за какво се използват парите.</p>
    <p>Най-голямата е „${top.short || top.name}“: <strong>${amt(ctx, top.mln, top.pctGdp)}</strong> — ${pct(top.share, 1)} от разходите по функции.</p>
    ${euLine}
    <p>Кои министерства и ведомства харчат тези пари — виж <a href="${href('vedomstva')}">„${byKey.vedomstva.title}“</a>.</p>`;
  const visual = ranklist({
    id: 's04-fn',
    caption: `Разходи на КФП по функции за ${ctx.period.year} г.`,
    unit: 'mln',
    d: ctx.store.get('perPerson') ? 0 : 1,
    categoryLabel: 'Функция',
    items: fns.map((f) => ({
      label: f.short || f.name,
      value: f.mln,
      share: f.share,
      pctGdp: f.pctGdp,
      href: href('funkciya', { fn: f.id }),
    })),
  });
  const deep = deeper(ctx, 3, 3, [
    {
      href: href('razhodi'),
      title: byKey.razhodi.title,
      text: 'Разходите по функции, по вид и по години.',
    },
    {
      href: href('funkciya', { fn: top.id }),
      title: top.short || top.name,
      text: 'Най-голямата функция: от какво се състои.',
    },
    {
      href: href('vedomstva'),
      title: byKey.vedomstva.title,
      text: 'Министерствата и другите бюджети, и програмите им.',
    },
  ]);
  return scene(3, {
    text,
    visual,
    deep,
    scope: 'kfp',
    source: ['budget2027'],
    asOf: selectPeriod(ctx.annualRaw?.outlook, ctx.period.key).publication,
    share: `Най-голямата функция на разходите за ${ctx.period.year} г. е „${top.short || top.name}“: ${money(top.mln, { d: 1 })} (${pct(top.share, 1)} от разходите по функции).`,
  });
}

/* ------------------------------------------------------------------ 4 · deficit -> new debt -> debt */

function scene4(ctx, core) {
  if (ctx.period.key === '2027.draft') {
    const doc = ctx.data.budget2027,
      d = stateDebt(doc, ctx.period.key),
      lim = doc?.debtLimits?.['68'];
    return block({
      id: 's04-scene4',
      title: 'От дефицит до дълг',
      source: ['budget2027'],
      asOf: doc?.publication,
      status: 'forecast',
      statusLabel: 'Проект и прогноза',
      share: { period: '2027.draft' },
      body: html`<p>Прогнозният държавен дълг по ЗДД към края на 2027 г. е ${money(cellValue(d?.total))}. Проектът допуска ново заемане до ${num(cellValue(lim), 1)} млрд. евро по чл. 68. Това е предложена горна граница, не прогноза и не приет закон.</p><p><a href="${href('dalg', {}, { per: '2027.draft' })}">Дългът и предложените граници за 2027 г.</a></p>`,
    });
  }
  const debt = ctx.data.debt;
  if (!debt) return failed(4, 'Данните за дълга не се заредиха.');
  const k = core.kpis,
    gdp = k.gdp?.mlnPrecise;
  const g = (mln) => (ok(gdp) ? (mln / gdp) * 100 : undefined);
  const gap = ok(k.balance?.planMln)
    ? -k.balance.planMln
    : k.expenditure.planMln - k.revenue.planMln;
  const lim = debt.limits?.items?.find((i) => i.id === 'newDebt');
  if (!lim || !ok(lim.mln)) return failed(4, 'Границата за ново заемане не се зареди.');
  const safe = ok(lim.includesMln) ? lim : null;
  const now = debt.latest?.zdd,
    plan = now?.next;
  const d26 = ok(plan?.mln)
    ? plan
    : { mln: k.debt.zddMln, pctGdp: k.debt.pctGdp, year: k.debt.year };
  const text = html`
    <p>Когато разходите са повече от приходите, държавата трябва да покрие разликата. Един от начините е да заеме пари. Така се образува ${gl('nov-dalg-novo-zaemane', 'нов дълг')}, а натрупаните заеми са ${gl('darzhaven-dalg', 'държавният дълг')}.</p>
    <p>Законът за държавния бюджет определя най-много колко нов дълг може да се поеме през ${debt.limits.year ?? d26.year} г.: <strong>${amt(ctx, lim.mln, g(lim.mln))}</strong>. Това е горна граница, не <span data-gl-skip>прогноза</span>.${safe ? html` В нея влиза и ${amt(ctx, safe.includesMln, g(safe.includesMln))} по инструмента „Мерки за сигурността на Европа (SAFE)“.` : ''}</p>
    <p>Новото заемане и дефицитът не са едно и също: част от заетото може да се използва за връщане на стари заеми. Подробно — на екрана <a href="${href('dalg')}">„${byKey.dalg.title}“</a>.</p>`;
  const prev = ok(now?.mln)
    ? html`<span class="s04-card-s">В края на ${now.year} г.: ${amt(ctx, now.mln, now.pctGdp)}${or(alt(ctx, now.mln, now.pctGdp))}</span>`
    : '';
  const id = twin(
    's04-fig4',
    ['Показател', 'Стойност, млн. €'],
    [
      ['Дефицит на КФП, план 2026', gap],
      [`Най-много ново заемане през ${debt.limits.year ?? d26.year} г. (горна граница)`, lim.mln],
      [`Държавен дълг по ЗДД, край на ${d26.year} г. (проект)`, d26.mln],
      ...(ok(now?.mln) ? [[`Държавен дълг по ЗДД, край на ${now.year} г. (отчет)`, now.mln]] : []),
    ],
  );
  const visual = html`<figure class="s04-fig s04-fig-chain" data-attach="${id}">
    <ol class="s04-chain">
      <li class="s04-card">
        <span class="s04-card-k">Дефицит ${scopeChip('kfp')}</span>
        <strong class="s04-card-v">${amt(ctx, gap, g(gap))}</strong>
        <span class="s04-card-s">Разликата между разходите и приходите.</span>
        <a class="s04-card-a" href="${href('dalg', {}, { to: 's17-b-balance' })}">Колко е дефицитът<span aria-hidden="true"> →</span></a>
      </li>
      <li class="s04-card" data-ceiling>
        <span class="s04-card-k">Ново заемане, най-много</span>
        <strong class="s04-card-v">до ${amt(ctx, lim.mln, g(lim.mln))}</strong>
        <span class="s04-card-s">Горна граница по закона, не прогноза.</span>
        <a class="s04-card-a" href="${href('dalg', {}, { to: 's17-b-newdebt' })}">Колко нов дълг се поема<span aria-hidden="true"> →</span></a>
      </li>
      <li class="s04-card">
        <span class="s04-card-k">Държавен дълг към края на ${d26.year} г. ${scopeChip('zdd')}</span>
        <strong class="s04-card-v">${amt(ctx, d26.mln, d26.pctGdp)}</strong>
        <span class="s04-card-s">${alt(ctx, d26.mln, d26.pctGdp) ? html`${alt(ctx, d26.mln, d26.pctGdp)}. ` : ''}По проекта на бюджета.</span>
        ${prev}
        <a class="s04-card-a" href="${href('dalg', {}, { to: 's17-b-zdd' })}">Как се променя дългът<span aria-hidden="true"> →</span></a>
      </li>
    </ol>
    <figcaption class="s04-cap">Трите числа не се събират едно с друго: границата е таван, а дългът се променя и от връщането на стари заеми.</figcaption>
  </figure>`;
  const deep = deeper(ctx, 4, 7, [
    {
      href: href('dalg'),
      title: byKey.dalg.title,
      text: 'Държавният дълг по две методики, лихвите и откъде се покрива дефицитът.',
    },
    {
      href: href('dalg', {}, { to: 's17-b-confuse' }),
      title: 'Дефицит, нов дълг и дълг',
      text: 'Три различни числа за една и съща тема: с какво се различават.',
    },
  ]);
  return scene(4, {
    text,
    visual,
    deep,
    scope: 'zdd',
    source: ['zdb', 'asbp'],
    asOf: debt.limits.asOf,
    share: `Законът допуска ново заемане до ${money(lim.mln, { d: 1 })} през ${debt.limits.year ?? d26.year} г. Това е горна граница, не прогноза.`,
  });
}

/* ------------------------------------------------------------------ 5 · the measures */

function scene5(ctx) {
  if (ctx.period.key === '2027.draft') {
    const doc = ctx.data.budget2027,
      rev = doc?.forecast?.II_7?.at(-1)?.cells?.[0],
      exp = doc?.forecast?.II_8?.at(-1)?.cells?.[0];
    const id = twin(
      's04-fig5-2027',
      ['Показател', 'Ефект 2027, млн. €', 'Произход'],
      [
        ['Приходни мерки: общ ред II-7', cellValue(rev), rev?.provenance],
        ['Разходни мерки: общ ред II-8', cellValue(exp), exp?.provenance],
      ],
    );
    return block({
      id: 's04-scene5',
      title: 'Мерките в проекта за 2027 г.',
      scope: {
        key: 'fiscal-measures',
        label: 'Фискални мерки',
        long: 'Приходни и разходни мерки по АСБП 2027–2029',
      },
      source: ['budget2027'],
      asOf: doc?.publication,
      status: 'real',
      statusLabel: 'Проект 2027',
      share: { period: '2027.draft', unit: 'млн. €' },
      body: html`<div data-attach="${id}"><p>Отпечатаният общ ефект за 2027 г. е ${money(cellValue(rev))} за приходните мерки (таблица II-7) и ${money(cellValue(exp))} за разходните мерки (таблица II-8). Това са предложени мерки в АСБП 2027–2029.</p><p><a href="${href('S12', {}, { per: '2027.draft' })}">Всички мерки и годишните им ефекти за 2027–2029</a></p></div>`,
    });
  }
  const m = ctx.data.measures;
  if (!m) return failed(5, 'Данните за мерките не се заредиха.');
  const t = m.totals,
    c = m.counts?.short;
  if (!t || !c || ![t.revenueMln, t.expenditureMln, t.expenditureMlnWithoutIndicative].every(ok))
    return failed(5, 'Данните за мерките са непълни.');
  const gdp = ctx.data.core.kpis.gdp?.mlnPrecise;
  const g = (mln) => (ok(gdp) ? (mln / gdp) * 100 : undefined);
  const indicative = t.expenditureMln - t.expenditureMlnWithoutIndicative; // negative: the part of the cuts that is only an indicative amount
  const withSum = c.revenue + c.expenditure;
  const big = (m.items || [])
    .filter(
      (i) =>
        i.tab === 'short' &&
        i.estimateKind === 'stated' &&
        ok(i.effectMln?.['2026']) &&
        Math.abs(i.effectMln['2026']) >= 200,
    )
    .sort((x, y) => Math.abs(y.effectMln['2026']) - Math.abs(x.effectMln['2026']));
  const scale = Math.max(
    Math.abs(t.revenueMln),
    Math.abs(t.expenditureMlnWithoutIndicative),
    Math.abs(indicative),
    ...big.map((i) => Math.abs(i.effectMln['2026'])),
  );
  const stage = (m.notes || []).find((n) => n.id === 'stage');
  const text = html`
    <p>Освен общите числа, в бюджета има конкретни мерки: едни носят допълнителни приходи, други ограничават разходи.</p>
    <p>Краткосрочните мерки са ${num(c.all, 0)}; за ${num(withSum, 0)} от тях има оценка в пари. Приходните носят <strong>${signed(ctx, t.revenueMln, g(t.revenueMln), 1, 'mln')}</strong>, а разходните намаляват разходите с <strong>${amt(ctx, -t.expenditureMln, g(-t.expenditureMln), 1, 'mln')}</strong>. От тях ${amt(ctx, -indicative, g(-indicative), 1, 'mln')} са индикативни суми — ориентир, а по едната мярка е избегнат разход, не намаление на сегашен.</p>
    <p>Всички мерки и кого засягат — в <a href="${href('merki')}">„${byKey.merki.title}“</a>.</p>`;
  // the first three rows add up to the total; the rows below them are single measures already counted in those totals
  const rows = [
    ['общо', 'Приходни мерки', 'приход', t.revenueMln],
    ['общо', 'Разходни мерки със сума', 'разход', t.expenditureMlnWithoutIndicative],
    ['общо', 'Разходни мерки с индикативна сума', 'разход', indicative],
    ...big.map((i) => [
      'отделна мярка (вече е в общите суми)',
      i.name,
      i.kind === 'revenue' ? 'приход' : 'разход',
      i.effectMln['2026'],
    ]),
  ];
  const id = twin('s04-fig5', ['Равнище', 'Мерки', 'Вид', 'Ефект 2026, млн. €'], rows);
  const kindOf = (k) => (k === 'revenue' ? 'rev' : 'exp');
  const visual = html`<figure class="s04-fig" data-attach="${id}">
    <div class="s04-group">
      <p class="s04-group-t">Общо по вид</p>
      <div class="s04-bars">
        ${bar({ label: 'Приходни мерки', value: signed(ctx, t.revenueMln, g(t.revenueMln), 1, 'mln'), kind: 'rev', fill: (Math.abs(t.revenueMln) / scale) * 100 })}
        ${bar({ label: 'Разходни мерки със сума', value: signed(ctx, t.expenditureMlnWithoutIndicative, g(t.expenditureMlnWithoutIndicative), 1, 'mln'), kind: 'exp', fill: (Math.abs(t.expenditureMlnWithoutIndicative) / scale) * 100 })}
        ${bar({ label: 'Разходни мерки с индикативна сума', sub: 'ориентир, не посочена сума', value: signed(ctx, indicative, g(indicative), 1, 'mln'), kind: 'exp', dash: true, fill: (Math.abs(indicative) / scale) * 100 })}
      </div>
    </div>
    ${
      big.length
        ? html`<div class="s04-group">
      <p class="s04-group-t">Най-големите мерки със сума (поне 200${NBSP}млн.${NBSP}€)</p>
      <div class="s04-bars">${big.map((i) =>
        bar({
          label: html`<a href="${href('merki', { id: i.id })}">${i.name}</a>`,
          sub: i.kind === 'revenue' ? 'приходна мярка' : 'разходна мярка',
          value: signed(ctx, i.effectMln['2026'], g(i.effectMln['2026']), 1, 'mln'),
          kind: kindOf(i.kind),
          fill: (Math.abs(i.effectMln['2026']) / scale) * 100,
        }),
      )}</div>
    </div>`
        : ''
    }
    <figcaption class="s04-cap">Ефект на мерките през 2026 г.: плюс — повече приходи, минус — по-малко разходи. Пунктираната лента е индикативна сума.${stage ? html` ${stage.text}` : ''}</figcaption>
  </figure>`;
  const deep = deeper(ctx, 5, 4, [
    {
      href: href('merki'),
      title: byKey.merki.title,
      text: 'Приходните и разходните мерки: какво се променя, от кога и какъв е ефектът.',
    },
    ...(big[0]
      ? [
          {
            href: href('merki', { id: big[0].id }),
            title: big[0].name,
            text: 'Най-голямата мярка със сума: подробности.',
          },
        ]
      : []),
  ]);
  return scene(5, {
    text,
    visual,
    deep,
    source: ['asbp', 'bill'],
    asOf: m.meta?.asOf,
    share: `Краткосрочните мерки в бюджета за 2026 г.: приходните носят ${money(t.revenueMln, { d: 1 })}, а разходните намаляват разходите с ${money(-t.expenditureMln, { d: 1 })}, от които ${money(-indicative, { d: 1 })} са индикативни суми.`,
  });
}

/* ------------------------------------------------------------------ 6 · the execution to the latest month */

function scene6(ctx, core) {
  const basis = planBasis(ctx.data.execution || {});
  const k = core.kpis,
    executionYear = Number(String(k.asOf).slice(0, 4)),
    r = k.revenue,
    e = k.expenditure,
    b = k.balance;
  if (![r.execMln, e.execMln].every(ok)) return failed(6, 'Няма данни за изпълнението.');
  if (![r.execPct, e.execPct].every(ok))
    return failed(6, 'Няма наличен положителен знаменател за процента на изпълнение.');
  const gdp =
    selectPeriod(ctx.annualRaw?.outlook, `${executionYear}.expected`).series?.gdp?.value ?? null;
  const g = (mln) => (ok(gdp) ? (mln / gdp) * 100 : undefined);
  const mi = ok(k.month) ? k.month - 1 : -1;
  const pace = ctx.data.execution?.pace?.['2025'];
  const paceRev = pace?.rev?.[mi],
    paceExp = pace?.['exp.total']?.[mi];
  const asOf = k.asOf,
    mon = ok(k.month) ? monthName(k.month) : '';
  const balShare = null;
  const yoy = ok(r.yoyPct) && ok(e.yoyPct);
  const text = html`
    ${ctx.store.get('unit') === 'pct' ? html`<p>Дяловете от БВП са спрямо прогнозния БВП за ${executionYear} г. от публикацията на МФ от 06.11.2026, не спрямо БВП за 2027 г.</p>` : ''}
    <p>${mon ? html`До края на ${mon}` : 'Към последния отчет'} са събрани <strong>${amt(ctx, r.execMln, g(r.execMln))}</strong> приходи, или ${pct(r.execPct, 1)}${NBSP}от${NBSP}плана за годината. Похарчени са <strong>${amt(ctx, e.execMln, g(e.execMln))}</strong>, или ${pct(e.execPct, 1)}${NBSP}от${NBSP}плана.</p>
    <p>${yoy ? html`Спрямо същите месеци на 2025 г. приходите са с ${pct(r.yoyPct, 1)} повече, а разходите — с ${pct(e.yoyPct, 1)} повече. ` : ''}${ok(b?.execMln) ? html`Дефицитът дотук е <strong>${amt(ctx, -b.execMln, g(-b.execMln))}</strong>${balShare !== null ? html` — ${pct(balShare, 1)}${NBSP}от${NBSP}планирания за цялата година` : ''}.` : ''}</p>
    <p>${ok(paceRev) && ok(paceExp) ? html`Приходите и разходите не постъпват равно през годината (${gl('sezonnost', 'сезонност')}). Чертата е ориентир: делът от цялата 2025 г. до същия месец — ${pct(paceRev, 1)} от приходите и ${pct(paceExp, 1)} от разходите. ` : ''}Повече — в <a href="${href('izpalnenie')}">„${byKey.izpalnenie.title}“</a>.</p>`;
  const canonical = ctx.data.execution?.canonical?.latest?.kfp;
  const exportValue = (id, key, fallback) => canonical?.[id]?.[key] ?? fallback;
  const id = twin(
    's04-fig6',
    [
      'Показател',
      `Към ${date(asOf)}, млн. €`,
      'Годишен план, млн. €',
      'Изпълнение, % от плана',
      'Дял от 2025 г. до същия месец, %',
    ],
    [
      [
        'Приходи',
        exportValue('rev', 'cum', r.execMln),
        exportValue('rev', 'plan', r.planMln),
        r.execPct,
        paceRev ?? null,
      ],
      [
        'Разходи',
        exportValue('exp.total', 'cum', e.execMln),
        exportValue('exp.total', 'plan', e.planMln),
        e.execPct,
        paceExp ?? null,
      ],
    ],
    [1, 2],
  );
  const row = (label, kind, x, tick, item) =>
    bar({
      label: html`<a href="${href('izpalnenie', {}, { pokazatel: item })}">${label}</a>`,
      kind,
      fill: x.execPct,
      tick,
      value: html`<strong>${amt(ctx, x.execMln, g(x.execMln))}</strong> <span class="s04-bar-p">${pct(x.execPct, 1)}${NBSP}от${NBSP}плана</span>`,
    });
  const visual = html`<figure class="s04-fig" data-attach="${id}">
    <div class="s04-bars">${row('Приходи', 'rev', r, paceRev, 'rev')}${row('Разходи', 'exp', e, paceExp, 'exp.total')}</div>
    <figcaption class="s04-cap">${basis.citation}. Изпълнение на плана към ${date(asOf, true)}. ${ok(paceRev) && ok(paceExp) ? ' Чертата: делът от 2025 г. до същия месец.' : ''}</figcaption>
  </figure>`;
  const deep = deeper(ctx, 6, 6, [
    {
      href: href('izpalnenie'),
      title: byKey.izpalnenie.title,
      text: 'Две години един до друг за един и същ период.',
    },
    {
      href: href('izpalnenie', {}, { to: 's15-b-plan' }),
      title: 'Изпълнява ли се планът',
      text: 'Приходи, разходи и капиталови разходи: план срещу изпълнение.',
    },
  ]);
  return scene(6, {
    text,
    visual,
    deep,
    title: `Изпълнението през ${executionYear} г.`,
    period: ctx.data.execution?.plan2026?.periodKey || `${executionYear}.draft`,
    scope: 'kfp',
    source: basis.source,
    asOf,
    share: `${basis.citation}. Към ${date(asOf, true)} са изпълнени ${pct(r.execPct, 1)} от плана за приходите и ${pct(e.execPct, 1)} от плана за разходите.`,
  });
}

/* ------------------------------------------------------------------ the guide's closing: the five checks (verbatim from guide.json) */

/** the sentence stays verbatim; the quoted name of the screen it mentions becomes a link */
function withLink(text, phrase, to) {
  const i = String(text).indexOf(phrase);
  if (i < 0) return text;
  return html`${text.slice(0, i)}<a href="${to}">${phrase}</a>${text.slice(i + phrase.length)}`;
}

function checks(ctx) {
  const c = ctx.data.guide?.checks;
  if (!c || !Array.isArray(c.items) || !c.items.length) return '';
  const body = html`<p class="s04-checks-lead">${c.lead}</p>
    <ol class="s04-checks-list">${c.items.map((it) => html`<li><span class="s04-checks-n" aria-hidden="true">${it.n}</span><span class="s04-checks-short">${it.short}<span class="sr-only">: </span></span><span class="s04-checks-text">${it.text}</span></li>`)}</ol>
    <p class="s04-checks-end">${withLink(c.end, 'Откъде са данните?', href('S24'))}</p>`;
  return block({
    id: 's04-checks',
    title: c.title,
    level: 2,
    sub: c.heading,
    status: 'text',
    body,
    cls: 's04-block s04-checks',
  });
}

/* ------------------------------------------------------------------ the page */

export function render(ctx) {
  const core = ctx.data.core;
  const nav = html`<nav class="s04-nav" aria-label="Сцени на екрана"><ol>${SCENES.map((s, i) => html`<li><a href="${to(s.id)}"><span class="s04-nav-n" aria-hidden="true">${i + 1}</span>${s.nav}</a></li>`)}</ol></nav>`;
  return html`<div class="s04">
    <div class="s04-top" data-gl-scan>
      <p class="s04-lead">Проектът за бюджет 2027 и прогнозата до 2029 г. Месечните отчети показват изпълнението за 2026 г. Чете се за около пет минути.</p>
      <p class="s04-basis">Числата са в евро. Годишните числа са от проекта на МФ за 2027 г., публикуван на 06.11.2026. Историческите мерки и месечните отчети са обозначени със своята година. Какво промени приетият закон — на екрана <a href="${href('zakon')}">„${byKey.zakon.title}“</a>.</p>
    </div>
    ${nav}
    ${guard(1, () => scene1(ctx, core))}
    ${guard(2, () => scene2(ctx, core))}
    ${guard(3, () => scene3(ctx, core))}
    ${guard(4, () => scene4(ctx, core))}
    ${guard(5, () => scene5(ctx))}
    ${guard(6, () => scene6(ctx, ctx.annualRaw?.core || core))}
    ${checks(ctx)}
  </div>`;
}

/* ------------------------------------------------------------------ motion: bars and cells grow once when their scene scrolls into view */

export function mount(root) {
  if (
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    !('IntersectionObserver' in window) ||
    typeof Element.prototype.animate !== 'function'
  )
    return undefined;
  const anims = [];
  const play = (vis) => {
    let i = 0;
    vis.querySelectorAll('.s04-fill, .s04-gap').forEach((el) =>
      anims.push(
        el.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
          duration: 650,
          delay: 90 * i++,
          easing: 'cubic-bezier(.2,.7,.2,1)',
          fill: 'backwards',
        }),
      ),
    );
    vis.querySelectorAll('.s04-tick').forEach((el) =>
      anims.push(
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 300,
          delay: 650 + 90 * i,
          fill: 'backwards',
        }),
      ),
    );
    vis.querySelectorAll('.s04-cell').forEach((el, n) =>
      anims.push(
        el.animate(
          [
            { opacity: 0, transform: 'scale(.4)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 260, delay: n * 7, easing: 'ease-out', fill: 'backwards' },
        ),
      ),
    );
    vis.querySelectorAll('.s04-card').forEach((el, n) =>
      anims.push(
        el.animate(
          [
            { opacity: 0, transform: 'translateY(10px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 400, delay: n * 160, easing: 'ease-out', fill: 'backwards' },
        ),
      ),
    );
  };
  // a picture that is already on screen when the page opens stays as it is (nothing flashes); only the ones that scroll in later grow
  const seen = new WeakSet();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const first = !seen.has(e.target);
        seen.add(e.target);
        if (e.isIntersecting) {
          io.unobserve(e.target);
          if (!first) play(e.target);
        }
      }
    },
    { threshold: 0.25 },
  );
  root.querySelectorAll('.s04-vis').forEach((v) => io.observe(v));
  return () => {
    io.disconnect();
    anims.forEach((a) => a.cancel());
  };
}
