# Процедура за production

Кодът на „СИГМА Бюджет“ влиза в production само чрез push на таг `vX.Y.Z` върху commit от `main`, след одобрение в GitHub Environment `production`.
Workflow-ът `.github/workflows/site.yml` изпълнява всички проверки, сглобява production артефакта и чак тогава допуска deploy.
Първото пускане изисква изрично одобрение от собственика. Публикуването на данни остава отделна операторска стъпка в
[ръководството на оператора](operator-guide.md).

Всяка стъпка има отговорник и се отбелязва в таблицата на края с дата и подпис.

## 0. Преди да започнеш (раздел 12)

- [ ] Потвърден Cloudflare акаунт и делегиран домейн `sigma-budget.midt.bg` (`SITE_ORIGIN` в `apps/web/wrangler.jsonc`).
- [ ] Оригиналите на изданието, което ще бъде първо, и копие извън Cloudflare.
- [ ] Прегледани семантични съпоставки (перата на КФП срещу Приложение 3; „% от плана“ спрямо закона или проекта).

## 1. Средата е създадена; остава GitHub конфигурацията

Production ресурсите вече съществуват: D1 `sigma-budget-registry` (`acfb23bb-310f-4064-a7f7-e6bff37db43e`, с приложени миграции),
R2 `sigma-budget-objects` и Worker `sigma-budget` (placeholder до първия deploy).
В горното ниво на `apps/web/wrangler.jsonc` са попълнени D1 id-то, custom domain `sigma-budget.midt.bg`, `workers_dev: false` и
`preview_urls: false`; `production.url` в `apps/etl/environments.json` е `https://sigma-budget.midt.bg`.
Staging ресурсите също са създадени, с приложени D1 миграции. Staging (`https://sigma-budget-staging.cf-midt.workers.dev`, с `noindex`)
и production (`https://sigma-budget.midt.bg`) са публично достъпни, без Cloudflare Access gateway.

`ACCESS_ISSUER` и `ACCESS_AUD` остават празни и в двете среди; без Access операторският API `/admin/*` остава изключен и връща `503`.

Еднократно собственикът настройва в GitHub:

- GitHub Environment `production`: required reviewer и deployment tags само `v*`.
- В `production`: secrets `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`. Токенът има Editor само за Worker `sigma-budget` и Zone → Workers Routes → Write само за зоната `midt.bg`.
- Repository-level secrets `CLOUDFLARE_*` не трябва да съществуват: при липсваща стойност Environment наследява repository secret.
- Tag ruleset за `v*`, който ограничава създаването, преместването и изтриването на тези тагове до администратори.
- GitHub Environment `staging`: отделен `CLOUDFLARE_API_TOKEN` с Editor само за Worker `sigma-budget-staging`, secret `CLOUDFLARE_ACCOUNT_ID` и variable `STAGING_ORIGIN` = `https://sigma-budget-staging.cf-midt.workers.dev`.

## 2. Първо качване на кода

За commit от `main` с минал CI собственикът създава и push-ва таг `vX.Y.Z`. Всички validation jobs се изпълняват и за тага.
Production build използва горното ниво на `wrangler.jsonc`, origin `https://sigma-budget.midt.bg` и няма `--noindex`.
В `target` job-а, преди останалите проверки и преди заявката за одобрение, се проверяват форматът
`^v[0-9]+\.[0-9]+\.[0-9]+$` и дали commit-ът е ancestor на `origin/main`, с пълната Git история.
След успешен `required-validation` се изисква одобрение в `production`.
Одобряващият reviewer проверява, че tagged commit-ът е в `main`.
Deploy job-ът повтаря проверките за формат и история и отказва таг, който не е първи в `git tag -l 'v*' --sort=-v:refname`;
за умишлено връщане на кода се използва `wrangler rollback`.

Преди deploy отделна стъпка без Cloudflare secrets изпълнява
`node tests/release/compat_check.mjs --env-url https://sigma-budget.midt.bg --allow-first-deploy`.
Ако сайтът отговаря, реалното текущо издание се проверява както досега, а несъвместимост или нечетимо издание спира deploy-а.
За първото качване, когато сайтът още не работи (DNS грешка, чужд `404`, Cloudflare error code или placeholder `503` с текст
„not deployed yet“), се издава warning „first deploy: the environment does not run the site yet, nothing to check against“ и се продължава.
Това не е пропускане на проверка на съществуващо издание.

