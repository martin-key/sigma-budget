# TypeScript release оператор

Node 24 клиентът използва съществуващите маршрути в `apps/web/workers/api/` и същия `budget-release/1` пакет. Няма нов backend или регистър. Общият `budget`/`budget-ts` dispatch остава за последващата интеграция; този модул вече има самостоятелен вход.

```sh
pnpm --filter @sigma-budget/etl... build
node apps/etl/dist/release-operator.js --help
node apps/etl/dist/release-operator.js preflight \
  --environment dev --url https://YOUR-DEV-ORIGIN \
  --release work/candidate --originals /path/to/source-root --json
node apps/etl/dist/release-operator.js status \
  --environment dev --url https://YOUR-DEV-ORIGIN --json
node apps/etl/dist/release-operator.js upload \
  --environment dev --url https://YOUR-DEV-ORIGIN \
  --release work/candidate --originals /path/to/source-root --yes --json
node apps/etl/dist/release-operator.js publish \
  --environment dev --url https://YOUR-DEV-ORIGIN \
  --release work/candidate --originals /path/to/source-root \
  --expected-revision 3 --yes --json
node apps/etl/dist/release-operator.js rollback \
  --environment dev --url https://YOUR-DEV-ORIGIN \
  --release-id SHA256 --expected-revision 4 --yes --json
```

Това са примери за операторска употреба, не изпълнени remote операции. Средата и origin-ът са изрични. HTTPS е задължителен освен за loopback. URL с потребител, парола, path, query или fragment се отказва. Всички admin и public заявки остават на един origin; redirects не се следват. `--dry-run` прави само preflight и публично четене на ревизията, без credentials, receipts или записи на сървъра. `preflight` е изцяло offline.

## Защитени входове

Операторът подава `BUDGET_ACCESS_TOKEN` или двойката `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` чрез защитената среда на процеса. Това са Cloudflare Access identity/service credentials. `CLOUDFLARE_API_TOKEN` за акаунта не се използва. Клиентът не отваря `.env`, `.dev.vars`, local environment registry, home auth или cloudflared. Няма credential флагове; тайни не трябва да се поставят в аргументи на процеса.

Персоналният Access token се изпраща като `Cf-Access-Token` и `Cf-Access-Jwt-Assertion`; service двойката се изпраща само в съответните Access headers. Edge-ът трябва да валидира service token и да предаде подписаното assertion към Worker-а. Worker-ът сам проверява подпис, issuer, audience, срок и operator membership. Account membership не дава операторско право. Public readback не получава credential headers.

## API и договор за интеграция

```ts
import {
  ReleaseClient,
  preflightRelease,
  credentialsFromEnvironment,
} from '@sigma-budget/ingest/release-client';

const client = new ReleaseClient({
  environment: { name: resolvedName, url: resolvedOrigin },
  receiptDirectory: protectedReceiptDirectory,
  credentials: (environment) => providedAccessIdentity(environment),
  // transport: injectedHttpTransport,
  // maxObjectBytes: 67108864, // само ако целевата среда действително е настроена така
});
await client.status();
await client.upload({ release, originals });
await client.publish({ release, originals, expectedRevision });
await client.rollback({ releaseId, expectedRevision });
await client.readBack(releaseId, appliedRevision);
await preflightRelease({ release, originals, maxObjectBytes });
```

`originals` е коренът, под който лежат всички manifest input paths, включително `data/cache` и `data/inputs`, а не само `data/originals`. `preflightRelease` проверява всички входове и изходи, canonical manifest bytes, build receipt identity, успешен validation report и точното файлово съдържание на candidate пакета. Отказва symlink, hardlink, специални файлове, опасни/повторени paths, неподдържан execution schema, различен размер/SHA-256 и непосочени файлове. Файловете се отварят с `O_NOFOLLOW`; проверяват се inode, размер и време на промяна. SHA-256 се пресмята потоково; преди PUT обектът се проверява отново. Числената валидация е работа на build/validate производителя; клиентът проверява записания успешен отчет и неговите байтове.

Отделният `releaseOperatorCli(args, dependencies)` в `apps/etl/src/release-operator.ts` връща exit code и приема инжектирани environment resolver, credential map, client factory и stdout. Родителският dispatch може да подаде вече разрешена среда от съществуващия registry; противоречив `--url` се отказва. Импортирането на модула не изпълнява команда и не чете process credentials. Acquisition команди не са част от този модул.

`HttpTransport` получава method, URL, headers, body, timeout и максимален размер на отговора. Тестовият транспорт трябва да пази същия отказ на redirects и да не логва headers/body. Производственият `nodeHttpTransport` ограничава декодираните response bytes и timeout-а. Credentials се добавят само към `/admin/*`. Грешките и резултатите използват избрани протоколни полета; произволни server/provider/network съобщения не се отразяват в stdout или receipt.

## Прекъсване, повторение и ревизии

Receipts по подразбиране са в `work/ts-operator-receipts`, отделно от build receipt-а. Името включва SHA-256 на environment name + origin и release ID. Съдържанието също проверява тази самоличност. Директорията трябва да е операторски контролирана, отделна от candidate и source `data/`. Старите Python receipts не се преизползват автоматично.

