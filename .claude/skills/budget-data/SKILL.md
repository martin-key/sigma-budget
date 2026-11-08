---
name: budget-data
description: Обновява данните на сайта от публичните източници до PR с готовите data/release/*.json. Проверява кое липсва, сваля отворените източници, внася ръчно свалените файлове от minfin.bg, пуска извличането, сглобяването и проверките и обяснява промените. Използвай, когато администраторът каже „дойде новият отчет“, „нов месец по КФП“, „обнови данните“, „свали източниците“, „внеси файла от minfin“ или подобно.
---

# Обновяване на данните

Skill-ът води администратора през месечния цикъл от `docs/data-acquisition.md` (раздели 6 и 7). Пуска скриптовете на хранилището и обяснява на прост език какво са направили. Резултатът е клон и PR към github.com/midt-bg/sigma-budget с `data/release/*.json`, сглобени от скриптовете.

## Правила, които важат винаги

- **Числата ги вадят само скриптовете.** Не пиши и не поправяй число на ръка в `data/release/`, `data/inputs/` или в кода. Единственото изключение са заглавните числа за независимата проверка (стъпка 5), които казва човекът.
- **Начинът на сваляне е свободен.** Днес файловете от minfin.bg ги сваля човекът в своя браузър, защото скрипт не минава проверката на Cloudflare. Ако има работещ автоматичен начин, източникът минава от `import` на `fetch` в `data/sources.yaml`. Задължителни са оригиналните байтове, sha256, адресът и датата. Бисквитки и токени не влизат в хранилището.
- **Не опреснявай живите източници без нужда.** Такива са API на Народното събрание, страницата на МИДТ, Eurostat, БНБ и Държавен вестник. Когато се променят, проверките в строителите спират сглобяването. Сваляй само липсващото, освен ако човекът изрично иска нова версия.
- **Работи само в отделен клон.** Отделяй го от `main` на midt-bg/sigma-budget. PR-ът е към `main`. Не push-вай в основния клон, не сливай и не публикувай: решават CI и човек.
- **Не разхлабвай проверка, която спира.** Покажи какво се е променило в източника и предложи поправка в кода с тест, като отделна промяна.

## 0. Подготовка (веднъж на машина)

Средата за обработката е отделна от `tmp/venv`: тя държи PyMuPDF 1.26.5, а 2.0 не чете програмните бюджети. Инсталира се от lockfile-а с хешовете:

```bash
uv venv tmp/venv-data --python 3.12
uv pip install --python tmp/venv-data/bin/python --require-hashes -r pipeline/requirements.lock
uv pip install --python tmp/venv-data/bin/python --no-deps -e pipeline
```

Без uv: `python3.12 -m venv tmp/venv-data && tmp/venv-data/bin/pip install --require-hashes -r pipeline/requirements.lock`.

Същата среда има и като образ, по digest: `docker build -t sigma-budget-data pipeline`. Тогава всяка команда `tmp/venv-data/bin/python …` по-долу става `docker run --rm -v "$PWD":/repo sigma-budget-data python …`. Образът е референтната среда: в него `rebuild.py` дава `data/release` байт по байт.

Клон за промяната, кръстен по периода. Командите приемат, че midt-bg/sigma-budget е remote `upstream`, а твоят fork е `origin`. Ако имаш права за запис в midt-bg и работиш направо в него, пиши `origin` вместо `upstream`.

```bash
git fetch upstream
git switch -c data/kfp-2026-10 upstream/main
```

## 1. Какво има и какво липсва

```bash
python -m budget_pipeline.sources.originals status
```

Обясни на човека кое липсва, кое е различно и кой е следващият отчет по КФП.

Ако липсва целият архив, например на нова машина, поискай архива на суровите файлове от работната група и го внеси. Файловете се разпознават по sha256:

```bash
python -m budget_pipeline.sources.originals import /път/до/архива/
```

## 2. Откъде може да се тегли от тази мрежа

```bash
python -m budget_pipeline.sources.access_probe
```

Днес minfin.bg дава `challenge`, затова файловете от него се свалят ръчно. nra.bg и data.egov.bg минават само от България.

## 3. Отворените източници: само липсващото

`status` отпечатва точната команда за липсващите автоматични файлове. Пусни нея и после отново `status`: всеки файл трябва да е „наличен“.

Ако за `nap/` дойде страница вместо PDF (CAPTCHA), не опитвай с други заглавки или адреси. Помоли човека да го свали в браузъра от nra.bg и го внеси със `import`; файлът се разпознава по sha256.

## 4. Ръчните файлове от minfin.bg

За всеки липсващ ръчен файл и за новия месец по КФП кажи на администратора точно:

- **страницата:** https://www.minfin.bg/bg/statistics/5 за КФП или https://www.minfin.bg/bg/legislation1/609 за мотивите и АСБП;
- **кой файл:** например отчетът „към 30.09.2026“, днес `2026-EU funds_0926_BG_WEB.xls`;
- **къде да го сложи:** в `tmp/sources/inbox/` или да го остави в Downloads.

Изчакай човека. После:

```bash
python -m budget_pipeline.sources.originals import ~/Downloads/2026-EU\ funds_0926_BG_WEB.xls
```

Без аргумент `import` чете `tmp/sources/inbox/`. Скриптът проверява листа, периода от клетка A3 и единицата. Записва файла под името, което очакват скриптовете, добавя реда му в `data/originals.sha256` и пише запис за придобиване в `tmp/sources/ACQUISITIONS.jsonl`. Ако за месеца вече има файл, а новият е коригирана версия (`_1`, `_2`), пусни с `--replace`: старата версия отива в `tmp/sources/replaced/`.

## 5. Независимата проверка на заглавните числа (при нов месец по КФП)

Помоли човека да прочете три числа от съобщението на МФ за изпълнението на КФП към края на месеца. Ако съобщението още го няма, може да ги прочете от файла, отворен в Excel. Числата са в млн. €, с един знак след десетичната запетая:

- приходите;
- разходите заедно с вноската в бюджета на ЕС;
- бюджетното салдо.

Впиши ги точно както ги каже човекът, като нов ред за месеца:

- в `REFERENCE` в `pipeline/budget_pipeline/extract/kfp_full.py`;
- в `HEADLINES` в `pipeline/budget_pipeline/validate/execution_reports.py`.

Не ги взимай от изхода на парсера: смисълът им е да проверят парсера.

## 6. Извличане: само когато суровите входове са нови

Пусни с `tmp/venv-data/bin/python` само екстракторите, чийто вход е нов или чийто изход `status` отчита като липсващ:

| Екстрактор | Кога |
|---|---|
| `pipeline/budget_pipeline/extract/dv_laws.py` | нов закон или изменение в Държавен вестник |
| `pipeline/budget_pipeline/extract/program_budgets.py` | нов архив към законопроекта |
| `pipeline/budget_pipeline/extract/asbp_tables.py` | нов PDF с мотивите и АСБП |
| `pipeline/budget_pipeline/extract/asbp_pages.py` | нов PDF с мотивите или липсва `data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json` |
| `pipeline/budget_pipeline/extract/bill.py` | нов законопроект или нов закон |

Новият месец по КФП не иска нито един от тях.

## 7. Сглобяване и проверка

Изданието се сглобява от commit (`docs/release.md`). Затова първо запиши промените в кода и пиновете: заглавните числа от стъпка 5,
датата на сглобяване по-долу, редът на новия отчет в `data/originals.sha256` (`import` го добави) и редът му в
`docs/data-sources.md` (стъпка 9). Файловете от minfin.bg са в git (`data/originals/kfp_*/` и `asbp/`), затова новият отчет влиза в същия commit. Останалите сурови файлове не са в git: сглобяването ги чете от локалното копие и сверява всеки с пина му от commit-а.

```bash
git add data/originals/kfp_2026/ pipeline/budget_pipeline/extract/kfp_full.py pipeline/budget_pipeline/validate/execution_reports.py pipeline/budget_pipeline/build/data_io.py pipeline/budget_pipeline/validate/checks.py pipeline/budget_pipeline/build/editorial.py pipeline/budget_pipeline/build/example_support.py \
  data/originals.sha256 docs/data-sources.md
