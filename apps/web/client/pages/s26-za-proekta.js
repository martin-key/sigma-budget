import { html, raw } from '../html.js';
import { date, num, plural } from '../format.js';
import { byId, byKey, href } from '../routes.js';
import { callout, facts, linkCard } from '../ui/cards.js';
import { chips } from '../ui/chips.js';
import { legendBody } from '../ui/status.js';

export const needs = [];
export const styles = ['s26-za-proekta'];

/** the blocks of the page: one source for the headings and for the „На тази страница“ links (id = target of ?to=) */
const SECTIONS = [
  { id: 's26-mission', label: 'Мисия', title: 'Мисия' },
  { id: 's26-pillars', label: 'Два стълба', title: 'Двата стълба' },
  { id: 's26-open', label: 'Отворен код', title: 'Отворен код и данни' },
  { id: 's26-versions', label: 'Версии', title: 'Версии на данните' },
  { id: 's26-legend', label: 'Легенда', title: 'Легенда на статусите' },
  { id: 's26-credits', label: 'Текстове и данни', title: 'Текстовете и данните' },
];
const TITLE = Object.fromEntries(SECTIONS.map((s) => [s.id, s.title]));
const to = (id) => href('za-proekta', {}, { to: id }); // same-screen jump: the router scrolls, highlights and focuses the heading, no re-render

const link = (key, label, params, query) =>
  html`<a href="${href(key, params, query)}">${label ?? byKey[key]?.title ?? byId[key]?.title}</a>`;

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
  <p>Основата са два стълба. Около тях има още два слоя.</p>
  <div class="s26-pillars">
    ${pillar(1, 'Бюджетът за годината', 'Законопроектът за 2027 г. и прогнозата за 2028–2029 г., заедно с приетия бюджет и отчетите за предходните години. Разходите са по функции, по вид разход и по ведомства и програми. Към тях са мерките в бюджета и техните публикувани ефекти.', ['prihodi', 'razhodi', 'vedomstva', 'merki'])}
    ${pillar(2, 'Изпълнението по месеци', 'Колко е събрано и изразходвано по месечните отчети, в сравнение със същия период на миналата година.', ['izpalnenie', 'novo'])}
  </div>
  <h3 class="s26-h3">Още два слоя</h3>
  <ul class="s26-layers">
    <li><strong>Учебен слой.</strong> ${link('5-minuti')} с връзки към подробностите, ${link('rechnik', 'речникът')} и пояснения на място, при самите числа.</li>
    <li><strong>Слой на доверието.</strong> До всяко число стоят източникът, обхватът, статусът (проект, закон, отчет, прогноза) и датата. Наборите са описани в „${link('danni')}“.</li>
  </ul>`;

/* ------------------------------------------------------------------ 3 · open code and data */

const openData = () => html`
  <p>Порталът е с отворен код, а данните са обикновени файлове, които можеш да свалиш и да ползваш. Така всеки може да провери числото и да го използва в собствена работа.</p>
  <div class="s26-cards">${['S24', 'S25'].map(cardOf)}</div>
  <p>Данните са публични: идват от официални документи и нямат отделен лиценз.</p>`;

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
          k: 'Курс на еврото',
          v: Number.isFinite(b.eurRate) && `1 € = ${num(b.eurRate, 5)} лв. (фиксиран)`,
        },
        { k: 'Какво има вътре', v: inside },
      ],
      { cls: 's26-facts' },
    )}`;
}

/* ------------------------------------------------------------------ 8 · legend, credits */

const legend = () => html`
  <p>До числата стои белег, който казва колко е сигурно то. Ето какво означава всеки.</p>
  ${legendBody()}`;

const credits = () => html`
  <p>Речникът и пояснителните текстове са редакционни текстове, не са официални данни. Числата идват от официалните източници, описани в „${link('danni')}“.</p>
  <p>Намери ли грешка или имаш идея, пиши ни през „${link('vrazka', 'Обратна връзка')}“.</p>`;

/* ------------------------------------------------------------------ screen */

export function render(ctx) {
  const core = ctx.core || {};
  return html`
    ${callout({ kind: 'info', title: 'Официални източници', body: html`<p>Бюджетните числа са от официални източници. Законопроектите, прогнозите и отчетите са обозначени със своя период и дата. Липсващите данни не се заменят с измислени стойности.</p>` })}
    <nav class="s26-toc" aria-label="На тази страница">${chips({ items: SECTIONS.map((s) => ({ label: s.label, href: to(s.id) })) })}</nav>
    ${block('s26-mission', mission(), { scan: true })}
    ${block('s26-pillars', pillars(), { scan: true })}
    ${block('s26-open', openData(), { scan: true })}
    ${block('s26-versions', versions(core), { scan: true })}
    ${block('s26-legend', legend())}
    ${block('s26-credits', credits())}`;
}
