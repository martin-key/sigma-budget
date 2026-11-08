# Спецификация на данните — форми на `data/release/*.json`

Притежател: ролята DATA. Читатели: SHELL и авторите на екрани. Написана на 2026-10-02 (v1), ПРЕДИ да съществуват скриптовете за извличане.
**Формите са нормативни.** Мога да ДОБАВЯМ полета по-късно; няма да преименувам, махам или променям типа на съществуващи без
да обновя този файл и да отбележа `SPEC CHANGE: …` в дневника на проекта. Примерите са илюстративни: числата,
отпечатани тук, са реални там, където съм могъл да ги проверя (КФП към юли 2026, общите суми от ЗДБ), и `…` другаде. Конвейерът
(`pipeline/budget_pipeline/build/run_all.sh`) произвежда файловете; `pipeline/budget_pipeline/validate/base.py` налага всичко по-долу.

Всички ключове в JSON са на английски; текстовете за потребителя (имена, етикети, бележки, причини) са на български. Всеки файл е
UTF-8, чист JSON (без NaN/Infinity), ключове в детерминиран ред, минимизиран.

---------------------------------------------------------------------------------------------------------
## 0. Конвенции, които важат за ВСЕКИ файл

### 0.1 Обвивка: `meta`
```jsonc
{ "meta": {
    "id": "D06+D16+D26",          // идентификатор(и) на набора от плана (D = реални, M = примерни, P = предстоящи)
    "title": "Месечно изпълнение на КФП",
    "status": "real",             // real | mock | pending  (състоянието на ТЯЛОТО на файла)
    "source": ["kfp"],            // ключове от core.sources (регистър в §2). Никога свободен текст тук.
    "sourceNote": "лист „стартова“, ред 11–49, колони к.2–к.4",   // свободен български текст: таблица / страница / лист
    "asOf": "2026-07-31",         // датата, за която важат числата (ISO). Предстоящи/примерни: датата на сглобяване.
    "retrieved": "2026-10-02",    // датата на сглобяване
    "unit": "млн. €",             // единица ПО ПОДРАЗБИРАНЕ на числата във файла (поле може да я смени, виж 0.3)
    "pending": ["P01"],           // по избор: идентификатори на предстоящи набори (core.pending), които принадлежат на тези екрани
    "mock": false                 // true тогава и само тогава, когато status === "mock"
} }
```
**Наследяване:** обект с числа има `status` и `source` собствени ИЛИ ги наследява от най-близкия
предшественик, който ги има, чак до `meta`. Възел може да ги замени (например серия `"status":"mock"` в реален файл е позволена,
но я избягвам: примерното живее само в `mock/*.json`). Валидаторът разрешава наследяването; екраните също трябва
(помощникът в `data.js`: `statusOf(node, path)`).

### 0.2 Стойности на състоянието
| състояние | значение | числа? | допълнителни полета |
|---|---|---|---|
| `real` | от първичен източник, възпроизводимо със скриптовете | да | `source`, `asOf` |
| `mock` | генерирано с фиксирано семе; сумира се до реалното цяло, което разбива | да | на ВСЕКИ запис: `"mock": true`, `"why": "…"`; на ниво файл `meta.seed` и `meta.constrainedBy` (до кой реален набор/число се сумира) |
| `pending` | данните съществуват при издателя, но не са извлечени | **НИКАКВИ числа** | `reason`, `expected` (къде живеят данните), `source[]`, `screens[]` |

Блок „предстои“ винаги е `{ "status":"pending", "id":"P01", "title":"…", "reason":"…", "expected":"…", "source":["minfin"], "screens":["S06"] }`
(регистър в `core.pending`; екраните рисуват пунктираното състояние „Предстои“ от него, никога от число).

### 0.3 Числа, единици, имена
* Числата са JSON числа, никога низове; нищо не е `null` / `NaN` / `""` там, където се очаква число.
  **Липсващо = ключът е отсъстващ** (или, в масив, подравнен с години/месеци, масивът е по-къс и `months`/`n` казва с колко).
* Единици: `meta.unit` е по подразбиране. Правила за наставки на полетата: `…Mln` или поле `mln` = млн. €; `…Khil` / `khil` = хил. €;
  `pct` = % (скала 0–100, напр. `25.81`); `pctGdp` = % от БВП; `eur` = €; `perCapita` = € на човек; `persons` = души.
  `unit` върху обект-серия винаги е по-силна от `meta.unit`.
* Месечните отчети по КФП за 2024 и 2025 г. са публикувани в млн. лв.; ВСИЧКИ стойности в моите файлове вече са в **млн. €** (÷ 1,95583, закръглени до
  3 знака). Серии на Eurostat за 2024 и по-рано са в млн. € както са публикувани.
* Процентите се пазят както са изчислени от мен с 2 знака, освен ако източникът дава 1.
* **Години/видове данни.** Годишните серии са подравнени с масив `years` на ниво файл. Видът на всяка година е
  `actual` (Отчет), `prelim` (Предварителен отчет), `plan` (Проект → ЗДБ), `forecast` (Прогноза). За сериите от Приложение 3:
  `[2024 actual, 2025 prelim, 2026 plan, 2027 forecast, 2028 forecast]` → стил плътно / светло / щрихован ръб / пунктирано.
* **Обект-серия** (ползва се навсякъде, където се появява ред от числа): `{"values":[…], "unit":"млн. €"}` плюс по избор `status`/`source`/`note`.
  Където таблица има стотици редове, ползвам вместо това редове `{"id","label","level","parent","mln":[…],"pctGdp":[…]}`; заглавната част на файла казва по коя ос (`years`) следват масивите.
* **Етикетите** (`label`, `name`) са оригиналната българска формулировка на източника, подрязана. Кратките форми (`short`) са мои.

### 0.4 Език / поверителност
Нищо под `data/release/` не споменава хора от работната група или чат платформи и не цитира обсъжданията на групата. Авторството е общо
(„Работна група „Бюджет на светло“). Предложенията на 69-те депутати се появяват само като броячи и връзки към документи (без имена).
Бележките, които са за проверка от експерт, се пишат „Съпоставката предстои да бъде проверена от експерт по публични финанси“.

### 0.5 Файлове, които НЕ са в `data/release/`
`data/cache/**` (изтеглени файлове, междинни извлечения), `data/originals.sha256`, `tmp/`. Сайтът никога не ги чете.

---------------------------------------------------------------------------------------------------------
## 1. Веднага или лениво, бюджет на размера

| файл | зарежда се | бюджет (твърд, `base.py`) |
|---|---|---|
| `core.json` | **веднага** (всяка страница, преди първото рисуване) | ≤ 10 KB gzip и ≤ 40 KB суров. Първото зареждане с HTML/CSS/JS/2 шрифта трябва да остане < 120 KB gzip |
| `glossary.json` | предзареждане в свободно време след първото рисуване (обяснения на място) | ≤ 60 KB gzip |
| `search-index.json` | при първия фокус на полето за търсене | **< 250 KB суров** |
| `geo/obshtini.json` | само S20 | ≤ 400 KB суров |
| `ministries/<код>.json` | само S11, по един файл на ведомство | ≤ 80 KB суров всеки |
| `mock/payments.json` | само S23 | ≤ 150 KB суров |
| всеки друг ленив файл | екраните, които го изброяват в §3 | ≤ 150 KB суров всеки |

Списъкът `data:` на рутера за един маршрут = имената на файловете по-долу (`data.load('execution')` → `data/execution.json`). Заявките минават
през `data.js` (с кеш; `?demo=error` прави зареждане да пропадне; `?demo=pending` подменя блок със състоянието му „предстои“).

---------------------------------------------------------------------------------------------------------
## 2. Регистри на идентификаторите (ползват се като ключове на маршрути и между файлове)

