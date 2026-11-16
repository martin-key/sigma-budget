# СИГМА Бюджет

Сайтът представя държавния бюджет на България на разбираем език и по официални данни. До числата стоят източникът, обхватът, статусът и датата. Примерните данни са означени като такива; неизвлечените данни се показват като „предстои“.

## Структура

```text
apps/web/               React Router SSR, Worker, клиент и публични ресурси
apps/etl/               Node CLI за обработка на данните
packages/ingest/        придобиване, сглобяване и проверки на данни
packages/dataset-schema/ схеми на наборите
packages/test-support/  помощни средства за тестове
data/                   входове и публикувано издание
tests/                  браузърни и release проверки
docs/                   спецификации и архитектурни решения
```

Workspace-ът обхваща `apps/*` и `packages/*` и използва общия коренов `pnpm-lock.yaml`. `./budget` стартира Node CLI от `@sigma-budget/etl`, който използва `@sigma-budget/ingest`. Новият код е TypeScript. Насоките за маршрути и поддръжка на старите екрани са в [ръководството](docs/dev-guide.md), а общите правила за принос - в [AGENTS.md](AGENTS.md). [ADR 0003](docs/adr/0003-repository-layout.md) е историческо решение с отменени части.

## Локално стартиране

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm dev -- --port 8814
# http://127.0.0.1:8814/

# Браузърната част без SSR; временната директория съчетава public/, client/ и data/release/
node apps/web/scripts/serve.ts
```

Зависимостите на Node се инсталират в корена с един `pnpm-lock.yaml` (pnpm workspace). `pnpm build` е build за локална разработка, без SEO обхода. Единственият вход за deploy артефакт е `pnpm build:release` (`apps/web/scripts/build-release.ts`, Node 24 и Chromium на закрепения в `package.json` Playwright от следващия раздел). Той проверява екраните, генерира sitemap/llms/robots и кеш заглавките и маркира service worker за всяко сглобяване. За staging използвай `--env staging --noindex`; за production - `--origin https://<адрес>`.

Сглобеният сайт е в `apps/web/build/`. Клиентът се публикува под `/js/`, а данните от `data/release/` под `/data/`; публичните адреси са запазени. SSR чете текущото издание от D1/R2; без регистър използва включеното в сглобяването издание.

Нужни са Node 24 и pnpm 10.33.0. `pnpm test` пуска тестовете на TypeScript пакетите; програмните PDF-и, които тестовете изискват, се подготвят според раздел „Входове за `pnpm test`“ в [ръководството](docs/dev-guide.md). Сравнението `budget-ts parity` и фикстурите са описани в [ръководството за разработка](docs/dev-guide.md); `./budget` изпълнява пълния Node импорт.

## Среда и проверки

```bash
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers pnpm exec playwright install chromium

pnpm typecheck
pnpm --filter @sigma-budget/etl... build
node packages/ingest/dist/validate/cli.js --live --only REGISTRY
# Одобреният входен архив се придобива според „Входове за pnpm test“ в docs/dev-guide.md.
# Възстановяването изисква нова директория извън хранилището и удостоверява архива и входовете.
node scripts/restore-node-input-cache.mjs /path/to/registered-node-inputs.tar.gz /tmp/registered-node-inputs
./budget check-site --inputs /tmp/registered-node-inputs
node tests/release/budget_provenance_check.mjs
node tests/release/compat_check.mjs
pnpm --filter @sigma-budget/web test # и списъците на заявките на екраните (app/lib/query-lists.test.ts)
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers pnpm build:release --env staging --noindex
# В отделен терминал стартирайте Worker-а:
pnpm exec wrangler dev -c apps/web/build/server/wrangler.json --ip 127.0.0.1 --port 8814
# Пълната проверка върви срещу него:
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker
```

Регресията за ранния мобилен tap се проверява с `E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker boot.spec.ts` срещу сглобения Worker. Файловете на артефакта (`sitemap.xml`, `robots.txt`, `llms.txt`, `_headers`, маркираният service worker) се проверяват от `apps/web/scripts/release-artifact.test.ts` в `pnpm test`; release командата проверява и действителния артефакт преди успех.

Playwright Test конфигурацията е в `tests/e2e/playwright.config.ts`, до общите fixtures и спецификациите. След стартиране на Worker от горния пример:

