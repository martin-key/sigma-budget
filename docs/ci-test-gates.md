# CI проверки и покритие

`build` проверява регистрите с `node packages/ingest/dist/validate/cli.js --live --only REGISTRY` и изпълнява `node tests/release/budget_provenance_check.mjs` директно върху записаното издание. `node-import` проверява регистрите с пълната Git история и след удостоверяване на входния архив изпълнява `./budget check-site --inputs "$RUNNER_TEMP/registered-node-inputs"`: manifest, указател, файлов инвентар, размери, SHA-256, receipt и пълните текущи TypeScript правила върху записаните данни. Годишните извлечения се сверяват чрез `production/loader.ts` и `readers/annual/annual.test.ts`. Само `node-import` не инсталира и не изпълнява Python. `build` запазва `python -m unittest discover -s tests/pipeline -t .` и Python setup, защото suite-ът проверява действащо съдържание и регенерира независимите PDFMiner референции от оригиналите; четирите програмни PDF-а се възстановяват преди него. `check` запазва останалите Python e2e, а `data-image` остава до P7. Запазените Python файлове не се изтриват в тази стъпка.

`site.yml` изпълнява всички Node suites веднъж в job `coverage`, с V8 coverage от Vitest 4.1.12. Самостоятелните parity и validation jobs (`common-parity`, `aggregation-parity`, `catalog-parity`, `wave13a-parity`, `wave13b-parity`, `validation-wave17b`, `validation-wave17c`, `validation-wave18`) изпълняват TypeScript CLI candidate проверки (`budget-ts build` и, където има, `budget-ts parity`; `kfp-cli.js`, `feed-cli.js`, `search-cli.js`, `catalog-metadata.js`) срещу замразените oracle данни. Самостоятелните Python стъпки, които генерираха отново тези oracles, вече не се изпълняват в тези jobs: замразените очаквани JSON файлове остават като тестови данни, а TypeScript тестовете продължават да сравняват с тях. Четирите диференциални Vitest suites сравняват със замразени Python резултати в `packages/ingest/test/expected/`; `coverage` не инсталира и не стартира Python, а `scripts/ci-gates.test.mjs` пази това. Хешът на генерираната таблица `search-unicode-data.ts` се пази от `search-unicode-data.test.ts`. Тестовите parity отчети се качват от `coverage`. Сглобеният web артефакт се използва повторно от browser проверките и staging deploy.

`required-validation` зависи от всички останали проверки, включително parity и validation jobs, data-image, node-import и reusable security workflow (semgrep и dependencies-and-secrets). Изпълнява се с `always()` и приема само `success` за всяка зависимост; failure, cancellation и skipped блокират deploy. Staging deploy зависи само от тази бариера. Security се извиква от site workflow за PR към main; има и ръчно стартиране. Security има отделен `pull_request` trigger с `branches-ignore: [main]` за PR към release/integration и други клони. Така всички PR targets получават Semgrep, gitleaks и dependency audit, без дублиране за main.

Операторска стъпка: branch protection трябва да изисква `required-validation` и `coverage`. Тази промяна не настройва GitHub branch protection и не разрешава production deploy.

## Coverage baseline

`coverage-baseline.json` съдържа измерените начални lines/branches проценти за всеки workspace с тестова команда. `pnpm check:coverage` записва в корена файла `coverage-summary.md`, който показва също functions/statements. Той е генериран изход: не се следи в Git (`.gitignore`), а CI го качва като artifact `coverage` заедно с `coverage-summary.json` отчетите на workspace-ите. Ниското покритие се отчита честно; базата не е твърдение за достатъчност на тестовете.

Включени са всички производствени TS/JS файлове в `src` и CLI launcher-ите в `bin`, както и изрично `apps/etl/publication-documents/prepare.mjs`, а за web - `app`, `client`, `workers`, service worker и candidate-data adapter, дори когато никой тест не ги импортира. Изключени са само тестове, декларации и fixture директории. CLI subprocess изпълненията проверяват реалната компилирана граница, но V8 отчетът на родителския Vitest процес не приписва тяхното покритие на изходния TypeScript.

Локално: `pnpm test -- --coverage`, после `pnpm check:coverage`. Липсващ workspace/отчет или невалидни метрики провалят gate. Допустимият шум е 0.5 процентни пункта за lines/branches по workspace, както в СИГМА. `node scripts/check-coverage.mjs --update` първо проверява всички отчети и четирите метрики и може само да повишава lines/branches базата. Намаление се отхвърля с non-zero status и без запис, включително в рамките на толеранса или при изключение. Базата не се обновява автоматично в CI.