### 2.1 Ключове на източниците (`meta.source`, `core.sources`)
`kfp` (МФ — месечна информация за КФП, xls) · `forecast_tables` (мотиви/АСБП 2026–2028 към законопроекта, PDF на МФ) ·
`bill` (законопроект 52-602-01-19, docx) · `zdb` / `zbdoo` / `zbnzok` (ДВ бр. 69 / бр. 68 / бр. 68) · `prb` (програмни бюджети, архив към законопроекта) ·
`parliament` (parliament.bg, данни за законопроекта) · `eurostat` · `bnb` (БНБ, SDMX) · `nap` (НАП, ВК-30-10237/12.08.2026) ·
`sebra` (МИДТ, СЕБРА) · `gisco` (Eurostat GISCO, LAU 2024) · `dataeuropa` (data.europa.eu) ·
`minfin` (minfin.bg — страници, достъпни само през браузър; ползва се в „предстои“) · `wg` (редакционна работа на работната група — за примерни/редакционни набори) ·
`mockgen` (генераторите `pipeline/budget_pipeline/build/examples.py` и `pipeline/budget_pipeline/build/editorial.py`, фиксирано семе).
`core.sources[key] = {"title":"…","publisher":"…","url":"https://…","kind":"xls|pdf|html|api|doc|generator","access":"open|browser-only|none","note":"…"}`.

### 2.2 Идентификатори на набори
Реални `D01…D26`, примерни `M01…M07`, предстоящи `P01…P07`; `catalog.datasets[].slug` е пътят на файла без `.json`, `/` → `-`
(`execution`, `ministries`, `geo-obshtini`, `mock-payments`). Маршрут `#/danni/<slug>`.

### 2.3 Ключове на маршрутите
| параметър на маршрута | ключ | къде е дефиниран |
|---|---|---|
| `#/razhodi/<функция>` | `id` на функцията (9 slug-а, по-долу) | `expenditure.functions[].id` |
| `#/prihodi/<източник>` | `id` на група приходи: `dds`, `osiguritelni`, `nedanachni`, `pomoshti`, `ddfl`, `akcizi`, `korporativen`, `drugi` | `revenue.groups[].id` |
| `#/vedomstvo/<код>[/<програма>]` | 4-цифрен бюджетен код (ЕБК), напр. `1300`; код на програма `1300.01.01` | `ministries.items[].id`, `ministries/<код>.json` |
| `#/merki/<мярка>` | `id` на мярка (`kr1…kr8`, `kx1…kx9`, `kn1…`, `d8-1…`, `d9-1…`, `p8-1…p8-8`) | `measures.items[].id` |
| `#/rechnik/<термин>` | `slug` на термин от речника | `glossary.terms[].slug` |
| `#/obshtina/<код>` | `id` на общината = код на НСИ/GISCO (`BLG03`, `SOF46`, …) | `municipalities.items[].id` |
| `#/proekti/<id>` | `pr-01…` | `mock/projects.json` |
| `#/plashtania/<еик>` | измислен ЕИК `999…` | `mock/payments.json` |
| `#/danni/<набор>` | slug на набор | `catalog.datasets[].slug` |

Slug-ове на функциите (Табл. III-1, 9 функции, сбор за 2026 **55 525,0 млн. €** = разходите по КФП без вноската в ЕС):
`obshti-sluzhbi` Общи държавни служби · `otbrana-sigurnost` Отбрана и сигурност · `obrazovanie` Образование · `zdraveopazvane` Здравеопазване ·
`sotsialni` Социално осигуряване, подпомагане и грижи · `zhilishtno-sreda` Жилищно строителство, благоустройство, комунално стопанство и опазване на околната среда ·
`kultura-sport` Култура, спорт, почивни дейности и религиозно дело · `ikonomika` Икономически дейности и услуги · `drugi` Разходи, некласифицирани в другите функции.

### 2.4 Идентификатори на редовете на КФП (лист „стартова“, едни и същи във всяка година)
`rev` (р.11) · `rev.tax` 12 · `rev.nontax` 13 · `rev.grants` 14 · `exp` (р.16 „Разходи“, без вноската в ЕС) · `exp.personnel` 17 · `exp.maint` 19 ·
`exp.interest` 20 (`exp.interest.ext` 21, `exp.interest.dom` 22) · `exp.social` 23 · `exp.subsidies` 24 · `exp.abroad` 25 · `exp.capex` 26 (= D26) · `exp.reserve` 27 ·
`transfers` 28 (`transfers.cb` 29, `transfers.other` 30, `transfers.revshare` 31) · `eucontrib` 32 · `balance` 33 ·
`fin` 35 · `fin.ext` 36 (`fin.ext.markets` 37, `fin.ext.repay` 38, `fin.ext.securities` 39, `fin.ext.deposits` 40) ·
`fin.dom` 41 (`fin.dom.advances` 45, `fin.dom.refunds` 46) · `fin.priv` 47–48 (`fin.priv.shares` 49).
Изчислени редове (`computed:true` в `rows`): **`exp.total` = `exp` + `eucontrib`** (= „Разходи“ в заглавното число: 28 548,8 за 07.2026).
Тъждествата са проверени във всичките 32 отчета (2024: 12, 2025: 12, 2026: 8): `rev = rev.tax+rev.nontax+rev.grants`; `exp = personnel+maint+interest+social+subsidies+abroad+capex+reserve`;
`balance = rev − exp + transfers − eucontrib`; `fin = −balance`; по колони `к.2 = к.3 + к.4`.
Две вътрешни разлики на източника са запазени, както са публикувани (предупреждения, ограничени в `kfp_full.py` / `execution_reports.py`): 05.2024 `fin` срещу `−balance`
се различават с 0,010047 млн. лв. в к.2 и к.3; 11.2024 контролният ред 34 = 0,000035 млн. лв. в к.2 и к.3.

---------------------------------------------------------------------------------------------------------
## 3. Файловете

Легенда: **S##** = екраните, които четат файла. Размерите са очаквания, не обещания (валидаторът мери).

> **КАКТО Е ПОСТРОЕНО (2026-10-02).** Формите в §3 са първата чернова. Сглобяващите скриптове (`pipeline/budget_pipeline/build/`) са източникът на истината,
> `python -m budget_pipeline.validate.base` е договорът (`--list` назовава групите му; проверките от §5 са реализирани там), а примерните файлове са описани в
> `docs/example-datasets.md`. Разликите, които имат значение за екран: `core.pending` е речник с ключове P01–P07; записите в `catalog.json` са по `slug`; всеки набор има
> `meta.status/source/asOf`; липсваща стойност е `null` или отсъства, никога 0 (документирани null: `rates.assumptions` пази низовете на НАП дословно; четири от 46-те бюджета
> нямат приходи/трансфери в закона). Пълният списък с промени е в §6.

