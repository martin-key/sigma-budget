# Издание на данните и командата `budget`

Изданието е проверим пакет от данните на сайта (раздели 6.3, 6.4, 7 и 8 на [спецификацията](approach-specification.md)). Прави го командата
`budget` (`apps/etl/src/production-cli.ts`, обвивка `./budget` в корена на хранилището). За исторически Python манифести се използва `./budget-python`; точният Node договор е в [production-typescript-import.md](production-typescript-import.md). Етап B сглобява, проверява и пресъздава изданието. Етап C го качва в R2,
записва го в регистъра в D1 и го прави текущо през операторския API (раздел „Публикуване“).

## Какво има в изданието

```text
/outside/new/candidate/
  manifest.json     каноничен JSON: подредени ключове, без интервали, един краен нов ред
  data/             всеки файл на data/release (без releases/)
  validation.json   всички 26 предметни групи + REGISTRY и допълнителните source проверки, без времената
  receipt.json      кога и как е сглобено; не е в манифеста
```

`release_id` е SHA-256 на точните байтове на `manifest.json`. Манифестът не съдържа собствения си хеш, а никой файл не зависи от `release_id`.
Времето на сглобяване е само в `receipt.json`, затова две сглобявания от един commit и едни входове дават едно и също `release_id`.

## Манифестът

| Блок                                                  | Съдържание                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest_schema`, `data_schema`, `provenance_format` | Версиите на формата на манифеста, на договорите на данните (`execution/2`) и на индекса на произхода.                                                                                                                                                                   |
| `processing`                                          | Точният commit/export, Node runtime, lock/compiler/executor хешовете, датата, регистрите и автентикираният snapshot. Историческите Python манифести запазват собствените Docker/lock метаданни.                                                                         |
| `inputs`                                              | Всеки файл, който сглобяването чете и не е в git: път, източник (`data/sources.yaml`), начин на придобиване, адрес на файла или на страницата, период, кога е получен, MIME, байтове и SHA-256. Междинните файлове казват производителя си и дали той ги възпроизвежда. |
| `outputs`                                             | Всеки файл на изданието: път, набор (`data/datasets.yaml`), MIME, байтове и SHA-256, включително `validation.json`.                                                                                                                                                     |
| `coverage`                                            | Всеки набор със статуса, периода и обхвата си, дали това издание го сглобява наново, ограниченията му, предстоящите набори с причината и входовете, които липсват.                                                                                                      |
| `compatibility`                                       | Кои версии на договора на `execution.json` четат приложението и инструментите.                                                                                                                                                                                          |

## Командите

```bash
./budget build --inputs /path/to/inputs --out /outside/new/candidate --build-date 2026-11-10
./budget build --inputs /path/to/inputs --out /outside/new/site-candidate --build-date 2026-11-10 --site
./budget validate --release /outside/new/candidate --inputs /path/to/inputs # манифестът, байтовете и SHA-256 на всеки файл, проверките на данните
./budget reproduce --manifest /outside/new/candidate/manifest.json --originals /path/to/inputs
./budget reproduce --current https://sigma-budget.midt.bg --originals /път/до/оригиналите
./budget refetch --manifest /outside/new/candidate/manifest.json --out work/refetch
./budget collect --out work/acquisition                # сваля всичко, което регистърът може да свали; snapshot.json ги описва
./budget import-source --source kfp --file ~/Downloads/2026-EU\ funds_1026_BG_WEB.xls --out /outside/new/acquired
```

- **`build`** изнася един commit с `git archive`, без `.git` и без промените, които не са в него. Входовете (`data/originals`,
  `data/cache`, `data/cache/research`) се автентикират и копират само за четене в отделен Node export/scratch. Всеки вход се сверява с пина си
  (`data/originals.sha256` или `sha256` в регистъра); разлика спира сглобяването. Новото сглобяване не изпълнява Python или Docker. Историческият Python replay запазва старата фиксирана среда.
- **`validate`** отказва издание, в което файл липсва, не е в манифеста или има други байтове.
- **`reproduce`** първо проверява, че оригиналите от манифеста са налице и със същия SHA-256. После сглобява commit-а на манифеста и
  сравнява всеки изход. С `--current` разрешава указателя на сайта веднъж и проверява точно това издание. Изтегля и публикуваните файлове
  и ги сравнява с манифеста.
- **`refetch`** сваля оригиналите отново от точните им адреси. Резултатът за всеки е `same`, `changed`, `manual` (ръчно получен файл,
  например отчетите на МФ), `derived` (кеш, който скрипт съкращава от отговора) или `unverified` (недостъпен адрес или отговор, който не е
  очакваният вид файл). Недостъпен източник никога не е „съвпада“.

Кодовете на изход (раздел 8.3): 0 проверено и без разлики, 1 разлики, 2 невалидни данни или употреба, 3 липсващ вход или недостъпен
източник (непроверено). С `--json` всяка команда дава машинен резултат.

## Публикуване

**Обекти (R2).** Качването отива първо в `uploads/<операция>/<sha256>`. Сървърът го прочита обратно и проверява размера и SHA-256. Едва тогава
обектът получава ключа `objects/sha256/<sha256>`; ключът на манифеста е неговият SHA-256, тоест `release_id`. Грешно качване изтрива
временния обект и не заема ключа. Съществуващ обект се преизползва само ако се хешира до ключа си; иначе е инцидент (`incidents` в D1) и не се
публикува. Операторският API не презаписва и не трие публикувани обекти.

**Регистър (D1, `apps/web/migrations/0001_registry.sql`).** `releases` пази запечатаните кандидати, `pointer` е един ред с текущото издание и
ревизия, `journal` пази всяка промяна. Публикуването и връщането са един `UPDATE` на `pointer` с условие за очакваната ревизия и за
неизползван `request_id`. Тригер записва събитието в същата транзакция, а `request_id` в журнала е уникален. Повторена заявка връща първия
резултат без второ събитие. Заявка на стара ревизия получава `409` с текущото издание. Нула променени реда никога не е успех.

**Операторският API** (`apps/web/workers/api/admin.js`) е зад Cloudflare Access, а Worker-ът проверява токена и сам: подпис по ключовете на екипа,
`iss`, `aud`, срок. Членство в акаунта не стига: `OPERATORS` (имейли) и `SERVICE_TOKENS` (Access service tokens за автоматизация) казват
кой може да публикува в средата.

| Маршрут                                     | Какво прави                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /admin/operations`                    | Приема байтовете на манифеста, проверява структурата му и казва кои обекти още трябват. |
| `PUT /admin/operations/:op/objects/:sha256` | Един обект; прочита се обратно и се проверява.                                          |
| `POST /admin/operations/:op/seal`           | Всичко е проверено → кандидатът се записва и операцията се затваря.                     |
| `GET /admin/operations/:op`                 | Състоянието, за да продължи прекъснато качване.                                         |
| `POST /admin/publish`                       | `{release_id, expected_revision, request_id, kind: publish\|rollback}`.                 |
| `GET /admin/requests/:request_id`           | Резултатът на публикуване, чийто отговор се е изгубил.                                  |

