# Ръководство за разработка на СИГМА Бюджет

## Нова работа

Новият код е TypeScript. Workspace-ът е описан в [README](../README.md); общите правила са в [AGENTS.md](../AGENTS.md). За обработката на данни `./budget` стартира Node CLI в `apps/etl/` и пакетите за обработка в `packages/ingest/`. Python пътят е исторически и референтен.

Маршрутите са в `apps/web/app/routes.ts`. Мигрираните екрани S26, S25, S35, S14 и S16 имат отделни route модули, а S30 използва `not-found.tsx`. Модулите използват loader, headers и компоненти; моделите и React представянето се свързват чрез `apps/web/app/migration/registry.tsx`. За нова работа следвай съществуващите модули и тестовете им. Останалите маршрути използват общия `screen.tsx` и стария renderer.

## Поддръжка на старите екрани

Следващият материал е историческа справка за JavaScript екраните в `apps/web/client/pages/`. Той не определя архитектурата или мястото за нов код; стари пътища, статути, команди и планирани интерфейси в него трябва да се проверяват срещу текущия код. Правилата за данни и проверки в [AGENTS.md](../AGENTS.md) имат предимство.

# Ръководство за разработка — как се прави екран на „СИГМА Бюджет“ (сайтът)

За кого е: авторите на екрани (по един на група екрани S01…S27). Притежател на този файл и на всеки споделен файл: ролята **SHELL**.
Не би трябвало да е нужно да четеш кода на обвивката: всичко, което викаш, е описано тук с точния му подпис.
Код, коментари: **английски**. Всичко, което чете посетителят: **български** (прост език, кратки изречения).
Какво трябва да съдържа всеки екран: `docs/plan.md` (кратко резюме на плана; общите правила за блоковете и достъпността са в разделите 6 и 13 по-долу).
Как изглеждат данните: `docs/data-spec.md` и `docs/example-datasets.md` (само за четене за теб).

Означения за състоянието, използвани по-долу:

- **[готов]** модулът съществува, интерфейсът е замразен, зарежда се в браузъра.
- **[готов · интерфейсът е непроверен]** интерфейсът е замразен; поведението още не е изпробвано в браузър. Ако нещо не работи, не го заобикаляй мълчаливо: опиши го като `[за SHELL] …` в бележките на проекта.
- **[предстои]** интерфейсът е описан, но модулът още не е добавен. Пиши срещу интерфейса; докато файлът не съществува, екранът показва състояние „грешка“, защото импортът връща 404 (провери с `ls apps/web/client/ui`). Раздел 16 е живата таблица.

---

## 0. Накратко

1. Екранът ти е **един файл**: `apps/web/client/pages/sNN-slug.js` (вече съществува като заготовка). По избор собствен CSS: `apps/web/public/css/pages/sNN-slug.css`. Не пипаш нищо друго, освен по правилата на раздел 15.
2. Модулът експортира `needs` (файловете с данни) и по избор `styles`, `title`, `crumbs`, `next`, `lede`, `periods`, `mount`, а също и **`render(ctx)`**, който връща `html\`…\``. Обвивката рисува рамката: трохите, надзаглавието, **единствения `<h1>`**, подзаглавието, реда за периода, тялото ти и картата „Следва“. Ти никога не рисуваш `<h1>`, `<main>` или долен колонтитул.
3. Данни само през `needs` (или `data.load`). Файл, който още го няма, е **състояние „предстои“**, никога грешка и никога измислено число.
4. Тялото се сглобява от блокове: `block({…body})`, който съдържа `kpiGrid`, `chart`, `dataTable`, `ranklist`, `tabs` … Всеки блок безплатно показва етикет за обхвата, значка за състоянието, бутон за източника и менюто „Сподели“.
5. Низовете са **текст**. Разметка се получава само с `html\`…\``. Виж 3.5 (правилото, на което се спъват всички).
6. Парите се пазят в **милиони евро** (`mln`). Печатай ги с `money()`/`view.amount()`; никога не форматирай число на ръка.
7. Всичко примерно (измислено) носи `mock:true`/`status:'mock'` и е със щриховка ▨ и надпис „Примерни данни“. Компонентите го правят, когато им подадеш флага. Число без източник и без флаг е грешка.
8. Провери работата си: `PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.screens --route S06` (раздел 14).
9. Екраните се рисуват наново, когато се смени период, обхват или единица: **`render` трябва да е чиста функция**, а предпочитанията се четат от `ctx.store` в момента на рисуването.
10. Публичен сайт: никъде под `apps/web/` няма имена на членове на групата, няма споменаване на чат платформи, няма цитати от вътрешни обсъждания. Авторството е общо („Работна група „Бюджет на светло“).

---

## 1. Основни правила

- Статичен сайт, чисти ES модули, **без стъпка на сглобяване, без framework, без `node`**. Всички пътища са относителни (трябва да работи под всеки базов път). Импорти от екран: `../html.js`, `../ui/block.js`, `../format.js`, `../data.js`, `../view.js`, …
- **Без външни заявки по време на работа** (CSP `connect-src 'self'`): без CDN, без шрифтове и картинки от други хостове. Само вградените ECharts и 3 шрифта. Външни _връзки_ са позволени (`ext()` в 5.19).
- **Без вградени скриптове, без `onclick=`**. Вградени атрибути `style="…"` са позволени, но е за предпочитане клас в собствения ти CSS файл.
- Без бисквитки, без проследяване. `localStorage`/`sessionStorage` само през `safe` от `store.js` (`safe.get/set/del('localStorage', key)`): никога не хвърля грешка.
- **Без измислени числа.** Реалните числа идват от `data/release/*.json` (притежател: DATA). Примерните числа идват само от `data/release/mock/*.json` (всеки запис има `mock:true`). В кода на екрана няма числови литерали, които приличат на данни. Ако стойност липсва, печатай „—“ (помощниците за форматиране го правят) или покажи `pendingState()`.
- Приложението е за работната група и за прегледващите: банерът „Примерни данни…“ вече е в обвивката.
- Временни файлове: `tmp/` (извън git, виж `.gitignore`). Не пиши извън работната си папка и не пипай `prototype/`.

---

## 2. Карта на файловете и имена

```
(корен на хранилището)
  docs/plan.md  docs/data-spec.md  docs/example-datasets.md  docs/dev-guide.md
  tests/e2e/screens.py       (SHELL)   проверката
  apps/web/
    index.html                  (SHELL)   скелетът на обвивката + CSP
    sw.js                       (SHELL)   минимална заготовка на service worker
    css/{tokens,base,layout,components,charts}.css     (SHELL, споделени)
    css/pages/sNN-slug.css      (ТИ)      по избор, по един на екран
    js/{html,format,store,data,icons,routes,router,shell,actions,main,share,charts,glossary,searchlib,search,view}.js   (SHELL)
    js/calc.js                  (G3)      чиста логика на калкулатора, раздел 5.24
    js/feedback.js              (G5)      локалната кутия „изпратено“ на S03/S27, раздел 5.26
    js/muni.js                  (G4)      помощници за общини на S20/S21 (чисти), раздел 5.28
    js/ui/map.js                (G4)      картата с оцветени области, раздел 5.25 (CSS ѝ е последният блок на css/charts.css)
    js/ui/unit-switch.js        (G1)      превключвателят „В евро | % от БВП“, раздел 5.29
    js/ui/*.js                  (SHELL)   компонентите, раздел 5
    js/pages/sNN-slug.js        (ТИ)      по един модул на екран (S28, S29, S30 са на SHELL: търсене, вграждане, 404)
    data/**                     (DATA)    никога не се редактира на ръка
    vendor/                     ECharts + шрифтове (никога не се редактира)
```

Имената на файловете на екраните се определят от таблицата с маршрутите (раздел 11). Имената на класове и DOM идентификатори, които създаваш, започват с номера на екрана: `s06-…`. Котвите, към които искаш да се прави връзка (`?to=<id>`), са уникални в рамките на екрана.

---

## 3. Договорът на модула на екрана

Общите параметри на адреса са `per`, `demo` и `unit`. `unit=eur` показва сумите в евро, а `unit=pct` — като процент от БВП там, където екранът поддържа този изглед. Изричният избор в адреса има предимство пред запазената настройка на браузъра. Споделените връзки и embed адресите носят единицата; сървърното показване и кешът я отчитат отделно. Личните стойности от калкулатора остават извън тези адреси.

### 3.1 Скелет (всяка заготовка вече изглежда така)

```js
// apps/web/client/pages/s06-prihodi.js
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { pendingState } from '../ui/states.js';

export const needs = ['core', 'revenue'];     // файлове с данни (имена без разширение) — зареждат се паралелно преди render()
export const styles = ['s06-prihodi'];        // по избор: css/pages/s06-prihodi.css
export const title = ctx => ctx.params.source ? 'Приходи: ' + ctx.params.source : 'Откъде идват парите?';
export function render(ctx) { return html`…`; }
```

Всички експорти са по избор, освен `render`:

| Експорт   | Подпис                                                   | Значение                                                                                                                    |
| --------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `needs`   | `string[]` или `ctx => string[]`                         | имена на файлове с данни, виж 4.1. `'name?'` = по избор                                                                     |
| `styles`  | `string[]`                                               | имена на CSS файлове на екрана (без път, без `.css`), регулярен израз `[a-z0-9-]+`; зарежда се веднъж, никога не се изважда |
| `title`   | `ctx => string`                                          | текстът на h1 и началото на `document.title`. По подразбиране: заглавието от таблицата с маршрутите                         |
| `crumbs`  | `ctx => [{label, href?}]`                                | трохите _след_ „Начало“; последният елемент = текущата страница. По подразбиране: веригата `parent` на маршрута             |
| `next`    | `ctx => ['S12'] \| [{href,title,text,kicker}]`           | картите на „Следва“. По подразбиране: `route.next`                                                                          |
| `lede`    | `ctx => string`                                          | едно изречение под h1. По подразбиране: `route.desc`                                                                        |
| `periods` | `'all'\|'none'\|string[]`                                | заменя поддържаните периоди на маршрута. Неподдържан период → обвивката показва празно състояние с бутони „Покажи …“        |
| `embeds`  | `{ [chartId]: ctx => {chart, source?, asOf?, status?} }` | диаграмите на екрана, които S29 може да показва самостоятелно (раздел 7.5)                                                  |
| `mount`   | `(root, ctx) => void \| (() => void)`                    | изпълнява се, след като страницата е в DOM (`root` = `.page-body`); върни функция за почистване                             |
| `render`  | `(ctx) => SafeHtml \| string \| object`                  | тялото, виж 3.3                                                                                                             |

### 3.2 `ctx`

```
ctx.route        {id:'S06', key:'prihodi', title, group, step, …}   (редът от таблицата с маршрутите)
ctx.params       параметрите на маршрута: {source:'dds'} за #/prihodi/dds   (имена: раздел 11)
ctx.query        живата ?заявка като обект: {tab:'programi'}      (обновява се от setQuery; ?per, ?to, ?demo се обработват от обвивката)
ctx.data         {core: {...}, revenue: {...}}  по имена БЕЗ '?' ; 'ministries/1300' остава 'ministries/1300'
ctx.missing      имената, които не са се заредили (по избор, или всички, когато екранът показва „предстои“)
ctx.period       {key:'2026.law', year:2026, status:'law', vintage:'plan', label:'2026 · Закон', desc}
ctx.store        store.get('userType'|'unit'|'perPerson'|'leva'|'onlyReal'|'scope'|'sources'|…)
ctx.core         getter = data.get('core') (undefined, докато core.json не е зареден: сложи 'core' в needs, ако го ползваш)
ctx.signal       AbortSignal на тази навигация (подай го на собствените си await)
ctx.setQuery(obj, {rerender:true})   записва ?k=v в адреса (replaceState). ''/null маха ключа. {rerender:false} = сам обновяваш DOM
ctx.rerender()   рисува екрана наново
ctx.announce(msg)  вежливо съобщение за екранни четци (aria-live)
ctx.go(hash)     навигира (добавя ?per, когато периодът не е по подразбиране)
ctx.href(idOrKey, params, query)   '#/prihodi/dds?per=…'   (= routes.href)
ctx.notFound()   хвърля → обвивката показва S30 за този адрес. Ползвай за непознати стойности на :code / :id
ctx.demo, ctx.kind   състояние на демото / 'load'|'link'|'pop'|'hash'|'rerender' (информативно)
```

### 3.3 Какво връща `render`

- `html\`…\`` (SafeHtml) — тялото.
- обикновен низ — третира се като **текст** (екранира се), подходящ само за съобщение на един ред.
- обект `{ title?, lede?, context?, eyebrow?, body }` — заменя части от рамката за това рисуване (например заглавие, което зависи от данните). `context` е допълнителен SafeHtml, добавен към реда за периода.

`render` може да е `async` (но предпочитай `needs`). Ако хвърли грешка, посетителят вижда състояние „грешка“, а конзолата показва стека (проверката пада). Третирай всяко число като евентуално `null`.

### 3.4 Жизнен цикъл, фокус, заглавие, превъртане — какво прави обвивката вместо теб

1. Навигация → почистванията на предишната страница се изпълняват → регистърът на споделянията/диаграмите се изчиства → скелет след 100 ms → зареждат се `needs` → `render` → рамката се рисува → задават се `document.title` и `h1` → фокусът отива на `h1` (при навигация по връзка/назад/хеш, **не** при първо зареждане, повторно рисуване или `?to=`), превъртането отива най-горе (назад/напред връща позицията).
2. След рисуването всеки елемент `[data-ui="name"]` вътре се „оживява“: `js/ui/<name>.js` `mount(el, ctx)` се импортира и вика (диаграмите се чертаят, таблиците стават сортируеми, табовете получават управление с клавиатура). Ти не викаш нищо. За късно вмъкната разметка (от твоя `mount`) → `import('../router.js').then(m => m.hydrate(node, ctx))`.
3. После се изпълнява твоят `mount(root, ctx)`. Ползвай го за поведение, което не се изразява с `data-` атрибути. Слушателите се закачат на `root` (не на `document`) и се връща функция за почистване.
4. `?to=<id>` (това, което създава „Копирай линк“): превърта се до елемента с този `id`, всеки обграждащ го `<details>` се отваря (и скритият панел на таб се показва), елементът се подчертава и получава фокус.
5. Повторно рисуване (сменени `period userType unit perPerson leva onlyReal`, `ctx.rerender()`, контроли с `data-query`): същата страница се рисува пак, превъртането се запазва, фокусът се връща на елемента със същия `id` или `data-fk`. **Контрол, който предизвиква повторно рисуване, трябва да има стабилен `id` или `data-fk`.**
6. `?demo=loading|empty|error|pending|offline` работи на всеки адрес без код от теб; обвивката рисува тези рамки.

### 3.5 Низове срещу разметка (прочети два пъти)

```js
import { html, raw, esc, cx } from '../html.js';
html`<p class="${cx('note', { warn: bad })}">${userText}</p>`   // всяко ${} се екранира, освен ако не е само html`` / raw()
html`<ul>${items.map(i => html`<li>${i.name}</li>`)}</ul>`       // масиви от html`` се слепват
raw('<b>fixed markup</b>')                                         // само за константи, които си написал сам
```

- **Обикновен низ**, върнат от `render`, подаден като тяло на лист/изскачащо или вмъкнат с интерполация, е екраниран текст. Разметка → `html\`…\``.
- **Стойностите на атрибутите винаги са в двойни кавички**: `class="${x}"`, никога `class=${x}`.
- Невалидно число (`NaN`, `Infinity`), вмъкнато в `html\`\``, се печата като „—“ и пише грешка в конзолата: това е грешка в обработката на данните и проваля проверката. Пази се с `?? null` и помощниците за форматиране.

### 3.6 Работен пример (подобен на S06; всеки използван модул е описан в раздели 5/9)

