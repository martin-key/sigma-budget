// S26 · За проекта · #/za-proekta · next S27, S01 · periods none
// An editorial reference page: mission, the two pillars, open code and data, the roadmap, the versions of the prototype, the open questions
// to the working group, a panel of „?demo=“ links and the status legend.
// The roadmap is built from the route table (so it cannot drift from the real screens) and the version facts from core.build / core.counts /
// core.pending. The page reads only `core`, which the shell always has, so it works with no data file at all. The shell frames for
// ?demo=loading|empty|error|pending|offline need no code here.
import { html, raw } from '../html.js';
import { date, num, plural } from '../format.js';
import { ROUTES, GROUPS, byId, byKey, href } from '../routes.js';
import { callout, facts, linkCard } from '../ui/cards.js';
import { chips } from '../ui/chips.js';
import { statusPill, legendBody } from '../ui/status.js';

export const needs = [];
export const styles = ['s26-za-proekta'];

/** the blocks of the page: one source for the headings and for the „На тази страница“ links (id = target of ?to=) */
const SECTIONS = [
  { id: 's26-mission', label: 'Мисия', title: 'Мисия' },
  { id: 's26-pillars', label: 'Два стълба', title: 'Двата стълба' },
  { id: 's26-open', label: 'Отворен код', title: 'Отворен код и данни' },
  { id: 's26-roadmap', label: 'Пътна карта', title: 'Пътна карта' },
  { id: 's26-versions', label: 'Версии', title: 'Версии на данните' },
  { id: 's26-questions', label: 'Въпроси', title: 'Въпроси към работната група' },
  { id: 's26-legend', label: 'Легенда', title: 'Легенда на статусите' },
  { id: 's26-credits', label: 'Авторите', title: 'Кой стои зад проекта' },
];
const TITLE = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));
const to = (id) => href('za-proekta', {}, { to: id }); // same-screen jump: the router scrolls, highlights and focuses the heading, no re-render

const link = (key, label, params, query) =>
  html`<a href="${href(key, params, query)}">${label ?? byKey[key]?.title ?? byId[key]?.title}</a>`;

/** the screen a nav-less child belongs to in the menu („Ведомство“ -> „Кой харчи?“) */
function menuTitle(id) {
  let r = byId[id];
  while (r && !r.nav && r.parent) r = byId[r.parent];
  return r?.title || '';
}

function block(id, body, o = {}) {
  return html`<section class="s26-block"${o.scan ? raw(' data-gl-scan') : ''}>
    <h2 id="${id}" tabindex="-1">${TITLE[id]}</h2>
    ${body}
  </section>`;
}

/* ------------------------------------------------------------------ 1 · mission, principles */

const SIX = ['S01', 'S06', 'S07', 'S15', 'S17', 'S18']; // the six questions of the portal (PLAN 1.1)
const PRINCIPLES = [
  ['Таблицата е равностойна на графиката.', 'До графиките има и таблица със същите числа.'],
  [
    'Източник за всяко бюджетно число.',
    'Показваме официалните стойности и произхода им. Където данните липсват, няма измислено число.',
  ],
  ['Нищо не напуска браузъра.', 'Без бисквитки, без проследяване и без заявки към външни сайтове.'],
];

const cardOf = (id) => {
  const r = byId[id];
  return linkCard({ href: href(r.key), title: r.title, text: r.desc, icon: r.icon });
};

const mission = () => html`
  <p class="s26-lead">„СИГМА Бюджет“ е портал с отворен код. Обяснява държавния бюджет на разбираем език, по официални данни.</p>
  <p>Порталът отговаря на шест въпроса. Всеки от тях има свой екран:</p>
  <div class="s26-cards">${SIX.map(cardOf)}</div>
  <h3 class="s26-h3">Как работим</h3>
  <ul class="s26-principles">${PRINCIPLES.map(([t, d]) => html`<li><strong>${t}</strong> ${d}</li>`)}</ul>`;

/* ------------------------------------------------------------------ 2 · pillars, layers */

function pillar(n, title, text, keys) {
  return html`<article class="s26-pillar">
    <p class="s26-kicker">Стълб ${n}</p>
    <h3 class="s26-h3">${title}</h3>
    <p>${text}</p>
    ${chips({ label: `Екрани от стълб ${n}`, items: keys.map((k) => ({ label: byKey[k].title, href: href(k) })) })}
  </article>`;
}

