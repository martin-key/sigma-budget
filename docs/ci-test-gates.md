# CI проверки и покритие

`site.yml` проверява само сайта и включеното издание. Job `build` изпълнява формат, TypeScript, offline `pnpm data:check`, съвместимостта на всички включени издания и `build:release`. Не се свалят оригинали и не се изпълнява обработка на данни.

`coverage` изпълнява web тестовете веднъж с `pnpm test -- --coverage`, после `pnpm check:coverage`. Базата за `apps/web` остава lines 48.19% и branches 41.43%, с толеранс 0.5 процентни пункта. Всички четири отчетни метрики трябва да са валидни. Обхватът включва app, client, workers, service worker, candidate adapter и release-artifact. Изключени са тестове, декларации и fixtures. Отчетите се качват като CI артефакт.

`node scripts/check-coverage.mjs --check-base` сравнява с целевия клон за PR и с предишната обща ревизия за push. Премахнат workspace не е регресия само ако вече не присъства в дървото. Намаление на съществуваща база изисква валидно, ограничено по workspace и метрика изключение в `coverage-exceptions.json`. `--update` може само да повишава базата след успешни пълни отчети.

`check` използва сглобения Worker и закрепения Chromium за всички Playwright проверки. Покриват се екрани, достъпност, контраст, навигация, споделяне, CSV, ранно зареждане, периоди, сигурност, калкулатор, приемни числа и движение. Проектите са `--project=worker` и `--project=static`. Браузърните тестове са във format и TypeScript проверките, извън производствените V8 прагове. При отказ се качват traces и screenshots преди следваща команда да ги изчисти. Chromium се инсталира чрез `scripts/ci-install-browser.sh`, с проверено повторение при временна грешка.

`release` проверява локалната съвместимост и логиката на проверката след deploy. `security` запазва Semgrep, gitleaks и dependency audit. Reusable workflow се извиква за PR към main; другите PR targets имат собствен trigger без дублиране.

`required-validation` изчаква target, security, coverage, build, check и release с `always()` и приема само `success`. Deploy изчаква тази бариера. След публикуване `scripts/check-deployment.mjs` сверява идентичността на сайта. Production изисква изрично одобрение. Този код не променя branch protection или настройките на средите.

Проверките на оригинали, регистри, читатели, независимо валидиране, възпроизводимост, freshness и source drift са в [хранилището за данни](https://github.com/midt-bg/sigma-budget-data). Новото издание се приема чрез [операторската процедура](operator-guide.md).
