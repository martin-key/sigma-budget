// The copy of the two legal pages, S36 „Поверителност“ (/poveritelnost) and S37 „Условия за ползване“ (/usloviya), shared by the React screens
// (app/routes/legal-content.tsx) and their legacy twins (client/pages/s36-poveritelnost.js, s37-usloviya.js), so the text exists once.
// A section is {id, title, body}; a body item is {p: parts} or {list: [parts, …]}; parts is a string or a list of a string,
// {route: [id, params, query], text} (a screen of the site), {url, text} (another site) or {contact: true} (the team's address).
// What the privacy page says follows the code: no cookies or analytics (footer „Без бисквитки и проследяване.“), browser storage only for the
// keys of client/store.js, client/feedback.js and client/pages/s27-vrazka.js, the service worker cache (public/sw.js), feedback as mailto
// (client/feedback.js), no invocation logs (apps/web/wrangler.jsonc), the rate limit on the address for 60 s (workers/release-rate-limit.ts),
// MCP arguments never logged (workers/mcp/handler.ts). Change the copy when one of these changes.
import { html } from './html.js';
import { href } from './routes.js';

export const UPDATED = '16 ноември 2026 г.';
export const CODE_URL = 'https://github.com/midt-bg/sigma-budget';
const code = { url: CODE_URL, text: 'github.com/midt-bg/sigma-budget' };

export const PAGES = {
  S36: [
    {
      id: 's36-nakratko',
      title: 'Накратко',
      body: [
        {
          p: 'СИГМА Бюджет не събира лични данни. Няма регистрация и профили, няма бисквитки и няма инструменти за анализ на посещенията или реклама. Страниците не зареждат нищо от други сайтове.',
        },
      ],
    },
    {
      id: 's36-brauzar',
      title: 'Какво остава само в браузъра',
      body: [
        {
          p: 'За удобство браузърът пази някои неща в своята памет (localStorage и sessionStorage). Те не се изпращат към сървъра:',
        },
        {
          list: [
            'настройките на изгледа, например обхват и мерна единица;',
            'кои новини вече са видени и дали е скрито съобщението в горната част на сайта;',
            'черновата и копие на обратната връзка, която подготвяте;',
            'копие на страниците, за да се отварят и без връзка с интернет.',
          ],
        },
        {
          p: 'Числата, които въвеждате в калкулатора за данъци, също не напускат браузъра. Адрес с тях се създава само ако изрично споделите резултата. Всичко това се изтрива от настройките на браузъра, като изчистите данните за сайта.',
        },
      ],
    },
    {
      id: 's36-vrazka',
      title: 'Обратна връзка',
      body: [
        {
          p: [
            'Формулярът ',
            { route: ['S27'], text: '„Обратна връзка“' },
            ' не изпраща нищо към сървъра. Той отваря готов имейл във вашата поща. Ако го изпратите, писмото и адресът ви се получават като всяко друго писмо и се използват само за отговор.',
          ],
        },
      ],
    },
    {
      id: 's36-hosting',
      title: 'Хостинг и сигурност',
      body: [
        {
          p: [
            'Сайтът работи в Cloudflare. При всяка заявка Cloudflare обработва IP адреса, за да достави страницата и да я защити от атаки, според ',
            {
              url: 'https://www.cloudflare.com/privacypolicy/',
              text: 'своята политика за поверителност',
            },
            '.',
          ],
        },
        {
          p: 'Ограничението на броя заявки държи адреса в паметта до една минута. Сайтът не пази IP адреси и не води дневник на посещенията: записват се само технически грешки и броят на извикванията, без данни за посетителя.',
        },
      ],
    },
    {
      id: 's36-ai',
      title: 'AI асистенти',
      body: [
        {
          p: 'Адресът /mcp дава на AI асистенти, например ChatGPT и Claude, достъп до същите публични данни. До сайта стигат само параметрите на конкретното извикване, например думата за търсене, а не разговорът. Те не се записват. Разговорът с асистента се обработва от неговия доставчик по неговата политика за поверителност.',
        },
      ],
    },
    {
      id: 's36-kod',
      title: 'Отворен код',
      body: [
        {
          p: [
            'Кодът на сайта е публичен, така че всичко описано тук може да се провери: ',
            code,
            '.',
          ],
        },
      ],
    },
    {
      id: 's36-vaprosi',
      title: 'Въпроси',
      body: [{ p: ['Въпроси за тази политика: ', { contact: true }, '.'] }],
    },
  ],
  S37: [
    {
      id: 's37-sait',
      title: 'Какво представя сайтът',
      body: [
        {
          p: 'СИГМА Бюджет представя данните за държавния бюджет на България от официалните документи на Министерството на финансите, НСИ, Евростат и други институции. До всяко число стоят източникът, обхватът, статусът и датата.',
        },
      ],
    },
    {
      id: 's37-tochnost',
      title: 'Точност',
      body: [
        {
          p: 'Числата се извличат от документите със скриптове и се проверяват, но може да има грешки. При разлика между сайта и официалния документ важи документът.',
        },
        {
          p: 'Речникът и поясненията са редакционни текстове, а не официални данни. Сайтът е информационен и не е правен, данъчен или финансов съвет.',
        },
      ],
    },
    {
      id: 's37-danni',
      title: 'Използване на данните',
      body: [
        {
          p: 'Данните са публични: идват от официални документи и нямат отделен лиценз. Всеки първичен източник има свои условия.',
        },
        {
          p: [
            'Източниците и готовото цитиране на всеки набор са в ',
            { route: ['S24', {}, { to: 's24-sources' }], text: '„Откъде са данните?“' },
            '. При използване посочвайте първоизточника.',
          ],
        },
      ],
    },
    {
      id: 's37-api',
      title: 'Файлове, API и MCP',
      body: [
        {
          p: [
            'Файловете с данни, ',
            { route: ['S25'], text: 'API' },
            ' и MCP сървърът за AI асистенти са без ключ и без вход. Броят на заявките е ограничен, за да остане услугата достъпна за всички. При превишаване сървърът отговаря с код 429 и казва кога да опитате отново.',
          ],
        },
      ],
    },
    {
      id: 's37-ai',
      title: 'Отговорите на AI асистенти',
      body: [
        {
          p: 'Отговорите на AI асистентите са техни, не на сайта. Проверявайте числата по връзките към сайта, които асистентът дава.',
        },
      ],
    },
    {
      id: 's37-kod',
      title: 'Изходен код',
      body: [{ p: ['Кодът на сайта е под лиценза MIT: ', code, '.'] }],
    },
    {
      id: 's37-promeni',
      title: 'Промени',
      body: [
        { p: 'Условията може да се променят. Датата на последната промяна е под този текст.' },
      ],
    },
    {
      id: 's37-vaprosi',
      title: 'Въпроси',
      body: [{ p: ['Въпроси за условията: ', { contact: true }, '.'] }],
    },
  ],
};

