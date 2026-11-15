# СИГМА Бюджет

Сайтът представя държавния бюджет на България на разбираем език и по официални данни. До числата стоят източникът, обхватът, статусът и датата. Примерните данни са означени като такива; неизвлечените данни се показват като „предстои“.

## Структура

```text
apps/web/               React Router SSR, Worker, клиент и публични ресурси
apps/etl/               Node CLI за обработка на данните
packages/ingest/        придобиване, сглобяване и проверки на данни
packages/dataset-schema/ схеми на наборите
packages/test-support/  помощни средства за тестове
pipeline/               историческа и референтна Python обработка
data/                   входове и публикувано издание
tests/                  браузърни и release проверки
reference/              исторически прототип и проверки
docs/                   спецификации и архитектурни решения
```

Workspace-ът обхваща `apps/*` и `packages/*` и използва общия коренов `pnpm-lock.yaml`. `./budget` стартира Node CLI от `@sigma-budget/etl`, който използва `@sigma-budget/ingest`; `./budget-python` и `pipeline/` са за историческо възпроизвеждане и справки. Новият код е TypeScript. Насоките за маршрути и поддръжка на старите екрани са в [ръководството](docs/dev-guide.md), а общите правила за принос - в [AGENTS.md](AGENTS.md). [ADR 0003](docs/adr/0003-repository-layout.md) е историческо решение с отменени части.

## Локално стартиране

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm dev -- --port 8814
# http://127.0.0.1:8814/

# Браузърната част без SSR; временната директория съчетава public/, client/ и data/release/
python3 -m apps.web.scripts.serve
```

Зависимостите на Node се инсталират в корена с един `pnpm-lock.yaml` (pnpm workspace). `pnpm build` е build за локална разработка, без SEO обхода. Единственият вход за deploy артефакт е `pnpm build:release` (Python 3.12 с зависимостите и Chromium от следващия раздел). Той проверява екраните, генерира sitemap/llms/robots и кеш заглавките и маркира service worker за всяко сглобяване. За staging използвай `--env staging --noindex`; за production - `--origin https://<адрес>`.

Сглобеният сайт е в `apps/web/build/`. Клиентът се публикува под `/js/`, а данните от `data/release/` под `/data/`; публичните адреси са запазени. SSR чете текущото издание от D1/R2; без регистър използва включеното в сглобяването издание.

Нужни са Node 24 и pnpm 10.33.0. `pnpm test` пуска тестовете на TypeScript пакетите; програмните PDF-и и Python 3.12, които тестовете изискват, се подготвят според раздел „Входове за `pnpm test`“ в [ръководството](docs/dev-guide.md). Сравнението `budget-ts parity` и фикстурите са описани в [ръководството за разработка](docs/dev-guide.md); `./budget` изпълнява пълния Node импорт. `./budget-python` е отделната команда за исторически Python издания и референтни проверки.

## Среда и проверки

```bash
uv venv tmp/venv --python 3.12
uv pip install --python tmp/venv/bin/python --require-hashes -r tests/requirements-dev.lock
uv pip install --python tmp/venv/bin/python --no-deps -e pipeline
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m playwright install chromium
uv venv tmp/venv-data --python 3.12
uv pip install --python tmp/venv-data/bin/python --require-hashes -r pipeline/requirements.lock
uv pip install --python tmp/venv-data/bin/python --no-deps -e pipeline

pnpm typecheck
python -m budget_pipeline.validate.registry check
./budget-python validate --site # историческата публикувана снимка е неизменна
python -m budget_pipeline.validate.datasets
tmp/venv/bin/python -m tests.release.compat_check
tmp/venv/bin/python -m apps.web.scripts.query_check
PATH="$PWD/tmp/venv/bin:$PATH" PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers pnpm build:release --env staging --noindex
# След това Worker-ът се стартира с pnpm dev; пълната проверка върви срещу него:
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.screens --url http://127.0.0.1:8814/
```