Записът е временен файл с mode `0600`, `fsync`, atomic rename и directory `fsync`. Един процес държи directory lock за конкретния environment/release. Lock-ът се освобождава във `finally`. След принудително прекратен процес оставащият `.json.lock` трябва да се отстрани ръчно само след проверка, че процесът е спрял; клиентът не гадае дали lock е стар.

Сървърът задава operation ID. Веднъж получен, той се пази и следващ upload чете `needed`, изпраща само липсващите обекти и seal-ва същата операция. Повторни PUT/seal и GET имат до три опита (конфигурируемо 1–5), с ограничено изчакване. Ако отговорът на първия `POST /admin/operations` се изгуби, backend-ът няма creation idempotency key или lookup по клиентски ID: клиентът връща exit 6 и предупреждава за възможна неидентифицирана отворена операция. Не повтаря този POST автоматично. Нова операторска команда може да започне нова операция; това е реална граница на съществуващия протокол и неговия лимит за отворени операции.

Обект, по-голям от `part_bytes` на операцията (16 MiB), клиентът изпраща на части: `POST …/objects/:sha256/parts`, по един `PUT …/parts/:n` за всяка част и `POST …/parts/complete` с техните `etag`. Сървърът хешира събрания обект, преди той да получи ключа си. Прекъснато качване на части започва отначало при следващия upload; незавършените части R2 трие след 7 дни. Сървър без `part_bytes` получава всеки обект с един `PUT`.

Publish intent се записва **преди upload и POST**, с фиксирани request ID, вид операция и expected revision. При повторение първо се проверява primary journal маршрутът `/admin/requests/:id`. Изгубен publish отговор се възстановява от същия маршрут; ако няма потвърждение, exit 6 пази същия intent за следващото изпълнение. POST не се повтаря автоматично с нов ID или нова ревизия. След конфликт се изисква операторът да провери status и да подаде изрично нов `--expected-revision`.

Успех означава съвпадение на journal response с intent, public pointer с приложената ревизия, exact manifest SHA-256 и размер/SHA-256 на един data output. Чете се release-specific path, а не mutable `/data/<file>`. Pointer-ът се проверява отново след download. При грешен readback приложената заявка се запазва; повторението прави readback без втори publish. Rollback използва същия CAS/request протокол; сървърът допуска само издание, което вече е било текущо. Конкурентна публикация след успешната промяна дава unconfirmed readback, не фалшиво потвърждение и не автоматично презаписване.

Exit codes: `0` успех, `2` невалиден пакет/употреба/протокол, `3` липсващ локален файл или недостъпен транспорт, `4` Access identity, `5` конфликт, `6` непотвърден резултат. След exit 6 се запазват същите receipts и аргументи за повторението.

## Локална проверка и реалният архив

Нормалните Vitest тестове изпълняват съществуващите Worker JS модули и SQL migration в временни Miniflare/workerd D1/R2. Използват случаен loopback порт, генерирани RSA/JWT identities и забранен outbound fetch; всички ресурси се освобождават. Покрити са resumption, replay, изгубени отговори, CAS, rollback, грешни upload/readback hashes, променен source, unsafe package/receipt paths и отделяне на средите.

```sh
pnpm --filter @sigma-budget/ingest exec vitest run src/release-client
pnpm --filter @sigma-budget/etl exec vitest run src/release-operator.test.ts

# Допълнително реално локално приемане; без credentials:
BUDGET_OPERATOR_CANDIDATE=/path/to/accepted-candidate \
BUDGET_OPERATOR_ORIGINALS=/path/to/source-root \
BUDGET_OPERATOR_REPORT=/tmp/operator-archive-report.json \
pnpm --filter @sigma-budget/ingest exec vitest run src/release-client/archive.test.ts
```

На 2026-11-10 приетият candidate `f6e78e74fba37602840310934821f4a6d95872a0d19af2512ba4763fefe5ca0b` премина пълна offline проверка: manifest 81 852 bytes, 119 inputs, 70 outputs, 190 уникални обекта с manifest-а. Default 50 MiB отказва `data/originals/parliament/52-602-01-19.zip` с неговите 63 488 595 bytes. Отделен локален Worker с default 50 MiB върна HTTP 422 преди създаване на операция, въпреки client allowance 64 MiB. Само следващият локален тест зададе `MAX_OBJECT_BYTES=67108864` и същия client limit. Не е променен глобалният Worker default. От 13.11.2026 Worker-ът по подразбиране приема обекти до 256 MiB и качва по-големите от 16 MiB на части ([release.md](release.md), „Размери“), така че архивът минава и без `MAX_OBJECT_BYTES`.

Реалните ZIP bytes бяха копирани в собствена временна директория и качени като input на малък тестов release. Upload, seal, final R2 read и public readback преминаха с SHA-256 `59efdf6503c8ea92c033c73b48a8b20d817d61711f8e8dfe5d37587253fe35d8`. Архивният протоколен тест отне 10 787 ms; Node process peak RSS беше 666 260 KiB. Това е локална функционална проверка на реалния архив с pinned Miniflare/workerd, не измерване на deployed Worker memory/CPU или цялостен full-registry upload. Workerd RSS не е измерен отделно. Реални Cloudflare auth, account API, deploy, upload, publish и recovery не са изпълнявани.