```js
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { chart } from '../ui/chart.js';
import { dataTable } from '../ui/table.js';
import { pendingState } from '../ui/states.js';
import { yIndex, amount } from '../view.js';
import { pct } from '../format.js';

export const needs = ['core', 'revenue', 'execution?'];     // execution е по избор тук
export const styles = ['s06-prihodi'];

export function render(ctx) {
  const rev = ctx.data.revenue;                              // {years, groups[{id,name,mln[],pctGdp[],share2026,…}], …}
  const i = yIndex(rev.years, ctx);                          // колоната на избраната година (-1, ако я няма)
  if (i < 0) return pendingState({ title: 'Няма данни за тази година' });
  const groups = rev.groups.map(g => ({ id: g.id, name: g.name, mln: g.mln[i] ?? null }));
  const total = rev.total.mln[i] ?? null;
  const byTax = ctx.missing.includes('execution')            // файлът по избор не се е заредил
    ? pendingState({ id: 'P01' })                            // заглавието/причината идват от core.pending
    : html`<p>…</p>`;
  return html`
    ${block({
      id: 's06-groups', title: 'Приходите по групи', sub: 'Всички приходи на КФП',
      scope: 'kfp', status: 'real', source: ['asbp'], asOf: rev.meta.asOf,
      body: html`
        ${kpiGrid([kpi({ label: 'Общо приходи', mln: total, pctGdp: rev.total.pctGdp[i], gl: 'prihodi' })])}
        ${chart({ id: 's06-groups-bar', type: 'barh', title: 'По групи', unit: 'млн. €', categories: groups.map(g => g.name),
                  series: [{ name: 'Приходи', data: groups.map(g => g.mln) }] })}`
    })}
    ${block({ id: 's06-bytax', title: 'По вид данък', scope: 'kfp', status: 'pending', body: byTax })}`;
}
```

---

## 4. Данни

### 4.1 Четене на данни

```js
export const needs = ['core', 'revenue'];                       // всички трябва да се заредят, иначе цялата страница показва „предстои“/грешка
export const needs = ['core', 'execution?'];                    // по избор: render() пак се изпълнява, ctx.missing = ['execution']
export const needs = ctx => ['core', 'ministries/' + ctx.params.code];   // зависи от адреса; грешен код → ctx.notFound()
ctx.data.revenue                                                // разобраният JSON
```

- Името е пътят на файла под `data/release/` без `.json` (`ministries/1300`, `mock/payments`, `geo/obshtini`).
- Файл, който не съществува (404 / HTML вместо JSON) → **предстои** (обвивката показва „Данните съществуват при издателя, още не са извлечени“ за цялата страница, когато файлът е задължителен). Мрежова грешка или грешка при разбор → състояние „грешка“ с „Опитай пак“.
- `core` се зарежда веднага при старта (≤ 40 KB). Всичко останало е лениво и кеширано, така че повторното искане е безплатно. `glossary` се предзарежда в свободно време.
- Директен интерфейс (рядко е нужен): `import { data } from '../data.js'` →
  `data.load(stem, {signal}) → Promise<json>` (хвърля `PendingError`/`LoadError`), `data.get(stem)` (синхронно, само ако вече е зареден),
  `data.prefetch(stem)`, `data.statusOf(node, doc) → 'real'|'mock'|'pending'|…` (node.status → doc.meta.status → 'real'),
  `data.sourceOf(node, doc) → string[]`, `data.source(key) → {title,publisher,url,kind,access,note}` (заместител, ако core липсва), `data.pending('P01') → {title,reason,expected,source,screens}`.

### 4.2 Как изглеждат реалното / примерното / „предстои“

| Вид      | Откъде идва                                 | Как го показваш                                                                                                                            |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| реални   | `meta.status:'real'` на файла               | `status:'real'` (зелена значка) — числа с бутон за източника                                                                               |
| частични | набор, при който част липсва/е изведена     | `status:'partial'` и бележка на един ред коя част                                                                                          |
| прогноза | години 2027–2028, `vintage:'forecast'`      | `status:'forecast'` (пунктирана значка). Ползвай `view.periodStatus(ctx)`                                                                  |
| примерни | `mock/*.json`, записи с `mock:true` + `why` | `status:'mock'`/`mock:true`: щриховка ▨ (`data-mock="true"`), значка и етикет „Примерни данни“, текст `why`, изключва се при „само реални“ |
| предстои | `core.pending` P01–P07 или липсващ файл     | `pendingState({id:'P01'})`: пунктирана сива бележка, **никога число**                                                                      |

CSS куки (компонентите ги задават; задавай ги сам само върху ръчно написана разметка): `data-mock="true"` върху малка лента/ред/запълване я щрихова. Контейнерите ползват `data-block-mock`, `data-kpi-mock`, `data-mock-fig`, `data-mock-table` (иначе общото правило би щриховало целия текст). `data-src="kfp,forecast_tables"` (+ `data-asof="2026-07-31"`) върху всеки бутон/връзка отваря картата на източника; `sourceBtn()`, `srcTag()`, `val()` я произвеждат.

### 4.3 Какво съдържат файловете (подробности: `docs/data-spec.md`)

Обвивката на всеки файл: `{ meta:{id,title,status,source[],sourceNote,asOf,retrieved,unit,pending[],mock}, … }`; наследниците наследяват `meta`.
Единици: `…Mln`/`mln` = милиони евро; `…Khil`/`khil` = хиляди евро; `pct` = 0–100; `pctGdp` = % от БВП; `eur`, `perCapita` = евро; `persons`. Липсващо число е **липсващ ключ** или `null` (никога 0, никога "n/a"). Времевите редове са масиви, подравнени с `years` на файла: колоната намираш с `view.yIndex(doc.years, ctx)`.
Ключове от най-високо ниво на `core`: `meta, build{dataVersion,kfpLatest,kfpMonths2026,kfpNext,eurRate}, years{list,vintage}, sources, pending, counts, population{year,date,persons,source}, kpis{gdp,revenue,expenditure,balance,capex,debt}, functions[], revenueGroups[]`.
Колоната за 2026 е от вид **план** (проектът на закона и законът го споделят); разликите между проекта и закона са в `law.json` (`docs/data-spec.md` §3.11). Когато не си сигурен към `2026.draft` или `2026.law` принадлежи едно число, питай притежателя на данните (DATA) в бележките на проекта.

Имена на файлове и екрани, които ги ползват:

| Име                       | Екрани                      | Име              | Екрани                                |
| ------------------------- | --------------------------- | ---------------- | ------------------------------------- |
| `core` (веднага)          | всички                      | `law`            | S14 S11 S16                           |
| `outlook`                 | S01 S04 S13 S17             | `debt`           | S17 S01 S13 S16                       |
| `revenue`                 | S06 S04 S07 S13 S15 S19     | `rates`          | S18 S16                               |
| `expenditure`             | S07 S08 S19 S04 S18         | `municipalities` | S20 S21 S19                           |
| `execution`               | S15 S16 S01 S04 S06 S17 S19 | `geo/obshtini`   | S20 S21                               |
| `components`              | S15                         | `glossary`       | S03 (+ изскачащите термини навсякъде) |
| `ministries`              | S07 S10 S11 S19 S05         | `guide`          | S02                                   |
| `ministries/<код>`        | S11 S10                     | `sebra`          | S23                                   |
| `programs`                | S10 S19                     | `feed`           | S16                                   |
| `measures`                | S12 S01 S04 S08 S19         | `catalog`        | S24 S25                               |
| `mock/activities`         | S09                         | `search-index`   | S28                                   |
| `mock/indicators`         | S11                         | `mock/payments`  | S23                                   |
| `mock/municipal-finance`  | S20 S21                     | `mock/projects`  | S22                                   |
| `indirect-tax-parameters` | S18                         |                  |                                       |

Идентификатори в маршрутите: групи приходи `dds osiguritelni nedanachni pomoshti ddfl akcizi korporativen drugi`; функции `obshti-sluzhbi otbrana-sigurnost obrazovanie zdraveopazvane sotsialni zhilishtno-sreda kultura-sport ikonomika drugi`; код на ведомство = 4-цифрен ЕБК (`1300`), програма `1300.01.01`; мерки `kr1…kr8 kx1…kx9 kn1… d8-1… d9-1… p8-1…p8-8`; общини `BLG03`; проекти `pr-01…`; плащания по измислен ЕИК `999…`; набори по slug. Ключове на източниците: `kfp forecast_tables bill zdb zbdoo zbnzok prb parliament eurostat bnb nap sebra gisco dataeuropa minfin wg ec-oil excise-law nsi-pack`.
Идентификатори на „предстои“: P01 (изпълнение по вид данък) S06 S15 · P02 S15 · P03 (програми на ~15 ведомства) S10 S11 · P04 S15 S16 · P05 S15 · P06 S17 · P07 S14.

Населението за „на човек“ е `ctx.core.population.persons`. Курсът евро/лев е `format.EUR_RATE`.

---

## 5. Компоненти

Импортират се от `../ui/<файл>.js`. Всички връщат `SafeHtml`, освен ако не е казано друго. Всеки интерактивен компонент има вградено поведението за достъпност (раздел 13); твоя работа е само да зададеш истински етикети.

### 5.1 `html.js` — [готов]

`html`, `raw(s)`, `esc(s)`, `cx(...args)` (имена на класове; обекти `{cls: bool}`), `attrs(obj)` (`attrs({'data-x': 1, hidden: cond})` → ` data-x="1"`), `slug(s)`, `nextId('prefix')`, `SafeHtml`. Виж 3.5.

### 5.2 `icons.js` — [готов]

```js
import { icon } from '../icons.js';
icon('wallet')                                   // декоративна, 18 px
icon('info', { size: 16, cls: 'x', label: 'Информация', sw: 2 })   // label → role="img"
```

Имена: home wallet trendingUp pieChart landmark fileText calendar gauge newspaper scale banknote barChart map hardHat transfer database code message x chevronDown chevronUp chevronRight chevronLeft arrowRight arrowLeft arrowUpRight arrowDownRight link copy download image share moon sun monitor more user users book list grid wifiOff refresh external alert dashed help eye table minus plus clock percent check checkCircle info search compass menu sliders flag partial forecast hatch. (Няма `arrowUp`/`arrowDown`: ползвай `chevronUp/Down`. Липсваща икона: добавя се само към `icons.js` и се отбелязва.)

### 5.3 `states.js` — [готов]

```js
import { skeleton, emptyState, errorState, pendingState, mockBadge, mockNote, offlineNote } from '../ui/states.js';
emptyState({ title:'Няма резултати', text:'Опитай с друга дума.', action:{ label:'Изчисти филтъра', action:'clear' }, icon:'search' })
emptyState({ title, text, actions:[{ label:'Към ДДС', href:'#/prihodi/dds' }, { label:'Покажи 2026', action:'set-period', value:'2026.law', primary:false }] })
errorState({ title?, text?, retry:true })        // „Не успяхме да заредим данните.“ + „Опитай пак“ (рисува наново) + връзка към #/danni
pendingState({ id:'P01' })                        // заглавие/причина/очаквано/източник се вземат от core.pending
pendingState({ title:'Програмите на ведомството', text:'…', reason:'…', expected:'…', source:['prb'], action:{label,href} })
skeleton({ lines:3, label:'Зареждане…' })        // резервира височината на асинхронно съдържание
mockBadge('Примерни данни') · mockNote('Защо е измислено…')   // значка / ред „▨ Примерни данни — …“
mockHidden(text?)                                 // компактното „скрит е блок с примерни данни“ + „Покажи“ (ползва се при включено „само реални“)
```

Всеки корен носи `data-state="empty|error|pending|loading|mock|offline"` — проверката го търси.
Действие `{label, href}` рисува бутон-връзка, `{label, action, value}` — бутон с `data-action` (`retry`, `set-period`, `legend`, `search`, `dismiss-banner`, `show-mock`).

### 5.4 `status.js` — [готов]

```js
import { statusPill, statusLabel, openLegend, STATUS } from '../ui/status.js';
statusPill('real') · statusPill('forecast') · statusPill('mock') · statusPill('partial') · statusPill('pending')
statusPill('real', { label: 'Към 31.07.2026' })
statusLabel('mock')        // 'Примерни данни'
```

Никога само с цвят: всяка значка има икона и думи.

### 5.5 `scope.js` — [готов]

```js
import { scopeChip } from '../ui/scope.js';
scopeChip('kfp')                     // КФП (връзка към речника)
scopeChip('zdd', { note:'без гаранциите' })
```

Ключове: `kfp nat eu zdd maastricht`. Блок, който показва числа, винаги има такъв (`block()` го прави от `scope:`).

### 5.6 `source.js` — [готов · интерфейсът е непроверен]

```js
import { sourceBtn, srcTag, val, sourceCard, srcShort } from '../ui/source.js';
sourceBtn(['kfp'], { asOf:'2026-07-31', label:'Източник' })   // бутон, който отваря картата на източника
val(money(26347.4), { src:'kfp', asOf:'2026-07-31' })        // число с етикет, показван само когато „Източници“ е включено
val(txt, { mock:true })                                       // щриховано вградено значение
```

Общият обработчик отваря картата за **всеки** елемент с `data-src="key1,key2"` (и по избор `data-asof`).

### 5.7 `block.js` — [готов · менюто за споделяне е непроверено]

Рамката на всеки блок с данни (виж раздел 6 и `docs/plan.md`).

```js
import { block } from '../ui/block.js';
block({
  id: 's06-groups',            // задължителен, уникален в екрана: DOM id, id за споделяне, цел на ?to=
  title: 'Приходите по групи', // задължителен, заглавието на блока (<h2>; level:3 за <h3>)
  level: 2,                    // ниво на заглавието 2|3|4 (по подразбиране 2)
  sub: 'млн. €, КФП',          // по избор: малък ред под заглавието (низ или html``)
  scope: 'kfp',                // 'kfp'|'nat'|'eu'|'zdd'|'maastricht' | {key, note, label, gl} | false (блок без числа)
  status: 'real',              // 'real'(по подразбиране)|'partial'|'forecast'|'mock'|'pending'|'text'|false
                               //   'text': само думи, без число от данните (определения, чеклист, данните на посетителя); без значка;
                               //   screens спира, ако такъв блок покаже графика, таблица, KPI или число с източник
                               //   false: без състояние (само за състояние на грешка); pill:false пази състоянието, без значката
  statusLabel: 'Към 31.07.2026', // по избор: сменя думите в значката (състоянието остава същото)
  mock: false,                 // true ≡ status:'mock' → щрихована лента, значка, mockNote(why); скрит е при „само реални“
  why: 'Стойностите са измислени…',   // текст под значката за примерни данни (собственото `why` на записа)
  source: ['kfp'], asOf: '2026-07-31',  // ключове на източници → бутон „Източник“; asOf → „Данни към 31.07.2026“ в долния ред
  share: true,                 // по подразбиране true, когато е зададен `source`. false | true | {title, sub, text, table, chart, embed}  (раздел 7)
  tools: html`…`,              // допълнителни контроли вдясно в заглавната част (напр. seg контрол)
  body: html`…`,               // съдържанието
  foot: html`<p>Бележка…</p>`, // редове в долния край
  report: true,                // връзка „Намерих грешка“ в долния край → #/vrazka?type=error&from=…&block=<id>. По подразбиране включена, освен за блокове pending/mock/status:false; false, за да се махне
  pending: 'P01',              // status:'pending' без body: общото pendingState({id}) от core.pending (по подразбиране: pendingState({title}))
  cls: 'my-class', flat: false, quiet: false     // flat = без рамка на карта; quiet = пунктир, малък
})
```

Блоковете със `status:'pending'` трябва да имат `body: pendingState({id})` (без `body` блокът сам рисува такъв). Примерен блок при включено „само реални“ рисува `mockHidden()` (автоматично; идентификаторът на блока остава в DOM, така че `?to=` пак пада на място). `title`/`sub` може да са `html\`\``; текстът за споделяне ползва обикновения им текст. Блокът е `<section aria-labelledby>`: `?to=<id>` му дава фокус, а екранните четци обявяват заглавието.