Следва `pnpm exec wrangler deploy -c apps/web/build/server/wrangler.json`. После отделна публична GET проверка на `<origin>/`
изисква `200` и `X-Release-Id`, равен на `release_id` от `data/release/releases/current.json`. Проверява се до три минути,
за да има време за DNS и custom domain сертификата; грешен адрес, липсваща заглавка или друго издание завършват с грешка.
Същата процедура се използва и за първия staging deploy. Липсващи production secrets са грешка;
за staging остават notice и пропускане на deploy. Deploy-ите за всяка среда са последователни и не прекъсват текущия deploy.
PR не публикува, а push към `main` публикува staging.

**Проверка:**

- [ ] `curl -sI https://<адрес>/` → 200, `Content-Security-Policy`, `Strict-Transport-Security`, `Cache-Control` с `no-transform`, без `X-Robots-Tag: noindex`.
- [ ] `https://<адрес>/robots.txt` позволява обхождане и назовава `sitemap.xml`; `https://<адрес>/nyama-takava` → 404.
- [ ] `https://<адрес>/admin/operations` → `503` (операторският API е изключен).
- [ ] `https://<адрес>/api/releases/current` → 404 „няма публикувано издание“ (регистърът е празен до стъпка 3).

## 3. Първото издание

Публикуването на данни е отделна операторска стъпка по [ръководството на оператора](operator-guide.md) и не се изпълнява от deploy workflow-а.
При текущите празни Access настройки операторското публикуване е недостъпно.

## 4. Следващо качване на кода

1. Избира се commit от `main` с минал CI и се създава нов таг `vX.Y.Z`.
2. Тагът се push-ва; workflow-ът изпълнява всички проверки и production build.
3. След одобрение в `production` се проверяват тагът, историята и съвместимостта с текущото издание, после се публикува кодът.
4. Изпълняват се проверките от стъпка 2. Данни се публикуват отделно по [ръководството на оператора](operator-guide.md).

## 5. Връщане назад

| Какво      | Как                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Кодът      | `pnpm exec wrangler deployments list -c apps/web/wrangler.jsonc`, после `pnpm exec wrangler rollback <version-id> -c apps/web/wrangler.jsonc` |
| Данните    | `./budget rollback --release-id <по-ранно издание> --environment production`                                                                  |
| Регистърът | D1 Time Travel или копие ([ръководството на оператора](operator-guide.md), раздел 6)                                                          |

## 6. Наблюдение

`observability` е включено в `apps/web/wrangler.jsonc` без логове на заявките (`invocation_logs: false`): те биха пазили заглавките на всяка заявка, с IP адреса на посетителя, до 7 дни, а политиката за поверителност казва, че сайтът не пази IP адреси. В Cloudflare се виждат грешките и редовете, които Worker-ът записва сам, без лични данни. Седмично: `./budget status --environment production`,
копие на регистъра, и `budget refetch --manifest` на текущото издание срещу официалните адреси.

## Подписи

| Стъпка                   | Отговорник | Дата | Подпис |
| ------------------------ | ---------- | ---- | ------ |
| 0. Предварителни условия |            |      |        |
| 1. Средата               |            |      |        |
| 2. Кодът                 |            |      |        |
| 3. Първото издание       |            |      |        |

Всички команди тук се изпълняват от корена на хранилището. Конфигурацията за собствен акаунт е `apps/web/wrangler.local.jsonc`, до `apps/web/wrangler.jsonc`, така че относителните `main` и `migrations_dir` запазват значението си. За нея се използва `-c apps/web/wrangler.local.jsonc`, а при сглобяване - `WRANGLER_CONFIG=apps/web/wrangler.local.jsonc`. Vite разрешава тази променлива спрямо корена на хранилището. Deploy на сглобен сайт използва `-c apps/web/build/server/wrangler.json`.
