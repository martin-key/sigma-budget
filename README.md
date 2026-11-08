# СИГМА Бюджет

Сайтът представя държавния бюджет на България на разбираем език и по официални данни. До числата стоят източникът, обхватът, статусът и датата. Примерните данни са означени като такива; неизвлечените данни се показват като „предстои“.

## Структура

```text
apps/web/       React Router SSR на Cloudflare Workers; app/, workers/api/, client/, public/, migrations/, scripts/
pipeline/       Python пакет budget_pipeline: sources/, extract/, build/, validate/; Dockerfile и зависимости
data/           originals/, inputs/, cache/ (извън git), release/, sources.yaml, datasets.yaml, originals.sha256
tests/          e2e/, release/, requirements-dev.txt и requirements-dev.lock
reference/      исторически prototype/ и mock/; не се сглобяват и изпълняват в CI
docs/           спецификации, ръководства и архитектурни решения
```

Правилата за нов код и данни са в [ADR 0003](docs/adr/0003-repository-layout.md). Клиентските екрани остават JavaScript модули до етап 2 на [ADR 0002](docs/adr/0002-react-router-ssr.md).

## Локално стартиране

```bash
npm ci
npm run typecheck
npm run build
npm run dev -- --port 8814
# http://127.0.0.1:8814/

# Браузърната част без SSR; временната директория съчетава public/, client/ и data/release/
python3 -m apps.web.scripts.serve
```

npm зависимостите се инсталират в корена с един `package-lock.json`. Сглобеният сайт е в `apps/web/build/`. Клиентът се публикува под `/js/`, а данните от `data/release/` под `/data/`; публичните адреси са запазени. SSR чете текущото издание от D1/R2; без регистър използва включеното в сглобяването издание.

## Среда и проверки

```bash
uv venv tmp/venv --python 3.12
uv pip install --python tmp/venv/bin/python --require-hashes -r tests/requirements-dev.lock
uv pip install --python tmp/venv/bin/python --no-deps -e pipeline
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m playwright install chromium
uv venv tmp/venv-data --python 3.12
uv pip install --python tmp/venv-data/bin/python --require-hashes -r pipeline/requirements.lock
uv pip install --python tmp/venv-data/bin/python --no-deps -e pipeline

npm run typecheck
python -m budget_pipeline.validate.registry check
./budget validate --site
python -m budget_pipeline.validate.datasets
tmp/venv/bin/python -m tests.release.compat_check
tmp/venv/bin/python -m apps.web.scripts.query_check
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m apps.web.scripts.build --env staging --noindex
# След това Worker-ът се стартира с npm run dev; пълната проверка върви срещу него:
PLAYWRIGHT_BROWSERS_PATH=$PWD/tmp/pw-browsers tmp/venv/bin/python -m tests.e2e.screens --url http://127.0.0.1:8814/
```

Останалите браузърни проверки са `redirects.py`, `calc_check.py`, `share_check.py`, `accept.py` и `motion.py` в `tests/e2e/`. Те използват временния статичен сайт. `overlap.py` и `perf.py` проверяват припокриване и работа при ограничен процесор. Очакваните числа се четат от текущите данни чрез `expect.py`. Интеграционните проверки `tests/release/release_check.py` и `restore_drill.py` изискват Node, OpenSSL и локален Worker.

## Данни и издания

`./budget` е входната команда за придобиване, сглобяване, проверка и възпроизвеждане на данните. Референтната среда е `docker build -t sigma-budget-data pipeline` (Python 3.12, зависимости с хешове). Оригиналите са в `data/originals/`; файловете на МФ остават в git, останалите се придобиват според [източниците](docs/data-sources.md). Ръчно поддържаните и замразените входове са в `data/inputs/`, а междинните резултати в игнорирания `data/cache/`.

`./budget build --build-date ГГГГ-ММ-ДД --site` сглобява издание от commit и записва данните и манифеста в `data/release/`. `./budget reproduce` го възпроизвежда и сравнява байтовете. Слоят за терминология още използва историческите тагове; редът на строителите е запазен. Подробности: [издания](docs/release.md), [придобиване](docs/data-acquisition.md), [операторско ръководство](docs/operator-guide.md).

GitHub Actions проверява PR и сглобява staging. Push към main може да публикува сайта на staging при конфигурирани Cloudflare секрети. Production е отделна контролирана процедура. Конфигурацията е в `apps/web/wrangler.jsonc`; собствена среда използва игнориран `wrangler.local.jsonc`. Готовността е описана в [production-readiness](docs/production-readiness.md).

## Документация

[Спецификация](docs/approach-specification.md), [ръководство за разработка](docs/dev-guide.md), [данни](docs/data-spec.md), [формати на наборите](docs/example-datasets.md), [план](docs/plan.md) и [архитектурни решения](docs/adr/).

## История и версии

Историята на хранилището е **възстановена от работни копия**; тя не е запис на реални commit-и за целия период:

- ранните commit-и на прототипа (`prototype/`) са оригиналните — със съдържанието и времето, в което са направени;
- по-късните етапи са възстановени от запазени снимки на работните копия и от времената в дневника на работата. Съдържанието на файловете във всеки commit е крайното състояние на файла за съответния етап, а времето на commit-а е най-доброто възможно приближение;
- версиите са отбелязани с тагове: `proto-v3.6` (старият прототип), `mock-v1` … `mock-v6` (сайтът, виж [`docs/plan.md`](docs/plan.md));
- страничната линия `kfp-2024` (допълване на отчетите по КФП за 2024 г.) е в отделен клон и е слята в началото на v5.

Съобщенията на commit-ите са на английски (Conventional Commits), документацията е на български.

## Лиценз

Кодът е под лиценза MIT — виж файла [`LICENSE`](LICENSE). Официалните документи, на които стъпват данните (законите, законопроектът и мотивите, отчетите на министерствата), са публични; текстът им е използван без промяна.