### 5.8 `kpi.js` — [готов]

```js
import { kpi, kpiGrid } from '../ui/kpi.js';
kpiGrid([
  kpi({ label:'Приходи', mln: 55525.0, pctGdp: 36.9, delta:{ value: 7.1, unit:'%', label:'спрямо 2025' }, sub:'за годината', gl:'prihodi' }),
  kpi({ label:'Дефицит', value: 3.0, unit:'% от БВП', d:1, delta:{ value:-0.4, unit:'пр.п.', label:'спрямо 2025', tone:'good' } }),
  kpi({ label:'Дълг към БВП', value: null })                       // няма стойност → плочка „Предстои“ (data-status="pending"), никога число
], { label:'Основни числа', cls:'' })
```

Опции на `kpi`: `label` (задължителна) · `value` число|низ|html (число → `num(value,d)`) · `unit` (малък текст след числото) · `d` десетични знаци · **`mln`** (пари в млн. €: печатат се през `view.amount`, така че важат предпочитанията „на човек“, лева и „% от БВП“; при `pctGdp` предпочитанието за единица `pct` печата дела от БВП) · `delta` `{value, unit:'%'|'пр.п.', label, tone}` или число (процент) — стрелка ▲▼→ и стойност със знак; цветът е **неутрален**, освен ако не подадеш `tone:'good'|'bad'` · `sub` · `scope`, `status`, `mock`, `source`, `asOf` · `gl` (етикетът става връзка към речника) · `href` (цялата плочка е връзка) · `id`.
Значка `status` се появява само ако подадеш `status` (ползвай я за изключения: прогноза/частични/примерни). Примерна плочка е щрихована и казва „Примерни данни“; изчезва при включено „само реални“, а `kpiGrid` добавя ЕДНА бележка „Скрити са N плочки с примерни данни“ с бутон „Покажи“ (скритото `kpi()` е празна разметка, така че е безопасно навсякъде; `kpiGrid` ги брои).
`mln` с `pctGdp`: докато предпочитаната единица е „% от БВП“, плочката печата дела; при „на човек“ печата евро на човек (иска зареден `core`: сложи `'core'` в `needs`); при „и в лева“ следва част `(≈ … лв.)`. `mln: null` или `value: null/''/NaN` → пунктираната плочка „Предстои“; `value: 0` е истинска нула. Посоката на `delta` (▲▼→) следва отпечатаната, закръглена стойност; екранните четци чуват „Увеличение/Намаление/Без промяна“. `gl` прави връзка само етикета; `href` прави връзка цялата плочка (`href` печели пред `gl`). `kpiGrid(items, {label})` е `role="group"`, когато има `label`; елементи null/false се прескачат.

### 5.9 `table.js` — [готов · интерфейсът е непроверен]

```js
import { dataTable } from '../ui/table.js';
dataTable({
  id: 's06-rows',                      // задължителен, уникален
  caption: 'Приходи по групи, млн. €', // задължителен (чете се от екранни четци; captionVisible:true го показва)
  columns: [
    { key:'name', label:'Група' },                                   // columns[0] = заглавие на реда (<th scope="row">)
    { key:'mln',  label:'2026', unit:'млн. €', d:1 },               // числата са вдясно, в българския формат, null → „—“
    { key:'share', label:'Дял', fmt:(v,row) => pct(v) }            // fmt връща низ или html``
  ],
  rows: [{ name:'ДДС', mln:12803.8, share:23.1, _href:'#/prihodi/dds' }, { name:'Друго', mln:null, _mock:true }],
  total: { label:'Общо', values:{ mln: 55525.0 } },
  sortable: true, sortBy: ctx.query.sort, dir: ctx.query.dir, query: true,   // ?sort=&dir= в адреса
  dense: false, note:'Бележка под таблицата', empty:'Няма редове.', status:'mock'   // status:'mock' щрихова цялата таблица
})
```

Флагове на редовете: `_mock:true` (щрихован, чете се като примерни данни), `_href` (първата клетка става връзка), `_status` (състояние на реда за CSV). Обвивката се превърта хоризонтално сама (`.table-wrap`, достъпна с клавиатура) — единственият елемент, на който е позволено да е по-широк от екрана. Регистрира се сама за износа в CSV.
`tableData(spec) → {columns, rows, statuses}` дава същата таблица като обикновени стойности.

### 5.10 `chart.js` — [готов · интерфейсът е непроверен] (описание на спецификацията: раздел 6)

```js
import { chart } from '../ui/chart.js';
chart({ id:'s07-years', type:'bar', title:'Разходи по години', sub:'млрд. €', unit:'млрд. €',
        categories:['2024','2025','2026'], series:[{ name:'Разходи', data:[48.1, 51.9, 55.5] }] })
```

Връща фигура: надпис, HTML легенда (за ≥ 2 серии; щракване включва/изключва серия), диаграмата и „Таблица с данните“ — близнак, който винаги е в DOM. ECharts се зарежда лениво, когато диаграмата за пръв път стане видима.

### 5.11 `tabs.js` — [готов]

```js
import { tabs } from '../ui/tabs.js';
tabs({ id:'s10-tabs', label:'Изглед', active: ctx.query.tab, query:'tab',
       tabs:[ { key:'vedomstva', label:'Ведомства', count: 40, body: html`…` },
              { key:'programi',  label:'Програми',  body: html`…` } ] })
```

ARIA табове (←/→ със зацикляне, Home/End, подвижен tabindex, автоматично активиране). Всички панели се рисуват; неактивните са `hidden`, така че диаграма в скрит панел се чертае, когато панелът се покаже. `active` = начален ключ (непознат/липсващ → избраното за този екран, иначе първият таб). `query:'tab'` отразява избора в `?tab=` без повторно рисуване (`ctx.setQuery({tab}, {rerender:false})`), затова подавай `active: ctx.query.tab`; без `query` изборът се помни до презареждане на страницата. Ключовете са къси ASCII slug-ове (стигат до идентификатори). `count` е число (форматира се) или текст; `label` текст или разметка; `body` разметка (низ е текст); неистинен елемент в `tabs` се прескача (`cond && {…}`). Елементът `.tabs` изпраща възходящо събитие `tabs:change` (`detail:{id,key}`) след всеки избор на потребителя. `?to=<id>` на нещо в скрит панел показва панела. **Не** слагай `data-query` на контейнера на табовете.

### 5.12 `disclosure.js` — [готов]

```js
import { disclosure } from '../ui/disclosure.js';
disclosure({ id:'s06-how', title:'Как е изчислено?', meta:'3 стъпки', body: html`<p>…</p>`, open:false, cls:'' })   // родно <details>
```

`id` е задължителен. Отварянето/затварянето от посетителя се помни за екран + id и оцелява при повторно рисуване (смяна на период, повторен опит); `open` е само началното състояние, а `?to=<id>` на елемента или на нещо вътре го отваря (не се помни). `title`/`meta` — текст или разметка (без заглавия в `title`), `body` — разметка (низ е текст).

### 5.13 `seg.js` — [готов · интерфейсът е непроверен]

```js
import { seg } from '../ui/seg.js';
seg({ name:'po', label:'Покажи по', value: ctx.query.po || 'fn', query:'po',
      options:[{ value:'fn', label:'Функции' }, { value:'vid', label:'Вид разход', icon:'list' }] })
```

Родна група радио бутони (стрелки, групиране наготово); идентификаторите са `${name}-${value}` (пази `name` уникално в екрана). С `query` промяната пише `?po=…` и екранът се рисува наново (`norender:true` = само се пише адресът). Без `query` слушай сам в `mount`.

### 5.14 `chips.js` — [готов]

```js
import { chips } from '../ui/chips.js';
chips({ label:'Филтър по група', items:[
  { label:'Всички', query:'g=', pressed: !ctx.query.g },                 // <button data-query="g=" aria-pressed>: пише ?g= и рисува наново ('g=' маха ключа)
  { label:'Социални', count: 12, query:'g=sotsialni', pressed: ctx.query.g === 'sotsialni' },
  { label:'Към речника', href:'#/rechnik' },                             // чип-връзка <a class="chip">; pressed:true → aria-current="true"
  { label:'Покажи още', key:'more' }                                     // обикновен <button data-chip="more">: слушай в собствения си mount; без aria-pressed
] })
```

- `pressed` е булева стойност, която изчисляваш от `ctx.query`. **Пропусни го** при чип, който само задейства нещо: `aria-pressed` се пише само когато `pressed` е зададено, иначе чипът би се обявявал като превключвател.
- Чиповете със заявка носят `data-fk`, така че фокусът от клавиатурата се връща на същия чип след повторното рисуване. Не им трябва `mount`.
- `label` (името на групата) става `aria-label` на групата (задай го, щом чиповете филтрират нещо); `count`: число се форматира, текст се показва както е; `icon:'name'` добавя икона.
- Няма елементи → нищо не се рисува.

### 5.15 `forms.js` — [готов · интерфейсът е непроверен]

```js
import { field, textInput, selectInput, toggle } from '../ui/forms.js';
field({ id:'f-sum', label:'Сума, €', hint:'Само цифри', error: bad && 'Въведи сума над 0',
        control: textInput({ id:'f-sum', name:'sum', value:'', type:'text', inputmode:'decimal', placeholder:'1 000', autocomplete:'off', required:true, hint:true, error: bad }) })
selectInput({ id:'f-y', name:'y', value:'2026', options:[{ value:'2026', label:'2026' }], query:'y', hint:false })
toggle({ id:'f-leva', name:'leva', label:'Покажи и в лева', checked:false, hint:'…', query:'leva', attrs:'' })
```

Всеки контрол има видим `<label>`; подсказките и грешките са свързани с `aria-describedby`. Поведението го закачаш сам в `mount` (обработчици на изпращане: `form.addEventListener('submit', e => e.preventDefault(); …)`; формата никога не се изпраща никъде).

### 5.16 `ranklist.js` — [готов]

```js
import { ranklist } from '../ui/ranklist.js';
ranklist({ id:'s10-top', caption:'Най-големи бюджети', ordered:true, sort:'desc', shares:true, categoryLabel:'Ведомство',
  items:[ { label:'Министерство на отбраната', sub:'1300', value: 3200.5, pctGdp: 3.4, href: ctx.href('vedomstvo', { code:'1300' }),
            children:[{ label:'Програма 1', value: 100.2 }, { label:'Програма 2', value: null }] },
          { label:'Друго', value: null } ] })        // null → пунктиран ред „Предстои“: без число, без лента
```

Опции: `id` (**задължителна**), `caption` (видим; също достъпното име на списъка), `label` (само достъпно име, когато няма видим надпис), `ordered` (номериран `<ol>`), `unit` (`'mln'` по подразбиране: милиони евро през `view.amount`, така че превключвателите на посетителя „% от БВП“ (иска `item.pctGdp`), „на човек“ и „и в лева“ действат, а големите стойности се печатат като „5,10 млрд. €“; `'pct'`: стойността вече е процент; `'num'`: обикновено число) или `fmt:(value, item) => string | html` за всичко друго, `d` (десетични знаци), `max` (лентите са спрямо него; по подразбиране най-голямата стойност от най-горното ниво), `sort:'desc'|'asc'` (по подразбиране: твоят ред; редовете без стойност отиват накрая), `shares:true` (добавя дела на всеки ред от най-горното ниво в общото, „40,1%“), `categoryLabel` / `unitLabel` (първа колона и единица на CSV близнака; `unitLabel` по подразбиране е „млн. €“ / „%“), `mock` (целият списък), `cls`.
Елементи: `{label, sub?, value, share?, href?, mock?, status?, pctGdp?, children?}`. `status` показва значка само за `partial|forecast` (`pending` е видът на null стойността, `mock` — щриховката); `mock:true` на ред щрихова лентата му и добавя „(примерни данни)“ за екранните четци; всеки примерен ред добавя значката „Примерни данни“ към списъка.

- Редове с `children` се разгъват (`<details>`; лентата на дете е спрямо родителя). С `href` етикетът е връзка — за ред с деца връзката „Към „…““ следва децата, защото връзка в `<summary>` би го превключвала.
- Отрицателна стойност се печата със знак минус и няма лента.
- CSV близнакът се регистрира с `share.attach(id, …)`, децата като „Родител › Дете“; обграждащият `block()` го намира сам.
- Ползвай го там, където стълбовидна диаграма би имала много или дълги етикети: това е достъпната алтернатива, подходяща за телефон.

### 5.17 `treemap-list.js` — [готов]

```js
import { treemapList } from '../ui/treemap-list.js';
treemapList({ id:'s07-fn', title:'Разходи по функции', sub:'млн. €', unit:'mln', view: ctx.query.view, query:'view', mock:false,
  items:[ { id:'obrazovanie', label:'Образование', value: 3200.5, href: ctx.href('funkciya', { fn:'obrazovanie' }),
            children:[{ label:'Висше образование', value: 900.1 }] },
          { label:'Нова функция', value: null } ] })      // null → „Предстои“ в списъка, извън картата (бележка казва колко са)
// екран, който иска собствен панел с подробности (S07: „Клик отваря детайл“), слуша в mount() и спира навигацията по подразбиране:
el.addEventListener('tmap:select', e => { e.preventDefault(); openDetail(e.detail.id); })     // detail: {id, label, href, item}
```

Карта от правоъгълници („карта“) **или** подреденият списък на същите елементи, превключвани с контрол („Списък / Карта“). И двете винаги са в страницата, едното е скрито: списъкът е по подразбиране на телефони (< 600 px), а картата — на широки екрани (следва преоразмеряването, докато посетителят не избере). Превключването никога не рисува екрана наново.

- `id` (**задължителна**), `items` (формата на `ranklist`: `{label | name, sub, value, href, mock, status, pctGdp, children, id}`), `unit` (`'mln'` по подразбиране | `'pct'` | `'num'`), `fmt`, `d`, `unitLabel`, `categoryLabel`, `shares` (по подразбиране `true`), `sort` (по подразбиране `'desc'`; `false` запазва твоя ред), `mock`, `height` (карта, по подразбиране 340), `cls`, `desc` (допълнително изречение за достъпното име на картата).
- `title` / `sub`: по избор малък надпис вляво от превключвателя; пропусни ги вътре в `block()`, който вече има заглавие. `label` е достъпното име (по подразбиране `title`).
- `view:'list'|'map'` налага едното; всичко друго = по ширината на екрана. `query:'view'` пише избора на посетителя в `?view=` без повторно рисуване — подавай `view: ctx.query.view`, за да отваря споделена връзка същия изглед.
- Картата рисува само редове с **положително** число (бележка под нея казва колко са пропуснати; списъкът показва всички). Ред с `children` става вложена област със заглавна лента. Картата печата суровите числа с текста на единицата (милиони евро) — превключвателите „на човек“, „% от БВП“, „лв.“ променят само списъка.
- Щракване върху област изпраща отменяемо, възходящо събитие `tmap:select`; ако никой не извика `preventDefault()` и елементът има `href`, екранът отива там. През картата няма път с клавиатура: списъкът е достъпната алтернатива (връзки, разгъваеми деца).
- Таблични близнаци: списъкът регистрира един (`<id>-list`), фигурата на картата друг (`<id>-map`); блок около нея намира видимия. Изобщо няма данни → празно състояние; само редове без числа → само списък, без превключвател.

### 5.18 `sankey.js`, `progress.js`, `timeline.js` — [готов]