```bash
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e
# Статичните проверки, без Worker:
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers pnpm test:e2e --project=static
# Самостоятелен статичен сървър с path fallback:
node apps/web/scripts/serve.ts --port 8000
```

Проектът `worker` включва `boot.spec.ts`, `security-headers.spec.ts`, `narrative-adoption.spec.ts` и `period-matrix.spec.ts`, както и `visual-audit.spec.ts` и `light-contrast.spec.ts`. Проектът `static` изпълнява `redirects.spec.ts`, `calc.spec.ts`, `share.spec.ts`, `accept.spec.ts`, `overlap.spec.ts` и `motion.spec.ts` върху автоматично сглобените symlinks в `tmp/static-site`. Данните се четат от `data/release`, JavaScript - от `apps/web/build/client/js`; необходим е предварителен build.

Командите и обхватът на визуалния одит и контраста са в [ръководството за разработка](docs/dev-guide.md).

Калкулаторът, споделянето, приемните числа, layout/keyboard матрицата, движението и припокриванията се проверяват с Playwright Test. Например `pnpm test:e2e --project=static calc.spec.ts` или `pnpm test:e2e --project=static accept.spec.ts overlap.spec.ts`. Независимите очаквания в `tests/e2e/expected.ts` използват release данните; заплатните изчисления са в цели центове, а процентните ставки - в базисни точки. Browser probes са типизирани функции, подавани директно на Playwright. При отказ се запазват traces.

## Данни и издания

`./budget` е входната команда за придобиване, сглобяване, проверка и възпроизвеждане на данните. Производствената среда е Node 24 с `pnpm-lock.yaml`. Историческо Python издание се възпроизвежда от commit-а в `processing.code.commit` на манифеста. Оригиналите са в `data/originals/`; файловете на МФ остават в git, останалите се придобиват според [източниците](docs/data-sources.md). Ръчно поддържаните и замразените входове са в `data/inputs/`, а междинните резултати в игнорирания `data/cache/`.

`./budget build --inputs /път/до/входовете --out /външна/нова/директория --build-date ГГГГ-ММ-ДД --site` сглобява издание от commit и записва данните и манифеста в `data/release/`. `./budget reproduce` го възпроизвежда и сравнява байтовете. Слоят за терминология чете замразените замени от `data/inputs/wording.json`, без историческите тагове; редът на строителите е запазен. Подробности: [издания](docs/release.md), [придобиване](docs/data-acquisition.md), [операторско ръководство](docs/operator-guide.md).

За изолиран build без запис в `data/release/` използвай [offline импорт и локален candidate сайт](docs/import-local.md). Двата readers за бюджет 2027 се проверяват автоматично при build; `BUDGET_CANDIDATE` избира валидирания пакет за assets и SSR.

GitHub Actions проверява PR и сглобява staging. Push към main може да публикува сайта на staging при конфигурирани Cloudflare секрети. Production е отделна контролирана процедура. Конфигурацията е в `apps/web/wrangler.jsonc`; собствена среда използва игнориран `wrangler.local.jsonc`. Готовността е описана в [production-readiness](docs/production-readiness.md).

## Документация

[Спецификация](docs/approach-specification.md), [ръководство за разработка](docs/dev-guide.md), [данни](docs/data-spec.md), [формати на наборите](docs/example-datasets.md), [план](docs/plan.md) и [архитектурни решения](docs/adr/).

## История и версии

Историята на хранилището е **възстановена от работни копия**; тя не е запис на реални commit-и за целия период:

- ранните commit-и на прототипа (запазен в тага `proto-v3.6`) са оригиналните — със съдържанието и времето, в което са направени;
- по-късните етапи са възстановени от запазени снимки на работните копия и от времената в дневника на работата. Съдържанието на файловете във всеки commit е крайното състояние на файла за съответния етап, а времето на commit-а е най-доброто възможно приближение;
- версиите са отбелязани с тагове: `proto-v3.6` (старият прототип), `mock-v1` … `mock-v6` (сайтът, виж [`docs/plan.md`](docs/plan.md));
- страничната линия `kfp-2024` (допълване на отчетите по КФП за 2024 г.) е слята в началото на v5 (`94134e0`).

Съобщенията на commit-ите са на английски (Conventional Commits), документацията е на български.

## Лиценз

Кодът е под лиценза MIT — виж файла [`LICENSE`](LICENSE). Официалните документи, на които стъпват данните (законите, законопроектът и мотивите, отчетите на министерствата), са публични; текстът им е използван без промяна.
