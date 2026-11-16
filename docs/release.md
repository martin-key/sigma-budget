# Закрепено издание на сайта

Сайтът чете само копието в `data/release/`, включено в build-а. Данните и обработката се поддържат в [midt-bg/sigma-budget-data](https://github.com/midt-bg/sigma-budget-data); форматът е описан в неговата [документация](https://github.com/midt-bg/sigma-budget-data/blob/main/docs/release.md). Връзката между двата проекта е форматът на изданието и JSON Schema в `schema.json`.

След merge на data PR се изпълнява `pnpm data:pull --commit <пълен-sha>` в нов клон на сайта. Командата изтегля анонимно `data/release/`, проверява го и подменя цялото копие. `data/release.lock.json` записва хранилището, пълния commit и `release_id`. Без параметър се избира текущият `main` на хранилището за данни.

`release_id` е SHA-256 на точните байтове на `releases/<id>/manifest.json`. Указателят `releases/current.json` и разписката трябва да назовават същото издание; размерът и SHA-256 на всеки изход трябва да съвпадат с манифеста. Непознат формат се отказва преди промяна на локалните данни. `pnpm data:check` прави offline проверка на заключването и изходите, без мрежа.

PR включва копието и lock файла. Merge към `main` публикува staging; след изрично одобрение таг `vX.Y.Z` публикува production. Стъпките са в [операторското ръководство](operator-guide.md).

Публичните `/data/<file>`, `/data/releases/<id>/…` и feed-ът четат включеното издание. `/api/releases/current` назовава неговия идентификатор. Неизвестни файлове и `/admin/*` връщат `404`. Старите издания запазват историческите метаданни; техните изходи не се заменят с текущите.

`node tests/release/compat_check.mjs` проверява четенето на всяко включено издание. След deploy `scripts/check-deployment.mjs` проверява идентичността на публикувания сайт. Сглобяването е описано в [README](../README.md), а публикуването - в [production процедурата](production-procedure.md).