```js
import { sankey } from '../ui/sankey.js';                          // [готов]
sankey({ id:'s05-flow', title:'От приходи към разходи', sub:'млн. €', desc:'Най-големият поток върви от осигурителните вноски към социалната защита.',
         nodes:['ДДС', 'Образование'],                                   // по избор: фиксира реда и цвета; имена, които се срещат само във връзки, се добавят след тях
         links:[{ source:'ДДС', target:'Образование', value: 100.5 }] })  // връзките ползват ИМЕНА на възли; добави `mock:true` на връзка или възел, или на цялото извикване
// Широки екрани: диаграмата (ECharts, SVG). Телефони (< 600 px): същите потоци като списък, групиран по източник („ДДС 720 млн. €“ → „→ Образование 120“ с ленти),
// табличният близнак (От / Към / Стойност, износ в CSV) остава обикновено разгъваемо под него. `unit` 'mln' (по подразбиране, „млн. €“) | 'pct' | 'num' | произволен текст; `unitLabel`
// заменя текста; `fmt:v=>string` носи собствена единица (не се добавя такава, освен ако не подадеш `unit`); `d` десетични знаци (по подразбиране: никакви, когато всяко число е цяло, иначе един).
// Числата се печатат сурови: преобразувай (на човек, лв.), преди да ги подадеш. Рисуват се само връзки с положително число; връзка с `value:null` остава в списъка
// и таблицата като „Предстои“, 0 или отрицателно число остава само в списъка и таблицата. Нищо за рисуване (всички null) или връзки, които се връщат (A→B→A; конзолата
// го казва) → без диаграма: надпис + списък при всяка ширина (`.sankey-flat`). Изобщо няма връзки → празно състояние.
// Идентификатори: обвивка `#<id>.sankey`, диаграма `#<id>-chart` (фигура `<id>-chart-fig`, таблица `<id>-chart-t`); менюто за споделяне намира фигурата. `height` по подразбиране е
// най-натоварената колона (320…720 px). Етикетите на последната колона получават място според дължината си (най-много 38 % от ширината) и завършват на „…“, когато са по-дълги.

import { progress, steps } from '../ui/progress.js';                  // [готов]
progress({ id:'s15-exec', label:'Изпълнение на приходите', value: 52.3, max: 100, text:'52,3% от годишния план', mock:false })
steps({ current: 3, total: 8, label:'Стъпка 3 от 8' })             // тънката лента със стъпките
// progress: `id` е задължителен; `text` по подразбиране е процентът („52,3%“); няма крайна `value` → няма лента, текстът казва „Предстои“ (пунктирана пътека,
// скрита за екранни четци); aria-valuenow се ограничава до 0…max; `mock:true` щрихова запълването и добавя значката. steps: всяка стъпка има скрито
// „Стъпка N (текуща/премината)“ за екранните четци.

import { timeline } from '../ui/timeline.js';                          // [готов]
timeline({ label:'Хронология на закона', items:[
  { date:'2026-07-21', title:'Приет на първо четене', text:'…', href: ctx.href('zakon'), kind:'event' },     // kind: event (по подразбиране) | expected | warning
  { date:'2026-10-01', title:'Отчетът към 31.08.2026', kind:'expected', status:'pending', id:'s13-tl-report' } ] })
// timeline: `date` е 'YYYY-MM-DD' (21.07.2026 в <time>), 'YYYY-MM' (юли 2026), 'YYYY' или произволен текст както е; `expected` добавя пунктирана маркировка и видимата
// дума „очаквано“, `warning` — кехлибарена маркировка, икона за предупреждение и изговорено „Внимание:“ — видът никога не е само цвят. `text` може да е разметка; `status` добавя значка;
// `id` прави елемента цел на ?to=. Елементите запазват реда ти (без сортиране). Няма елементи → нищо не се рисува. Връща <ol class="tl">; без mount.
```

### 5.19 `cards.js` и `gl.js` — [готов]

```js
import { linkCard, callout, facts, ext, reportLink } from '../ui/cards.js';
linkCard({ href:'#/razhodi', title:'Къде отиват парите?', text:'Разходите по функции.', kicker:'Стъпка 3 от 8', icon:'wallet', meta:'3 мин', cls:'' })
callout({ kind:'info', title:'Важно', body: html`<p>…</p>`, icon:'info' })       // kind: info | warn | bad | ok;  role="note"
facts([{ k:'Публикувано', v:'31.07.2026' }, { k:'Източник', v: html`<a href="#/danni">КФП</a>` }])   // <dl class="facts">
ext('https://www.minfin.bg', 'Министерство на финансите')    // външна връзка: нов раздел, икона, „(в нов раздел)“ за екранни четци
reportLink({ block:'s06-groups', val:'12 803,8', src:'kfp', type:'error', label:'Намерих грешка' })   // връзка към #/vrazka?type=…&from=<този екран>&block=&val=&src=

import { gl } from '../ui/gl.js';
html`<p>Над ${gl('dds', 'ДДС')} стоят…</p>`      // <a class="gl" data-gl="dds" href="#/rechnik/dds">ДДС</a>, отваря изскачащото с термина
```

Правила за речника: свързвай термин **веднъж на екран**, най-много 3 на абзац, никога в заглавия, числа, таблици или бутони. Slug-овете: `glossary.json` (`terms[].slug`). Контейнер с `data-gl-scan` получава тези правила автоматично (раздел 8).

### 5.20 `next.js`, `breadcrumbs.js` — [готов]

Обвивката строи и двете от таблицата с маршрутите (експортите `next(ctx)` / `crumbs(ctx)` ги заменят). Пряко ползване: `nextCard({ kicker, title, text, href, more:[{label, href}] })`, `breadcrumbs([{label, href}, …, {label}])`.

### 5.21 `sheet.js`, `toast.js` — [готов · интерфейсът е непроверен]

```js
import { sheet, popover, note } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
sheet.open({ title:'Как е изчислено', body: html`<p>…</p>`, wide:false, id:'s06-sheet', returnFocus: btn, onClose(){} })  // → {el, close}
popover.open(anchorEl, { title:'Източник', body: html`…`, align:'start', label:'…', onClose(){} })                 // закачено; на телефони е лист
note('Заглавие', 'Текст')                  // пряк път за лист само с текст
toast('Линкът е копиран')                  // вежлива жива област; затваря се сама
toast('Грешка', { kind:'bad' }) · toast('Изтрито', { action:{ label:'Отмени', onClick(){} }, ms: 7000 })
```

Листовете ползват родния `<dialog>` (капан за фокуса, Esc, неактивен фон); фокусът се връща на отварящия. Тяло: `html\`\``, DOM възел или низ (текст).
Отварянето на лист или изскачащо, докато друго е отворено, го заменя веднага (`onClose`на старото се изпълнява първо). Всяка промяна на хеша в адреса (връзка, Назад,`go()`) затваря всичко отворено и **не** връща фокуса, така че фокусът на рутера върху новия `h1`печели: листът никога не надживява екрана си. Същото важи за обикновено щракване върху`a[href^="#/"]`вътре в лист или изскачащо (рутерът го следва с`pushState`, който не вдига `hashchange`, затова и двата модула се затварят при самото щракване). `sheet.close()`и`popover.close()`са синхронни: когато върнат, диалогът го няма, заключването на превъртането е свалено, а фокусът е върнат на отварящия. Изскачащо на телефон (≤ 600 px) е лист; аргументът`close(back)` там се игнорира.

### 5.22 `view.js` — [готов] — малки чисти помощници за екрани

```js
import { yIndex, at, change, amount, perCapita, periodStatus } from '../view.js';
yIndex(years, ctx)            // индекс на ctx.period.year в масив `years`, -1 при липса
at(arr, years, ctx)           // arr[yIndex] ?? null
change(a, b)                  // процентна промяна от b към a; null, когато не може да се изчисли (никога NaN)
amount(ctx, { mln, pctGdp, d, scale })   // низ, съобразен с предпочитанията: единица 'pct' (иска pctGdp) → „36,9% от БВП“; perPerson → „8 645 € на човек“; leva → „… (≈ … лв.)“
perCapita(ctx, mln)           // евро на човек от ctx.core.population.persons, или „—“
periodStatus(ctx)             // 'forecast' за 2027/2028, иначе 'real'
chartUnit(ctx, { pct, max, d })   // (G1) числа за ДИАГРАМИ, които следват „% от БВП“ и „на човек“: pct = можеш да подадеш стойности в % от БВП, max = най-голямото |млн. €| на диаграмата, d = подмяна на десетичните знаци
//   → { kind:'pct'|'person'|'mlrd'|'mln', unit, d, conv(mln, pctGdp) → number|null, fmt(v), axis(v), option(horizontal) }; лева остава само в текста (диаграмите ги игнорират)
//   const u = chartUnit(ctx, { pct: true, max });
//   chart({ …, unit: u.unit, d: u.d, fmt: u.fmt, option: u.option(), series: [{ data: mln.map((m, i) => u.conv(m, pg[i])) }] })   // option(true) за хоризонтални ленти
moneyCol(ctx, { d = 1 })      // (G1) ПАРИЧНА колона на ТАБЛИЦА, която следва „на човек“ и „и в лева“: връща { unit: 'млн. €' | '€ на човек', d, raw(mln) → number|null, text(mln) → '12 803,8' | '—', lev(mln) → '≈ 25 040,2 млн. лв.' | '' }
//   const m = moneyCol(ctx);
//   колона { key:'v', label:'Приходи', unit: m.unit, d: m.d, fmt: (v, row) => html`${m.text(row.mln)}${m.lev(row.mln)}` };  ред { mln, v: m.raw(mln) }
//   суровата стойност Е показаната, така че сортирането и износът в CSV съвпадат с екрана
```

### 5.23 Какво обвивката вече осигурява (не го прави наново)

Едноредова горна лента с пет падащи групи („Начало“, „Изпълнение“, „Бюджет“, „Данъци и контекст“, „Данни и проект“), бутон „Бюджет 2027“, избор на период и винаги видима лупа за търсене. Под 1241 px групите и червеният бутон са в чекмеджето „Меню“; долната лента с табове остава до 960 px включително. Хедърът е компактен на всички ширини. Обвивката осигурява още банер „Примерни данни“, футър с навигационните групи и „Легенда“, бележка за липса на връзка, връзка „прескочи към съдържанието“, `aria-live` области и изскачащи за речник, търсене, източник и споделяне. Няма панел „Настройки“ или превключвател на тема.

### 5.24 `calc.js` — [готов] — чиста логика на калкулатора (притежател: авторът на екрани G3; споделена между S18 и мини калкулатора на S01)

Без DOM, без fetch, без импорти; всяка ставка е аргумент, нищо не е вкарано в кода. Парите са евро на месец, освен ако името не казва годишни; резултатите **не са закръглени** (закръгля се при печат с `eur()` или с `apportion()` за таблици, които трябва да се сумират).

```js
import { employmentCalc, ruleSets, receiptByFunction, indirectTaxes, apportion } from '../calc.js';
const sc = ctx.data.rates.scenarios.find(s => s.id === 'employment');          // data/rates.json
employmentCalc(gross, sc, { rules:'from' | 'until' | 'year', tzpb })   // → {gross, rules, insurable, maxInsurable, capped, employeePct, employerPct, incomeTaxPct, tzpbPct, taxBase,
                                                                       //    employeeContrib, incomeTax, employerContrib, net, monthlyDirect, yearlyDirect,
                                                                       //    employeeParts{doo,upf,health}, employerParts{doo,upf,health,tzpb}}  или null
ruleSets(sc)                                                           // [{id:'until'|'from', from, to, months, maxInsurableEur}] за етикетите на превключвателя
receiptByFunction(yearlyEur, functions, { index:1, decimals:2, days:365 })   // functions = ctx.core.functions (поле mln) → [{id, name, short, yearEur, dayEur, sharePct}], редовете се сумират до общото
indirectTaxes(input, parameters)                                      // input: {vat20Eur, vat9Eur, vat0Eur, fuelType, fuelLitres, fuelPrice, tobaccoPacks, tobaccoPrice, sticksPerPack, date}
                                                                       // parameters = indirect-tax-parameters.json → {vat, fuelExcise, tobaccoExcise, total, vatParts, approx:true}; null, където липсва вход
apportion(values, total, decimals)                                     // закръгля пропорционални дялове така, че закръглените части да се сумират до закръгленото общо (метод на най-големия остатък)
```

`employmentCalc` връща `null` (→ покажи подсказка или „предстои“, никога число), когато брутото не е число над 0 или сценарият е „предстои“/непълен. `indirectTaxes` винаги е оценка (`approx:true`): формулирай го „ориентировъчно“.

### 5.25 `map.js` — [готов] — карта с оцветени области (притежател: авторът на екрани G4; ползва се от S20 / S21)

Чист SVG, рисуван от GeoJSON: без плочки, без библиотека, без мрежа. Областите са истински `<a href>` вътре в SVG, така че отваряне / нов раздел се държат като при всяка връзка. Фигурата няма заглавия.

```js
import { mapFigure, filterMap, binEdges } from '../ui/map.js';
mapFigure({ id:'s20-karta', title:'Трансфер на жител', sub:'€ на жител по общини', geo,        // geo = ctx.data[...] GeoJSON FeatureCollection, WGS84; feature.properties.id === item.id
            items:[{ id:'BLG03', label:'Благоевград', sub:'област Благоевград', value:345.2, group:'BLG', href: ctx.href('obshtina', { code:'BLG03' }), mock:false, aria:'…' }],
            unitLabel:'Трансфер на жител, €', valueLabel:'трансфер на жител', fmt: v => eur(v), d:0, bins:5 /* или [120,250,400,700] */,
            focusGroup:'BLG', selected:'BLG03', mock:false, categoryLabel:'Община', groupLabel:'Област', hint:'…', help:'…', desc:'…', openLabel:'Виж общината', twin:true, cls:'' })
filterMap(figureEl, ids | null)      // затъмнява всяка област, която не е в ids (null изчиства); работи преди или след mount; страница със собствено търсене го вика от `mount`
binEdges(values, n)                  // чиста: границите на класовете, които ползва легендата (квантили с две значещи цифри, никога празен клас)
```

- `value: null` е „няма данни“ (точкувано, никога най-ниският клас). Област без елемент се рисува като неутрален контекст. `focusGroup` приближава към елементите на тази група и избледнява останалите.
- Цветът никога не е единственото кодиране: информационният ред, достъпното име на областта, легендата (диапазони с броячи) и по избор табличният близнак (`twin:true`, храни и `share.attach` за CSV) носят числата. `mock` (или `mock:true` на елемент) → щриховано наслагване, значка „Примерни данни“ и `data-mock-fig`.
- Клавиатура: ЕДНА спирка с Tab (подвижен tabindex); стрелките скачат до най-близката област в тази посока, Home/End първа/последна (по азбучен ред), Enter отваря, Space избира/отваря. Мишка: задържане показва картата, щракване отваря. Докосване: първото докосване показва преглед (карта с връзка), второто отваря. `ctx.announce` изговаря избора.
- Събития (възходящи от фигурата): `map:select` `{id}`; `map:filter` `{ids}` е това, което изпраща `filterMap`. Оживява се през `data-ui="map"`.
- Геометрията не се чете или няма елементи → кратка бележка („Картата не се зареди. Същите данни има в списъка.“): винаги рисувай списъка до картата. Цветовете идват от токените (блок `.map-*`, светла/тъмна/принудителна тема).

### 5.26 `feedback.js` — [готов] — локалната кутия „изпратено“ (притежател: авторът на екрани G5; ползва се от S03 и S27)

Нищо не се изпраща никъде. Каквото посетителят „изпрати“, остава в този браузър (ключ `bns.feedback.v1` в `localStorage` през `safe`; в паметта до презареждане, когато хранилището е блокирано). Пазят се най-новите 30.

```js
import { add, list, clear, SENT, TYPES, MAX_TEXT } from '../feedback.js';
add({ type:'error' | 'unclear' | 'idea', text, route?, term?, from?, block?, val?, src?, topic?, contact? })   // → записаният запис {id, type, text, at, …, persisted}; никога не хвърля
list()    // записи, най-новите първо          clear()    // забравя всички
SENT      // единственото изречение за успех на Mock („Благодарим. В истинското приложение това отива при екипа.“)      TYPES  // {error, unclear, idea} → видими имена във формата
```