### 3.1 `core.json` — ВЕДНАГА · състояние real · източник forecast_tables, kfp, eurostat · asOf 2026-08-31 (последният отчет по КФП) · S01 и всяка страница
Единственият файл, който се зарежда веднага. Малък нарочно; всичко тежко е лениво.
```jsonc
{
 "meta": { "id":"core", … },
 "build": { "dataVersion":"2026-10-02.1", "kfpLatest":"2026-08-31", "kfpMonths2026":8, "kfpNext":"2026-09-30",
            "eurRate":1.95583 },
 "years": { "list":[2024,2025,2026,2027,2028],
            "vintage":{ "2024":"actual","2025":"prelim","2026":"plan","2027":"forecast","2028":"forecast" } },
 "sources": { "kfp": {"title":"…","publisher":"Министерство на финансите","url":"https://…","kind":"xls","access":"open","note":"…"}, … },   // §2.1
 "pending": { "P01": {"status":"pending","id":"P01","title":"Изпълнение по видове данъци","reason":"…","expected":"…","source":["minfin"],"screens":["S06"]}, … },
 "counts":  { "functions":9, "budgets":45, "programBudgets":…, "programs":…, "terms":64, "municipalities":265, "measures":…, "kfpReports":32 },
 "population": { "year":2026, "date":"2026-01-01", "persons":6423207, "source":["eurostat"] },
 "kpis": {                       // «Бюджет 2026 в шест числа» (S01), предварително изчислени, за да не трябва друг файл при първото рисуване
   "gdp":         { "mln":125247.0, "year":2026, "vintage":"plan", "href":"#/prognoza" },
   "revenue":     { "planMln":49615.3, "execMln":26347.4, "execPct":53.1, "yoyPct":11.2, "href":"#/izpalnenie" },
   "expenditure": { "planMln":56807.2, "execMln":28548.8, "execPct":50.3, "yoyPct":10.3, "href":"#/izpalnenie" },   // с вноската в ЕС
   "balance":     { "planMln":-7191.9, "execMln":-2201.4, "prevYearMln":…, "href":"#/izpalnenie" },
   "capex":       { "planMln":9360.6, "execMln":3062.2, "execPct":32.71, "pctGdp":7.5, "href":"#/izpalnenie/pera" },
   "debt":        { "zddMln":…, "pctGdp":…, "year":2026, "scope":"zdd", "href":"#/dalg" }
 },
 "functions": [ { "id":"obrazovanie","name":"Образование","mln":5599.7,"pctGdp":4.5,"share":10.09,"yoyPct":7.0 }, … ],   // 9, план 2026, за «топ 5» и лентите на началната страница
 "revenueGroups": [ { "id":"dds","name":"ДДС","mln":12803.8,"share":25.81 }, … ]                                      // 8, план 2026, «от всеки 100 €»
}
```
`core.kpis` дублира числа, притежавани от `outlook`/`execution`/`debt`; `base.py` проверява, че са идентични.

### 3.2 `outlook.json` — ленив · D01 D02 D15 (+ съотношение D13) · real · източник forecast_tables · asOf 2026-07-01 · S01 S04 S13 S17
Приложение 3 (млн. € и % от БВП) + макрорамка от Табл. I-2, 2024–2028.
```jsonc
{ "meta":{…,"unit":"млн. €"},
  "years":[2024,2025,2026,2027,2028], "vintage":["actual","prelim","plan","forecast","forecast"],
  "gdp":     {"mln":[104767.0, …, 125247.0, …]},            // Табл. I-2; 2026 незакръглено: 125246.7 в бележката
  "kfp": {
    "revenue":     {"mln":[…5], "pctGdp":[…5]},             // Приходи, помощи и дарения; 2026 = 49615.3
    "expenditure": {"mln":[…5], "pctGdp":[…5]},             // Общо разходи (с вноската в ЕС); 2026 = 56807.2
    "balance":     {"mln":[…5], "pctGdp":[…5]},             // 2026 = -7191.9
    "interest":    {"mln":[…5], "pctGdp":[…5]},             // D15
    "primaryBalance": {…}                                    // само ако редът го има в източника
  },
  "macro": { "gdpRealGrowthPct":[…5], "hicpPct":[…5], "unemploymentPct":[…5] },   // ако може да се извлече от I-2 (иначе ключът отсъства и meta.pending казва защо)
  "notes": [ {"id":"pct2024","text":"Колоната „% от БВП“ за 2024 г. в Табл. II-2 е грешна в източника; ползваме Приложение 3."} ]
}
```

### 3.3 `revenue.json` — ленив · D05 (половината за приходите) · real · източник forecast_tables · asOf 2026-07-01 · S06 S04 S07 S13 S15 S19
```jsonc
{ "meta":{…}, "years":[2024,2025,2026,2027,2028], "vintage":[…],
  "total": {"mln":[…], "pctGdp":[…]},
  "groups": [                                     // 8-те източника на S06 (регистър на идентификаторите §2.3), същото групиране като в прототипа v3.6 revenue_structure
    {"id":"dds","name":"ДДС","annex3Rows":["ДДС"],"mln":[…5],"pctGdp":[…5],"share2026":25.81,"yoy2026Pct":16.4,"glossary":"dds"}, … ],
  "rows": [                                       // пълното дърво на приходите от Приложение 3, плоско с указатели към родителя
    {"id":"r.tax","label":"Данъчни приходи","level":1,"parent":"r.total","mln":[…],"pctGdp":[…]}, … ],
  "execution": { "ref":"execution", "rows":{"rev.tax":"Данъчни","rev.nontax":"Неданъчни","rev.grants":"Помощи"} }   // указател: изпълнението идва от execution.json
}
```
Изпълнението по вид данък е **предстоящо P01** (`meta.pending:["P01"]`).

### 3.4 `expenditure.json` — ленив · D03 D04 D05 (половината за разходите) · real · източник forecast_tables, eurostat · asOf 2026-07-01 · S07 S08 S19 S04 S18
```jsonc
{ "meta":{…},
  "functions": {
    "years":[2025,2026,2027,2028], "vintage":["prelim","plan","forecast","forecast"],   // Табл. III-1, колона „2025 Програма“ = prelim
    "totalMln":[…4], "totalPctGdp":[…4],                                                // 2026: 55525.0
    "items":[ {"id":"zdraveopazvane","name":"Здравеопазване","mln":[6043.8,6664.4,6765.9,6981.4],"pctGdp":[5.5,5.3,5.0,4.9],
               "parts":[{"name":"…","mln":[…4],"pctGdp":[…4]}], "ministries":["1600"], "glossary":"…" }, … ]   // parts[] както са отпечатани в III-1 (някои функции нямат)
  },
  "economic": { "years":[2024,2025,2026,2027,2028], "vintage":[…],
    "rows":[ {"id":"x.personnel","label":"Персонал","level":2,"parent":"x.current","mln":[…5],"pctGdp":[…5]}, … ] },   // дървото на разходите от Приложение 3
  "cofog": { "years":[2015,…,2024], "unit":"млн. €", "source":["eurostat"], "asOf":"2026-09-16",
    "total":{"mln":[…10],"pctGdp":[…10]},
    "items":[ {"code":"GF07","name":"Здравеопазване","nameEn":"Health","mln":[…10],"pctGdp":[…10]}, … ] },           // 10 дивизии + GF0107 операции с дълга
  "perCapita": { "population":6423207, "year":2026 }                                      // удобство: население към 2026-01-01 (виж core.population)
}
```

### 3.5 `execution.json` — ленив · D06 D16 D26 · real · източник kfp · asOf 2026-08-31 · S15 S16 S01 S04 S06 S17 S19

**Договор, версия 2 (05.11.2026).** Формата по-долу е версия 1; версия 2 я пази и добавя каквото иска раздел 6.1 на
[спецификацията](approach-specification.md). Кодът е в `pipeline/budget_pipeline/validate/execution_contract.py`.

- **`contract`** казва версията на схемата (`schema: 2`, и `meta.schema: "execution/2"`), валутата (EUR), единицата и мащаба (млн. €),
  обхвата на всяка колона (`kfp`, `nat`, `eu`), счетоводната основа (`cash`), правилото за превръщане от лева (2024 и 2025 г.) и
  правилото за липсваща стойност: `null`, никога 0.
- **`contract.blocks`** казва за всеки блок трите статуса поотделно. Доказателството е `real`, `mock` или `pending`. Бюджетният статус е
  `draft`, `law`, `report` или `forecast` (`plan2026` е `draft`). Видът на стойността е `observed`, `derived` или `estimate`
  (`monthly`, `latest`, `pace` и `reconcile` са `derived`, с правилото).
- **Парите са десетични низове** с толкова знака, колкото казва `contract.money.places`: `data` и `monthly` 3, `plan2026` и `latest` 1,
  `reconcile` 3 / 1 / 1. Например `"33898.456"`, `"-3669.2"`. Процентите (`pctPlan`, `yoyPct`, `pace`) остават числа.
  Екстракторът превръща и вади в десетична аритметика и закръгля половината нагоре от нулата, както Excel и съобщенията на МФ;
  на 3168-те числа на отчетите резултатът е същият като на предишното изчисление.
