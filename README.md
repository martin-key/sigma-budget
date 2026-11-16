# СИГМА Бюджет

СИГМА Бюджет е официален сайт и проект на МИДТ. Представя държавния бюджет на България на разбираем език и по официални данни. До числата стоят източникът, обхватът, статусът и датата.

## Структура и локална среда

`apps/web/` съдържа React Router SSR, Cloudflare Worker, клиента и публичните ресурси. `data/release/` е закрепеното издание, `tests/` съдържа браузърните и release проверки, а `docs/` - документацията на сайта. Единственият workspace е `apps/web`; нужен е Node 24 и pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm dev -- --port 8814
# http://127.0.0.1:8814/
```

Не се изискват оригинали, ETL или входни архиви. Сглобеният сайт е в `apps/web/build/`. Клиентът се публикува под `/js/`, а данните под `/data/`. SSR чете само включеното в build-а издание. Новият код е TypeScript; маршрутите и поддръжката на екраните са в [ръководството](docs/dev-guide.md), а конвенциите - в [AGENTS.md](AGENTS.md).

## Проверки и сглобяване

```sh
pnpm format:check
pnpm typecheck
pnpm test -- --coverage
pnpm check:coverage
node --test scripts/ci-gates.test.mjs
pnpm data:check
node tests/release/compat_check.mjs
pnpm build
```

`pnpm build` е локален build. Deploy артефактът се създава само чрез `pnpm build:release`, с Chromium на закрепената версия на Playwright:

```sh
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers pnpm exec playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers pnpm build:release --env staging --noindex
pnpm exec wrangler dev -c apps/web/build/server/wrangler.json --ip 127.0.0.1 --port 8814
# В отделен терминал:
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers E2E_WORKER_URL=http://127.0.0.1:8814 pnpm test:e2e --project=worker
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers pnpm test:e2e --project=static
```

Playwright конфигурацията е в `tests/e2e/playwright.config.ts`. Worker проверките покриват SSR, ранния tap, навигацията, достъпността и екраните. Статичните проверки покриват старите адреси, калкулатора, споделянето, приемните числа, движението и припокриванията. При отказ се пазят traces. `build:release` проверява екраните, създава sitemap/llms/robots, кеш заглавките и версията на service worker. За production се подава `--origin https://<адрес>`.

## Данни и публикуване

Оригиналите, регистрите, обработката и независимите проверки са в [midt-bg/sigma-budget-data](https://github.com/midt-bg/sigma-budget-data). Сайтът знае само формата на изданието и доставената с него JSON Schema; хранилището за данни не зависи от сайта.

След merge на data PR:

```sh
pnpm data:pull --commit <пълен-sha>
pnpm data:check
```

Командата изтегля анонимно и проверява изданието преди подмяна на `data/release/`; записва commit и release id в `data/release.lock.json`. Без `--commit` се избира текущият `main` на хранилището за данни. Копието и lock файлът се предлагат с PR, без ръчни промени в изданието.

Merge към `main` публикува staging на `https://sigma-budget-staging.cf-midt.workers.dev`. След изрично одобрение от собственика таг `vX.Y.Z` върху commit от `main` публикува production на `https://sigma-budget.midt.bg` през GitHub Environment `production`. PR проверките не публикуват. Всяка среда използва собствен Cloudflare token. `/admin/*` връща `404`.

Подробности: [формат и проверки](docs/release.md), [ново издание](docs/operator-guide.md), [production процедура](docs/production-procedure.md), [готовност](docs/production-readiness.md). Историческите решения са в [docs/adr/](docs/adr/).

## История и версии

Историята на хранилището е **възстановена от работни копия**; тя не е запис на реални commit-и за целия период:

- ранните commit-и на прототипа (запазен в тага `proto-v3.6`) са оригиналните — със съдържанието и времето, в което са направени;
- по-късните етапи са възстановени от запазени снимки на работните копия и от времената в дневника на работата. Съдържанието на файловете във всеки commit е крайното състояние на файла за съответния етап, а времето на commit-а е най-доброто възможно приближение;
- версиите са отбелязани с тагове: `proto-v3.6` (старият прототип), `mock-v1` … `mock-v6` (сайтът, виж [`docs/plan.md`](docs/plan.md));
- страничната линия `kfp-2024` (допълване на отчетите по КФП за 2024 г.) е слята в началото на v5 (`94134e0`).

Съобщенията на commit-ите са на английски (Conventional Commits), документацията е на български.

## Лиценз

Кодът е под лиценза MIT — виж файла [`LICENSE`](LICENSE). Официалните документи, на които стъпват данните (законите, законопроектът и мотивите, отчетите на министерствата), са публични; текстът им е използван без промяна.