CI изпълнява `node scripts/check-coverage.mjs --check-base` преди тестовете. Checkout включва историята; PR се сравнява с `origin/<base_ref>`, push - с merge-base на HEAD и предходния push SHA, ръчно стартиране - с предишната ревизия. Ref/SHA идват през env и се подават като отделни git argv стойности, без shell интерполация. Само липсващ `coverage-baseline.json` в съществуващата base ревизия пропуска сравнението с изрично SKIP съобщение, както при първоначалното въвеждане на базата. Липсващ ref или повреден JSON е отказ. Нов workspace без base стойност е допустим; премахване на съществуваща база е отказ. Всяко намаление на съществуваща метрика изисква валидно изключение за същия workspace/metric, чийто `minimum` покрива новата стойност. Толерансът от 0.5 пункта не допуска намаляване на самата база.

Умишлена временна регресия се описва в `coverage-exceptions.json`: `workspace`, `metric` (`lines`/`branches`), `minimum`, конкретно `reason`, `review` (URL към PR в това хранилище) и `expires` (UTC YYYY-MM-DD). Записът подлежи на преглед като код; празни причини, дублирани/неизвестни обхвати и изтекли изключения провалят проверката. Първоначално няма изключения. Не се добавят изключения за неуспешни тестове.

## Формат

`pnpm format:check` проверява целия поддържан от Prettier набор с `--ignore-unknown`; `pnpm format` го форматира. Това е format gate, не semantic lint. Python, shell и другите неподдържани езици се проверяват чрез съответните тестове, а не се представят като форматирани от Prettier.

Прегледаните изключения в `.prettierignore` пазят `data/`, `reference/`, историческия `pipeline/`, frozen fixtures/oracles, vendored и генерирани файлове. Масовото форматиране е отделен commit върху main след сливането на PR #57 (тема), #58 (име), #59 (формулировки и източници) и #64 (boot/release build). При следващи паралелни client JS промени format pass се изпълнява отново. Замразените bytes не се форматират.

## Изходно CI време

Измерено чрез `gh run list` и `gh run view` за успешния site run `42945661686` от 2026-11-11: build 1036 s, от които Node tests 696 s; зависимият browser check 1095 s. Последователният път е 2131 s (35 min 31 s), без опашката за runner. Самостоятелният повторен wave17a suite е 723 s. По-новият неуспешен run `43014760197` има build 928 s и wave17a 659 s.

При същите останали времена изваждането на Node tests от build дава приблизително 1435 s (23 min 55 s) за build + browser check, около 33% по-кратък път. Отделният coverage job също трябва да завърши преди общата бариера. Това е оценка от исторически стъпки, не обещание за runner време; опашката, натоварването и V8 overhead се отчитат отделно при сравнение с PR run.

Literal HTML/CSS и кодовите примери в низове не се преформатират (`embeddedLanguageFormatting: off`): те участват в byte-level oracle договори. JSONC се форматира без trailing commas за съвместимост с текущите проверяващи parsers. Това запазва съдържанието на договорите, без да изключва поддържаните JS/TS/JSONC файлове от format gate.

Browser bootstrap не променя apt sources. Chromium идва от закрепения `@playwright/test` чрез `scripts/ci-install-browser.sh`. След потвърдени DNS откази към Azure и official archive се повтаря само `pnpm exec playwright install --with-deps chromium`: до 3 опита, по максимум 300 s, с паузи 15/30 s. След последния опит non-zero status се връща като отказ. Python проверките в `tests/e2e/` ползват същия Chromium, защото версията на Playwright в `tests/requirements-dev.lock` е същата (`scripts/ci-gates.test.mjs` го проверява). Запазени са apt signature verification и всички Playwright зависимости и проверки; няма `continue-on-error` или `--allow-unauthenticated`. DNS-only отказите са инфраструктурни, а не основание за допълнителни mirror/workaround промени.

Провереният Node inventory извън `src`/`bin` включва standalone publication-documents entry point, web service worker и candidate-data adapter. Последните два вече са в web coverage. Сглобяването за публикуване `apps/web/scripts/build-release.ts` се проверява от край до край в job `build`, а частта му без браузър (`release-artifact.ts`) е във V8 обхвата. Останалите Node файлове извън тези source директории са Vitest/Vite/React Router конфигурации и vendored код; не са production runtime entry points.

## Обхват след #64