### 5.27 `search.js`, `searchlib.js` — [готов] — палитрата за търсене и двигателят (страницата S28 ползва същия двигател)

Лупата `#btn-search` е бутон с етикет „Търсене“ и цел поне 44×44 px на всяка ширина. Тя отваря същата палитра под хедъра, поставя фокуса в полето и отразява състоянието чрез `aria-expanded`. Escape, щракване отвън и бутонът за затваряне връщат фокуса към лупата. На телефон панелът заема ширината на екрана; на десктоп е вдясно под бутона. В блока за изпълнение на плана няма отделно поле за търсене.

Палитрата принадлежи на обвивката (`/`, Ctrl/Cmd+K, бутонът в горната лента, всеки бутон с `data-action="search"`: не строй друга). Страница я отваря с действие на `emptyState`/`errorState` `{ label:'Търси', action:'search' }` или в код:

```js
import { openPalette, closePalette } from '../search.js';
openPalette(openerEl?, { q:'ДДС' })      // → {input, close, focus}; идемпотентна: когато е отворена, само връща фокуса на полето
import { parse, run, mark, getIndex, screenOf, countText, hiddenText, groupLabel, POPULAR, MAX_QUERY } from '../searchlib.js';
const ix = await getIndex();             // {entries, hasIndex, groups}; кеширан, НИКОГА не отхвърля (файлът с индекса е по избор)
const toks = parse(q);                   // [], когато няма какво да се търси (празно или само едносимволни думи)
const { hits, hidden, fuzzy } = run(ix.entries, toks, { onlyReal });   // най-доброто първо; hidden = примерни попадения, отпаднали заради „Само реални данни“; fuzzy = само почти-попадения
mark(hit.title, toks)                    // SafeHtml: съвпадналите думи в <mark>
countText(3) → '3 резултата'          hiddenText(2) → 'Скрити са 2 примерни резултата.' (това, което „Само реални данни“ скрива; 1 → 'Скрит е 1 примерен резултат.')
```

Попадение е `{group, title, sub, value, period, status, href, …}`; `group` ∈ indicators · institutions · municipalities · measures · terms · datasets · screens (`groupLabel(g)` дава българското заглавие).

**Индекс.** `data/search-index.json` (`docs/data-spec.md` §3.21, **по избор**: 404 = „предстои“) дава първите шест групи. Обвивката сама добавя **екраните** (всеки маршрут с шаблон и без задължителен параметър) и, докато индексът няма собствени редове `terms`, речника. Без файла палитрата и S28 казват „Предстои: показатели, ведомства и общини. Засега търсим по екрани и понятия.“ и пак работят. Екраните не четат индекса; за да направиш нещо откриваемо, поискай ред в индекса от DATA или добави ключови думи към екрана в `SCREEN_KW` (searchlib.js).

**Съвпадение.** Кирилица/латиница (`plovdiv`, `dds`), главни/малки и знаците над буквите, синоними („ддс“ = „данък върху добавената стойност“, „мвр“ = „вътрешни работи“, …), коренът на думата и членът („образованието“ намира „образование“), и резервен вариант за почти-съвпадение, когато нищо не съвпада точно („дефецит“ → „Бюджетен дефицит“, с изрична бележка). Заявка ≤ 120 знака (`MAX_QUERY`).

**Поведение на палитрата.** Показва ≤ 8 попадения плюс ред „Покажи всички N резултата“ към `#/tarsene?q=…`; първото попадение е активно, така че „ДДС“ + Enter го отваря. ARIA combobox: фокусът остава в полето, `aria-activedescendant` следва ↑/↓, Enter следва връзката (Ctrl/Cmd+Enter = нов раздел), Esc затваря, фокусът се връща на отварящия (не и след навигация: рутерът фокусира новия `h1`). Примерните попадения са скрити при „Само реални данни“ с бутон „Покажи“. Резултатите се обявяват вежливо след кратка пауза.

**Подробности за подредбата.** Попаденията в името бият попаденията в текста; всяка дума трябва да съвпада (И); заявка с няколко думи получава малък бонус, когато думите стоят една до друга в този ред (`toks.phrase`: +2 в името, +1 в текста), така че „заплата преди удръжки“ подрежда „Брутна заплата“ първа, а кодът на програма „1000.02“ подрежда реда, който наистина съдържа „1000 02“.

**Страницата за търсене S28** (`#/tarsene?q=<текст>&g=<id на група>`) е същият двигател с повече място: резултати по групи (5 на група, „Покажи всички N в …“ отваря една група, 40 на страница + „Покажи още“), чипове за групите, карта на попадение показва заглавие, подзаглавие · период, стойността, значка за състоянието и „Екран: …“. Обновява се **на място** докато пишеш (полето е извън кутията с резултатите и никога не се подменя; `?q=` следва с `history.replaceState`) и обявява броя веднъж, след като писането спре. Връзка към търсенето от твоя страница е просто `href="#/tarsene?q=…"` (кодирай текста) — екраните иначе никога не четат и не пишат състоянието на търсенето. **На S28 `/` и Ctrl/Cmd+K и бутонът в горната лента фокусират собственото поле на страницата** (`openPalette` търси `input[data-search-field]` и го връща, вместо да отвори второ търсене); сложи този атрибут на всяко бъдещо поле за търсене, което трябва да прави същото.

### 5.28 `muni.js` — [готов] — помощници за общини (притежател: авторът на екрани G4; ползва се от S20 / S21)

Чисти: без DOM, без store, без fetch, без състояние на модула; импортират се само `format.js` и `searchlib.js` (`norm`, `lat`). Парите в `municipalities.json` са в хил. €, `perCapita` е в € на човек; непознато число е липсващо или `null`, никога 0. Примерният файл `mock/municipal-finance.json` декларира собствена единица в `meta.unit`.

```js
import { TYPES, KEYS, popOf, totalOf, pcOf, pcType, aggregate, rankOf, similarTo, search, normQuery, unitFactor, financeIndex, khilText, eurText, munName } from '../muni.js';
TYPES / KEYS                 // петте вида трансфер (delegated, equalizing, winterRoads, capital, otherTargeted) като {key, label, short, text}; KEYS = ['total', …]
popOf(m) · totalOf(m) · pcOf(m) · pcType(m, key)      // население · общ трансфер (хил. €) · € на човек · € на човек за един вид (null, когато е неизвестно)
aggregate(list)              // {count, population, popCount, sum{key}, perCapita{key}}
rankOf(list, m)              // {rank, of} по € на човек, 1 = най-много, или null
similarTo(list, m, n)        // n-те общини с най-близко население, най-малките първо
search(list, q)              // {hits, via:'name'|'region'|null} (кирилица или латиница, със или без „Община“); null за празна заявка
unitFactor(doc)              // 1 за „хил. €“, 1000 за „млн. €“, null за непозната единица (тогава числата остават „предстои“)
financeIndex(doc)            // Map id → запис M03 в хил. €: {id, ownRevenue, expenditure, debt, balance, quarterly[], why, mock}
khilText(v, d, leva) · eurText(v, d, leva) · munName(m)     // суми, съобразени с „и в лева“ · „Община Благоевград“ / „Столична община“
```

Пълният списък по функции и точните форми са в коментара в началото на файла.

### 5.29 `unit-switch.js` — [готов] — „Покажи сумите в: В евро | % от БВП“ (притежател: авторът на екрани G1; ползва се от S06 / S07 / S08)

Обвивката няма контрол за общото предпочитание `unit` (менютата ѝ носят период, тип потребител, „На човек“ и „Сумите и в лева“, но не и единицата), затова всеки екран, чиито числа съществуват и в млн. €, и като % от БВП, носи този. Това е `seg` (раздел 5.13) с видим етикет и по избор бележка.

```js
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';
unitSwitch(ctx, { name:'s06-unit', note:'…' })   // → SafeHtml; `name` е уникално в екрана (радио идентификатори `${name}-eur` / `${name}-pct`); стойност = ctx.store.get('unit'); след `note` компонентът винаги добавя „Изборът остава и на другите екрани.“
bindUnitSwitch(root, ctx, name)                  // → почистване; викай от mount(): изборът прави ctx.store.set('unit', 'eur'|'pct'); рутерът рисува наново и обявява „Показваме в евро / в проценти“
```

`unit` е в `RERENDER_KEYS`, така че не е нужно нищо друго; стойността се чете с `view.chartUnit(ctx, …)` (5.22) за диаграми и с `ctx.store.get('unit')` за числа. Трите му CSS правила (`.unit-switch`, `.unit-switch-label`, `.unit-switch-note`) са в края на `components.css`. S13 има собствено копие на контрола и може да премине към този.

---

## 6. Диаграми (`chart(spec)` и `charts.js`)

```
id         задължителен, уникален в екрана. DOM id на диаграмата; `${id}-fig` е фигурата; `${id}-tbl` е таблицата-близнак
type       'bar' (колони) | 'barh' (хоризонтални ленти) | 'line' | 'donut' | 'treemap' | 'sankey' | 'option' (суров ECharts option в `option`)
title, sub текст на надписа; sub обикновено е единицата
unit, d    текст на единицата и десетични знаци за оста/подсказката/таблицата
fmt        v => string  (заменя unit/d в подсказките, етикетите и таблицата)
categories категории по x (bar/barh/line)
series     [{ name, data:[number|null|{value, mock}], color, mock, dashed, dashFrom, stack }]
data       donut/treemap: [{ name, value, color?, mock?, children? }]   (treemap: възел от най-горното ниво с `children` получава заглавна лента с името и сбора си)
nodes, links   sankey: nodes:[{name, mock?}], links:[{source:name, target:name, value, mock?}]   (екраните ползват `ui/sankey.js`, който го обвива със списъка за телефони; раздел 5.18)
stack, area    натрупване на колони/линии; запълване под линия
mock       цялата диаграма е примерна (щриховка + значка „Примерни данни“); по серии чрез series[i].mock, по точки чрез {value, mock:true}
height, labels, legend:false, desc, categoryLabel, table:{columns,rows}, emptyTitle, emptyText, cls, colors, center, min, max
labelWidth    само barh: ширина в px на етикетите на категориите; 'auto' = колкото изисква най-дългото име (най-много 320 px); по подразбиране 168 px (108 px под 480 px)
labelOverflow само barh: 'truncate' (по подразбиране: име, което не се събира, завършва на „…“) | 'break' | 'breakAll' (пренася на следващия ред)
interval      само bar/line: колко етикета на категории се прескачат между два показани (0 = всички, 'auto' = правилото на ECharts); по подразбиране: изчислява се по най-широкия етикет и ширината на диаграмата
```

- **Цветовете** следват токените, никога собствен hex: слот `1..8` (`color:3`), `'other'`, име на токен (`'--rev'`, `'--exp'`), или hex само в краен случай. По подразбиране е по реда на сериите (`--series-1…8`); повече от 8 категории се свиват в „Други“. Серия запазва цвета си, когато други са скрити.
- **Прогнозни** години: при серия-линия `dashFrom: k` (индекс на ПЪРВАТА прогнозна точка) рисува плътно точките преди k и пунктирано линията от точка k-1 нататък. `charts.js` я разделя на две серии на ECharts с едно име и един цвят (ECharts игнорира стил на линията по точки), така че легендата и подсказката показват серията веднъж, а пунктираната половина започва от последната плътна точка без втори маркер. `dashFrom` ≤ 0 пунктира цялата линия, k на или след последната точка я оставя плътна; натрупаните линии го игнорират (двете половини биха се сумирали), а `mock` серии така или иначе са пунктирани изцяло. `series.dashed:true` пунктира цяла линия. За колони няма пунктир: маркирай прогнозните точки `{ value, mock:true }` (щриховани) или ги сложи в отделна серия. Винаги пиши „Прогноза“ в `sub` или в името на легендата.
- **Дълги имена на категории при `barh`** (програми, функции): `labelWidth:'auto'` прави място за най-дългото име (никога повече от 45% от диаграмата, така че на телефон дългите пак завършват на „…“; пълното име е в таблицата-близнак и в подсказката). `labelOverflow:'break'` пренася вместо да реже: дай на диаграмата `height` с място за два реда на лента (около 56 px на лента). Отрязването се мери с истинския шрифт (`fitText`), така че кирилско име ползва цялата си налична ширина.
- **Много категории** (11–42 години или месеца) при `bar`/`line`: етикетите на категориите се разреждат автоматично (всеки 2-ри, 3-ти … докато най-широкият се събере в слота си, мерено с истинския шрифт), така че никой екран не се нуждае от собствен `axisLabel.interval`; `interval:0` налага всеки етикет. **Етикетите със стойности вътре в лентите** (`labels:true` при диаграма с `stack:true`) са черни или бели според запълването на серията — онова с по-висок контраст (≥ 4,5:1 при всяко запълване от палитрата, светло и тъмно); `charts.js` изнася същия избор като `textOn(fill)` за собствени етикети.
- **Само една ос.** Две мерки с различен мащаб → две диаграми.
- **Стойност `null` е пропуск**, не 0.
- **Достъпност:** диаграмата е `role="img"` с генерирано име (`type + title + desc`); таблицата-близнак носи данните. Пиши `desc` като едно изречение с извода („Приходите растат всяка година“).
- Празни данни (няма стойности в серии) → автоматично `emptyState`.
- Смяната на тема прерисува на място. ECharts се зарежда само когато диаграма стане видима: страници без диаграми никога не го зареждат.
- Ниско ниво (рядко е нужно): `charts.js` изнася `loadECharts, tokens, rgba, textOn, colorOf, merge, buildOption, chartImage, textPx(text, font) → px, fitText(text, maxPx, font) → text с „…“`. Не ползвай собственото `overflow:'truncate'` на ECharts с `width` за кирилица в собствен `option`: то брои всяка нелатинска буква за широк знак и реже на около половината от мястото; подай `formatter: v => fitText(v, px, '13px ' + tokens().font)`.

---

## 7. Споделяне, CSV, PNG, вграждане

### 7.1 През `block()`

`block({ …, source:[…], share:true })` (по подразбиране, когато е зададен `source`) регистрира блока и слага бутон „Сподели“ в заглавната му част. Менюто предлага: **копиране на текст** (винаги с реда за източника; примерни → „ПРИМЕРНИ ДАННИ: стойностите са измислени, не ги цитирай.“), **копиране на връзка** (`#/…?to=<id на блока>`, запазва `?per=`, маха `?demo`), **PNG** (заглавие + диаграмата или таблицата + долен ред с източник; диагонален воден знак „примерни данни“, когато данните са примерни), **CSV** (UTF-8 с BOM, разделител `;`, колони `статус` и `източник`; примерните редове казват `Примерни данни`), **код за вграждане** (iframe на S29, само когато е зададено `embed`) и системното меню за споделяне там, където браузърът има такова. CSV/PNG автоматично вземат първата видима `chart`/`dataTable` в блока.

```js
block({ id:'s06-groups', title:'…', source:['asbp'], share:{
  text: 'Приходите за 2026 г. са 55,5 млрд. €.',      // низ или () => низ; по подразбиране: редът `sub` (менюто винаги добавя първо заглавието, после източника и връзката)
  embed: 's06-groups-bar',                             // id на диаграма → #/embed/prihodi.s06-groups-bar (виж 7.5); или true
  embedParams: { code: ctx.params.code },              // само за екран, чийто адрес има параметри (#/vedomstvo/:code): те пътуват като ?code=… (7.5)
  table: { columns:['Група','млн. €'], rows:[['ДДС', 12803.8]] }   // само когато вътре няма близнак dataTable/chart
}, body: … })
```

### 7.2 Без блок

```js
import * as share from '../share.js';
share.register('s05-note', { title:'…', sub:'…', text:'…', source:['kfp'], asOf:'2026-07-31', status:'real', chart:'chartDomId', table:{ columns, rows, statuses }, embed:true });
html`${share.shareButton('s05-note', { label:'Сподели' })}`
```

