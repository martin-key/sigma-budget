# Процедура за production

Как „Бюджет на светло“ влиза в production и как се качва нова версия на кода там. Спецификацията (раздел 11, етап E) иска процедурата да
е описана и проверена на staging, а не изпълнена: първото пускане решава екипът. CI никога не качва production
(`.github/workflows/site.yml`). Публикуването на данни е в [ръководството на оператора](operator-guide.md).

Всяка стъпка има отговорник и се отбелязва в таблицата на края с дата и подпис.

## 0. Преди да започнеш (раздел 12)

- [ ] Потвърдени домейн и Cloudflare акаунт; адресът става `SITE_ORIGIN` в `wrangler.jsonc` (днес `https://sigma-budget.my-data.bg`, непотвърден).
- [ ] Списък на операторите и техните входове в Zero Trust (метод за вход: Cloudflare или One-time PIN).
- [ ] Оригиналите на изданието, което ще бъде първо, и копие извън Cloudflare.
- [ ] Прегледани семантични съпоставки (перата на КФП срещу Приложение 3; „% от плана“ спрямо закона или проекта).
- [ ] Лиценз на данните и `FEEDBACK_EMAIL`.
- [ ] Изданието е публикувано на staging и `./budget reproduce --current <staging>` дава „reproduced byte for byte“.

## 1. Създаване на средата (веднъж)

```bash
npx wrangler d1 create sigma-budget-registry                 # id-то → wrangler.jsonc, горното ниво (d1_databases)
npx wrangler r2 bucket create sigma-budget-objects
npx wrangler d1 migrations apply DB --remote
```

- [ ] В `wrangler.jsonc`, горното ниво: `routes` с адреса като custom domain, `workers_dev: false`, `preview_urls: false` (Access пази
      единствената врата към `/admin/*`), `SITE_ORIGIN`, `FEEDBACK_EMAIL`, `SIGMA_URL`, `NOINDEX` празно.
- [ ] Access: self-hosted приложение за `<адрес>/admin/*` с Allow политика за операторите; `ACCESS_ISSUER` (`https://<team>.cloudflareaccess.com`)
      и `ACCESS_AUD` (Application Audience tag) в `wrangler.jsonc`.
- [ ] `tools/environments.json`: `production.url` е адресът.

## 2. Първо качване на кода

От commit в `main`, за който CI е минал:

```bash
git switch --detach <commit> && npm ci
PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers .venv/bin/python tools/site/build.py --origin https://<адрес>   # build/ с проверка на всеки екран
python3 tools/compat_check.py
npx wrangler deploy -c build/server/wrangler.json
npx wrangler secret put OPERATORS                            # след deploy-а: таен ключ не може да носи името на променлива (код 10053)
```

**Проверка:**

- [ ] `curl -sI https://<адрес>/` → 200, `Content-Security-Policy`, `Strict-Transport-Security`, `Cache-Control` с `no-transform`, без `X-Robots-Tag: noindex`.
- [ ] `https://<адрес>/robots.txt` позволява обхождане и назовава `sitemap.xml`; `https://<адрес>/nyama-takava` → 404.
- [ ] `https://<адрес>/admin/operations` → пренасочване към входа на Access.
- [ ] `https://<адрес>/api/releases/current` → 404 „няма публикувано издание“ (регистърът е празен до стъпка 3).

## 3. Първото издание

Същото издание, което е минало през staging (същото `release_id`):

```bash
cloudflared access login https://<адрес>/admin/operations
./budget publish --release work/candidate --environment production
./budget status --environment production
./budget reproduce --current https://<адрес>
```

- [ ] `status` показва изданието на ревизия 1.
- [ ] Екраните показват данните на изданието (`X-Release-Id` в заглавките на страница е същото `release_id`).
- [ ] `reproduce --current` → „reproduced byte for byte“.

## 4. Следващо качване на кода

1. CI е минал на commit-а в `main`.
2. `python3 tools/compat_check.py --env-url https://<адрес>`: новият код чете текущото издание на production.
3. `tools/site/build.py --origin https://<адрес>`, после `npx wrangler deploy -c build/server/wrangler.json`.
4. Проверката от стъпка 2.

## 5. Връщане назад

| Какво | Как |
|---|---|
| Кодът | `npx wrangler deployments list`, после `npx wrangler rollback <version-id>` |
| Данните | `./budget rollback --release-id <по-ранно издание> --environment production` |
| Регистърът | D1 Time Travel или копие ([ръководството на оператора](operator-guide.md), раздел 6) |

## 6. Наблюдение

`observability` е включено в `wrangler.jsonc`: заявките и грешките на Worker-а се виждат в Cloudflare. Седмично: `./budget status`,
копие на регистъра, и `budget refetch --manifest` на текущото издание срещу официалните адреси.

## Подписи

| Стъпка | Отговорник | Дата | Подпис |
|---|---|---|---|
| 0. Предварителни условия | | | |
| 1. Средата | | | |
| 2. Кодът | | | |
| 3. Първото издание | | | |
