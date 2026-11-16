# CI проверки и покритие

`build` проверява регистрите с `node packages/ingest/dist/validate/cli.js --live --only REGISTRY` и изпълнява `node tests/release/budget_provenance_check.mjs` директно върху записаното издание. `node-import` проверява регистрите с пълната Git история и след удостоверяване на входния архив изпълнява `./budget check-site --inputs "$RUNNER_TEMP/registered-node-inputs"`: manifest, указател, файлов инвентар, размери, SHA-256, receipt и пълните текущи TypeScript правила върху записаните данни. Годишните извлечения се сверяват чрез `production/loader.ts` и `readers/annual/annual.test.ts`. `check` изпълнява браузърните проверки с Playwright Test.

`site.yml` изпълнява всички Node suites веднъж в job `coverage`, с V8 coverage от Vitest 4.1.12. Четирите диференциални Vitest suites сравняват със замразени резултати в `packages/ingest/test/expected/`. Хешът на генерираната таблица `search-unicode-data.ts` се пази от `search-unicode-data.test.ts`. Сглобеният web артефакт се използва повторно от browser проверките и staging deploy.

`required-validation` зависи от всички останали проверки, включително node-import и reusable security workflow (semgrep и dependencies-and-secrets). Изпълнява се с `always()` и приема само `success` за всяка зависимост; failure, cancellation и skipped блокират deploy. Staging deploy зависи само от тази бариера. Security се извиква от site workflow за PR към main; има и ръчно стартиране. Security има отделен `pull_request` trigger с `branches-ignore: [main]` за PR към release/integration и други клони. Така всички PR targets получават Semgrep, gitleaks и dependency audit, без дублиране за main.

Операторска стъпка: branch protection трябва да изисква `required-validation` и `coverage`. Тази промяна не настройва GitHub branch protection и не разрешава production deploy.

## Coverage baseline

`coverage-baseline.json` съдържа измерените начални lines/branches проценти за всеки workspace с тестова команда. `pnpm check:coverage` записва в корена файла `coverage-summary.md`, който показва също functions/statements. Той е генериран изход: не се следи в Git (`.gitignore`), а CI го качва като artifact `coverage` заедно с `coverage-summary.json` отчетите на workspace-ите. Ниското покритие се отчита честно; базата не е твърдение за достатъчност на тестовете.

Включени са всички производствени TS/JS файлове в `src` и CLI launcher-ите в `bin`, както и изрично `apps/etl/publication-documents/prepare.mjs`, а за web - `app`, `client`, `workers`, service worker и candidate-data adapter, дори когато никой тест не ги импортира. Изключени са само тестове, декларации и fixture директории. CLI subprocess изпълненията проверяват реалната компилирана граница, но V8 отчетът на родителския Vitest процес не приписва тяхното покритие на изходния TypeScript.

Локално: `pnpm test -- --coverage`, после `pnpm check:coverage`. Липсващ workspace/отчет или невалидни метрики провалят gate. Допустимият шум е 0.5 процентни пункта за lines/branches по workspace, както в СИГМА. `node scripts/check-coverage.mjs --update` първо проверява всички отчети и четирите метрики и може само да повишава lines/branches базата. Намаление се отхвърля с non-zero status и без запис, включително в рамките на толеранса или при изключение. Базата не се обновява автоматично в CI.

CI изпълнява `node scripts/check-coverage.mjs --check-base` преди тестовете. Checkout включва историята; PR се сравнява с `origin/<base_ref>`, push - с merge-base на HEAD и предходния push SHA, ръчно стартиране - с предишната ревизия. Ref/SHA идват през env и се подават като отделни git argv стойности, без shell интерполация. Само липсващ `coverage-baseline.json` в съществуващата base ревизия пропуска сравнението с изрично SKIP съобщение, както при първоначалното въвеждане на базата. Липсващ ref или повреден JSON е отказ. Нов workspace без base стойност е допустим; премахване на съществуваща база е отказ. Всяко намаление на съществуваща метрика изисква валидно изключение за същия workspace/metric, чийто `minimum` покрива новата стойност. Толерансът от 0.5 пункта не допуска намаляване на самата база.

Умишлена временна регресия се описва в `coverage-exceptions.json`: `workspace`, `metric` (`lines`/`branches`), `minimum`, конкретно `reason`, `review` (URL към PR в това хранилище) и `expires` (UTC YYYY-MM-DD). Записът подлежи на преглед като код; празни причини, дублирани/неизвестни обхвати и изтекли изключения провалят проверката. Първоначално няма изключения. Не се добавят изключения за неуспешни тестове.

## Формат

`pnpm format:check` проверява целия поддържан от Prettier набор с `--ignore-unknown`; `pnpm format` го форматира. Това е format gate, не semantic lint. Shell и другите неподдържани езици се проверяват чрез съответните тестове, а не се представят като форматирани от Prettier.

Прегледаните изключения в `.prettierignore` пазят `data/`, frozen fixtures/oracles, vendored и генерирани файлове. Масовото форматиране е отделен commit върху main след сливането на PR #57 (тема), #58 (име), #59 (формулировки и източници) и #64 (boot/release build). При следващи паралелни client JS промени format pass се изпълнява отново. Замразените bytes не се форматират.

## Изходно CI време

Измерено чрез `gh run list` и `gh run view` за успешния site run `42945661686` от 2026-11-11: build 1036 s, от които Node tests 696 s; зависимият browser check 1095 s. Последователният път е 2131 s (35 min 31 s), без опашката за runner. Самостоятелният повторен wave17a suite е 723 s. По-новият неуспешен run `43014760197` има build 928 s и wave17a 659 s.