Регистърът се изчиства при всяка навигация. Други помощници (за тестове и инструменти): `textFor/linkFor/csvFor/embedFor/embedHash(spec)` (`embedHash` = `#/embed/<routeKey>.<chartId>?per=…&<embedParams>`), `renderPng(spec,{watermark,pixelRatio})`, `pngDiff(spec)`, `copyText`, `download`.

### 7.3 Правилото, което не се огъва

Всичко примерно напуска страницата означено: ред в текста, воден знак на PNG, колона за статус в CSV, щриховка на екрана.

### 7.4 Дълбоки връзки

`?to=<id>` на кой да е елемент: превъртане + подчертаване + фокус (отваря `<details>`, показва скрити табове). Слагай `id` на блокове и редове, които искаш да се споделят.

### 7.5 Вграждане (S29) [готов]

`#/embed/<routeKey>.<chartId>[?per=…&<параметри на домакина>]` рисува ЕДНА диаграма сама на гола страница (без горна лента, без меню): диаграмата с таблицата-близнак „Таблица с данните“, реда за източника (`Източник: …`, външни връзки, `данни към <asOf>`), значката за състоянието и „СИГМА Бюджет →“. Примерните данни получават щриховката, значката и диагонален воден знак „Примерни данни“. Рамката е направена за `<iframe>` от менюто за споделяне (720 × 440) и се побира във всякакъв размер: диаграмата взема останалата височина (мин. 160 px, макс. 640 px). Вътре в рамката нищо не навигира самата рамка: връзките към източника и сайта са абсолютни и се отварят в нов раздел. Заглавие на документа = заглавието на диаграмата.

За да стане диаграма вградима, страницата-домакин изнася карта `embeds` (конструкторът е същият, който ползва `render`) и предлага `embed: '<chartId>'` в `share` на блока си:

```js
export const needs = ['revenue'];
export const revenueChart = ctx => ({ id:'s06-groups-bar', type:'barh', title:'…', /* … */ series:[…] });
export const embeds = { 's06-groups-bar': ctx => ({ chart: revenueChart(ctx), source:['asbp'], asOf: ctx.data.revenue.meta.asOf, status:'real' }) };
// в render(): chart(revenueChart(ctx))
```

- `routeKey` = `key` на реда на домакина в таблицата с маршрутите (не идентификаторът му `S06`); идентификаторът на диаграмата е всичко след ПЪРВАТА точка, така че може да съдържа точки. `embeds[id](ctx)` може да е асинхронна; връща `{chart, source?, asOf?, status?}`, `null` (данните не са готови → състояние „предстои“) или хвърля `NotFound` (→ „не е намерена“). `status:'mock'` прави цялата диаграма примерна.
- S29 зарежда домакина както рутерът (`router.prepare`: неговите `needs`, включително по избор `'x?'`, и `styles`) и вика конструктора с ctx на ДОМАКИНА (`data`, `core`, `period`, `query`, `params`, `store`). `?per=<период>` е периодът, както навсякъде. Дръж конструктора свободен от всичко, което иска DOM на екрана или неговите контроли: вградената диаграма е състоянието на екрана по подразбиране.
- Домакин, чийто адрес има параметри (`#/vedomstvo/:code`, `#/obshtina/:code`, `#/razhodi/:fn`), ги получава обратно през query параметри със СЪЩОТО ИМЕ: `share:{ embed:'s09-bar', embedParams:{ code: ctx.params.code } }` → `#/embed/vedomstvo.s09-bar?code=1000`. Липсващ ЗАДЪЛЖИТЕЛЕН параметър → „Графиката не е намерена“. Ключовете в `embedParams` са прости имена (никога `per`/`demo`), стойностите — примитиви.
- Резултати: непознат ключ или id на диаграма → празно състояние „Графиката не е намерена“; задължителните данни на домакина са „предстои“ → състояние „Графиката предстои“; грешка при зареждане → състояние „грешка“ с „Опитай пак“; `?demo=loading|empty|error|pending` както на всеки екран.
- `#/embed/selftest` е вградена, очевидно синтетична диаграма (кръгли числа в „условни единици“, изцяло примерна): собственик на сайт може да провери, че рамката се зарежда, без нито едно реално число.
- `errorState` има опция `link:false` (без връзка „Откъде са данните“): вътрешна връзка в iframe би навигирала самата рамка. Ползвай я във всеки гол контекст.

---

## 8. Речник — [готов] (`js/glossary.js`)

Разметка: `gl('dds', 'ДДС')` (5.19) или на ръка `<a class="gl" data-gl="dds" href="#/rechnik/dds">ДДС</a>`. Щракването отваря изскачащо с термина (долен лист на телефони): определение, пример, свързани термини (щракване подменя съдържанието на място, „← <предишен термин>“ връща назад), собствените връзки „Виж в бюджета“ на термина и „Пълно обяснение в речника“. Второ щракване върху същата дума, Esc, щракване извън него или Tab след последната връзка го затваря и връща фокуса на думата; всяка навигация го затваря. Без JS, с ctrl/средно щракване, докато `data/glossary.json` е „предстои“, или за непознат slug то е просто връзка към `#/rechnik/<slug>`: никога мъртво щракване, никога грешка. Етикетите за обхват и опциите `gl:` на KPI се свързват по същия начин.

**Автоматично свързване.** Сложи `data-gl-scan` на елемента, който държи течащ текст (подзаглавие, блок абзаци, тяло на разгъваемо). След всяко рисуване рутерът пуска скенера веднъж; той свързва първото споменаване на всеки термин в **екрана**: най-много 3 на абзац; никога вътре в заглавия, таблици, бутони, връзки, `.kpi`, `.chip`, `.eyebrow` или `[data-gl-skip]`; думата веднага след число („5,7% от БВП“, „70 млн. евро дълг“) остава обикновена; термин, свързан на ръка с `gl()`, се смята за свършен; текстът, който се вижда, се свързва преди текста в затворени `<details>`. Съвпадат само подбрани форми (~60 термина с членове и множествено число: ДДС, БВП, КФП, дефицит, държавният дълг, лихвите, акцизи, брутна заплата …). Обикновени думи сами по себе си („бюджет“, „приходи“, „разходи“) никога. Идемпотентно е. Текст, който вмъкваш по-късно (табове, филтри, `innerHTML` в `mount`), не се сканира автоматично: викай `import('../glossary.js').then(m => m.scan(el))`.

```js
import { ready, termOf, titleOf, openTerm, scan } from '../glossary.js';
const g = await ready();            // {terms, by: Map(slug → term)}; отхвърля с data.PendingError / LoadError, когато файлът липсва
termOf('kfp')                       // обектът на термина (синхронно, след ready())    titleOf(term) → 'Консолидирана фискална програма – КФП'
openTerm(anchorEl, 'dds')           // това, което вика общият обработчик на щраквания    await scan(el) → брой добавени връзки
```

---

## 9. Помощници за форматиране (`format.js`) — [готов]

Всички печатат **„—“ за невалиден вход, никога `NaN`/`undefined`.** Разделител на хилядите — тесен неразкъсваем интервал, десетична запетая, типографски минус „−“.

| Помощник                                                    | Пример → резултат                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `num(v, d=0, {group=true, sign=false})`                     | `num(12803.8,1)` → `12 803,8`                                                                                 |
| `pct(v, d=1, {sign})`                                       | `pct(53.14)` → `53,1%`                                                                                        |
| `pp(v, d=1)`                                                | `pp(1.5)` → `+1,5 пр.п.`                                                                                      |
| `delta(v, d=1)`                                             | `delta(11.2)` → `+11,2%`                                                                                      |
| `money(mln, {scale:'auto'\|'mln'\|'mlrd'\|'eur', d, leva})` | `money(26347.4)` → `26,35 млрд. €`; `money(738.4)` → `738,4 млн. €`; `leva:true` добавя `(≈ 51,53 млрд. лв.)` |
| `moneyParts(mln, o)`                                        | `{ v:'26,35', u:'млрд. €' }` за големи числа                                                                  |
| `khil(v, d=1)`, `eur(v, d=0)`, `leva(v, d=0)`               | `4 927 964,0 хил. €`, `8 645 €`, `16 908 лв.`                                                                 |
| `perPerson(mln, persons)`                                   | евро на човек                                                                                                 |
| `date(iso, long=false)`                                     | `31.07.2026` / `31 юли 2026`                                                                                  |
| `monthName(m, short)`, `monthYear(y, m)`                    | `юли`, `юли 2026`                                                                                             |
| `plural(n, one, many)`                                      | `plural(2,'проект','проекта')` → `2 проекта`                                                                  |
| `moneyLabel(mln)`                                           | за `aria-label`: „26,35 милиарда евро“                                                                        |
| `arrow(v)`                                                  | ▲ ▼ →                                                                                                         |
| `parseQuery`, `buildQuery`, `csvCell`                       | помощни функции                                                                                               |
| константи                                                   | `EUR_RATE` (1,95583), `NNBSP`, `NBSP`, `MINUS`, `DASH`                                                        |

Тон: кратки изречения, действителен залог, обясни или свържи жаргона, кавички „…“, тире в диапазони (2026–2028), дати `ДД.ММ.ГГГГ`, без емоджи, без „n/a“.

---

## 10. CSS

### 10.1 Токени (`css/tokens.css`) — никога не вкарвай цветове или размери в кода

Сайтът използва само светлата тема. Сървърът задава `data-theme="light"`; системната тема и старите запазени предпочитания се игнорират. Тъмните CSS палитри са запазени, но не могат да бъдат избрани. Ползвай семантичните цветови токени.

- Цветове: `--bg --surface --sunk --overlay --ink --muted --faint --line --line-strong --data --data-hover --data-soft --data-2 --data-3 --on-data --accent --accent-soft --accent-ink --on-accent --focus --rev --exp --series-1…8 --series-other --ok --warn --bad (+ -soft) --st-real|partial|pending|mock|forecast (+ -soft) --hatch --hatch-step`.
- Разстояния `--sp-1…7` (4/8/12/16/24/32/48 px), радиуси `--r-1 --r-2 --r-3 --r-full`, шрифтове `--font-body --font-head --font-mono`, размери `--fs-xs --fs-s --fs-0…--fs-6`, `--lh-tight --lh-body`, сенки `--shadow-1 --shadow-2`, движение `--t-fast --t-med --ease`.
- Разположение `--nav-w --content-w --topbar-h --tabbar-h --gutter`. Прагове: 400 / 600 / 900 / 1200 px. Колоната със съдържание е ≤ 1040 px.

### 10.2 Готови класове

`.stack` `.stack-lg` (вертикален ритъм), `.cluster` `.cluster-lg` (ред с пренасяне), `.spread` (space-between), `.grid` (автоматично побиращи се колони, мин. 15 rem) `.grid-2` `.grid-3` (свиват се на телефони), `.prose` (68 ch), `.muted` `.small` `.num` (табличен) `.nowrap` `.sr-only` `.hl` (подчертаване), `.btn .btn-primary .btn-quiet .btn-sm`, `.input .select`, `.icon-btn`, `.st` (значка за състояние), `.scope`, `.src-btn`, `.state*`, `.mock-badge`, `.block*`, `.kpi*`, `.tab-list`, `.disc`, `.table-wrap table.data`, `.rank*`, `.tl*`, `.chips .chip`, `.prog .steps`, `.fig*`, `.tmap*`, `.sankey*`. Децата на `.page-body` вече са разделени (`margin-top: var(--sp-5)` между съседи): не е нужна обвивка.
Щриховка: **само** `data-mock="true"` (или `.hatch`) щрихова елемент. Не го слагай върху контейнер с текст.

### 10.3 CSS на екран в собствен файл

```js
export const styles = ['s06-prihodi'];       // зарежда css/pages/s06-prihodi.css (веднъж, никога не се изважда)
```

```css
/* css/pages/s06-prihodi.css — ограничи ВСИЧКО; файлът остава зареден и след като напуснеш екрана */
.page[data-route="S06"] .s06-split { display: grid; gap: var(--sp-4); }
@media (min-width: 900px) { .page[data-route="S06"] .s06-split { grid-template-columns: 2fr 1fr; } }
```

Правила: всеки селектор започва с `.page[data-route="SNN"]` (или ползва клас `sNN-`), само токени, без `!important`, без селектори на елементи без обхват, първо мобилен изглед, без фиксирани ширини в пиксели над 400 px, нищо не бива да прелива хоризонтално. Трябва ти нещо общо в споделения CSS? Раздел 15.

---

## 11. Маршрути и връзки

Таблица с маршрутите (`js/routes.js`; също `window.__ROUTES__` в браузъра). Граматика на шаблона: `literal | :name | :name? | :name(regex)(?)`. `?per=` (период) е глобален; `?to=` и `?demo=` също са глобални.