- **Четене.** `apps/web/client/data.js` и `execution_contract.numbers()` четат и двете версии и дават на страниците, строителите и проверките числа.
  Файлът, както е публикуван, остава в `canonical` (в браузъра) за износа.
- **Произход** (раздел 6.2): `execution-provenance.json` е компактен индекс. За всеки месец дава отчета (`originals["2026-09"]`: файл,
  sha256, дата, единица), листа (`sheet`), буквата на всяка колона (`columns`), реда на Excel за всеки ред (`rows`) и правилото за
  изчисления ред `exp.total` (`computed`). Числото `data["2026"].kfp.rev[8]` е клетка B11 на `2026-EU_funds_0926_BG_WEB.xls`.
  За плана: страницата и редът на Приложение 3 (`plan2026.kfp`) и пътя в `data/inputs/kfp_components_2026.json` (`nat`, `eu`).
  Групата CONTRACT на `datasets.py` проверява файла, както е записан, и индекса.

Натрупано изпълнение по КФП, **32 месечни отчета** (2024: 12, 2025: 12, 2026: 8; файлове `data/originals/kfp_2024|2025|2026/*.xls`; файловете за 2024 и 08.2026
са добавени на 2026-10-09), всички редове, три колони. `data["2024"]` има същата форма като `data["2025"]` (лева, преобразувани). Към 2026-10-09 числата
по-долу, които още казват юли, са отчетът за юли; последният е за август (`latest.month` 8, `pendingMonths[0]` = 9 / 2026-09-30).
```jsonc
{ "meta":{"id":"D06+D16+D26", "unit":"млн. €", "asOf":"2026-07-31", …},
  "cols":[ {"id":"kfp","label":"Консолидирана фискална програма","kfpCol":"к.2"},
           {"id":"nat","label":"Национален бюджет","kfpCol":"к.3"},
           {"id":"eu","label":"Европейски средства","kfpCol":"к.4"} ],
  "rows":[ {"id":"rev","label":"Приходи, помощи и дарения","row":11,"level":0,"group":"revenue"},
           {"id":"rev.tax","label":"Данъчни приходи","row":12,"level":1,"parent":"rev","group":"revenue"}, …
           {"id":"exp.total","label":"Разходи (с вноската в ЕС)","computed":"exp+eucontrib","level":0,"group":"expenditure"}, … ],   // §2.4
  "data": {
    "2025": { "months":12, "currency":"BGN","converted":"÷1.95583",
              "asOf":["2025-01-31", … ,"2025-12-31"],
              "files":[{"month":1,"file":"2025-EU_funds_0125_BG_WEB.xls","sha256":"…"}, …],
              "kfp":{"rev":[…12],"rev.tax":[…12], … }, "nat":{…}, "eu":{…} },
    "2026": { "months":7, "currency":"EUR","asOf":["2026-01-31", … ,"2026-07-31"], "files":[…],
              "kfp":{"rev":[…,26347.377], "exp":[…,27887.092], "eucontrib":[…,661.724], "exp.total":[…,28548.816],
                     "balance":[…,-2201.439], "fin.ext.markets":[…,2826.202], "exp.capex":[…,3062.167], … }, "nat":{…}, "eu":{…} } },
  "monthly": { "2026": {"kfp":{"rev":[…7],"exp.total":[…7],"balance":[…7]}, …}, "2025": {…} },   // НЕнатрупани (разлики) само за трите заглавни реда, всички колони
  "plan2026": { "kfp": {"rev":49615.3,"rev.tax":…,"rev.nontax":…,"rev.grants":…,"exp":…,"exp.personnel":…,"exp.maint":…,"exp.interest":…,"exp.social":…,
                         "exp.subsidies":…,"exp.abroad":…,"exp.capex":9360.6,"exp.reserve":…,"eucontrib":…,"exp.total":56807.2,"balance":-7191.9},
                "nat": {"rev":44248.2,"exp.total":49194.5,"balance":-7080.4}, "eu": {…},
                "note":"Съпоставката на перата на отчета с Приложение 3 предстои да бъде проверена от експерт по публични финанси.",
                "source":["asbp"], "asOf":"2026-07-01" },
  "latest": { "month":7, "asOf":"2026-07-31",            // предварително изчислено заглавно число на последния отчет, по колони
              "kfp": {"rev":{"cum":26347.4,"plan":49615.3,"pctPlan":53.1,"prevYearCum":…,"yoyPct":11.2}, "exp.total":{…}, "balance":{…}, "exp.capex":{…,"pctPlan":32.71}, "fin.ext.markets":{"cum":2826.2}} },
  "pace": { "2025": {"exp.capex":[…12 натрупан дял от годишния за 2025],"rev":[…],…} },     // дял от крайния натрупан за годината, достигнат до месец m (за ▼ изостава / ▲ изпреварва)
  "pendingMonths": [ {"month":8,"asOf":"2026-08-31","status":"pending","id":"P04"} ],
  "reconcile": { "dec2024VsAnnex3": {…същите редове, колоната „2024 Отчет“ на Приложение 3…}, "dec2025VsAnnex3": {"rev":{"kfp":44015.160,"annex3":44014.7}, "exp.total":{…}} , "note":"…" }
}
```
Правила: масивите имат точно `months` елемента (без null); редове, празни в един отчет, се изпускат от файла, ако са празни във **всички** отчети на годината
(редове 42–44 са заглавия във файловете за 2026); `files[].sha256` свързва всяко число с xls файла, от който идва; стойностите за 2025 се закръгляват до 3 знака СЛЕД деление на 1,95583
(тъждествата тогава важат с точност ±0,005; валидаторът ги проверява точно върху ОРИГИНАЛНИТЕ числа, а върху преобразуваните — с този допуск).
Опорни стойности: 31.07.2026 натрупано КФП — приходи 26347.377, `exp.total` 28548.816, баланс −2201.439 → 26,35 / 28,55 / 2,20 млрд. €;
31.08.2026 — приходи 30117.756, `exp.total` 33193.232, баланс −3075.476 → 30,12 / 33,19 / 3,08 млрд. € (60,7% / 58,4% от плана).
`pace` има 2024 и 2025 (пълни години); S15 отбелязва 2026 спрямо темпа на 2025. Декември 2024 срещу Приложение 3 „2024 Отчет“: приходи −8,2,
`exp.total` −21,3, баланс +13,1 млн. €; срещу Табл. II-3 / II-4 (2024): национални приходи +30,3, разходи +53,5, баланс −39,5; европейски приходи −38,5,
разходи −74,8, баланс +52,6 млн. € (отчетено от `execution_reports.py`, не е коригирано).

### 3.6 `components.json` — ленив · D07 · real · източник zdb, zbdoo, zbnzok, forecast_tables, kfp · asOf 2026-07-31 · S15 («Бюджети»)
```jsonc
{ "meta":{…,"unit":"хил. €"},
  "budgets": { "state":{"revKhil":28460847.1,"expKhil":17600574.1,"transfersNetKhil":16897918.8,"euContributionKhil":1282158.2,"source":["zdb"],"sourceNote":"ЗДБ 2026, чл. 1, ал. 1–3 (ДВ бр. 69)"},
               "doo":{…}, "nzok":{…}, "municipalities":{…}, "euAccounts":{"unit":"млн. €",…}, "other":{"bntKhil":49503.7,…} },
  "transfers": { "toMunicipalitiesKhil":4927964.0, "toDooKhil":6744937.1, "toNzokKhil":2052233.7, "toEuNfKhil":1538258.1, "toEuDfzKhil":482749.6 },
  "nationalVsEu2026": { "plan":{"national":{"revMln":44248.2,"expMln":49194.5,"balanceMln":-7080.4},"eu":{…}}, "exec":{"asOf":"2026-08-31","ref":"execution"} },
  "sankey": { "unit":"млн. €", "nodes":[{"id":"state","name":"Държавен бюджет"},…], "links":[{"source":"state","target":"doo","value":6744.9},…] },   // връзките се сумират до трансферите по-горе (хил. → млн., 1 знак)
  "pending": ["P02"]       // месечно изпълнение по съставни бюджети
}
```

