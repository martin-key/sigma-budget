# Издание на данните и командата `budget`

Изданието е проверим пакет от данните на сайта (раздели 6.3, 6.4, 7 и 8 на [спецификацията](approach-specification.md)). Прави го командата
`budget` (`apps/etl/src/production-cli.ts`, обвивка `./budget` в корена на хранилището). Издание, сглобено преди TypeScript обработката, се възпроизвежда чрез checkout на commit-а от `processing.code.commit` в манифеста и документацията на този commit. Данните се публикуват с кода от `data/release/`, включително `releases/`. Новото издание идва от `midt-bg/sigma-budget-data` чрез PR по [процедурата](operator-guide.md).

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
| `processing`                                          | Точният commit/export, Node runtime, lock/compiler/executor хешовете, датата, регистрите и автентикираният snapshot.                                                                                                                                                    |
| `inputs`                                              | Всеки файл, който сглобяването чете и не е в git: път, източник (`data/sources.yaml`), начин на придобиване, адрес на файла или на страницата, период, кога е получен, MIME, байтове и SHA-256. Междинните файлове казват производителя си и дали той ги възпроизвежда. |
| `outputs`                                             | Всеки файл на изданието: път, набор (`data/datasets.yaml`), MIME, байтове и SHA-256, включително `validation.json`.                                                                                                                                                     |
| `coverage`                                            | Всеки набор със статуса, периода и обхвата си, дали това издание го сглобява наново, ограниченията му, предстоящите набори с причината и входовете, които липсват.                                                                                                      |
| `compatibility`                                       | Кои версии на договора на `execution.json` четат приложението и инструментите.                                                                                                                                                                                          |

## Командите

```bash
./budget build --commit HEAD --inputs /path/to/inputs --out /outside/new/candidate --build-date 2026-11-10
./budget build --commit HEAD --inputs /path/to/inputs --out /outside/new/site-candidate --build-date 2026-11-10 --site
./budget validate --release /outside/new/candidate --inputs /path/to/inputs # манифестът, байтовете и SHA-256 на всеки файл, проверките на данните
./budget reproduce --manifest /outside/new/candidate/manifest.json --originals /path/to/inputs
./budget reproduce --current https://sigma-budget.midt.bg --originals /път/до/оригиналите
./budget refetch --manifest /outside/new/candidate/manifest.json --out work/refetch
./budget collect --out work/acquisition                # сваля всичко, което регистърът може да свали; snapshot.json ги описва
./budget import-source --source kfp --file ~/Downloads/2026-EU\ funds_1026_BG_WEB.xls --out /outside/new/acquired
```

`--root` е копието на хранилището, чиито `data/` и регистри командата използва. По подразбиране е коренът на копието, от което върви кодът, независимо от текущата папка.

- **`build`** изнася един commit с `git archive`, без `.git` и без промените, които не са в него. Входовете (`data/originals`,
  `data/cache`, `data/cache/research`) се автентикират и копират само за четене в отделен Node export/scratch. Всеки вход се сверява с пина си
  (`data/originals.sha256` или `sha256` в регистъра); разлика спира сглобяването.
- **`validate`** отказва издание, в което файл липсва, не е в манифеста или има други байтове.
- **`reproduce`** първо проверява, че оригиналите от манифеста са налице и със същия SHA-256. После сглобява commit-а на манифеста и
  сравнява всеки изход. С `--current` разрешава указателя на сайта веднъж и проверява точно това издание. Изтегля и публикуваните файлове
  и ги сравнява с манифеста.
- **`refetch`** сваля оригиналите отново от точните им адреси. Резултатът за всеки е `same`, `changed`, `manual` (ръчно получен файл,
  например отчетите на МФ), `derived` (кеш, който скрипт съкращава от отговора) или `unverified` (недостъпен адрес или отговор, който не е
  очакваният вид файл). Недостъпен източник никога не е „съвпада“.

Кодовете на изход (раздел 8.3): 0 проверено и без разлики, 1 разлики, 2 невалидни данни или употреба, 3 липсващ вход или недостъпен
източник (непроверено). С `--json` всяка команда дава машинен резултат.

## Публично четене

Екраните, `/data/<file>`, `/data/releases/<id>/…` и feed-ът четат само изданието, включено в build-а. `/api/releases/current` и `/data/releases/current.json` назовават неговия `release_id`. Неизвестните файлове и `/admin/*` връщат `404`.

Статичните файлове запазват ETag, X-Release-Id, Cache-Control и CORS от release артефакта. Feed-ът използва адреса на сайта; архивираният feed запазва точните си байтове. Всички публични отговори минават през общия security слой. GET и HEAD са публични, а останалите методи връщат 405.

Публичният API и липсващите release адреси запазват rate limiter-а. Включените статични файлове се обслужват преди него. В production липсващ или повреден limiter връща 503; извън production локалната проверка може да продължи без binding.

`node tests/release/compat_check.mjs` проверява съвместимостта на кода с включените издания локално. След deploy `scripts/check-deployment.mjs` проверява идентичността на публикувания сайт. Сглобяването и production процедурата са описани в [README](../README.md) и [production-procedure.md](production-procedure.md).

Изходните файлове на текущото издание са достъпни на адресите от манифеста под `/data/releases/<id>/data/…`; `validation.json` е до манифеста. Входните файлове не се свалят от сайта: подготвят се по инструкциите в `midt-bg/sigma-budget-data` и при `reproduce --current` се подават изрично с `--originals /път/до/входовете`. Старите издания запазват само `manifest.json`, `receipt.json` и `validation.json`; техните изходи не се заменят с текущите.