const pillars = () => html`
  <p>Основата са два стълба. Около тях има още три слоя.</p>
  <div class="s26-pillars">
    ${pillar(1, 'Бюджетът за годината', 'Законопроектът за 2027 г. и прогнозата за 2028–2029 г., заедно с приетия бюджет и отчетите за предходните години. Разходите са по функции, по вид разход и по ведомства и програми. Към тях са мерките в бюджета и техните публикувани ефекти.', ['prihodi', 'razhodi', 'vedomstva', 'merki'])}
    ${pillar(2, 'Изпълнението по месеци', 'Колко е събрано и изразходвано по месечните отчети, в сравнение със същия период на миналата година.', ['izpalnenie', 'novo'])}
  </div>
  <h3 class="s26-h3">Още три слоя</h3>
  <ul class="s26-layers">
    <li><strong>Учебен слой.</strong> ${link('5-minuti')} с връзки към подробностите, ${link('rechnik', 'речникът')} и пояснения на място, при самите числа.</li>
    <li><strong>Слой на доверието.</strong> До всяко число стоят източникът, обхватът, статусът (проект, закон, отчет, прогноза) и датата. Наборите са описани в „${link('danni')}“.</li>
    <li><strong>Следващи стъпки.</strong> Какво още предстои, пише в <a href="${to('s26-roadmap')}">пътната карта</a>.</li>
  </ul>`;

/* ------------------------------------------------------------------ 3 · open code and data */

const openData = () => html`
  <p>Порталът е с отворен код, а данните са обикновени файлове, които можеш да свалиш и да ползваш. Така всеки може да провери числото и да го използва в собствена работа.</p>
  <div class="s26-cards">${['S24', 'S25'].map(cardOf)}</div>
  <p>Лицензът на данните още не е избран. Решението зависи от това чий е порталът и е сред <a href="${to('s26-questions')}">въпросите към работната група</a>.</p>`;

/* ------------------------------------------------------------------ 4 · roadmap */

/** phase 1: every screen of the menu, by menu group (read from the route table) */
const mvpGroups = () =>
  GROUPS.filter((g) => g.id !== 'util')
    .map((g) => ({ g, items: ROUTES.filter((r) => r.group === g.id && r.nav && r.phase === 1) }))
    .filter((x) => x.items.length);

/** phase 2: the screens marked phase 2 in the route table, plus what has no screen of its own yet */
const phaseTwo = () => [
  {
    label: 'Дейности във функцията',
    text: 'По-подробен поглед към дейностите вътре във функцията. Липсва официален набор, затова не е в прототипа.',
  },
  {
    label: 'Индикатори за резултат',
    text: 'Цел и постигнато по програма. Липсва официален набор, затова не е в прототипа.',
  },
  {
    label: 'Финанси на общините',
    text: 'Собствени приходи и разходи на общините. В прототипа има само годишните трансфери от държавния бюджет.',
  },
  {
    label: 'Истински API',
    href: href('S25'),
    text: 'Постоянни адреси за данните, със версии. Засега е само предложение.',
  },
];

function waiting(core) {
  const items = Object.values(core.pending || {}).filter((p) => p && p.title);
  if (!items.length) return '';
  return html`<div class="s26-wait">
    <h3 class="s26-h3">Данни, които още чакаме</h3>
    <p>Тези данни съществуват при издателя, но още не са извлечени. Затова на екраните пише ${statusPill('pending')}, а не число.</p>
    <ul class="s26-wait-list">${items.map((p) => {
      const where = [...new Set((p.screens || []).map(menuTitle).filter(Boolean))];
      return html`<li><span class="s26-wait-t">${p.title}</span>${where.length ? html`<span class="s26-wait-s">Засяга: ${where.join(', ')}</span>` : ''}</li>`;
    })}</ul>
    <p>Защо всеки набор още липсва, пише в „${link('danni')}“.</p>
  </div>`;
}