### 3.7 `ministries.json` — ленив · D08 (+ индекс на D09) · real · източник zdb, prb, bill · asOf 2026-07-31 · S07 S10 S11 S19 S05
**46-те** бюджета на ЗДБ 2026 (чл. 2–47; планът казваше 45). Както е построено: `{meta,totals,kinds,tiers,programTotals,scopeNote,items[]}`, запис = `{id,art,name,lawName,short,kind,revKhil,expKhil,transfersKhil,policyTotalKhil,policiesKind,policies,programs,billVsLaw}` (`lawName` само там, където законът изписва името различно; `billVsLaw` = промяната на бюджета от проекта към закона; `tiers` = доколко е проверен всеки програмен бюджет: 39 потвърдени / 3 се различават от закона / 4 предстоящи).
```jsonc
{ "meta":{…,"unit":"хил. €"},
  "totals": {"count":45,"revKhil":2284302.7,"expKhil":13323620.6},      // суми на записите (някои бюджети нямат собствени приходи → rev отсъства)
  "items":[ { "id":"1300","art":12,"name":"Министерството на вътрешните работи","short":"МВР","kind":"ministry",
              "revKhil":…, "expKhil":…, "policyTotalKhil":…,
              "policies":[{"n":1,"name":"…","khil":…}],                   // политиките, отпечатани в закона (23 бюджета ги имат)
              "programs":{"status":"real","count":11,"file":"ministries/1300.json"},      // или {"status":"pending","id":"P03","reason":"таблиците са картинки / различен формат"}
              "exp2025Khil":…,                                           // „Закон 2025“, от програмния бюджет, когато го има
              "billVsLaw":{"expKhil":{"bill":…,"law":…,"diff":…}} } ,    // само за 4-те бюджета, където проект ≠ закон: МС +1622,2; ДАНС +1954,6; ДАР +626,6; СЕМ +33,0 хил. €
            … ] }
```
`kind` ∈ `ministry | agency | commission | judiciary | constitutional | legislature | fund | other` (мое, по име; ползва се за филтъра на S10).

### 3.8 `ministries/<код>.json` — ленив, по един на ведомство · D09 · real · източник prb · asOf 2026-07-01 · S11 S10
Програмни бюджети 2023–2028, нарязани от източника от 552 KB. Файл съществува само за бюджети, извлечени от v3.6 (**41 кода разчетени, 28 потвърдени**, 5 неразчетени → тези
ведомства имат `programs.status:"pending"` в `ministries.json` и НЯМАТ файл).
```jsonc
{ "meta":{…,"unit":"хил. €"}, "id":"1300","art":12,"name":"…",
  "years":[2023,2024,2025,2026,2027,2028], "yearLabels":["Отчет 2023","Отчет 2024","Закон 2025","Проект 2026","Прогноза 2027","Прогноза 2028"],
  "vintage":["actual","actual","plan","plan","forecast","forecast"],
  "cols":["consTotal","consPrb","consOther","deptTotal","deptPrb","deptOther","admTotal","admPrb","admOther"],   // консолидирани / ПРБ / други и ЕС; ведомствени; администрирани (нивата никога не се сумират заедно)
  "policies":[ { "code":"1300.01.00","name":"…","values":{"2026":[…9],"2025":[…9]},
                 "programs":[ {"code":"1300.01.01","name":"…","values":{"2026":[…9],…}} ] } ],
  "yearsComplete":[2025,2026],                 // години, за които всяка таблица е разчетена (останалите са частични → пунктирани в интерфейса)
  "check": {"prbTotal2026":…, "zdbExp":…, "matchesLaw":true},      // източник на флага «проект ≠ закон»
  "problems":[…],                              // предупреждения при извличането на български, показват се само в каталога
  "doc": {"file":"1300_МВР.pdf","pages":[…],"archive":"52-602-01-19.zip → папка 7"} }
```
Числа, които не са разчетени за дадена година, са ОТСЪСТВАЩИ от `values` (не се измислят нули).

### 3.9 `programs.json` — ленив · индекс на D09 · real · S10 («Програми») S19
Плосък индекс на всяка извлечена политика/програма за търсене/сортиране без отваряне на 41 файла.
```jsonc
{ "meta":{…,"unit":"хил. €"}, "fields":["ministry","code","name","level","policy","y2026","y2025","growthPct","isNew"],
  "items":[ ["1300","1300.01.01","…","program","1300.01.00",123456.7,120000.1,2.88,0], … ] }       // level: policy|program; y2026 = консолидиран сбор (consTotal), липсващ ключ в масивите → 0 само при isNew=1 (документирано), никога измислено
```
(Масив от масиви заради размера; `fields` назовава колоните. За редове без стойност за годината записът е `-1`, което значи „няма данни“ — никога не се рисува като число.)

### 3.10 `measures.json` — ленив · D12 · real · източник forecast_tables · asOf 2026-07-01 · S12 S01 S04 S08 S19
Нормализиран от `measures_2026.json` на v3.6 (въведение 8+9 с оценка + 4+3 без оценка; Табл. II-8/II-9; Част VIII 8 елемента).
```jsonc
{ "meta":{…,"unit":"млн. €"},
  "tabs":["short","discretionary","laws"],
  "totals": { "revenueMln":745.0, "expenditureMln":-1710.5, "discretionary2026":{"II-8":482.0,"II-9":604.4}, "basis":"начислена основа за II-8/II-9" },
  "items":[ { "id":"kr1","tab":"short","kind":"revenue","name":"…","text":"…","effectMln":{"2026":…},"hasEstimate":true,
              "from":"2026-01-01","legalBasis":"…","quote":"…","page":{"pdf":…,"docx":…},"status":"bill" } , … ],   // status: «в законопроекта; по приетия закон не е проверено»
  "check":{"II-8":482.0,"II-9":604.4}
}
```
Редакционните етикети (кого засяга, кой плаща → кой печели, риск) са **примерни M06**: `mock/measure-labels.json` по `id` на мярката.

### 3.11 `law.json` — ленив · D10 D11 (+ разлика на D08) · real · източник bill, zdb, parliament · asOf 2026-07-31 · S14 S11 S16
```jsonc
{ "meta":{…},
  "art1": { "unit":"хил. €", "lines":[ {"id":"a1.1.rev","text":"Приходи на държавния бюджет","bill":28455734.1,"law":28460847.1,"diff":5113.0}, … ] },   // чл. 1, ред по ред
  "budgets": [ {"art":12,"name":"…","bill":{"rev":…,"exp":…},"law":{"rev":…,"exp":…},"diff":{"exp":…}} , … ],              // 46 бюджета, проект срещу закон (извлечени от docx); законът се различава от проекта в чл. 1 и в бюджетите по чл. 2, 3, 16, 17
  "timeline": [ {"date":"2026-07-01","kind":"submitted","title":"Внесен от Министерския съвет","ref":"52-602-01-19","href":"…"},
                {"date":"2026-07-15","kind":"plenary-1","title":"Първо четене в залата"}, … ],
  "counts": { "committeeReports":23, "opinions":70, "proposals":69, "proposalDates":{"2026-07-16":6,"2026-07-17":29,"2026-07-20":34} },
  "gazette": [ {"issue":68,"date":"2026-07-28","laws":["ЗБДОО","ЗБНЗОК"]}, {"issue":69,"date":"2026-07-31","laws":["ЗДБ"]} ],
  "documents": [ {"title":"…","url":"https://www.parliament.bg/…","kind":"report|opinion|bill|proposal"} ],               // само връзки
  "pending":["P07"]                                                                                                     // съдържанието/ефектът на 69-те предложения
}
```
Никъде няма имена на депутати. Първата стъпка от хронологията (удължителният закон) има `"dateStatus":"to-verify"` и няма ключ за дата, ако не мога да я намеря в източник.