git commit -m "data(kfp): pin the October 2026 report and its headline"
./budget build --build-date ГГГГ-ММ-ДД --site
./budget validate --site
python -m budget_pipeline.validate.registry check
```

- `budget build` сглобява commit-а в образа на `pipeline/Dockerfile` (без docker: в `tmp/venv-data`). Той пуска `rebuild.py`: `kfp_full.py`, строителите и слоя v5/v6 (`wording.py`, `active_data.py`, `apply_sources.py`, `catalog_refresh.py`) в реда, който дава публикуваните файлове. С `--site` слага данните в `data/release`, а манифеста на изданието в `data/release/releases/`.
- Отпечатва `release_id` и `missingInputs`. Кажи на човека кои входове липсват и кои набори засягат.
- **Производствен вход.** Използвай `./budget build`, който изпълнява цялата последователност `python -m budget_pipeline.build.rebuild`. Историческият shell ред не е вход към текущото сглобяване.
- **Датата на сглобяване** е денят на сглобяването и влиза във всеки файл. Сложи същата дата като стойност по подразбиране на `BUILD_DATE` в `pipeline/budget_pipeline/build/data_io.py`, `checks.py`, `editorial.py` и `example_support.py`. Иначе CI ще отхвърли новите дати.
- `budget validate --site` е същата проверка като в CI: манифестът, SHA-256 на всеки файл и `datasets.py`. Трябва да завърши с код 0.
- `registry.py check` сверява `data/sources.yaml` и `data/datasets.yaml` с хранилището, също като в CI. Новият месец по КФП не иска промяна в регистрите: шаблонът `kfp_2026/*.xls` го покрива. Нов вид източник или нов файл в `data/release` иска запис там.

Ако нещо спре, прочети грешката, обясни я и спри (виж правилата).

Групата INPUTS сравнява суровите файлове с `data/originals.sha256`. Ако в стъпка 3 е свалено нещо, `MANIFEST.json` и опреснените живи източници ще се различават. Това е очаквано: обясни го на човека. Не обновявай редовете им в `originals.sha256`, освен ако новата версия наистина влиза в сглобяването.

## 8. Преглед на промените

```bash
git status --short
git diff --stat
```

Обясни на прост език, без политически оценки:

- **новият месец:** заглавните числа спрямо предишния месец и спрямо плана (`data/release/execution.json`, блок `latest`);
- **ревизиите:** стойности за минали месеци, които са се променили в `execution.json`. Изброй ги, защото МФ понякога коригира стари отчети;
- **необичайните промени:** месечна промяна на ред, много по-голяма от обичайната за него;
- **засегнатите файлове на сайта.**

## 9. Документация

- В `docs/data-sources.md`, раздел 4.1, добави реда, който `import` отпечата, в таблицата на годината. Обнови и броя отчети в заглавието на таблицата.
- `data/originals.sha256` вече е обновен от `import`.

## 10. PR

```bash
git add data/release
git commit -m "data(kfp): add the October 2026 report"
```

Кодът и пиновете вече са в commit-а от стъпка 7; манифестът на изданието казва неговия хеш. Затова направи стъпка 9 преди 7. После:

```bash
git push -u origin HEAD
gh pr create --repo midt-bg/sigma-budget --base main --head "$(gh api user -q .login):$(git branch --show-current)"
```

Клонът отива във fork-а (`origin`), а PR-ът е към `main` на midt-bg.

В описанието на PR напиши:

- кои файлове са влезли: име, sha256, режим (`auto`, `auto-bg` или `import`) и откъде;
- `release_id` и кои проверки са минали;
- какво се променя на сайта;
- какво остава.

## Справка

- `docs/data-acquisition.md`: защо процесът е такъв, трите режима на придобиване и планът.
- `docs/data-sources.md`: всички източници с адрес, размер и sha256.
- `docs/data-spec.md`: формата на `data/release/*.json`.