При същите останали времена изваждането на Node tests от build дава приблизително 1435 s (23 min 55 s) за build + browser check, около 33% по-кратък път. Отделният coverage job също трябва да завърши преди общата бариера. Това е оценка от исторически стъпки, не обещание за runner време; опашката, натоварването и V8 overhead се отчитат отделно при сравнение с PR run.

Literal HTML/CSS и кодовите примери в низове не се преформатират (`embeddedLanguageFormatting: off`): те участват в byte-level oracle договори. JSONC се форматира без trailing commas за съвместимост с текущите проверяващи parsers. Това запазва съдържанието на договорите, без да изключва поддържаните JS/TS/JSONC файлове от format gate.

Browser bootstrap не променя apt sources. Chromium идва от закрепения `@playwright/test` чрез `scripts/ci-install-browser.sh`. След потвърдени DNS откази към Azure и official archive се повтаря само `pnpm exec playwright install --with-deps chromium`: до 3 опита, по максимум 300 s, с паузи 15/30 s. След последния опит non-zero status се връща като отказ. Запазени са apt signature verification и всички Playwright зависимости и проверки; няма `continue-on-error` или `--allow-unauthenticated`. DNS-only отказите са инфраструктурни, а не основание за допълнителни mirror/workaround промени.

Провереният Node inventory извън `src`/`bin` включва standalone publication-documents entry point, web service worker и candidate-data adapter. Последните два вече са в web coverage. Сглобяването за публикуване `apps/web/scripts/build-release.ts` се проверява от край до край в job `build`, а частта му без браузър (`release-artifact.ts`) е във V8 обхвата. Останалите Node файлове извън тези source директории са Vitest/Vite/React Router конфигурации и vendored код; не са production runtime entry points.

## Обхват след #64

`client/chrome-boot.js` се включва чрез `client/**/*.js`, а новите screen модули и `migration/screens.ts` - чрез `app/**/*.{ts,tsx}`. Всички те участват и във format gate. Manifest файловете с `build:release` също се форматират. `tests/e2e/worker/boot.spec.ts` и останалите Playwright Test файлове са във format gate и в `tsc -p tests/e2e/tsconfig.json`, включен в `pnpm typecheck`. Изпълняват се в отделния browser gate, извън production V8 thresholds. Guard-ът в `scripts/ci-gates.test.mjs` проверява това за boot спецификацията. Сглобяването за deploy (`apps/web/scripts/build-release.ts`) и неговите файлове (`release-artifact.ts`, в V8 обхвата) са TypeScript. След rebase форматът се регенерира чрез Prettier в отделен format-only commit; последващите CI поправки са самостоятелни commits. Format конфликти не се разрешават на ръка.

Проверките на допълнението към P03 използват оригиналните програмни PDF-и,
които са пинирани и се намират в одобрения CI входен архив. Job `coverage` изчаква `node-inputs`; `restore-programme-test-inputs.mjs` удостоверява
архива и възстановява само четирите необходими документа. Вече наличен оригинал
се проверява, без да се презаписва. Липсващ или променен документ проваля проверката.

Playwright Test конфигурацията е в `tests/e2e/`, с проекти `worker` и `static`. Статичният gate изпълнява redirects, calculator, sharing, acceptance, overlap и motion. Приемните проверки включват 54 числови комбинации и layout/keyboard матрици; overlap обхожда всички маршрути и допълнителни адреси. Fixtures управляват статичния сървър и loopback Worker; очакванията се четат независимо от release JSON. Guard-овете предотвратяват пропускане или селективно изпълнение на браузърните тестове.

Проверките на екраните се изпълняват изцяло с Playwright Test в job `check`. `screens-base`, `screens-demo`, `screens-variants` и `screens-selftest` запазват общите проверки; `screens-tour`, `screens-sharing`, `screens-shell`, `screens-glossary`, `screens-tabs` и `screens-views` покриват действията на посетителя. Общият fixture събира грешките от браузъра и изчаква точния маршрут. CSV и речникът имат отделни Vitest проверки. Вътрешни атрибути, тема, mock маркери, embed и предупреждения от стария инструмент не се пренасят. `check` използва Chromium на Node Playwright. Командите се пазят в `scripts/ci-provenance-commands.json`.

Проверките на списъците, CSV, споделените мерни единици и навигацията са в `tests/e2e/worker/public-bill-lists.spec.ts`, `share-units.spec.ts` и `react-bridge.spec.ts`. Job `check` ги изпълнява с `E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker public-bill-lists.spec.ts share-units.spec.ts react-bridge.spec.ts`. `apps/web/scripts/hrefs.test.ts` проверява адресите в хранилището чрез web Vitest suite. `node apps/web/scripts/make-images.ts` генерира social card и app icons; байтовете зависят от Chromium и шрифтовете.

В job `check` визуалният одит и контрастната проверка се изпълняват с две последователни команди `E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker visual-audit.spec.ts` и `E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker light-contrast.spec.ts`. И двете вече са били CI проверки. Запазени са 11 визуални теста за видимото съдържание, навигацията, CSV и печата и 52 контрастни случая от общия каталог на маршрутите. Контрастните прагове са 4.5:1 за малки labels и placeholders и 3:1 за големи labels и полета; неактивни табове не се посещават, а маршрут без измерени елементи е отказ; контрастните доказателства се прилагат като JSON attachments към отделните Playwright tests.