### 3.12 `debt.json` — ленив · D13 D14 · real · източник forecast_tables, eurostat, bnb · asOf 2026-07-21 (тримесечно) · S17 S01 S13 S16
```jsonc
{ "meta":{…},
  "zdd": { "years":[2024,2025,2026,2027,2028], "vintage":[…], "totalMln":[…], "externalMln":[…], "domesticMln":[…], "pctGdp":[…] },       // Табл. VI-1
  "maastricht": { "years":[2015,…,2025], "bg":{"mln":[…11],"pctGdp":[…11]}, "eu27":{"pctGdp":[…11],"mln":[…11]}, "thresholdPctGdp":60 },    // Eurostat gov_10dd_edpt1
  "quarterly": { "eurostat":{"quarters":["2024-Q1",…],"mln":[…],"pctGdp":[…],"flags":[…]},
                 "bnbGg":{"quarters":[…],"mln":[…]}, "bnbCg":{"quarters":[…],"mln":[…]} },       // gov_10q_ggdebt + BNB SDMX GGD/CGD
  "financing": { "ref":"execution", "rows":["fin","fin.ext","fin.ext.markets","fin.dom","fin.dom.advances","fin.dom.refunds","fin.priv"] },
  "pending":["P06"] }                                                                            // падежи и емисии на държавни ценни книжа
```

### 3.13 `rates.json` — ленив · D17 · real (+ предстоящи части) · източник nap, zbdoo, zbnzok, forecast_tables · asOf 2026-08-12 · S18 S16
Крайна форма, строена от `pipeline/budget_pipeline/build/rates.py` (69,7 KB суров, 12,4 KB gz). Ставките са % от месечния осигурителен доход, парите са в EUR.
Реално само там, където таблицата на НАП има ред (категории 1 и 10); всяко число се сверява при сглобяването с
Приложение № 2 към законопроекта и с двата закона (сглобяването пада, ако не съвпадат).
```jsonc
{ "meta":{…, "id":"D17", "unit":"%", "pending":[]},          // предстоящите части са на ниво сценарий (в `scenarios[*]`), нямат P-идентификатор
  "scenarios":[
    {"id":"employment","label":"Трудов договор","status":"real","source":["nap","zbdoo","zbnzok","asbp"],"basis":"…","appliesTo":"plain text",
     "employeePct":13.78,"employerPct":18.92,"employerPctWithoutTzpb":18.52,"incomeTaxPct":10.0,
     "split":{"employee":{"doo":8.38,"upf":2.2,"health":3.2},"employer":{"doo":10.92,"upf":2.8,"health":4.8}},
     "tzpbPct":{"min":0.4,"max":1.1,"used":0.4},"gvrsPct":0.0,
     "maxInsurableIncomeEur":[{"id":"until","from":"2026-01-01","to":"2026-07-31","eur":2111.64},{"id":"from","from":"2026-08-01","to":"2026-12-31","eur":2300.0}],
     "variants":[{"id":"born-before-1960","nap":"1.1","employeePct":13.78,"employerPctWithoutTzpb":18.52,"split":{…},"note":"…"}]},
    {"id":"management-contract", … същите числа като employment, БЕЗ incomeTaxPct, "sameRatesAs":"employment",
     "pending":[{"field":"incomeTaxPct","reason":"…","expected":"…","source":[…]}]},
    {"id":"self-employed", … "employeePct":27.8,"employerPct":0.0,"split":{целият дял на работодателя е 0},
     "minInsurableIncomeEur":[{…550.66},{…620.2}],"maxInsurableIncomeEur":[…],
     "variants":[{"id":"with-sickness-maternity","nap":"10.2","employeePct":31.3,"split":{…}}],"pending":[{"field":"incomeTaxPct",…}]},
    {"id":"pensioner","label":"Пенсионер","status":"pending","source":["nap"],"reason":"…","expected":"…"}      // без числа: таблицата на НАП няма ред за пенсионер
  ],
  "rules":{"validTo":"2026-07-31","from":"2026-08-01","year":2026},               // двата набора правила (до 31.07 / от 01.08)
  "incomeTax":{"ratePct":10.0,"years":{"2025":10.0,…},"soleTraderBusinessPct":{"2025":15.0,…},"basis":"…","source":["asbp"],"note":"…"},
  "tzpb":{"unit":"…","min":0.4,"max":1.1,"used":0.4,"usedWhy":"…","activities":[{"code":"01","name":"…","until":0.9,"from":0.9}],   // 87 дейности (ЗБДОО Прил. 2 + 2А)
          "changed":7,"note":"…","basis":"…","source":["zbdoo"]},
  "minInsurableIncome":{"unit":"…","groups":[9 професионални групи],"rows":[{"no":1,"code":"…","name":"…","until":[9 числа|null],"from":[9 числа|null]}],   // 86 реда (Прил. 1 + 1А)
          "selfEmployedEur":[…],"notes":[5 низа],"cells":774,"emptyCells":30,"basis":"…","source":["zbdoo"]},
  "changes":[{"id":"max-insurable","label":"…","unit":"…","until":2111.64,"from":2300.0,"delta":188.36,"deltaPct":8.92,"basis":"…","source":[…]}, …],
        // идентификатори: max-insurable, min-self-employed, min-income-by-activity (броячи + мин/макс, без разлика), tzpb-by-activity (броячи + changedCodes),
        //      civil-servant-employee-share (0 -> 6.5), civil-servant-employer-share (32.3 -> 25.8)
  "napCategories":[{"no":1,"label":"…","page":1,"modelledBy":["employment","management-contract"]}],   // всичките 19 категории от таблицата на НАП
  "assumptions":[{"no":"3","label":"…","unit":"…","years":{"2025":"…","2026":"…","2027":"…","2028":"…"},"sub":[]}],   // 15 реда от Прил. 2 на АСБП, текстът както е отпечатан
  "quotes":{"zbdoo_art9":"…","zbdoo_art14":"…","zbdoo_art15":"…","zbnzok_art2":"…"},
  "notes":[…], "checks":{…} }
```
`employment` е сценарият, който чете `calc.js` на S18 (`employeePct`, `employerPct` с ТЗПБ или `employerPctWithoutTzpb`, `incomeTaxPct`, `split`,
`tzpbPct`, `maxInsurableIncomeEur[{from,to,eur}]`, плюс `appliesTo` и `gvrsPct` за кутията с методиката); без числово `incomeTaxPct` показва
„предстои“. Единствените `null` във файла са празните клетки на `minInsurableIncome.rows[*].until/from`. Буквите на секциите по КИД, отпечатани в
приложенията на закона, не се препубликуват (в последните редове не следват КИД-2008).