`client/chrome-boot.js` се включва чрез `client/**/*.js`, а новите screen модули и `migration/screens.ts` - чрез `app/**/*.{ts,tsx}`. Всички те участват и във format gate. Manifest файловете с `build:release` също се форматират. `tests/e2e/worker/boot.spec.ts` и останалите Playwright Test файлове са във format gate и в `tsc -p tests/e2e/tsconfig.json`, включен в `pnpm typecheck`. Изпълняват се в отделния browser gate, извън production V8 thresholds. Guard-ът в `scripts/ci-gates.test.mjs` проверява това за boot спецификацията. Сглобяването за deploy (`apps/web/scripts/build-release.ts`) и неговите файлове (`release-artifact.ts`, в V8 обхвата) са TypeScript. След rebase форматът се регенерира чрез Prettier в отделен format-only commit; последващите CI поправки са самостоятелни commits. Format конфликти не се разрешават на ръка.

Parity report пътищата се дефинират само в `coverage.env` на site workflow. Turbo strict mode ги пропуска изрично през `globalPassThroughEnv`, а upload стъпките ползват `${{ env.<REPORT> }}`. Всички 12 отчета се генерират и при успешни тестове: преди run се изчистват стари файлове, след run се проверява всеки JSON поотделно, включително четирите Wave15 отчета. Задължителните uploads остават с `if-no-files-found: error`; липсващ отчет не се игнорира.

Проверките на допълнението към P03 използват оригиналните програмни PDF-и,
които са пинирани и се намират в одобрения CI входен архив. Jobs `coverage` и
`build` изчакват `node-inputs`; `restore-programme-test-inputs.mjs` удостоверява
архива и възстановява само четирите необходими документа. Вече наличен оригинал
се проверява, без да се презаписва. Независимият PDFMiner прочит и отрицателните
тестове са задължителни; липсващ или променен документ проваля проверката.
Съществуващите архивни ID, размер, SHA-256 и входен snapshot остават същите,
защото оригиналите вече са включени в архива.

Playwright Test конфигурацията е в `tests/e2e/`, с проекти `worker` и `static`. Статичният gate изпълнява redirects, calculator, sharing, acceptance, overlap и motion. Приемните проверки включват 54 числови комбинации и layout/keyboard матрици; overlap обхожда всички маршрути и допълнителни адреси. Fixtures управляват статичния сървър и loopback Worker; очакванията се четат независимо от release JSON. Guard-овете предотвратяват пропускане или селективно изпълнение на браузърните тестове.

Проверките на екраните се изпълняват в задължителна стъпка след оставащия Python screens run:

```bash
E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker screens-base.spec.ts screens-demo.spec.ts screens-variants.spec.ts screens-selftest.spec.ts
```

Всеки пример и ширина, demo състояние и период е отделен тест. Типизирани browser функции изчакват реалната готовност и проверяват видимото съдържание, достъпността, навигационните връзки и преливането. Автоматичен fixture проваля теста при browser errors или бисквитки. Състоянията и числата от изданието имат отделни assertions. Потребителските типове и премахнатите настройки не се проверяват. Python запазва chrome/embed/gloss/png/share/tabs/to/tour/views. S21 има изрично временно изключение само за липсваща таблица към графиката; контрастът има отделна проверка.

Проверките на екраните се изпълняват в задължителна стъпка след оставащия Python screens run:

```bash
E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker screens-base.spec.ts screens-demo.spec.ts screens-variants.spec.ts screens-selftest.spec.ts
```

Всеки пример и ширина, demo състояние и период е отделен тест. Типизирани browser функции изчакват реалната готовност и проверяват видимото съдържание, достъпността, навигационните връзки и преливането. Автоматичен fixture проваля теста при browser errors или бисквитки. Състоянията и числата от изданието имат отделни assertions. Потребителските типове и премахнатите настройки не се проверяват. Python запазва chrome/embed/gloss/png/share/tabs/to/tour/views. S21 има изрично временно изключение само за липсваща таблица към графиката; контрастът има отделна проверка.

Проверките на списъците, CSV, споделените мерни единици и навигацията са в `tests/e2e/worker/public-bill-lists.spec.ts`, `share-units.spec.ts` и `react-bridge.spec.ts`. Job `check` ги изпълнява с `E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker public-bill-lists.spec.ts share-units.spec.ts react-bridge.spec.ts`. `apps/web/scripts/hrefs.test.ts` проверява адресите в хранилището чрез web Vitest suite. `node apps/web/scripts/make-images.ts` генерира social card и app icons; байтовете зависят от Chromium и шрифтовете.