| Id  | Ключ            | Шаблон на хеша                        | Модул на страницата (`apps/web/client/`) | h1 / заглавие            | Група · стъпка | Периоди               | „Следва“ (id) | Примерни адреси (посещавани от проверката)                  |
| --- | --------------- | ------------------------------------- | ---------------------------------------- | ------------------------ | -------------- | --------------------- | ------------- | ----------------------------------------------------------- |
| S01 | `start`         | `#/`                                  | `pages/s01-nachalo.js`                   | Какъв е бюджетът?        | start 1        | all                   | S06           | `#/`                                                        |
| S02 | `patevoditel`   | `#/patevoditel/:step([1-8])?`         | `pages/s02-patevoditel.js`               | Пътеводител              | start          | none                  | S01           | `#/patevoditel` `#/patevoditel/3`                           |
| S03 | `rechnik`       | `#/rechnik/:term?`                    | `pages/s03-rechnik.js`                   | Речник                   | start          | none                  | S02,S01       | `#/rechnik` `#/rechnik/dds`                                 |
| S04 | `5-minuti`      | `#/5-minuti`                          | `pages/s04-5-minuti.js`                  | Бюджетът за 5 минути     | start          | none                  | S02,S06       | `#/5-minuti`                                                |
| S05 | `pari`          | `#/pari`                              | `pages/s05-pari.js`                      | Парите                   | budget         | all                   | S06           | `#/pari`                                                    |
| S06 | `prihodi`       | `#/prihodi/:source?`                  | `pages/s06-prihodi.js`                   | Откъде идват парите?     | budget 2       | all                   | S07           | `#/prihodi` `#/prihodi/dds`                                 |
| S07 | `razhodi`       | `#/razhodi`                           | `pages/s07-razhodi.js`                   | Къде отиват парите?      | budget 3       | all                   | S12           | `#/razhodi` `#/razhodi?po=vid`                              |
| S08 | `funkciya`      | `#/razhodi/:fn`                       | `pages/s08-funkciya.js`                  | Функция                  | budget         | all                   | S12           | `#/razhodi/obrazovanie`                                     |
| S09 | `deynosti`      | `#/razhodi/:fn/deynosti`              | `pages/s09-deynosti.js`                  | Дейности                 | budget         | 2026.draft, 2026.law  | S12           | `#/razhodi/obrazovanie/deynosti`                            |
| S10 | `vedomstva`     | `#/vedomstva`                         | `pages/s10-vedomstva.js`                 | Кой харчи?               | budget 5       | 2026.law              | S15           | `#/vedomstva` `#/vedomstva?tab=programi`                    |
| S11 | `vedomstvo`     | `#/vedomstvo/:code/:program?`         | `pages/s11-vedomstvo.js`                 | Ведомство                | budget         | 2026.law              | S15,S10       | `#/vedomstvo/1300`                                          |
| S12 | `merki`         | `#/merki/:id?`                        | `pages/s12-merki.js`                     | Мерки в бюджета 2026     | budget 4       | 2026.draft, 2026.law  | S10           | `#/merki` `#/merki/kr1`                                     |
| S13 | `prognoza`      | `#/prognoza`                          | `pages/s13-prognoza.js`                  | Накъде вървим? 2026–2028 | budget         | all                   | S17           | `#/prognoza`                                                |
| S14 | `zakon`         | `#/zakon`                             | `pages/s14-zakon.js`                     | Как се прие бюджетът?    | budget         | 2026.draft, 2026.law  | S15           | `#/zakon`                                                   |
| S15 | `izpalnenie`    | `#/izpalnenie/:sub(pera\|byudzheti)?` | `pages/s15-izpalnenie.js`                | Изпълнява ли се планът?  | exec 6         | 2025.report, 2026.law | S17           | `#/izpalnenie` `#/izpalnenie/pera` `#/izpalnenie/byudzheti` |
| S16 | `novo`          | `#/novo`                              | `pages/s16-novo.js`                      | Какво ново?              | exec           | none                  | S15           | `#/novo`                                                    |
| S17 | `dalg`          | `#/dalg`                              | `pages/s17-dalg.js`                      | Колко дължим?            | debt 7         | all                   | S18           | `#/dalg` `#/dalg?obhvat=maastricht`                         |
| S18 | `danaci`        | `#/danaci`                            | `pages/s18-danaci.js`                    | Колко плащам аз?         | debt 8         | 2026.draft, 2026.law  | S24,S01       | `#/danaci`                                                  |
| S19 | `klasacii`      | `#/klasacii`                          | `pages/s19-klasacii.js`                  | Класации и сравнения     | debt           | all                   | S24           | `#/klasacii` `#/klasacii?tab=godini`                        |
| S20 | `obshtini`      | `#/obshtini`                          | `pages/s20-obshtini.js`                  | Моята община             | phase2         | 2026.draft, 2026.law  | S23,S24       | `#/obshtini`                                                |
| S21 | `obshtina`      | `#/obshtina/:code`                    | `pages/s21-obshtina.js`                  | Община                   | phase2         | 2026.draft, 2026.law  | S20,S23       | `#/obshtina/BLG03`                                          |
| S22 | `proekti`       | `#/proekti/:id?`                      | `pages/s22-proekti.js`                   | Големите проекти         | phase2         | 2026.draft, 2026.law  | S23           | `#/proekti` `#/proekti/pr-01`                               |
| S23 | `plashtania`    | `#/plashtania/:eik?`                  | `pages/s23-plashtania.js`                | Кой на кого плаща?       | phase2         | 2026.draft, 2026.law  | S24,S01       | `#/plashtania` `#/plashtania/999000012`                     |
| S24 | `danni`         | `#/danni/:set?`                       | `pages/s24-danni.js`                     | Откъде са данните?       | ref            | none                  | S25,S01       | `#/danni` `#/danni/execution`                               |
| S25 | `api`           | `#/api`                               | `pages/s25-api.js`                       | Отворени данни и API     | ref            | none                  | S01           | `#/api`                                                     |
| S35 | `proverka`      | `#/proverka`                          | `pages/s35-proverka.js`                  | Данни и проверка         | ref            | none                  | S24,S25       | `#/proverka`                                                |
| S26 | `za-proekta`    | `#/za-proekta`                        | `pages/s26-za-proekta.js`                | За проекта               | ref            | none                  | S27,S01       | `#/za-proekta`                                              |
| S27 | `vrazka`        | `#/vrazka`                            | `pages/s27-vrazka.js`                    | Обратна връзка           | ref            | none                  | S01           | `#/vrazka`                                                  |
| S28 | `tarsene`       | `#/tarsene`                           | `pages/s28-tarsene.js`                   | Търсене                  | util           | none                  | S02,S01       | `#/tarsene` `#/tarsene?q=%D0%94%D0%94%D0%A1`                |
| S29 | `embed`         | `#/embed/:chart`                      | `pages/s29-embed.js`                     | Вграден изглед           | util           | none                  |               | `#/embed/selftest` `#/embed/neznajna.grafika`               |
| S30 | `ne-e-namereno` | `#(404)`                              | `pages/s30-404.js`                       | Няма такава страница     | util           | none                  |               |                                                             |

Колони: **Периоди** `all` = поддържа се всеки период; `none` = изборът на период е скрит за екрана (редът за периода не се показва); списък = само тези периоди (за останалите обвивката показва празно състояние). **Група** `start budget exec debt phase2 ref util` (страничната навигация; числото е стъпката от водения път). `S29` е гола рамка (без елементи на обвивката); `S30` няма шаблон (отговаря на всеки непознат хеш).

> **V7: адресите са пътища.** Всеки екран има собствен адрес `/prihodi/dds` (без `#`), който сървърът изобразява в първия отговор (виж „Адреси, изобразяване на сървъра и SEO“ по-долу). Шаблоните в таблицата са същите без `#`. Старите адреси `#/…` още се отварят: рутерът ги чете и пренаписва адреса в лентата. Проверките `pipeline/budget_pipeline/build/*.py` пускат приложението в хеш режим (`window.__HASH_ROUTES__`), затова примерните адреси в таблицата и в `samples` остават с `#`.

Свързване:

```js
ctx.href('prihodi', { source:'dds' })                        // '/prihodi/dds'  (id 'S06' също работи; в хеш режим '#/prihodi/dds')
ctx.href('razhodi', {}, { po:'vid' })                        // '/razhodi?po=vid'
html`<a href="${ctx.href('funkciya', { fn:'obrazovanie' })}">Образование</a>`
```