/** the parts of a paragraph as a list, a lone string included */
export const partsOf = (p) => (Array.isArray(p) ? p : [p]);
/** where a link part points: a screen of the site, another site, or the team's address (mailto, else the feedback screen) */
export function target(part, email) {
  if (part.contact)
    return email
      ? { href: `mailto:${email}`, text: email }
      : { href: href('S27'), text: 'страницата „Обратна връзка“' };
  if (part.url) return { href: part.url, text: part.text };
  const [id, params = {}, query = {}] = part.route;
  return { href: href(id, params, query), text: part.text };
}

/** the body of a legal page for the legacy renderer; the React one is app/routes/legal-content.tsx */
export function legalHtml(screen, email) {
  const parts = (p) =>
    partsOf(p).map((x) => {
      if (typeof x === 'string') return x;
      const t = target(x, email);
      return html`<a href="${t.href}">${t.text}</a>`;
    });
  return html`<div class="legal">${PAGES[screen].map(
    (s) =>
      html`<section class="legal-block" aria-labelledby="${s.id}"><h2 id="${s.id}" tabindex="-1">${s.title}</h2>${s.body.map(
        (b) =>
          b.list
            ? html`<ul>${b.list.map((li) => html`<li>${parts(li)}</li>`)}</ul>`
            : html`<p>${parts(b.p)}</p>`,
      )}</section>`,
  )}<p class="legal-updated">Последна промяна: ${UPDATED}</p></div>`;
}
