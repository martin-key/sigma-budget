# Offline импорт и локален сайт от candidate

`./budget` използва Python 3.12 с фиксираните зависимости от `pipeline/requirements.lock`. TypeScript миграцията е отделна работа. Нужни са вече придобитите оригинали и кешове според регистрите; тези команди не свалят източници.

От корена на хранилището:

```bash
export PYTHONDONTWRITEBYTECODE=1
./budget build --commit HEAD --inputs /absolute/path/to/acquired-inputs \
  --out "$PWD/tmp/candidate" --build-date 2026-11-10 --env local
./budget validate --release "$PWD/tmp/candidate"
BUDGET_CANDIDATE="$PWD/tmp/candidate" pnpm --filter @sigma-budget/web... build
```

Входната директория съдържа `data/originals/` и `data/cache/`. `--env local` изисква `tmp/venv-data` с фиксираните Python зависимости. Изходът е отделен candidate с `data/`, `manifest.json`, `validation.json` и `receipt.json`. Няма запис в checkout `data/release/`, remote pointer или публикуване. Съществуващият `build --site` остава отделната изрична команда за локално записване в `data/release/`.

## Извличане и свежест

Всеки `budget build` експортира посочения commit. В този export `rebuild` автоматично пуска двата readers за ноемврийската публикация за бюджет 2027: `budget_forecast_2027` и `budget_bill_2027`. При липсващ extraction файл reader-ът го генерира. При наличен файл извлича повторно от ZIP/PDF и сравнява точните байтове; разлика спира build-а, без да заменя файла. ZIP архивът, acquisition записът и PDF членовете се сверяват с pins. `processing.extractions` в манифеста записва действието, producer-а, хеша и размера на всяко извлечение и произхода му до ZIP/PDF.

Кодът, pins и наличните `data/inputs/` идват от commit-а. Неприключена редакция в `--inputs/data/inputs/` не се приема за нов release input. Нова публикация изисква преглед и commit на оригиналите, acquisition метаданните и pins; ако extraction вече е в commit-а, обновява се и той. Самото копиране на променен ZIP не го прави доверен вход. `sources.prepare_inputs` включва същите две проверки; само за тях може да се изпълни:

```bash
tmp/venv-data/bin/python -m budget_pipeline.sources.prepare_inputs --budget-2027-only
```

Тази пряка команда генерира само липсващите извлечения в текущото работно копие. За изолиран candidate се използва `budget build`, без предварителна ръчна последователност от readers. `budget validate` взима build датата от манифеста на избраното издание.

## Избор за сайта

`BUDGET_CANDIDATE` посочва корена на candidate, абсолютен или спрямо корена на репото. Vite проверява receipt/manifest идентичността, всеки output SHA-256 и размер, липсващи и нерегистрирани файлове и успешния отчет от production валидатора. Това е проверка на вече валидирания пакет; числовите проверки остават в Python `build`/`validate`.

Пакетът в `apps/web/build/client/data/` съдържа точно избраните данни и локални release метаданни. SSR използва същото ID и assets, дори локалният D1/R2 регистър да сочи друго издание. Браузърът получава `/data/` за същите файлове. Липсващ деклариран SSR asset е грешка; действително липсващ набор остава „предстои“. В този режим няма registry API/журнал; метаданните са от пакета. Без променливата се запазва обичайното поведение с `data/release/` и текущия регистър.

## Фокусирана acceptance проверка

```bash
BUDGET_IMPORT_INPUTS=/absolute/path/to/acquired-inputs \
BUDGET_IMPORT_OUT="$PWD/tmp/import-acceptance" \
PYTHONDONTWRITEBYTECODE=1 tmp/venv-data/bin/python -m unittest \
  tests.pipeline.test_import_orchestration -v
BUDGET_IMPORT_CANDIDATE="$PWD/tmp/import-acceptance/candidate" \
  pnpm --filter @sigma-budget/web test workers/import-candidate.test.ts
```

Python тестът сглобява `HEAD`, извлича реалните pinned PDF-и, проверява генериране на липсващи извлечения, отказ на остаряло извлечение и повреден ZIP, независима печатна числова опора и неизменност на checkout originals/inputs/release. Допълнителният `BUDGET_IMPORT_REFERENCE=/path/to/reference-candidate` сравнява всички data bytes с предварително проверен candidate. Web тестът проверява пакетирането и пет действителни SSR render пътя от избрания candidate, включително исторически период. Без тези променливи тежките functional проверки се пропускат изрично; малките тестове остават активни.

Покритието е за наличната публикация от 06.11.2026. Историческите GVA/Eurostat, някои стари междинни и редакционни входове остават запазени с ограниченията в [reproducibility.md](reproducibility.md). Липсващият пълен програмен архив за 2027–2029 не се регенерира. Разликата в публикувания БВП между таблиците, отделните vintages, sparse вариантът `billMc`, празните клетки и точните единици се запазват. Локалните проверки не удостоверяват deployment, live refresh или възстановяване на липсващи исторически оригинали.