**Командите.** Средата винаги се казва изрично; няма такава по подразбиране (`pipeline/environments.json`). Преди промяна командата показва
средата, текущото издание с ревизията и новото издание и пита (`--yes` пропуска въпроса, `--dry-run` не пише нищо).

```bash
./budget status --environment staging
./budget publish --release /outside/new/candidate --originals /path/to/inputs --environment staging --dry-run # преглед на publish плана
./budget upload --release /outside/new/candidate --originals /path/to/inputs --environment staging --dry-run # преглед на upload плана
./budget rollback --release-id <по-ранно издание> --environment staging
```

`publish` запазва `request_id` в `work/receipts/<release_id>.json` преди заявката. Ако отговорът се изгуби, пита `GET /admin/requests/:id`,
а не публикува отново с нов ID. Накрая чете указателя, манифеста и един файл без кеш. Изходи: 4 отказан достъп, 5 конфликт на ревизии
(някой е публикувал пръв), 6 непотвърдено публикуване. Достъпът: `cloudflared access login <адрес>/admin/operations`, или `BUDGET_ACCESS_TOKEN`, или service
token в `CF_ACCESS_CLIENT_ID` и `CF_ACCESS_CLIENT_SECRET`. Токените не се печатат и не влизат в манифеста или в разписките.