- Връзките към екрани се прихващат от рутера (`js/loc.js` `isAppHref`); периодът (`?per=`) се пренася автоматично, когато не е по подразбиране. Никога не пиши `per` сам, освен ако нарочно не свързваш към друг период.
- Строй връзките с `ctx.href()` / `href()` от `routes.js` или с `toHref('/път')` от `js/loc.js`. Стара връзка `#/…` в шаблон или в набор с данни (индексът за търсене, `feed.json`) работи: в режима с пътища `loc.watchLinks()` я превръща в `/…` в DOM. Файл се свързва спрямо корена (`data/x.json` става `/data/x.json`), а в код адресът му се смята с `new URL('data/x.json', ROOT)`, не с `document.baseURI` (на `/danni/execution` базата е `/danni/`).
- Непознат път, непознат `:code`/`:id` → `ctx.notFound()` показва S30: адресът остава в лентата, а екранът го назовава („Адресът #/… не води до екран от сайта“), предлага поле за търсене и шест места за начало. Не строй собствен текст „не е намерено“ за грешен `:code`.
- Добавяне на маршрут (само добавяне, отбележи го): добави ред към `ROUTES` в `routes.js` с нов id `S31+`, създай `js/pages/s31-….js`, добави `samples`. Добавянето на адрес към `samples` на съществуващ маршрут (това, което посещава проверката), също е позволено.

### Адреси, изобразяване на сървъра и SEO (V7, ADR 0002)

- **Режими** (`js/loc.js`). Режимът с пътища е по подразбиране. Хеш режимът е само за проверките v6 (`window.__HASH_ROUTES__ = true` преди зареждането). Кодът не чете `location.hash` за състояние: `here()` дава текущия адрес във вътрешния вид `/път?заявка`, `toHref()` го превръща във връзка на активния режим, `absolute()` — в пълен адрес (споделяне, вграждане).
- **Сървърът** ([ADR 0002](adr/0002-react-router-ssr.md)). React Router в Worker-а (`app/`, `apps/web/workers/app.ts`) изобразява всеки екран от текущото издание със същия код като браузъра: `js/render.js` (изгледът на екрана), `js/chrome.js` (горната лента, менюто, долната навигация) и `head()` от `js/seo.js`. Адресът, периодът и данните на заявката идват от `js/env.js`. Затова `render()` на екрана не чете `document`, `window`, `location` или `localStorage`; това е работа на `mount()`. Състояние, което екранът записва по време на `render()` в модул (спецификации на графики и таблици), минава през `scoped()` от `js/env.js`: на сървъра всяка заявка има свое. `apps/web/scripts/build.py` сглобява Worker-а, пуска го и проверява всеки екран, до който води връзка от началната страница, два пъти: сървърният HTML трябва да е готов екран (`data-view="ready"`, `h1`, описание, каноничен адрес), а в браузъра екран в грешка, конзолна грешка, връзка към несъществуващ екран, стара `#/` връзка, липсващи заглавие, описание или каноничен адрес спират сглобяването (код 1). Пишат се още `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt` и `_headers` в `build/client`.
- **Поемане от приложението.** Сървърният HTML има `data-prerendered` на `<html>`: адресът, чийто екран е. Първото изобразяване на рутера над него е без скелет, без появяване и без броене на числата. Стиловете на страницата, вече заредени в `<head>`, не се зареждат втори път. Документът назовава изданието си (`<meta name="release-id">`, `<meta name="data-base">`): всеки файл, който браузърът дозарежда, CSV и произходът са от същото издание.
- **Главата на страницата** (`js/seo.js`: `head()` дава таговете, `paint()` ги пише в браузъра, сървърът в документа). Описание, каноничен адрес (`SITE_ORIGIN` + пътя, без заявката), `robots` (`noindex` за 404, вграждането и `?demo=`), Open Graph и Twitter карти (`/og.png`), JSON-LD: `WebSite` с търсене, `Organization`, `WebPage` или `FAQPage` с `BreadcrumbList`.
- **Куки на екрана за SEO** (по избор, до `title`/`lede`). `question` е въпросът, на който отговаря екранът, ако заглавието му не е въпрос. `answer(ctx)` е краткият отговор с числа, който **вече е на екрана** (например изречението „Накратко“). Без `answer` отговорът е въведението, ако заглавието или `question` е въпрос и в него има число. `docTitle(ctx)` е заглавието на документа, когато едно h1 обслужва няколко адреса (`/prihodi/dds` → „ДДС: приходи през 2026 г.“, двете общини Бяла). `schema(ctx)` връща собствени възли за JSON-LD: S24 дава `Dataset` за всеки реален набор и `DataCatalog` за списъка, S03 дава `DefinedTerm` за термин и `DefinedTermSet` за речника. Помощниците `siteUrl()` и `orgRef()` от `js/seo.js` дават производствените адреси. Всяко от тях може да дойде и като поле на обекта от `render()`.
- **Производственият адрес** е `SITE_ORIGIN` в `apps/web/wrangler.jsonc` (`https://sigma-budget.midt.bg`); празен означава адреса на заявката (staging). `build.py --origin …` го дава на проверката, на `sitemap.xml` и на `llms.txt`.

---

## 12. Хранилище и предпочитания

`ctx.store.get(key)` остава интерфейсът за четене. В текущата v6 обвивка се променят периодът, обхватът и единицата. `perPerson`, `leva`, `onlyReal` и `sources` остават `false`: контролите им са премахнати и старите стойности от `localStorage` не се четат. `PERSIST` съдържа само `userType`, `scope`, `unit`; `ROLE_SELECTOR = false` пази типа „Гражданин“ и игнорира запазена роля. Периодът е в URL. Таблицата по-долу описва запазения програмен интерфейс; възможностите на помощниците за „на човек“ и лева не означават налични потребителски настройки.

| Ключ        | Стойности                                                                                                               | Какво трябва да прави екранът ти                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `period`    | `2024.report 2025.report 2026.draft 2026.law 2027.forecast 2028.forecast` (в адреса като `?per=`; ползвай `ctx.period`) | показва тази година; `view.yIndex`                                                                                                                                                                                    |
| `userType`  | `citizen journalist expert`                                                                                             | акцентите по аудитория от плана (журналист: „какво се променя“, експерт: таблици)                                                                                                                                     |
| `unit`      | `eur` \| `pct`                                                                                                          | `pct` = показва дялове / % от БВП, където ги има (`view.amount` го прави)                                                                                                                                             |
| `perPerson` | bool                                                                                                                    | „на човек“ през `view.amount` / `kpi({mln})`                                                                                                                                                                          |
| `leva`      | bool                                                                                                                    | `(≈ … лв.)` след сумите в евро (`money(.., {leva})`, `view.amount`)                                                                                                                                                   |
| `onlyReal`  | bool                                                                                                                    | скрива примерните блокове (блоковете/KPI го правят; за ръчно направено примерно съдържание провери и покажи `mockHidden()`)                                                                                           |
| `sources`   | bool                                                                                                                    | `srcTag()` става видим до стойностите                                                                                                                                                                                 |
| `scope`     | `kfp nat eu zdd maastricht`                                                                                             | обхватът по подразбиране на посетителя за превключвателите на обхват                                                                                                                                                  |
| `guide`     | `{step: 0..8}`                                                                                                          | стъпката, чийто екран е отворен последно. Рутерът я пише сам, когато се рисува екран със стъпка от пътеводителя (или негово дете); само S02 я чете („Продължи от стъпка N“) и я нулира. Никога не рисува екран наново |

`store.PERIODS`, `store.SCOPES`, `store.USER_TYPES` са регистрите. Никога не чети `localStorage` сам.

---

## 13. Списък за достъпност — всеки екран

- Точно един `<h1>` (на рамката). Блоковете са `<h2>`, подблоковете `<h3>`; без прескочени нива. Без втори `<main>`/`<nav>` без етикет.
- Състоянието, обхватът и примерното **никога не са само цвят**: икона + думи (компонентите го правят); примерното е и щриховано.
- Всяка диаграма има име (`desc`) и таблица-близнак; всяка таблица има надпис, `<th scope>` и стои в `.table-wrap` (превърта се, достъпна с фокус).
- Всеки контрол има видим етикет; подсказки/грешки през `aria-describedby`; цели за докосване ≥ 44 px при груби указатели (компонентите го правят; за собствени бутони ползвай `.btn`).
- Клавиатура: всяко действие е достижимо с Tab/Enter/Space/стрелки; фокусът е видим (`--focus`); диалозите хващат и връщат фокуса; Esc затваря.
- Връзките казват къде водят („Към ДДС“, не „тук“); външните връзки се отварят в нов раздел и го казват (`ext()`).
- Динамични промени, които не местят фокуса → `ctx.announce('…')`.
- Спазвай `prefers-reduced-motion` (CSS на обвивката го прави; не добавяй дълги анимации).
- Текст при 200% увеличение и при ширина 400 px не бива да се превърта хоризонтално (освен `.table-wrap`).
- Заглавията и подзаглавието са на прост език; числата имат единици; „—“ за неизвестно, никога празна клетка.

---

### 13.1 Движение, печат и PNG (v6, 26–27 октомври)

`css/motion.css` и `js/ui/motion.js` добавят появяване на екран и блокове при скрол, запълване на барове, броене до крайните стойности и кратки преходи на менюта и търсене. Времената са в токените `--dur-1…4`, `--stagger`, `--ease-out`, `--ease-io`. Движението използва `opacity` и `transform`. При `prefers-reduced-motion: reduce` или липса на `IntersectionObserver` началните скрити състояния не се включват. Фокусът и прескачането към съдържание го разкриват; защитен таймер показва останалото съдържание. Повторното рисуване не повтаря входната анимация. Рутерът извиква `motion.cleanup()` преди подмяна на страницата, за да спре броячите и да освободи наблюдаваните елементи, включително тези под видимата област. `share.renderPng()` извиква `motion.settle()`, за да изнесе крайните числа и барове; печатът също показва крайното състояние.

## 14. Пускане на проверките

```bash
# от корена на хранилището; средата е tmp/venv, а Chromium е в tmp/pw-browsers (и двете са извън git — виж .gitignore)
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.screens --route S06            # един екран, всички негови примерни адреси
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.screens --route S06 --shots    # + снимки на екрана в tmp/render-check/
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.screens --quick               # финалната проверка, около минута: всеки маршрут, първият пример, 1280 px и 400 px, светла тема
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.screens                       # всичко: 1280 и 400 px × светла и тъмна
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.screens --url http://127.0.0.1:8000/   # вече пуснат сървър
```

`--route` приема id (`S06`) или ключ (`prihodi`). Проверката пуска собствен локален сървър върху `apps/web/`. Изходен код 0 само когато всичко е зелено. Пътищата до `apps/web/` и до папката със снимки се изчисляват в началото на скрипта (`ROOT`, `SITE`, `SHOT_DIR`) — вижте бележката за разположението в `README.md`.

Какво проверява за всеки маршрут × размер × тема: няма грешки или изключения в конзолата (404 за липсващ файл `/data/…` е само предупреждение „предстоящ файл с данни“); няма `NaN`/`undefined`/`Infinity`/`null`/`[object Object]` в текста или SVG; няма хоризонтално превъртане на страницата (освен вътре в `.table-wrap`); точно един `h1`; `document.title` се е променил; фокусът е на `h1` след навигация; целта на „Следва“ съществува; `?demo=loading|empty|error|pending|offline` рисува правилния компонент за състояние; ключовете в `data-src` съществуват в `core.sources`; всяка повърхност `[data-mock]` има значка или щриховка; примерните блокове са означени в текста за споделяне/CSV/PNG.

> **Версии.** Командите в този раздел са писани за `check_mock.py` (версия v1, таг `mock-v1`). За последното дърво на `apps/web/` (v6) ползвайте `tests/e2e/screens.py` със същите опции и `pipeline/budget_pipeline/validate/datasets.py`; на по-старите тагове — съответния `check_mock_vN.py`.

`check_mock.py` има още семейства проверки (period, user, prefs, tour, `?to=`, chrome, share, embed, glossary, tabs, theme); документацията в началото на файла ги изброява заедно с всяка опция. `-v` отпечатва всяка находка с всичките ѝ клетки и адреси. Предупрежденията никога не карат пускането да пропадне; `--only base --route S06` е най-бързият цикъл за един екран. За да видиш страницата, добави `--shots` (по един PNG за всяко зареждане, имената се преизползват).

За текущата v6 основната проверка работи с намалено движение. `tests/e2e/motion.py` проверява включените и изключените анимации, крайните стойности, фокуса, разкриването при скрол и PNG подготовката. `tests/e2e/overlap.py` обхожда маршрутите при 1920/1440/1280/1241/1181/1024/768/390/320 px: припокривания, преливане, печат, клик, клавиатура и история. Неговият `--quick` вариант е включен в `accept.py`; при отделна пълна проверка може да се изпълни `accept.py numbers layout`, за да не се повтаря. `tests/e2e/perf.py` проверява зареждане и скрол при 390 px и 4× CPU. Пускат се със същите `tmp/venv` и `PLAYWRIGHT_BROWSERS_PATH` като останалите инструменти. За действителен PNG износ ползвай `png_probe.py tmp/png-check 390 'home=#/' 'plan=#/izpalnenie' --click`.

Service worker (`sw.js`, кеш `bns-v5-11`) използва `fetch(req, { cache: 'no-cache' })`, за да презаверява ресурсите и да избягва смесване със стария HTTP кеш на хостинга. Първото зареждане при посетител със стар работник може още да е смесено; следващото зареждане използва новото поведение. Известни ограничения при измерването са прескачането на футъра при първоначално зареждане и дългата задача за разбор на ECharts на екраните с графики.

Погледни екрана си при 1280 и 400 px, светъл и тъмен, и само с клавиатура, преди да кажеш, че е готов.

---

## 15. Споделени файлове: правила и записване

Споделено = всичко под `apps/web/`, освен собствените ти `js/pages/sNN-*.js` и `css/pages/sNN-*.css`, плюс това ръководство и `tests/e2e/screens.py`.

1. Позволено ти е само да **добавяш** към споделен файл: нов експорт, нова функция, нов блок CSS правила, нова икона, нов ред в маршрутите, нов файл-компонент. **Никога не преименувай, не махай и не променяй поведението на нещо съществуващо.** Ползвай инструмента за редакция със закотвена вмъкване (добавяй в края, под коментар-банер `/* ── added by S06 ── */`); никога не презаписвай цял споделен файл (други автори го редактират едновременно) и препрочети редовете точно преди редакцията.
2. **Записвай всяка такава редакция** с един добавен ред в дневника на работата:
   `YYYY-MM-DD HH:MM Sofia · <АВТОР> · SHARED-EDIT <файл>: <какво и защо>` (час: `TZ=Europe/Sofia date '+%Y-%m-%d %H:%M'`; добавяй с `>>`, никога не пренаписвай файла).
3. Всичко по-голямо — промяна на поведение, грешка в компонент, липсващ компонент или опция, нова нужда от данни — отива като един ред в списъка с нужди: `[за SHELL] <какво ти трябва, на кой екран, предложен интерфейс>`. SHELL отговаря в дневника с `done: …` под реда. Нужди от данни: `[за DATA] …`.
4. Нов общ компонент, който наистина ти трябва сега: създай `js/ui/<име>.js` (коментар в началото с интерфейса, същите конвенции като останалите), запиши го като SHARED-EDIT и кажи на SHELL в списъка с нужди, за да бъде описан тук.
5. Никога не редактирай `data/release/**`, `docs/data-spec.md`, `apps/web/public/vendor/**`, `reference/prototype/**`. Никога не слагай в страница число „от главата си“.

---

## 16. Таблица на готовността (поддържа се от SHELL)

| Модул                                                                              | Състояние                                 | Бележки                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `html.js format.js icons.js store.js data.js routes.js router.js shell.js main.js` | готов                                     |                                                                                                                                                                                                 |
| `ui/states.js status.js scope.js next.js breadcrumbs.js`                           | готов                                     | включва `mockHidden()` и `mockNote(text,{badge:false})`                                                                                                                                         |
| `ui/source.js sheet.js toast.js seg.js forms.js actions.js`                        | готов · интерфейсът е непроверен          |                                                                                                                                                                                                 |
| `ui/chart.js charts.js ui/table.js share.js`                                       | готов · интерфейсът е непроверен          | написани, първото пускане в браузър предстои                                                                                                                                                    |
| `ui/block.js`                                                                      | готов · менюто за споделяне е непроверено |                                                                                                                                                                                                 |
| `ui/kpi.js`                                                                        | готов                                     |                                                                                                                                                                                                 |
| `view.js`                                                                          | готов                                     | чисти помощници, раздел 5.22 (включително `chartUnit`, `moneyCol` от G1)                                                                                                                        |
| `calc.js`                                                                          | готов (притежател G3)                     | чиста логика на калкулатора, раздел 5.24                                                                                                                                                        |
| `ui/map.js`                                                                        | готов (притежател G4)                     | карта с оцветени области, раздел 5.25                                                                                                                                                           |
| `feedback.js`                                                                      | готов (притежател G5)                     | локална кутия за обратна връзка, раздел 5.26                                                                                                                                                    |
| `muni.js`                                                                          | готов (притежател G4)                     | помощници за общини, раздел 5.28                                                                                                                                                                |
| `ui/unit-switch.js`                                                                | готов (притежател G1)                     | превключвател „В евро / % от БВП“, раздел 5.29                                                                                                                                                  |
| `ui/gl.js ui/cards.js`                                                             | готов                                     |                                                                                                                                                                                                 |
| `ui/tabs.js ui/disclosure.js`                                                      | готов                                     | раздел 5.11 / 5.12                                                                                                                                                                              |
| `ui/chips.js ui/progress.js ui/ranklist.js`                                        | готов                                     | раздел 5.14 / 5.18 (progress) / 5.16                                                                                                                                                            |
| `ui/timeline.js`                                                                   | готов                                     | раздел 5.18                                                                                                                                                                                     |
| `ui/treemap-list.js`                                                               | готов                                     | раздел 5.17                                                                                                                                                                                     |
| `ui/sankey.js`                                                                     | готов                                     | раздел 5.18                                                                                                                                                                                     |
| `glossary.js` (изскачащо с термин, `[data-gl-scan]`)                               | готов                                     | раздел 8; `ui/sheet.js` вече заменя отворен лист веднага и се затваря при навигация (5.21)                                                                                                      |
| `search.js searchlib.js` (палитра + двигател)                                      | готов                                     | раздел 5.27; `data/search-index.json` е по избор, докато DATA не го добави                                                                                                                      |
| `pages/s28-tarsene.js` (страницата за търсене)                                     | готов                                     | раздели 5.27 и 18                                                                                                                                                                               |
| `pages/s29-embed.js` (+ `css/pages/s29-embed.css`)                                 | готов                                     | раздел 7.5; `share.embedHash` приема `embedParams`, `block({share:{embedParams}})` го предава; `errorState({link:false})`                                                                       |
| `pages/s30-404.js` (+ `css/pages/s30-404.css`)                                     | готов                                     | раздел 11: подзаглавието назовава поисканния адрес (и след `ctx.notFound()`), после поле за търсене (`[data-search-field]`, Enter → `#/tarsene?q=`) и шест връзки; нормална рамка, без „Следва“ |
| `tests/e2e/screens.py`                                                             | готов                                     | раздел 14; `--quick` е финалната проверка                                                                                                                                                       |
| `apps/web/public/dev/components.html` (витрина на компонентите, без маршрут)       | не е направена                            | отпаднала при замразяването на обхвата; живите примери са екраните S28 / S29 / S30 и коментарът в началото на всеки `js/ui/*.js`                                                                |

---

## 17. Капани

1. Низът е текст; разметка иска `html\`\``. Слагай кавички на всяка стойност на атрибут.
2. `id`-тата са глобални: поставяй префикс `s06-`. Идентификаторите на диаграми и таблици трябва да са уникални в екрана (те са DOM идентификатори и идентификатори за споделяне).
3. Контроли, които рисуват наново, имат нужда от стабилен `id`/`data-fk`; не слагай `data-query` върху контейнери (табовете ползват `data-qkey`).
4. `render` се изпълнява пак при всяка промяна на предпочитание: без променливо състояние на ниво модул, което зависи от едно рисуване, без броячи, без `Date.now()` в изхода.
5. Не викай `fetch()` сам, не чети `location.hash` (ползвай `ctx.params`, `ctx.query`), не задавай `document.title` и не местѝ фокуса при навигация.
6. Не импортирай от друг модул на страница. Споделена логика → поискай от SHELL или добави нов файл в `ui/` (раздел 15).
7. Слагай `'core'` в `needs`, ако ползваш `ctx.core` (иначе при самото първо рисуване може да е `undefined`).
8. `value: 0` е истинска нула; `null`/липсващо е неизвестно (→ „—“ или „предстои“). Не превръщай `null` в `0`.
9. Диаграми в скрити контейнери (табове, затворени `<details>`) се чертаят, когато станат видими; дай им височина през `height`, ако контейнерът е `display:none` при рисуването.
10. Линия, която смесва реални и прогнозни години: ползвай `dashFrom: k` (една серия, плътна, после пунктирана; раздел 6) и напиши „Прогноза“. Серия от колони, която ги смесва: щрихова прогнозните точки с `{ value, mock:true }` или ползвай втора серия.
11. Без емоджи, без външни шрифтове/картинки, без `target="_blank"` без `rel="noopener noreferrer"` (ползвай `ext()`).
12. Всичко на публичния сайт е на български; редовете в дневниците, коментарите в кода и бележките на SHELL са на английски.
13. `.sr-only` е `position:absolute`. Вътре в собствен контейнер с превъртане (`overflow:auto`) дай на контейнера `position:relative`, иначе скритият текст стои на мястото си в потока извън изрязването на контейнера и може да разшири цялата страница на телефон (`.table-wrap` на `ui/table.js` вече го има).
14. Идентификатори, които компонентите притежават: `block({ id })` ползва `<id>` (секцията) и `<id>-t` (заглавието му, целта на `aria-labelledby`); `chart` и `mapFigure` с таблица с данни ползват `<id>-tbl` (разгъваемото). Никога не давай на друг елемент един от тях (например таблица с `id: 's21-vidove-t'` вътре в блока `s21-vidove`): check_mock отчита `dup-id`. Наименувай собствените си таблици например `<id>-table`.

---

## 18. Еталонна реализация

S28 (`js/pages/s28-tarsene.js` + `css/pages/s28-tarsene.css`, с `js/search.js`/`searchlib.js`) е еталонният екран — [готов]. Прочети го за: `needs = []` плюс собствено зареждане по избор (`getIndex()` никога не отхвърля), `styles`, асинхронен `render(ctx)`, който връща формата **извън** кутията с резултатите, чиста `view(index, q, g, opts)`, ползвана и от `render()`, и от обновяванията на място, `mount(root, ctx)`, който закача събитията и връща почистване, работа със заявката (`ctx.query.q`, `ctx.setQuery({q}, { rerender:false })`, така че писането не прерисува екрана), чипове на място (`button.chip[data-chip="g:<id>"]`; бутоните с `data-query` рисуват страницата наново, затова тук не се ползват), клавиатура (↑/↓ между резултатите, ↑ от първия връща към полето, Esc изчиства), фокус, запазен или възстановен след всяко прерисуване (курсорът никога не се губи), едно вежливо обявяване след спиране на писането (`ctx.announce`), празното състояние с предложения, бележката „предстои“, когато индексът го няма, бележката „Само реални данни“ (`mockHidden` + `hiddenText`), разтеглени карти-връзки с кръг на фокуса около картата (`:has(:focus-visible)`, с резервен вариант собствения кръг на връзката) и помощна страница без споделяне. Заготовките (`js/pages/s01…s27`, каквито бяха) и работният пример в 3.6 показват минималната форма; `apps/web/public/dev/components.html` (предстои) показва всеки компонент с примерни данни.

## TypeScript основа

Използвай Node 24 (`nvm use`) и `pnpm@10.33.0`. От корена:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm dev
```

Python командите остават действащи. След сглобяване на пакетите JSON наборите се сравняват по избран обхват:

```sh
pnpm exec budget-ts parity --oracle data/release --candidate tmp/candidate --scope outlook,revenue --policy tmp/policy.json --report tmp/parity.json
```

Началната политика за точно сравнение е `{"precision":[],"accepted":[]}`. Примерно правило за точност е `{"dataset":"outlook","pointer":"/gdp/*","decimals":1,"unit":"million EUR"}`; `*` съвпада с един сегмент от JSON Pointer. Правилата следват публикуваната точност. Бройките, идентификаторите, годините и целочислените парични единици остават точни. Прието различие задава `dataset`, `file`, `pointer`, `expected`, `actual` и непразно основание `rationale`; структурни разлики и невалидни числа не могат да се приемат. Изходните кодове са 0 (успех), 1 (неприето различие или невалидно извикване) и 2 (липсващи доказателства). Адаптерите за останалите формати предстоят; техните обхвати връщат `unverified`.

`FixtureManifest` в `packages/test-support` съдържа `schema: 1`, пълна ревизия `baselineRevision`, дата `buildDate`, `inputs: [{path, sha256}]` и `datasets: [{id, eligibility, rationale}]`. Допустимите стойности за `eligibility` са `reproducible`, `frozen-only` и `unverified`. Resolver-ът проверява инвентара, ограничението на пътищата и контролните суми. Доказателствата се заснемат от Python; очакванията не се генерират от кандидата.

### Косвени данъци след 08.11.2026 г.

S12 чете проверените откъси направо от `measures`; S08 няма редакционни връзки към мерки. S18 зарежда `indirect-tax-parameters` и приема отделни разходи по ДДС 20%, 9% и 0%/освободени, литри и вид гориво, кутии и късове, действителни цени и дата. Цените от ЕК и НСИ са датирани, редактируеми справки. Липсващ вход дава null; липса на покупки се задава с 0. Годишното умножение е сценарий. „Само реални данни“ не скрива оценката върху официални параметри.

S18 запазва отделни състояния за невалиден вход, липсващ вход и дата без проверени ставки. Грешката остава до полето с `aria-invalid`. Референтните цени се показват с десетична запетая и подходяща точност; до първата редакция сметката използва стойността от източника. След редакция използва въведената цена.
