# Процедура за production

Кодът на „СИГМА Бюджет“ влиза в production само чрез push на таг `vX.Y.Z` върху commit от `main`, след одобрение в GitHub Environment `production`.
Workflow-ът `.github/workflows/site.yml` изпълнява всички проверки, сглобява production артефакта и чак тогава допуска deploy.
Първото пускане изисква изрично одобрение от собственика. Данните се включват в build-а по [процедурата за издание](operator-guide.md).

Всяка стъпка има отговорник и се отбелязва в таблицата на края с дата и подпис.

## 0. Преди да започнеш (раздел 12)

- [ ] Потвърден Cloudflare акаунт и делегиран домейн `sigma-budget.midt.bg` (`SITE_ORIGIN` в `apps/web/wrangler.jsonc`).
- [ ] Оригиналите на изданието, което ще бъде първо, и копие извън Cloudflare.
- [ ] Прегледани семантични съпоставки (перата на КФП срещу Приложение 3; „% от плана“ спрямо закона или проекта).

## 1. Средата е създадена; остава GitHub конфигурацията

Production използва Worker `sigma-budget`, custom domain `sigma-budget.midt.bg`, `workers_dev: false` и `preview_urls: false` от горното ниво на `apps/web/wrangler.jsonc`. Staging използва `https://sigma-budget-staging.cf-midt.workers.dev` с `noindex`. Данните се обслужват от build-а. Съществуващите D1 и R2 ресурси не се променят с тази процедура; собственикът решава отделно за тях.

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

Преди deploy се проверяват локално кодът и включените издания с `node tests/release/compat_check.mjs`.

Следва `pnpm exec wrangler deploy -c apps/web/build/server/wrangler.json`. После отделна публична GET проверка на `<origin>/`
изисква `200` и `X-Release-Id`, равен на `release_id` от `data/release/releases/current.json`. Проверява се до три минути,
за да има време за DNS и custom domain сертификата; грешен адрес, липсваща заглавка или друго издание завършват с грешка.
Същата процедура се използва и за първия staging deploy. Липсващи production secrets са грешка;
за staging остават notice и пропускане на deploy. Deploy-ите за всяка среда са последователни и не прекъсват текущия deploy.
PR не публикува, а push към `main` публикува staging.

**Проверка:**

- [ ] `curl -sI https://<адрес>/` → 200, `Content-Security-Policy`, `Strict-Transport-Security`, `Cache-Control` с `no-transform`, без `X-Robots-Tag: noindex`.
- [ ] `https://<адрес>/robots.txt` позволява обхождане и назовава `sitemap.xml`; `https://<адрес>/nyama-takava` → 404.
- [ ] `https://<адрес>/admin/operations` → `404`.
- [ ] `https://<адрес>/api/releases/current` → 200 с `release_id` от `data/release/releases/current.json`.

## 3. Първото издание

Първото издание е включеното в build-а `data/release/`, заедно с `releases/`. Не е нужна допълнителна стъпка след deploy.

## 4. Следващо качване на кода

1. Избира се commit от `main` с минал CI и се създава нов таг `vX.Y.Z`.
2. Тагът се push-ва; workflow-ът изпълнява всички проверки и production build.
3. След одобрение в `production` се проверяват тагът, историята и съвместимостта с включеното издание, после се публикува кодът.
4. Изпълняват се проверките от стъпка 2. Новите данни се включват чрез PR по [процедурата за издание](operator-guide.md).

## 5. Връщане назад

Кодът и данните се връщат заедно чрез `pnpm exec wrangler rollback <version-id> -c apps/web/wrangler.jsonc` след изрично одобрение. За промяна само на данните се подготвя PR с провереното копие на изданието.

## 6. Наблюдение

`observability` е включено в `apps/web/wrangler.jsonc`: заявките и грешките на Worker-а се виждат в Cloudflare. Публичният `/api/releases/current` показва включеното издание. `budget refetch --manifest` сравнява оригиналите с официалните адреси.

## Подписи

| Стъпка                   | Отговорник | Дата | Подпис |
| ------------------------ | ---------- | ---- | ------ |
| 0. Предварителни условия |            |      |        |
| 1. Средата               |            |      |        |
| 2. Кодът                 |            |      |        |
| 3. Първото издание       |            |      |        |

Всички команди тук се изпълняват от корена на хранилището. Конфигурацията за собствен акаунт е `apps/web/wrangler.local.jsonc`, до `apps/web/wrangler.jsonc`, така че относителните `main` запазват значението си. За нея се използва `-c apps/web/wrangler.local.jsonc`, а при сглобяване - `WRANGLER_CONFIG=apps/web/wrangler.local.jsonc`. Vite разрешава тази променлива спрямо корена на хранилището. Deploy на сглобен сайт използва `-c apps/web/build/server/wrangler.json`.