### 3.14 `municipalities.json` — ленив · D19 D20 D21 · real · източник zdb, gisco, eurostat · asOf 2026-07-31 · S20 S21 S19
265 общини; трансфери от ЗДБ чл. 51 (сбор на основните трансфери 4 887 464,0 хил. €), население от GISCO **LAU 2024** (`POP_2024`, 1 януари 2024; сборът 6 445 481 е равен на националното число на Eurostat; изданието LAU 2021 е оценка преди преброяването от 6 916 548). Поле `population`, `populationYear` 2024. GISCO има разменени населенията на Добрич (DOB28) и Добрич-селска (DOB15); `popFix` държи поправката и обяснението ѝ (покажи го като бележка под линия навсякъде, където се вижда стойност на жител за някоя от двете).
```jsonc
{ "meta":{…,"unit":"хил. €"},
  "columns":["total","delegated","equalizing","winterRoads","capital","otherTargeted"],
  "items":[ {"id":"BLG03","name":"Благоевград","region":"Благоевград","regionId":"BLG","population":…,"populationYear":2024,
             "transfers":{"total":…,"delegated":…,"equalizing":…,"winterRoads":…,"capital":…,"otherTargeted":…},
             "perCapita":{"total":…}, "match":"exact|manual" } , … ],            // perCapita в € на човек (изчислено от мен)
  "regions":[ {"id":"BLG","name":"Благоевград","population2025":…,"transfersKhil":…} ],      // D21; отсъства, ако заявката към Eurostat пропадне (тогава meta.pending го отбелязва)
  "totals":{"transfersKhil":4887464.0,"populationSum":…}, "unmatched":[]
}
```
Ако мрежата не е налична при сглобяването, ползва се кешираното копие в `data/cache/`; ако няма кеш, списъкът се публикува без `population`, а `meta.status` остава `real` за трансферите (ключът `population` отсъства, никога не е нула).

### 3.15 `geo/obshtini.json` — ленив · D20 · real · източник gisco · S20 S21
GeoJSON `FeatureCollection` (разширението `.json` е нарочно; обикновен `application/json`). WGS84, ≤ 400 KB, координати, закръглени до 3–4 знака, само България (265 обекта).
```jsonc
{ "type":"FeatureCollection", "meta":{…}, "features":[ {"type":"Feature","properties":{"id":"BLG03","name":"Благоевград"},"geometry":{"type":"Polygon|MultiPolygon","coordinates":[…]}} ] }
```
За ECharts `registerMap('bg-obshtini', geojson)` ползвай `nameProperty:'id'` (имената на общините не са уникални).

### 3.16 `glossary.json` — ленив (предзареждане в свободно време) · D22 · real · източник wg (редакционен, дословно от v3.6) · S03, на място навсякъде
Строен от `pipeline/budget_pipeline/build/editorial.py`; крайната форма е в `docs/example-datasets.md` и тя печели там, където се различава от скицата по-долу (например `intro.disclaimer` е обект).
```jsonc
{ "meta":{…}, "categories":[{"id":"…","title":"…"}],
  "terms":[ {"n":1,"slug":"dds","title":"ДДС","name":"Данък върху добавената стойност","abbr":"ДДС","cat":"…","def":"…","example":"…","aliases":["…"],
             "related":[{"slug":"akciz","note":"Не бъркай с …"}], "see":[{"label":"Виж в бюджета","href":"#/prihodi/dds"}] } , … ],   // 64
  "sources":[…] }
```

### 3.17 `guide.json` — ленив · D23 · real · източник wg (редакционен) · S02
Строен от `pipeline/budget_pipeline/build/editorial.py`; крайната форма е в `docs/example-datasets.md` и тя печели там, където се различава от скицата по-долу (стъпките носят `next{n,title,href,text}`, последната стъпка няма `next`).
```jsonc
{ "meta":{…}, "steps":[ {"n":1,"title":"…","intro":"…","blocks":[{"type":"p|ul|link","text":"…","href":"…"}],"next":{"n":2,"title":"…"}} , … ],   // 8 стъпки
  "checks":{"title":"Петте проверки","items":[{"n":1,"text":"…"}, …]}, "credit":"Работна група „Бюджет на светло“" }
```
Текстът е оригиналният текст на пътеводителя, дословно; авторството е общо.

### 3.18 `sebra.json` — ленив · D24 · real · източник sebra · asOf 2026-08-31 · S23
Реално дневно обобщение на плащанията на МИДТ за 31.08.2026: 28 плащания, 171 854,85 €, категория „10 xxxx Издръжка“, по бюджетна организация.
```jsonc
{ "meta":{…,"unit":"€"}, "period":{"from":"2026-08-31","to":"2026-08-31"}, "ministry":"Министерство на електронното управление",
  "total":{"count":28,"eur":171854.85}, "byCode":[{"code":"10 xxxx","name":"Издръжка","count":28,"eur":171854.85}],
  "byOrganisation":[{"name":"ИАИЕУ","code":"0750010000","count":…,"eur":…},{"name":"…-ЦУ","code":"0750000002","count":…,"eur":…}] }
```

### 3.19 `feed.json` — ленив · real · S16 (+ RSS `feed.xml`)
```jsonc
{ "meta":{…}, "events":[ {"date":"2026-07-31","kind":"report|law|plenary|data|rates|eurostat","title":"…","text":"…","href":"#/izpalnenie","status":"real"} … ],
  "expected":[ {"title":"Отчетът към 30.09.2026","status":"pending","id":"P04"}, {"title":"Проектът за бюджет 2027","status":"pending"} ],
  "highlights":{ "month":8,"revenueYoyPct":11.2,"expenditureYoyPct":10.3,"deficitMln":2201.4,"deficitPrevYearMln":…,"capexPctPlan":32.71,"newBorrowingMln":2826.2 } }
```
**Отклонение:** RSS файлът е `data/release/feed.xml` (моя зона) вместо `site/feed.xml` — искане към SHELL в списъка с нужди.

### 3.20 `catalog.json` — ленив · D25 · real · S24 S25 (+ „виж набора“ в изскачащите)
```jsonc
{ "meta":{…},
  "datasets":[ {"id":"D06","slug":"execution","file":"data/execution.json","title":"…","status":"real","source":["kfp"],"period":"2024-01 … 2026-08","asOf":"2026-08-31",
                "format":"JSON","bytes":…,"gzipBytes":…,"screens":["S01","S06","S15","S16"],"eager":false,"contains":["D06","D16","D26"] }, … ],     // всеки файл, включително mock/* и предстоящите P01–P07 (състояние pending, файлът отсъства)
  "traps":[ {"id":"eur-bgn","title":"Евро и лева","text":"…","related":["D06"]}, … ],        // «капаните» на v3.6: евро/лева, обхват, КФП/COFOG, достъп, две версии на АСБП, проект/закон
  "methodology":[ {"id":"calculator","title":"…","text":"…"}, {"id":"cash-accrual",…}, {"id":"conversion","text":"1 € = 1,95583 лв."} ],
  "files":[ {"file":"…","sha256":"…","bytes":…,"role":"source"} ]                           // sha256 на първичните изходни файлове (от MANIFEST.json)
}
```
`catalog.sources` НЕ се дублира: ползвай `core.sources`.

### 3.21 `search-index.json` — ленив (при първия фокус на търсенето) · real · S28 · < 250 KB суров
```jsonc
{ "meta":{…}, "version":1, "groups":["indicators","institutions","municipalities","measures","terms","datasets"],
  "fields":["g","title","sub","value","period","status","href","kw"],
  "items":[ [0,"Приходи 2026 (план)","КФП","49,6 млрд. €","2026","real","#/prihodi","приходи доходи revenue"], … ] }
```
`g` = индекс в `groups`; `value` е готов низ за показване (българско форматиране); `status` ∈ real|mock|pending; `kw` = допълнителни думи за търсене (синоними, съкращения, кодове) — клиентът нормализира латиница/кирилица.
Всеки реален набор допринася; елементите, произлезли от примерни данни, носят `status:"mock"`. Както е построено: 912 реда; бюджетите и агенциите са озаглавени `<име> – <съкращение>` (напр. „Министерство на вътрешните работи – МВР“), така че съкращението да подрежда институцията над програмите ѝ; редовете за политики сочат `#/vedomstvo/<код>`, редовете за програми `#/vedomstvo/<код>/<програма>`; адресите може да носят заявка (`#/razhodi?po=vid`, `#/dalg?obhvat=maastricht`); групата `screens` се добавя от клиента.