const roadmap = (core) => html`
  <p>Разделението по-долу е предложение. Работната група трябва да го потвърди.</p>
  <div class="s26-road">
    <section class="s26-phase" aria-labelledby="s26-mvp-h">
      <h3 class="s26-h3" id="s26-mvp-h">Първа версия (MVP)</h3>
      <p>Екрани, които се строят върху официални данни. Където данните още липсват, пише „предстои“.</p>
      ${mvpGroups().map(
        ({ g, items }) => html`<div class="s26-grp">
        <p class="s26-grp-h">${g.label}</p>
        ${chips({ label: g.label, items: items.map((r) => ({ label: r.title, href: href(r.key) })) })}
      </div>`,
      )}
    </section>
    <section class="s26-phase s26-phase-2" aria-labelledby="s26-ph2-h">
      <h3 class="s26-h3" id="s26-ph2-h">Фаза 2</h3>
      <p>Теми, за които официални данни още няма или са непълни. Прототипът не ги показва, за да не измисля числа.</p>
      <ul class="s26-ph2">${phaseTwo().map((it) => html`<li><span class="s26-ph2-t">${it.href ? html`<a href="${it.href}">${it.label}</a>` : it.label}</span><span class="s26-ph2-s">${it.text}</span></li>`)}</ul>
    </section>
  </div>
  ${waiting(core)}`;

/* ------------------------------------------------------------------ 5 · versions */