**Публичният API** (`apps/web/workers/api/api.js`, раздел 9.2) е само за четене:

| Маршрут                                    | Съдържание                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/releases/current`                | `release_id`, ревизия, адресът на манифеста; `no-store`. Без издание: `404` „няма публикувано издание“.                                                                                                       |
| `GET /api/releases`                        | Журналът по страници; операторът е роля и псевдоним.                                                                                                                                                          |
| `GET /data/releases/:id/manifest.json`     | Точните байтове на манифеста.                                                                                                                                                                                 |
| `GET /data/releases/:id/:path`             | Файл от манифеста, изход или оригинал; ETag, `immutable` и `no-transform` (никоя настройка на зоната, например бийконът на Web Analytics, не променя байтовете), Range. HTML и XML оригиналите са за сваляне. |
| `GET /api/releases/:id/datasets/:dataset`  | Файловете на един набор с `release_id` и схемата.                                                                                                                                                             |
| `GET /api/releases/:id/provenance/<запис>` | Откъде е едно число: `data/2026-09/kfp/rev` → отчетът, листът, клетката и оригиналът за сваляне.                                                                                                              |

Издание, което никога не е било текущо, не е публично. Публичните маршрути отговарят `405` на всичко освен GET и HEAD.

**Проверката** `python -m tests.release.release_check` пуска Worker-а с локални D1 и R2 и минава сценариите от раздел 11 със синтетични
издания: 9 (достъп), 3 (повредено качване), 4 (прекъсване), 5 (двама оператори), връщане и публичния API. CI я пуска при всеки PR.
С `--real /outside/new/candidate` публикува и истинското издание и го пресъздава с `budget reproduce --current` от оригиналите, които сваля от
самото издание.

**Среди.** Създаването на среда е отделно от deploy-а на кода и иска Cloudflare акаунта (раздел 12):

```bash
pnpm exec wrangler d1 create sigma-budget-staging-registry -c apps/web/wrangler.jsonc          # id-то влиза в env.staging
pnpm exec wrangler r2 bucket create sigma-budget-staging-objects -c apps/web/wrangler.jsonc
pnpm exec wrangler d1 migrations apply DB --env staging --remote -c apps/web/wrangler.jsonc
```

После: Access приложение за `/admin/*` с allow политика за операторите; `ACCESS_ISSUER` и `ACCESS_AUD` в `env.staging.vars`;
`OPERATORS` като таен ключ на Worker-а (`pnpm exec wrangler secret put OPERATORS --env staging -c apps/web/wrangler.jsonc`), за да не са имейлите в публичното
хранилище; адресът на staging в `pipeline/environments.json`. Production следва същите стъпки по-късно, ръчно (етап E).

Zero Trust организацията има нужда от метод за вход (**Integrations → Identity providers**: One-time PIN или Cloudflare); без него
страницата на Access казва, че няма методи за вход. `OPERATORS` съдържа имейла, който Access записва в токена: при вход с Cloudflare
това е имейлът на Cloudflare акаунта, не непременно служебният. Пропуснат ли е, Access пуска заявката, а Worker-ът отговаря `403`
„not an operator of this environment“.

**Своя среда.** Средата на организацията е в `apps/web/wrangler.jsonc` и `pipeline/environments.json`. Среда в собствен акаунт (например за проба)
не влиза в git: `apps/web/wrangler.local.jsonc` е копие на `apps/web/wrangler.jsonc` с id-тата и адреса на акаунта, а `pipeline/environments.local.json`
добавя или заменя среди за `budget`. Двата файла са в `.gitignore`. Сглобяването го чете от `WRANGLER_CONFIG`, а командите на
wrangler получават `-c apps/web/wrangler.local.jsonc`:

```bash
pnpm exec wrangler d1 migrations apply DB --env staging --remote -c apps/web/wrangler.local.jsonc
CLOUDFLARE_ENV=staging WRANGLER_CONFIG=apps/web/wrangler.local.jsonc pnpm build:release    # build/: Worker-ът на staging от собствения акаунт
pnpm exec wrangler deploy -c apps/web/build/server/wrangler.json
pnpm exec wrangler secret put OPERATORS --env staging -c apps/web/wrangler.local.jsonc
```

Таен ключ не може да носи името на обикновена променлива на качената версия (код 10053), затова `secret put` идва след deploy-а.
Access приложението покрива само `/admin/*`: сайтът и публичният API остават отворени.

## Изданието в сайта

**Сървърът.** Всеки екран се изобразява в Worker-а от текущото издание на регистъра ([ADR 0002](adr/0002-react-router-ssr.md)): указателят
в D1 назовава изданието, файловете му са в R2 по SHA-256. Ново издание се вижда при следващата заявка (до 10 секунди), без ново
сглобяване на сайта. Документът назовава изданието си (`<meta name="release-id">`) и откъде са файловете му (`<meta name="data-base">`:
`/data/releases/<release_id>/data/`): всеки файл, който браузърът дозарежда, CSV и произходът са от същото издание до края на
посещението, дори да е публикувано по-ново (раздел 7.3, сценарий 6). Постоянните адреси `/data/<файл>` дават файла на текущото издание.
Без регистър (локално, в CI) данните са тези на `data/release`, сглобени от git.

**„Данни и проверка“** (`/proverka`, раздел 9.1 на спецификацията) показва изданието на страницата и дали има по-ново, периода и
обхвата на всеки набор с ограниченията му, всеки оригинал и всеки файл с формат, размер, SHA-256 и сваляне, commit-а, образа и
регистрите на обработката, проверките от `validation.json`, командата за пресъздаване и журнала на публикуванията и връщанията.

**Със сайта.** `build --site` слага данните в `data/release`, манифеста и `validation.json` в `data/release/releases/<release_id>/`, а указателя в
`data/release/releases/current.json`. Екранът „Месечни отчети“ (S15) показва в „Откъде са числата“ изданието, отчетите, техните SHA-256 и
клетките, от които идват числата. Указателят се сервира с `Cache-Control: no-store`. Манифестите не са в каталога: каталогът е един от
изходите, а манифестът съдържа неговия SHA-256.

## Какво още не е направено

- **Средите на организацията не са създадени.** Staging на midt-bg и production чакат Cloudflare акаунта (раздел 12). Целият поток е
  проверен на staging в собствен акаунт (5–6 ноември 2026 г.): публикуване през Access, четене през публичния API, екраните от
  изданието в R2 и `budget reproduce --current` байт по байт от оригиналите, свалени от самото издание.
- **Сървърният HTML е екранът преди браузъра.** Графиките (ECharts), картата на общините с избраната община и бутоните за PNG се
  добавят в браузъра. Текстът, таблиците, връзките на екрана и връзките към речника (`apps/web/client/glossary-scan.js`, същите правила като в
  браузъра) са в HTML-а от сървъра; `apps/web/scripts/ssr_parity.py` сравнява двата.
- **Не всичко се сглобява от оригиналите.** `coverage` и `python -m budget_pipeline.validate.registry check` казват кои набори се пренасят от git, без
  да се сглобяват (речникът, пътеводителят, примерните набори, `gva-sectors`, `dbp2027`), и кои междинни файлове нямат работещ производител.
- **`refetch` на страниците на Държавен вестник дава `changed`**, защото балансьорът на натоварването вгражда в страницата нов
  токен при всяко сваляне. Текстът на законите е същият. Разликата се отчита, не се крие.

Всички команди тук се изпълняват от корена на хранилището. Конфигурацията за собствен акаунт е `apps/web/wrangler.local.jsonc`, до `apps/web/wrangler.jsonc`, така че относителните `main` и `migrations_dir` запазват значението си. За нея се използва `-c apps/web/wrangler.local.jsonc`, а при сглобяване - `WRANGLER_CONFIG=apps/web/wrangler.local.jsonc`. Vite разрешава тази променлива спрямо корена на хранилището. Deploy на сглобен сайт използва `-c apps/web/build/server/wrangler.json`.

## Политика за публичното четене

`/api/releases`, неговите подмаршрути и `/data/*` са публични за GET и HEAD.
Всички отговори, включително грешките и статичните резервни файлове, изпращат
`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, HEAD` и
`Cross-Origin-Resource-Policy: cross-origin`, без разрешение за credentials.
Браузърните клиенти използват `credentials: 'omit'`. ETag, X-Release-Id и
Retry-After са достъпни за JavaScript. Други методи получават 405; не се поддържа
preflight за удостоверени или нестандартни заявки. `/admin/*` остава same-origin.
Общият слой добавя security headers и noindex извън production; само `/embed/*`
разрешава `frame-ancestors *`. Sandbox политиката на активните оригинали се запазва.

Публичните release API/object заявки и четенето на текущи registry файлове се
ограничават чрез Workers binding `RELEASE_RATE_LIMITER`: 120 заявки за 60 секунди
на CF-Connecting-IP, общ брояч за маршрутите, с `unknown-client` при липса на IP.
Ключът е само IP адресът, без version/hostname префикс. Една среда запазва
общия бюджет през rolling/gradual deployments и през hostname aliases.
Средите са изолирани чрез три стабилни namespaces: `2001` за production,
`2002` за staging и `2003` за операторския dev deployment config (`sigma-budget-dev`).
Top-level конфигурацията остава production; dev се публикува със собствен
операторски config с `ENVIRONMENT: "dev"`, собствен `SITE_ORIGIN` и `NOINDEX: "1"`.
Статичните bundled файлове, включително `/data/releases/<id>/*`, се разпознават
преди limiter-а и не четат R2. Candidate builds също не използват registry лимита.
429 връща `Retry-After: 60` и `Cache-Control: no-store`. При липсващ binding или
грешка от него registry четенето получава 503 само ако `ENVIRONMENT` е точно
`"production"`. При всяка друга стойност, включително `"dev"` и `"staging"`,
limiter-ът предупреждава и допуска заявката (fail open). Работещ binding се
прилага във всички среди и връща 429 при изчерпана квота.
Ограничението е приблизително и се прилага отделно във всяка Cloudflare локация:
https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

При следващо разрешено публикуване операторът трябва да провери, че и трите
namespace IDs (`2001`, `2002`, `2003`) са неизползвани в акаунта. При конфликт
трябва да се изберат три други отделни свободни положителни числови IDs и да се
пренесат в custom/local конфигурациите. Top-level production носи binding с
`2001`, а staging носи binding с `2002`. Отделният операторски dev config трябва
да включва собствен binding:

```jsonc
"ratelimits": [{ "name": "RELEASE_RATE_LIMITER", "namespace_id": "2003", "simple": { "limit": 120, "period": 60 } }]
```

Не се използва version metadata binding. Production deploy процедурата и
нейният избор на top-level конфигурацията са запазени.
Не са необходими remote команди за тази промяна.

CI блокира при всички advisory нива (`pnpm audit --audit-level=low`), при gitleaks
находки и при Semgrep находки. Няма advisory изключения. Евентуално изключение
изисква отделен преглед с advisory ID, основание, собственик, дата на преглед и
срок; грешка на скенера също блокира проверката. Gitleaks проверява checkout-а
преди инсталирането на зависимости и редактира намерените стойности в лога.
Semgrep използва digest-pinned образ като СИГМА и преглеждани локални правила
в `.semgrep/security.yml` за динамично изпълнение, shell команди, SQL интерполация,
изключена JWT проверка и опасна десериализация в JavaScript/TypeScript/Python.
Пробното изпълнение на широките audit packs даде 20 сигнала за доверени CLI URL-и,
локални XML файлове и константни SVG икони; те не са потвърдени уязвимости в одита.
Този фокусиран gate не заменя прегледа на тези контексти. Gitleaks запазва всички
стандартни правила; точните публични стойности `2028.forecast` и `2029.forecast`
са документирани false positives в `.gitleaks.toml`, без изключване на файлове. Допълнителните изключения обхващат само 11 точни, прегледани SHA-256
стойности в пет конкретни frozen provenance/capture файла и точните имена на две
липсващи полета от KeyError в един validation oracle. Dependabot предлага обновявания на SHA pins
за GitHub Actions за преглед. За merge protection трябва да са required двата
security job-а; staging deploy зависи от security workflow-а.

Release acceptance helper-ът пази HTTP headers с case-insensitive lookup.
Sandbox проверката изисква точно една самостоятелна `sandbox` директива без
`allow-*` изключения във всяка policy. Дублирани sandbox директиви се отхвърлят,
включително permissive-first комбинации; следваща директива не поправя първата. Проверяват се и
attachment, no-transform и пълната CSP на SSR документа.