### 3.22 `mock/*.json` — ленив · състояние **mock** (всички записи `mock:true` + `why`; `meta.seed`, `meta.constrainedBy`)
Строени от `pipeline/budget_pipeline/build/examples.py` (проверявани от `reference/mock/validate_mock.py`); крайните форми са в `docs/example-datasets.md` и печелят там, където се различават от тази таблица.
| файл | id | какво | ограничено от (сумира се до) | екрани |
|---|---|---|---|---|
| `mock/activities.json` | M01 | 12–20 дейности на функция за **Здравеопазване** и **Образование** | по елемент от Табл. III-1 за функцията (стойност 2026 = реалният елемент; 2025 = 2026 ÷ реалния растеж ± 3%) | S09 |
| `mock/indicators.json` | M02 | 2–3 индикатора за резултат на програма за МФ, МОН, МТСП | програмите са реални (D09); `achieved2024` = цел ± 10% | S11 |
| `mock/municipal-finance.json` | M03 | собствени приходи, разходи, дълг, по тримесечия, на община | Σ разходи = **6 881,9 млн. €** (АСБП с. 128); собствени приходи = разходи − реални трансфери ± малък баланс | S20 S21 |
| `mock/payments.json` | M04 | плащания като в СЕБРА, ян–авг 2026: по институция, вид, ден, получатели (`ЕИК 999…`, „Примерен изпълнител 017 ЕООД“) | месечните суми ≤ реалните разходи на националния бюджет (D06) | S23 |
| `mock/projects.json` | M05 | 12–16 капиталови проекта (`pr-01…`) | годишният сбор, показан като дял от реалните **9 360,6 млн. €** капиталови разходи | S22 |
| `mock/measure-labels.json` | M06 | за всеки `id` на мярка: `affects[]` (персони), `payer`, `winner`, `risk`, `since` | ефектите са реалните (D12) | S12 S08 S01 |
| `mock/tax-assumptions.json` | M07 | допускания за косвените данъци: дял на покупките с ДДС 20%, цена на горивото, акциз на литър/кутия | модел, етикет „ориентировъчно“ | S18 |

Скелет на запис за всеки примерен файл: `{"meta":{…"status":"mock","seed":20261002,"constrainedBy":"D03 Табл. III-1; 2026"}, "items":[{"id":"…","mock":true,"why":"Разбивката до дейности се публикува само от МФ (ЗДОИ)", …}]}`.

---------------------------------------------------------------------------------------------------------
## 4. Предстоящи набори (`core.pending`, без числа)
| id | заглавие | причина / очакван източник | екрани |
|---|---|---|---|
| P01 | Изпълнение по видове данъци | месечният бюлетин на МФ, PDF, недостъпен автоматично (minfin.bg) | S06 S15 |
| P02 | Месечно изпълнение по съставни бюджети (държавен, ДОО, НЗОК, общини) | отчетите на МФ са само за консолидираните колони; съставните са в друг формат | S15 |
| P03 | Програмите на ~15 ведомства | таблиците в архива към законопроекта са картинки / различен формат | S10 S11 |
| P04 | Отчетът към 30.09.2026 и следващите | още не е добавен (последният добавен е към 31.08.2026) | S15 S16 |
| P05 | Ориентир 2022–2023 | месечните отчети за 2022–2023 не са извлечени (2024 е добавена на 09.10.2026) | S15 |
| P06 | Падежи и емисии на дълга | регистърът на държавния дълг на МФ — достъп само през браузър | S17 |
| P07 | Съдържанието и ефектът на 69-те предложения | документите са PDF; само линкове | S14 |

---------------------------------------------------------------------------------------------------------
## 5. Какво налага `pipeline/budget_pipeline/validate/base.py` (ненулев изходен код при грешка)
1. Наборът файлове в `prototype/` и всеки SHA-256 са равни на `data/originals.sha256`.
2. КФП: във всеки от 32-та отчета тъждествата за `rev`, `exp` (§2.4) и `к.2 = к.3 + к.4`; `balance` = ред 33; натрупано 2026-07 = 26347,4 / 28548,8 / −2201,4;
   натрупано 2026-08 = 30117,8 / 33193,2 / −3075,5; натрупаните приходи и разходи по КФП растат всеки месец.
3. Тъждества и общи суми от Приложение 3 (приходи, ДОП, разходи, баланс; ±0,3); сборът на Табл. III-1 за 2026 = 55 525,0.
4. ЗДБ: 46 бюджета; Σ елементи е съгласувана; сборът на общинските трансфери 4 887 464,0 хил. €; 265 общини; 64 термина в речника; мерки 482,0 / 604,4 / +745,0 / −1 710,5.
5. Няма `NaN`/`null`/`""` там, където се очаква число; няма числови ключове в нито един блок `pending`.
6. Всеки набор/серия разрешава `status` и `source` (по наследяване); всеки ключ `source` съществува в `core.sources`; всеки примерен запис има `mock:true` + `why`; примерните набори се сумират до реалните общи суми, които разбиват (допуск 0,1 млн. €).
7. `core.kpis` е равно на притежаващите го набори; `catalog.json` изброява всеки файл в `data/release/` (и няма липсващ файл).
8. Бюджетът на размера от §1; gzip размерите се мерят и се записват в `catalog.json`.
9. Както е построено, `base.py` проверява и: всеки `href` на `search-index.json`, `feed.json`, `glossary.json` (`see.href`), `core.json` (`kpis`) и `law.json` съвпада с маршрут от `apps/web/client/routes.js`, и всеки идентификатор на екран в `catalog.json` е маршрут; `screens` на запис в каталога може да се различава от онова, което модул на страница декларира в `needs` (отчита се като предупреждение); редовете на търсенето, общините, мерките, термините и записите на каталога съвпадат един към един с файловете, които описват; `datasets.py --check` (всеки генериран файл е равен на изхода на своя конструктор); `validate_mock.py` (DATA2).

---------------------------------------------------------------------------------------------------------
## 6. Дневник на промените
* v1 · 2026-10-02 · първа версия (преди извличането). По-късните промени са записвани в дневника на проекта като `SPEC CHANGE: …`.
* v3 · 2026-10-09 · добавени КФП 2024 (12 отчета) и 08.2026: 32 отчета; `data["2024"]`, `monthly["2024"]`, `pace["2024"]`, `reconcile.dec2024VsAnnex3`;
  последен = 31.08.2026, `pendingMonths` = 09.2026; P04 → 30.09.2026, P05 → 2022–2023; период 2024.report на S15. BUILD_DATE по подразбиране 2026-10-09
  (`dataVersion` 2026-10-09.1, всеки `meta.retrieved` на прегенерираните файлове; glossary.json и guide.json запазват 2026-10-02, защото
  `editorial.py` спира на собствената си проверка на стъпка 1 от пътеводителя след смяната на заглавието на S01 от 02.10).
* v2 · 2026-10-02 · както е построено (DATA, край на M1): 46 бюджета (не 45), LAU 2024 (не 2021), примерни генератори `examples.py` / `editorial.py`; бюджетите на закона носят `lawName` и `billVsLaw`;
  програмните бюджети са проверени на три нива (39 / 3 / 4); имената на програми и политики са прочетени от заглавията в PDF, където файлът на прототипа няма такива; Приложение 3 съществува в две версии
  (PDF — юнска основа; docx от 01.07.2026 за Табл. III-1; 9 подредове се различават най-много с 4,3 млн. €; оповестено в `outlook.notes`, `execution.plan2026.note` и капана `two-versions` в каталога);
  `debt.json` има `limits`, `newDebt.uses` и `asOf` 2026-09-30; `feed.meta.source` има 8 ключа; заглавията в `search-index.json` получават наставка със съкращението; заглавието на D13 в каталога е
  „Държавен дълг: размер, лихви и лимити“; `core.pending` е речник с ключове P01–P07; записите в `catalog.json` са по `slug`.