const dateG = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${date(iso, true)} г.` : '');
function monthsText(n) {
  if (!Number.isFinite(n) || n < 1) return '';
  if (n === 1) return 'януари 2026 г.';
  if (n >= 12) return 'цялата 2026 г.';
  return `първите ${n} месеца на 2026 г.`;
}

function versions(core) {
  const b = core.build || {},
    c = core.counts || {};
  const latest = dateG(b.kfpLatest);
  const next = dateG(b.kfpNext);
  const inside = [
    Number.isFinite(c.budgets) &&
      plural(c.budgets, 'бюджет', 'бюджета') + ' на ведомства и институции',
    Number.isFinite(c.programs) && plural(c.programs, 'програма', 'програми'),
    Number.isFinite(c.measures) && plural(c.measures, 'мярка', 'мерки'),
    Number.isFinite(c.terms) && plural(c.terms, 'термин', 'термина') + ' в речника',
    Number.isFinite(c.municipalities) &&
      plural(c.municipalities, 'община', 'общини') + ' с годишни трансфери',
  ]
    .filter(Boolean)
    .join(', ');
  return html`
    <p>Данните са от официални източници; законопроектът и прогнозите са обозначени отделно от отчетите. Нищо от въведеното в сайта не напуска браузъра ти: няма бисквитки, проследяване и външни заявки.</p>
    ${facts(
      [
        { k: 'Версия на данните', v: b.dataVersion },
        { k: 'Данните са извлечени на', v: dateG(core.meta?.retrieved) },
        {
          k: 'Последен отчет на КФП',
          v:
            latest &&
            `към ${latest}${monthsText(b.kfpMonths2026) ? ` (${monthsText(b.kfpMonths2026)})` : ''}`,
        },
        {
          k: 'Следващ отчет',
          v: next && `към ${next}${core.pending?.P04 ? ' (още не е извлечен)' : ''}`,
        },
        {
          k: 'Курс на еврото',
          v: Number.isFinite(b.eurRate) && `1 € = ${num(b.eurRate, 5)} лв. (фиксиран)`,
        },
        { k: 'Какво има вътре', v: inside },
      ],
      { cls: 's26-facts' },
    )}`;
}

/* ------------------------------------------------------------------ 6 · questions to the working group (PLAN 9.2, neutral) */

const see = (key, label, params, query) => ({
  label: label ?? byKey[key]?.title,
  href: href(key, params, query),
});
const QUESTIONS = [
  {
    topic: 'Дълг: основният обхват.',
    text: 'Кой обхват да е основен: по Закона за държавния дълг (ЗДД) или по методиката на Маастрихт? В прототипа има превключвател, а по подразбиране е ЗДД.',
    see: [see('dalg')],
  },
  {
    topic: 'Калкулатор: осигуровки и ставки.',
    text: 'Осигуровките да са по функции на бюджета или отделно? Как да се смята 2026 г.: 7 месеца по досегашните правила и 5 по новите (от 1 август), или само по новите? Кой потвърждава ставките?',
    see: [see('danaci')],
  },
  {
    topic: 'Мерките по приетия закон.',
    text: 'Да проследяваме ли какво се променя при второто четене?',
    see: [see('zakon')],
  },
  {
    topic: 'Обхват на първата версия и на фаза 2.',
    text: 'Потвърждавате ли разделението от пътната карта?',
    see: [{ label: 'Пътна карта', href: to('s26-roadmap') }],
  },
  {
    topic: 'Визуален език и икони.',
    text: 'Одобрявате ли визуалния език и набора икони (Lucide)?',
    see: [],
  },
  {
    topic: 'Чий е порталът.',
    text: 'Държавен (МИДТ или МФ) или граждански? От отговора зависят тонът на текстовете, призивите към посетителите, бюлетинът, домейнът и лицензът на данните.',
    see: [see('api')],
  },
  { topic: 'Известия.', text: 'По какъв път да стигат: имейл, RSS или Viber?', see: [see('novo')] },
  {
    topic: 'Вносителите на предложенията.',
    text: 'Да показваме ли вносителите на 69-те предложения между първо и второ четене (информацията е публична) или само броя им и връзките?',
    see: [see('zakon')],
  },
  {
    topic: 'Отчети за по-ранни години.',
    text: 'Месечните отчети за 2022–2023 г. предстоят. Кой ще ги осигури? Има ли договорен достъп до Министерството на финансите?',
    see: [see('izpalnenie')],
  },
  {
    topic: 'Дейности във функциите.',
    text: 'Кой и кога ще подаде заявление по Закона за достъп до обществена информация (ЗДОИ) за дейностите? Без официален набор прототипът не ги показва.',
    see: [],
  },
  { topic: 'Английска версия.', text: 'Нужна ли е още в първата версия?', see: [] },
  {
    topic: 'Оценка на хода на изпълнението.',
    text: 'Прототипът не оцветява нищо като „изостава“ или „изпреварва“, защото няма официален график за годината. Нужен ли е такъв ориентир и кой го определя?',
    see: [see('izpalnenie')],
  },
  {
    topic: 'Роли „гражданин, журналист, експерт“.',
    text: 'В тази версия няма избор на роля, защото така препоръчва UX прегледът от 09.10. Не е решение на групата. Връщаме ли го?',
    see: [],
  },
];

const questions = () => html`
  <p>Тези въпроси чакат решение. Отговорите определят какво влиза в първата версия и как изглежда тя.</p>
  <ol class="s26-qs" role="list">${QUESTIONS.map(
    (q, i) => html`<li class="s26-q">
    <span class="s26-q-n" aria-hidden="true">${i + 1}</span>
    <div class="s26-q-body">
      <p><span class="s26-q-topic" data-gl-skip>${q.topic}</span> ${q.text}</p>
      ${q.see.length ? html`<p class="s26-q-see">Виж: ${q.see.map((s, j) => html`${j ? ', ' : ''}<a href="${s.href}">${s.label}</a>`)}</p>` : ''}
    </div>
  </li>`,
  )}</ol>
  <p class="s26-q-more">Имаш отговор или идея? <a href="${href('vrazka', {}, { type: 'idea', from: 'za-proekta' })}">Кажи ни</a>.</p>`;

/* ------------------------------------------------------------------ 7 · demo of the states */

const DEMOS = [
  {
    key: 'loading',
    label: 'Зареждане',
    text: 'Какво вижда посетителят, докато данните още идват.',
  },
  {
    key: 'empty',
    label: 'Празно',
    text: 'Какво вижда, когато избраният изглед няма какво да покаже.',
  },
  {
    key: 'error',
    label: 'Грешка',
    text: 'Какво се случва, когато данните не могат да се заредят. Има бутон „Опитай пак“.',
  },
  {
    key: 'pending',
    label: 'Предстои',
    text: 'За данни, които още не са извлечени. Без измислено число.',
  },
  {
    key: 'offline',
    label: 'Без връзка',
    text: 'Екранът остава, а най-горе пише, че няма връзка и от кога са запазените данни.',
  },
];
const MENU = GROUPS.filter((g) => g.id !== 'util')
  .map((g) => ({ label: g.label, items: ROUTES.filter((r) => r.group === g.id && r.nav) }))
  .filter((g) => g.items.length);
const DEFAULT_SCREEN = 'prihodi';
let lastScreen = DEFAULT_SCREEN; // the choice survives a re-render (a switch in the top bar redraws the page)

function demo(screenKey) {
  const r = byKey[screenKey] || byKey[DEFAULT_SCREEN];
  return html`
    <p>Всеки екран може да се види и без данни: със зареждане, с грешка, без връзка. Добави <code>?demo=</code> и името на състоянието в края на адреса на кой да е екран или избери екран тук.</p>
    <div class="field s26-demo-field">
      <label class="field-label" for="s26-demo-screen">На кой екран да се покаже?</label>
      <span class="select"><select id="s26-demo-screen" aria-describedby="s26-demo-hint">
        ${MENU.map((g) => html`<optgroup label="${g.label}">${g.items.map((x) => html`<option value="${x.key}"${x.key === r.key ? raw(' selected') : ''}>${x.title}</option>`)}</optgroup>`)}
      </select></span>
      <p class="field-hint" id="s26-demo-hint">Връзките по-долу се сменят с избора. Връщаш се с бутона „назад“ на браузъра.</p>
    </div>
    <ul class="s26-demo-list" role="list">${DEMOS.map(
      (d) => html`<li class="s26-demo-item">
      <a class="btn s26-demo-link" href="${href(r.key, {}, { demo: d.key })}" data-s26-demo="${d.key}">${d.label}<span class="sr-only"> на „<span data-s26-name>${r.title}</span>“</span></a>
      <p class="s26-demo-text">${d.text} <code class="s26-demo-code">?demo=${d.key}</code></p>
    </li>`,
    )}</ul>`;
}

/* ------------------------------------------------------------------ 8 · legend, credits */

const legend = () => html`
  <p>До числата стои белег, който казва колко е сигурно то. Ето какво означава всеки.</p>
  ${legendBody()}`;

const credits = () => html`
  <p>Проектът е на работна група „Бюджет на светло“.</p>
  <p>Речникът и пояснителните текстове са редакционни текстове на групата, не са официални данни. Числата идват от официалните източници, описани в „${link('danni')}“.</p>
  <p>Намери ли грешка или имаш идея, пиши ни през „${link('vrazka', 'Обратна връзка')}“.</p>`;

/* ------------------------------------------------------------------ screen */

export function render(ctx) {
  const core = ctx.core || {};
  return html`
    ${callout({ kind: 'info', title: 'Официални източници', body: html`<p>Бюджетните числа са от официални източници. Законопроектите, прогнозите и отчетите са обозначени със своя период и дата. Липсващите данни не се заменят с измислени стойности. Пътната карта и въпросите по-долу са предложение, не готови решения.</p>` })}
    <nav class="s26-toc" aria-label="На тази страница">${chips({ items: SECTIONS.map((s) => ({ label: s.label, href: to(s.id) })) })}</nav>
    ${block('s26-mission', mission(), { scan: true })}
    ${block('s26-pillars', pillars(), { scan: true })}
    ${block('s26-open', openData(), { scan: true })}
    ${block('s26-roadmap', roadmap(core))}
    ${block('s26-versions', versions(core), { scan: true })}
    ${block('s26-questions', questions(), { scan: true })}
    ${block('s26-legend', legend())}
    ${block('s26-credits', credits())}`;
}

/* ------------------------------------------------------------------ behaviour: the demo links follow the chosen screen */

export function mount(root, ctx) {
  const sel = root.querySelector('#s26-demo-screen');
  if (!sel) return undefined;
  const onChange = () => {
    const r = byKey[sel.value];
    if (!r) return;
    lastScreen = r.key;
    for (const a of root.querySelectorAll('[data-s26-demo]'))
      a.setAttribute('href', href(r.key, {}, { demo: a.dataset.s26Demo }));
    for (const n of root.querySelectorAll('[data-s26-name]')) n.textContent = r.title;
    ctx.announce(`Връзките сочат към „${r.title}“.`);
  };
  sel.addEventListener('change', onChange);
  return () => sel.removeEventListener('change', onChange);
}
