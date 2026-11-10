# Offline импорт и локален сайт от candidate

`./budget` използва Node 24 и фиксираните workspace зависимости. Новите издания изпълняват реалните четци, общия TypeScript граф и всичките 26 групи + REGISTRY. `./budget-python` е отделният launcher за исторически Python издания и референтните тестове. Нужни са вече придобити оригинали и кешове според регистрите; offline build не сваля източници.

От корена на хранилището:

```bash
pnpm install --frozen-lockfile
./budget build --commit HEAD --inputs /absolute/path/to/acquired-inputs \
  --out /absolute/new/candidate --build-date 2026-11-10
./budget validate --release /absolute/new/candidate --inputs /absolute/path/to/acquired-inputs
BUDGET_CANDIDATE=/absolute/new/candidate pnpm --filter @sigma-budget/web... build
```

Входната директория съдържа `data/originals/` и `data/cache/`. Изходът е нова директория извън checkout-а с `data/`, `manifest.json`, `validation.json` и `receipt.json`. Няма запис в checkout `data/release/`, remote pointer или публикуване. Само изричното `build --site` записва локалните checkout данни. Launcher-ът използва Turbo, за да построи променения код и да използва кешираните workspace инструменти; не инсталира зависимости и не избира Python като fallback.

## Извличане и свежест

Build експортира посочения commit и автентикира цялата входна верига. Реалните PDF/XLS/XLSX/DOCX/HTML и API readers проверяват наличните intermediates срещу източниците; разлика спира изпълнението, без да заменя входа. Регистрираните възстановими липсващи intermediates се генерират само в собствен scratch. ZIP архивите, acquisition записите и членовете се сверяват с pins. Манифестът разграничава прочетени източници, извлечения и новогенерирани intermediates.

Кодът, pins и `data/inputs/` идват от commit-а. Неприключена редакция в `--inputs/data/inputs/` не е нов release input; копирането на променен ZIP не го прави доверен. Нова публикация изисква преглед на acquisition метаданните и pins. Отделна подготовка на физическите документи може да се изпълни в нова директория:

```bash
./budget prepare --inputs /absolute/path/to/acquired-inputs --out /absolute/new/prepared --build-date 2026-11-10
```

За изолиран candidate се използва `budget build`, без ръчна последователност от readers. `budget validate` взима build датата от манифеста и възпроизвежда пакета с реалните числови проверки. Подробните договори и команди са в [production-typescript-import.md](production-typescript-import.md).

## Избор за сайта

`BUDGET_CANDIDATE` посочва корена на candidate, абсолютен или спрямо корена на репото. Vite проверява receipt/manifest идентичността, всеки output SHA-256 и размер, липсващи и нерегистрирани файлове и успешния пълен отчет. Числовите проверки се изпълняват в Node `build`/`validate`.

Пакетът в `apps/web/build/client/data/` съдържа точно избраните данни и локални release метаданни. SSR и браузърът използват същото ID и assets, дори локалният D1/R2 регистър да сочи друго издание. Липсващ деклариран SSR asset е грешка; действително липсващ набор остава „предстои“. В този режим няма registry API/журнал; метаданните са от пакета. Без променливата се запазва обичайното поведение с `data/release/` и текущия регистър.

## Задължително приемане

```bash
node scripts/node-import-acceptance.mjs /absolute/path/to/acquired-inputs /absolute/new/acceptance 2026-11-10
node scripts/node-candidate-site-acceptance.mjs /absolute/new/acceptance/candidate /absolute/new/site-proof
```

Проверката включва реалните четци и всички правила, два build-а, API и default CLI възпроизвеждане, откази при повредени данни и сайта. Няма skip при липсващи оригинали. Python donor тестовете остават отделна историческа референция; старите манифести се възпроизвеждат с `./budget-python` или изрично `--historical-python`.

Историческите GVA/Eurostat, някои стари междинни и редакционни входове остават запазени с ограниченията в [reproducibility.md](reproducibility.md). Липсващият пълен програмен архив за 2027–2029 не се регенерира. Разликите между публикуваните vintages, sparse вариантът `billMc`, празните клетки и точните единици се запазват. Пълното изпълнение на правилата не удостоверява deployment, live refresh или възстановяване на липсващи исторически оригинали.