Регресията за ранния мобилен tap се проверява с `python -m tests.e2e.boot --url http://127.0.0.1:8814/` срещу сглобения Worker. Release smoke проверките са `python -m unittest tests.release.test_build_artifact`; release командата проверява и действителния артефакт преди успех.

Останалите браузърни проверки са `redirects.py`, `calc_check.py`, `share_check.py`, `accept.py` и `motion.py` в `tests/e2e/`. Те използват временния статичен сайт. `overlap.py` и `perf.py` проверяват припокриване и работа при ограничен процесор. Очакваните числа се четат от текущите данни чрез `expect.py`. Интеграционните проверки `tests/release/release_check.py` и `restore_drill.py` изискват Node, OpenSSL и локален Worker.

## Данни и издания

`./budget` е входната команда за придобиване, сглобяване, проверка и възпроизвеждане на данните. Производствената среда е Node 24 с `pnpm-lock.yaml`. Python 3.12 и образът `docker build -t sigma-budget-data pipeline` остават за историческо възпроизвеждане и референтните тестове. Оригиналите са в `data/originals/`; файловете на МФ остават в git, останалите се придобиват според [източниците](docs/data-sources.md). Ръчно поддържаните и замразените входове са в `data/inputs/`, а междинните резултати в игнорирания `data/cache/`.

`./budget build --inputs /път/до/входовете --out /външна/нова/директория --build-date ГГГГ-ММ-ДД --site` сглобява издание от commit и записва данните и манифеста в `data/release/`. `./budget reproduce` го възпроизвежда и сравнява байтовете. Слоят за терминология чете замразените замени от `data/inputs/wording.json`, без историческите тагове; редът на строителите е запазен. Подробности: [издания](docs/release.md), [придобиване](docs/data-acquisition.md), [операторско ръководство](docs/operator-guide.md).

За изолиран build без запис в `data/release/` използвай [offline импорт и локален candidate сайт](docs/import-local.md). Двата readers за бюджет 2027 се проверяват автоматично при build; `BUDGET_CANDIDATE` избира валидирания пакет за assets и SSR.

GitHub Actions проверява PR и сглобява staging. Push към main може да публикува сайта на staging при конфигурирани Cloudflare секрети. Production е отделна контролирана процедура. Конфигурацията е в `apps/web/wrangler.jsonc`; собствена среда използва игнориран `wrangler.local.jsonc`. Готовността е описана в [production-readiness](docs/production-readiness.md).

## Документация

[Спецификация](docs/approach-specification.md), [ръководство за разработка](docs/dev-guide.md), [данни](docs/data-spec.md), [формати на наборите](docs/example-datasets.md), [план](docs/plan.md) и [архитектурни решения](docs/adr/).

## История и версии

Историята на хранилището е **възстановена от работни копия**; тя не е запис на реални commit-и за целия период:

- ранните commit-и на прототипа (днес в `reference/prototype/`) са оригиналните — със съдържанието и времето, в което са направени;
- по-късните етапи са възстановени от запазени снимки на работните копия и от времената в дневника на работата. Съдържанието на файловете във всеки commit е крайното състояние на файла за съответния етап, а времето на commit-а е най-доброто възможно приближение;
- версиите са отбелязани с тагове: `proto-v3.6` (старият прототип), `mock-v1` … `mock-v6` (сайтът, виж [`docs/plan.md`](docs/plan.md));
- страничната линия `kfp-2024` (допълване на отчетите по КФП за 2024 г.) е слята в началото на v5 (`94134e0`).

Съобщенията на commit-ите са на английски (Conventional Commits), документацията е на български.

## Лиценз

Кодът е под лиценза MIT — виж файла [`LICENSE`](LICENSE). Официалните документи, на които стъпват данните (законите, законопроектът и мотивите, отчетите на министерствата), са публични; текстът им е използван без промяна.
