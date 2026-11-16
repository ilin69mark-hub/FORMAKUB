# PRODUCTION READINESS — Managed Rules / Rules Snapshot (CA-T-511 / NEW-N4)

**Дата:** 2026-11-13
**Режим:** READ-ONLY. Код, тесты, seed, production collections, значения норм и `source` не изменялись; публикация и перерасчёт не выполнялись.

> **Обновление 2026-11-13 (NEW-N4):** раздел 11 отражает фактическую реализацию D-7–D-11. Блокеры B2 (seed-механизм) и F4 (publication audit recovery) закрыты технически; source норм переведён в `preliminary` (D-8). CA-T-511 остаётся BLOCKED внешними условиями (подтверждение норм, production provisioning/runbook execution). Разделы 1–10 сохранены как исходный аудит.
**Проверено:** targeted/full тесты, typecheck, lint; read-only SQLite-запрос коллекций; чтение кода/документации.

---

## 1. Executive Summary

**Инфраструктура хранения и серверная защита публикации готовы; production-публикация Managed Rules — НЕ готова.**

Ключевые факты:

1. **Production collections пусты** (`rules-snapshots.json`, `managed-rules.json` отсутствуют в `data/formakub.db` — read-only проверка). Это ожидаемо и безопасно: create/preview fail-closed, чтение проектов работает.
2. **Нет production seed и нет механизма создания требуемых 27 правил с детерминированными id.** `createManagedRule` генерирует `rule-<random12>` (`managed-rules.ts:487`), а Engine ищет конкретные id `rule-wardrobe-hinge-band-*` / `rule-wardrobe-facade-density-*` (`wardrobe-hinges.ts`). Через текущий API/UI требуемый первый снимок создать **невозможно**.
3. **`source=owner_confirmed` для 27 норм не подтверждён** документом; исходно значения описывались как предварительные. Публикация с этим source без подтверждения владельца недопустима.
4. **Production gate реализован** (`managed-rules.ts:468–476`): `NODE_ENV=production` без `FORMAKUB_RULES_PUBLICATION_ENABLED=1` → отказ. Gate — в сервисе, UI обойти не может. Но gate зависит от корректности `NODE_ENV`; флаг отсутствует в `.env.example`/compose/чек-листе.
5. **Нет runbook и тестов** для первого seed/publish, production gate в production-окружении, восстановления публикации после сбоя аудита.
6. **Публикация неатомарна**: снимок → статусы правил → аудит; при сбое аудита снимок остаётся, повтор возвращает replay и **не дописывает аудит** (`managed-rules.ts:920–975`). Риск отсутствия аудита публикации.

**Итог:** CA-T-511 остаётся **BLOCKED** для production publication. NEW-N4 (production seed) — **BLOCKED** до решения по механизму создания правил с требуемыми id и подтверждению `source`.

---

## 2. Матрица проверок

### A. Production provisioning

| # | Требование | Статус | Факт / ссылка | Риск | Действия | Блокирует публикацию |
|---|---|---|---|---|---|---|
| A1 | Создание пустого production-хранилища | **READY** | SQLite открывается и создаёт `collection_state` при первом обращении (`sqlite-storage.ts`, `db()`); отсутствующая коллекция = `missing` (`readStatus`) | — | — | Нет |
| A2 | Обязательные каталоги/права/env | **READY WITH CONDITIONS** | `FORMAKUB_DATA_DIR` (writable), production → SQLite обязателен (`storage/index.ts: resolveStorageKind`); auth/backup env — `PRODUCTION_CUTOVER_CHECKLIST.md` | Неописанный `FORMAKUB_RULES_PUBLICATION_ENABLED`; ошибка прав = 500 | Добавить env в `.env.example`/compose/preflight/чек-лист | Нет (для провижининга) |
| A3 | Повторяемость без потери данных | **READY** | `applyBootstrap` идемпотентен (существующие коллекции не перезаписываются; повторный apply — no-op); rules-коллекций bootstrap не касается | Нет seed правил | — | Нет |
| A4 | Отсутствие/пустые/повреждённые/частичные коллекции | **READY WITH CONDITIONS** | missing → `none` → `RULES_SNAPSHOT_MISSING`; corrupt → `RULES_SNAPSHOT_CORRUPT`; частичный снимок без 27 норм → fail-closed (`wardrobeHingeNormsFromRules`); corrupt `managed-rules.json` → ошибка admin-чтения/публикации | Один повреждённый снимок блокирует все новые расчёты (fail-closed by design) | Диагностика уже показывает статус/причину (NEW-N2) | Нет |
| A5 | Исключён dev/test seed в production | **READY** | `rules-test-fixture.ts` импортируется только тестами (grep: вне `*.test.*` — нет); bootstrap правил не создаёт | — | — | Нет |
| A6 | Production не откатывается на JSON незаметно | **READY WITH CONDITIONS** | `resolveStorageKind`: production + `FORMAKUB_STORAGE≠sqlite` → ошибка запуска | Если `NODE_ENV` не `production`, защита не действует | Проверять `NODE_ENV` в preflight; рассмотреть явный `FORMAKUB_ENV` | Нет |

### B. Production seed и исходные данные

| # | Требование | Статус | Факт / ссылка | Риск | Действия | Блокирует публикацию |
|---|---|---|---|---|---|---|
| B1 | Перечень обязательных правил | **READY** | 27 id: 3 density + 8×3 band (`wardrobeRequiredRuleIds()`; `wardrobe-hinges.ts`) | — | — | Нет |
| B2 | Начальный набор seed и путь в production | **BLOCKED** | Seed-файла/импортёра нет; `bootstrap.ts`/`import.ts` Managed Rules не создают; `createManagedRule` не принимает `id` и генерирует случайный (`managed-rules.ts:481–487`); API-схема `id` запрещает | **Нельзя создать требуемые id через API/UI** → Engine fail-closed на любом созданном снимке | Реализовать seed/import с детерминированными id (NEW-N4) или согласовать явное создание по id | **ДА** |
| B3 | Полнота и корректность 27 значений | **READY WITH CONDITIONS** | Тестовая фикстура генерирует 27 из кодовых констант; parity-тест; Engine-тест fail-closed; значения не менялись | Значения не подтверждены владельцем (B4) | — | Нет (технически), но B4 — да |
| B4 | `source` норм | **NEEDS OWNER DECISION** | Фикстура/план используют `owner_confirmed`; исходный код описывал нормы как предварительные до паспортов петель; документа-подтверждения нет; ADR §11.6 фиксирует вопрос | Ложное подтверждение; `preliminary` исключается из расчёта (Q7-06) | Владелец подтверждает значения/документ либо меняет source (решение) | **ДА** |
| B5 | Дубли Managed Rules ↔ AdminParameter | **READY** | `wardrobe.hingeBand.*`/`wardrobe.density*` удалены из `parameter-seed.ts`; grep пуст | — | — | Нет |
| B6 | Согласованность seed/схем/Engine | **READY WITH CONDITIONS** | Валидаторы/Engine согласованы (тесты); но seed-механизм отсутствует (B2) | Рассинхрон id | Входит в NEW-N4 | **ДА** (через B2) |

### C. Безопасность публикации

| # | Требование | Статус | Факт / ссылка | Риск | Действия | Блокирует публикацию |
|---|---|---|---|---|---|---|
| C1 | Серверный gate на всех путях | **READY** | `rulesPublicationBlocked` вызывается в `publishRulesSnapshot`; единственный HTTP-путь — `/api/admin/rules/publish` → сервис; UI использует API | — | — | Нет |
| C2 | Отсутствующая/некорректная/разрешающая env | **READY WITH CONDITIONS** | `NODE_ENV=production` + unset/≠`"1"` → blocked; `"1"` → allowed; вне production → allowed (`managed-rules.ts:468–476`, тест pure function) | Gate опирается только на `NODE_ENV`; при неверном `NODE_ENV` возможен обход | Явный production-флаг/проверка в preflight и startup | Нет (при корректном env) |
| C3 | UI не обходит gate | **READY** | UI вызывает API; прямых импортов сервиса публикации в клиент нет | — | — | Нет |
| C4 | Permissions/audit/ошибки | **READY WITH CONDITIONS** | API: `price.publish`, `guardAdminMutation`; аудит `rule.publish` после снимка; повтор (replay) аудит не пишет | **Сбой аудита → снимок без аудита; повтор не исправляет** | Добавить публикационный журнал/починку аудита; тест сбоя | Да (аудит-целостность) |
| C5 | Обычный запуск не включает публикацию | **READY** | Флаг нигде не устанавливается по умолчанию (`.env.example` не содержит) | — | — | Нет |
| C6 | Dev/test не создают production-обход | **READY WITH CONDITIONS** | Вне production публикация разрешена; никакой связи с production DB нет при корректном окружении | Запуск production-данных с `NODE_ENV≠production` | Проверка environment в preflight/health | Нет |

### D. Начальная публикация (процедура)

| # | Шаг | Статус | Комментарий |
|---|---|---|---|
| D1 | Подготовка collections | READY | Создаются адаптером автоматически. |
| D2 | Проверка seed/происхождения | **BLOCKED / NEEDS OWNER** | B2/B4. |
| D3 | Создание 27 draft-правил | **BLOCKED** | API не позволяет задать id. |
| D4 | Проверка обязательных правил/условий | READY | Публикация валидирует; диагностика показывает missing. |
| D5 | Явный выбор draft | READY | API/UI. |
| D6 | Публикация первого snapshot | READY WITH CONDITIONS | После B2–B4; gate должен быть явно разрешён. |
| D7 | Проверка contentHash/состава | READY | `contentHash` + resolver. |
| D8 | Разрешение Engine | READY | Fail-closed/тесты. |
| D9 | Fail-closed при некорректном snapshot | READY | `RULES_SNAPSHOT_*`. |

**Вывод:** безопасная процедура технически возможна, но **не выполнима текущими средствами** из-за D2/D3.

### E. Старые проекты и совместимость

| # | Требование | Статус | Факт |
|---|---|---|---|
| E1 | Проект с закреплённым snapshot | READY | `data-resolver.ts` recalc использует `StoredProject.rulesSnapshotId`; тест pinned/active. |
| E2 | Legacy без snapshot | READY | `RULES_SNAPSHOT_MISSING`, чтение разрешено (тесты). |
| E3 | Чтение старых проектов/PriceSnapshot | READY | `getProject` не зависит от rules; тесты. |
| E4 | Provisioning/публикация не назначают snapshot | READY | Автоназначения нет; тесты/код. |
| E5 | Нет автоперерасчёта | READY | Публикация не вызывает пересчёт. |
| E6 | Active не меняет закреплённые | READY | Тест data-resolver. |

### F. Backup, recovery, эксплуатация

| # | Требование | Статус | Факт / риск |
|---|---|---|---|
| F1 | Backup включает rules collections | **READY** | SQLite backup — вся БД (`backup.ts`, `runScheduledBackup`), rules внутри. |
| F2 | Restore | READY WITH CONDITIONS | `restore-database` + restore-drill; production drill не выполнен (внешнее). |
| F3 | Recovery незавершённых переходов | READY WITH CONDITIONS | Журнал + `recoverPendingRulesTransitions()`; запускается только при следующей операции, фонового recovery нет. |
| F4 | Recovery публикации | **BLOCKED (пробел)** | Нет журнала/починки аудита; replay не пишет аудит (`managed-rules.ts`). |
| F5 | Runbook для правил | **BLOCKED** | `PRODUCTION_CUTOVER_CHECKLIST.md` не содержит правил/снимков/флага; `.env.example` — без флага. |
| F6 | Риск потери данных | READY WITH CONDITIONS | Снимки/правила в БД → backup; потеря/повреждение → fail-closed, восстановление из backup; политика retention 48/30/12. |

---

## 3. Production blockers (сводно)

1. **Нет механизма создания 27 правил с требуемыми id** → первый валидный snapshot невозможно опубликовать через API/UI (B2).
2. **`source=owner_confirmed` не подтверждён** → публикация норм без подтверждения владельца недопустима (B4).
3. **Нет runbook первого seed/publish и production-проверки gate**; флаг отсутствует в `.env.example`/compose/preflight (F5/C2).
4. **Публикация не имеет recovery/починки аудита**; сбой аудита оставляет снимок без записи, повтор не исправляет (C4/F4).
5. **Gate зависит от `NODE_ENV`**; при неверном окружении возможен обход (C2/C6).
6. **NEW-N4 не зарегистрирован** в backlog/плане (отсутствует как задача).

Не блокируют: отсутствие collections (создаются автоматически), пустые/повреждённые коллекции (fail-closed), backup (БД целиком), старые проекты (совместимость подтверждена).

---

## 4. Вопросы владельцу

1. **Подтверждение 27 норм:** какие документы/паспорта подтверждают полосы петель и плотности; допустим ли `source=owner_confirmed`? Варианты: (а) подтвердить значения и оставить owner_confirmed; (б) `preliminary` (исключаются из расчёта → публикация бессмысленна); (в) отложить публикацию.
2. **Механизм seed:** (а) импорт правил с детерминированными id (новый сервис/скрипт, паттерн CA-T-208); (б) разрешить создание правила с заданным id через API (изменение контракта/прав); (в) одноразовый контролируемый seed в составе provisioning. Рекомендация: (а).
3. **Gate:** достаточно ли `NODE_ENV=production` + флаг, или требуется явный `FORMAKUB_ENV=production`/проверка в preflight и startup? Рекомендация: усилить проверку.
4. **Аудит публикации:** обязателен ли строгий инвариант «снимок ⇒ аудит»; если да — нужен журнал/починка (возможно в рамках NEW-N4), NEW-N3 не обязателен.
5. **Recovery переходов:** нужен ли фоновый recovery журнала (сейчас только при следующей операции)?

---

## 5. Необходимые изменения (не выполнять сейчас)

| Область | Изменение |
|---|---|
| Код/seed | Механизм импорта/seed Managed Rules с детерминированными id (NEW-N4); тест полноты 27 правил. |
| Код | Публикационный журнал/recovery или починка аудита при replay; тест сбоя аудита. |
| Код/конфиг | Явная production-проверка окружения; `FORMAKUB_RULES_PUBLICATION_ENABLED` в `.env.example`, compose, preflight; интеграционный тест блокировки в production-режиме. |
| Документация | Runbook: seed → publish → verify; backup/restore rules; регистрация NEW-N4; обновление cutover checklist. |
| Тесты | Production gate (env=production), seed completeness, publish audit failure/recovery, restore с rules collections. |

---

## 6. Предлагаемая последовательность (после решений владельца)

1. **Решение B4** (source/подтверждение) → 2. **Решение B2** (механизм seed) → 3. NEW-N4: seed с id + тест → 4. Публикационный аудит/recovery (если требуется) → 5. Усиление gate/preflight → 6. Runbook + тесты → 7. Первый publish в staging → 8. Production publish после CA-T-511.

Зависимости: B4 и B2 блокируют 3; gate-усиление независимо; NEW-N3 не требуется для запуска (см. §7).

---

## 7. Нужна ли NEW-N3 для CA-T-511

**Нет, как жёсткая зависимость запуска.**

- Переход проекта уже использует журнал + восстановление (`project-rules-transition.ts`), что закрывает практический риск незавершённого перехода.
- Публикация правила/снимка **не** использует межколлекционную транзакцию; остаточный риск — снимок без аудита при сбое аудита. Это можно закрыть журналом/починкой аудита в рамках NEW-N4 без изменения Storage Adapter.
- Backup — на уровне всей SQLite БД, правила/снимки входят автоматически.

**Вывод:** NEW-N3 остаётся отдельным улучшением (строгая атомарность), не блокером CA-T-511. Решение о её обязательности — за владельцем.

---

## 8. Фактические проверки

| Проверка | Результат |
|---|---|
| `npx vitest run` | **109 files / 1165 passed** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `sqlite3 -readonly data/formakub.db` | collections: admin-audit-log, catalog-items, display-metadata, leads, module-presets, price-items, pricing-changes, pricing-versions, projects; **rules-snapshots/managed-rules отсутствуют** |
| Grep `rules-test-fixture` вне тестов | 0 импортов |
| Grep `FORMAKUB_RULES_PUBLICATION_ENABLED` | код/тесты/доки; в `.env.example`/compose — нет |
| Grep `createManagedRule` id | `rule-${randomBytes(6)}`; поле `id` в API-схеме отсутствует |

---

## 9. Документационные расхождения (не исправлялись)

1. `docs/CALCULATION_ADMIN/PRODUCTION_CUTOVER_CHECKLIST.md` не содержит Managed Rules: seed, первый publish, gate-флаг, backup/restore правил.
2. `.env.example` не содержит `FORMAKUB_RULES_PUBLICATION_ENABLED`.
3. `PROJECT_BACKLOG.md`/`CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md` не содержат задачу **NEW-N4**.
4. `PROJECT_PROGRESS.md` фиксирует N1/N2 как DONE, но не фиксирует production seed gap как отдельный blocker.
5. ADR-07 §11.6 корректно фиксирует открытый вопрос `owner_confirmed` — расхождений нет.

---

## 10. Точный статус

- **CA-T-511:** **BLOCKED** для production publication/Managed Rules. Инфраструктура (SQLite/backup/RBAC/gate) готова, но отсутствуют seed-механизм с детерминированными id, подтверждение `source`, runbook и production-проверка gate. Статус остаётся PARTIAL/BLOCKED; настоящий аудит статусы не меняет.
- **NEW-N4:** **BLOCKED** — задача не зарегистрирована и не может быть выполнена до решения владельца по seed-механизму (B2) и подтверждению норм (B4).
- **NEW-N3:** не требуется как блокер CA-T-511 (см. §7).

---

## 11. NEW-N4 — фактическая реализация (2026-11-13)

Реализованы D-7–D-11; production cutover не выполнялся.

| Решение | Реализация | Статус |
|---|---|---|
| D-7 seed | `managed-rules-seed.ts`, `POST /api/admin/rules/import`; 27 fixed id, draft, идемпотентно, конфликты → 409 | READY |
| D-8 source | seed `preliminary`; публикация preliminary запрещена; `owner_confirmed` только после документов | READY (значения не подтверждены) |
| D-9 gate | `rules-publication-config.ts`, `FORMAKUB_ENV`, флаг, startup-проверка, `.env.example`/compose | READY |
| D-10 journal | `rules-publication-journal.ts`, audit с `requestId`, инвариант snapshot → audit; **публикация без journal невозможна** (operationId генерируется сервером, replay проверяет/восстанавливает журнал) | READY |
| D-11 recovery | startup (`instrumentation.ts`) + перед публикацией; без фонового процесса | READY |

### 11.1. Production runbook (Managed Rules)

**Разделение этапов:** инфраструктура → импорт preliminary draft → документальное подтверждение норм → разрешение publication → первая публикация.

1. **Проверка окружения:** `NODE_ENV=production`, `FORMAKUB_ENV=production`, `FORMAKUB_STORAGE=sqlite`, writable `FORMAKUB_DATA_DIR`; preflight/health.
2. **Проверка конфигурации gate:** `FORMAKUB_RULES_PUBLICATION_ENABLED` пуст/`0`; startup-лог не содержит противоречий; проверить `GET /api/admin/rules/snapshots/active` (пусто).
3. **Создание collections:** автоматически Storage Adapter; проверить отсутствие `managed-rules.json`/`rules-snapshots.json` (read-only).
4. **Проверка backup:** `npm run restore-drill`/ручной backup; убедиться, что БД включает rules collections после появления.
5. **Проверка seed:** `POST /api/admin/rules/import` под `catalog.write`; ожидается 27 created, source=preliminary.
6. **Проверка фиксированных ID:** `GET /api/admin/rules` — 27 id из контракта Engine; повторный импорт → created=0.
7. **Проверка source/статусов:** все `draft`, `preliminary`; диагностика `/admin/rules/diagnostics` — preliminary не publishable.
8. **Проверка конфликтов:** повторный импорт не меняет файлы; конфликт тестируется на staging.
9. **Диагностика:** нет `required_rules_missing` после подтверждения/публикации (до публикации — ожидаемо).
10. **Recovery:** перезапуск приложения → startup recovery не создаёт snapshot/audit; журнал пуст/завершён.
11. **Условия первой публикации:** документальное подтверждение владельцем 27 норм → новые draft-редакции с `source=owner_confirmed` → явный выбор → `expectedVersion`/`confirmed`; gate временно разрешён только на staging.
12. **Snapshot/contentHash:** проверить `contentHash`, состав 27+ правил, `publishedSeq=1`.
13. **Audit:** `GET /api/admin/audit-log?action=rule.publish` — ровно одна завершённая запись с `requestId`, соответствующим snapshot.
14. **Engine:** расчёт wardrobe проходит без `RULES_SNAPSHOT_*`; pinned old projects не меняются; legacy остаются заблокированными для расчёта.
15. **Rollback/ошибки:** при сбое аудита — recovery (старт/повторная публикация), snapshot не пересоздаётся; при повреждении snapshot — восстановление из backup; публикация не повторяется вслепую.
16. **Запрет:** не включать production flag до подтверждения норм и завершения CA-T-511; не выполнять seed на production в рамках этого этапа.

### 11.2. Обновлённые статусы

- Seed-механизм: **READY** (ранее BLOCKED).
- Source: **NEEDS OWNER DECISION** (preliminary корректен; публикация требует подтверждения).
- Gate: **READY** (усилен D-9).
- Publication audit/recovery: **READY** (journal).
- Runbook: **READY (документ)**; фактическое выполнение — staging/production.
- **CA-T-511: остаётся BLOCKED** внешними условиями (подтверждение норм, production provisioning/secret/users, restore-drill на production-like, фактическое выполнение runbook).

---

## 12. CA-T-511 Blocker Assessment (2026-11-13, после NEW-N4)

**Статус CA-T-511: BLOCKED (PARTIAL).** NEW-N4 закрыл технические блокеры seed, gate, journal/recovery; остались подтверждение норм и production-доступ.

| # | Блокер | Фактический статус | Доказательство | Недостающий результат | Закрывается без production | Внешняя зависимость |
|---|---|---|---|---|---|---|
| B1 | Документальное подтверждение 27 норм и смена `source` на `owner_confirmed` | **NEEDS OWNER DECISION** | Seed `source=preliminary` (`managed-rules-seed.ts`); публикация preliminary запрещена; подтверждающего документа нет | Подписанный/подтверждённый перечень значений (паспорта/решение владельца); новые draft-редакции | Нет (требуется владелец) | Да |
| B2 | Production seed/import 27 draft и первая публикация snapshot | **READY WITH CONDITIONS** | `POST /api/admin/rules/import` (идемпотентно), publish journal/gate, diagnostics | Фактическое выполнение на staging/production; проверка id/source/audit/hash | Частично: staging — да; production — нет | Да (production access) |
| B3 | Keycloak production realm/issuer/secret/redirect URI, реальные пользователи | **BLOCKED** | `deploy/keycloak/README.md`, `realm-formakub.json`, checklist; локальный disposable PASS | Production realm, секреты, redirect URIs, пользователи | Нет | Да |
| B4 | Production browser smoke (OIDC/RBAC/public price) | **BLOCKED** | `scripts/browser-smoke.mjs` (локальный PASS) | Прогон на production URL | Нет | Да (deployment) |
| B5 | Production-like restore-drill и backup rules collections | **READY WITH CONDITIONS** | `restore-drill` локальный PASS; backup — вся SQLite БД (`backup.ts`) | Production-like копия, restore, проверка rules snapshot/projects | Нет для production; staging возможно | Да (production backup) |
| B6 | Решение по S3 off-site backup | **NEEDS OWNER DECISION** | `PRODUCTION_CUTOVER_CHECKLIST.md` §10; S3 опционален | Решение владельца + настройка/проверка | Нет (решение), проверка — внешняя | Да |
| B7 | Preflight не валидирует `FORMAKUB_ENV`/`FORMAKUB_RULES_PUBLICATION_ENABLED` | **READY TO CLOSE (technical)** | `scripts/deploy-preflight.mjs` проверяет Keycloak/storage, но не rules gate; startup-проверка есть (`instrumentation.ts`) | Добавить проверки в preflight и тест | Да | Нет |
| B8 | Фактическое выполнение production runbook | **READY WITH CONDITIONS** | Runbook §11; staging не выполнялся | Выполненный и подписанный runbook (staging/production) | Нет для production | Да |
| B9 | Включение `FORMAKUB_RULES_PUBLICATION_ENABLED=1` | **NEEDS OWNER DECISION** | Флаг не включён; gate блокирует | Явное разрешение владельца после B1/B3/B8 | Нет | Да |
| B10 | NEW-N3 (межколлекционная транзакция) | **NOT REQUIRED** | Journal/recovery закрывают инвариант snapshot → audit; transition — journal | — | — | — |

### 12.1. Что уже готово и подтверждено

- Deterministic seed/import 27 правил с фиксированными id, идемпотентность и конфликты — тесты 5.
- Seed `source=preliminary`; публикация preliminary отклоняется; диагностика показывает публикуемость.
- Production gate: `FORMAKUB_ENV`, flag, startup-проверка, блокировка противоречий — тесты 6.
- Publication journal + audit recovery, recovery при старте/перед публикацией, публикация без journal невозможна — тесты 8.
- Локальные OIDC/RBAC/browser/restore/preflight проверки (CA-T-511 baseline) — PASS.
- Документация: ADR §11.6–§11.10, runbook §11, checklist §11, `.env.example`, compose.

### 12.2. Что можно закрыть технически без production

1. Добавить в `scripts/deploy-preflight.mjs` проверки `FORMAKUB_ENV`/rules flag и запрет `1` без production-маркера (B7) + тест.
2. Прогнать staging-runbook на disposable Keycloak + temp SQLite: seed → diagnostics → publish с флагом → audit/contentHash → Engine fail-closed/ok → recovery (B2/B8 частично).
3. Добавить тест startup-проверки конфигурации gate (юнит/instrumentation-уровень), если требуется.
4. Документировать результат staging в runbook.

### 12.3. Что требует внешнего подтверждения/доступа

- B1 — документы/решение владельца по 27 нормам.
- B3/B4/B5/B8 — production Keycloak, секреты, пользователи, browser smoke, production-like restore, выполнение runbook.
- B6/B9 — решения владельца (S3, разрешение публикации).

### 12.4. Порядок дальнейших действий (минимальный)

1. **B1:** владелец подтверждает значения и `source`; создаются новые draft-редакции (`owner_confirmed`).
2. **B7:** preflight-валидация нового gate + тест.
3. **B2/B8 (staging):** seed 27 draft → diagnostics → флаг на staging → первая публикация → проверка snapshot/hash/audit/Engine → recovery drill.
4. **B3:** production Keycloak realm/issuer/secret/redirect/users.
5. **B5/B4:** production backup/restore-drill и browser smoke на staging/копии.
6. **B9:** явное включение production flag только после B1/B3/B8.
7. **B2 (production):** seed/import и первая публикация; проверка audit/Engine; затем закрытие CA-T-511.

### 12.5. Документальные расхождения, исправленные в этом аудите

- `CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md` — строка CA-T-511 дополнена фактическими блокерами NEW-N4 (нормы, seed, gate, runbook) без смены статуса.
- `PRODUCTION_CUTOVER_CHECKLIST.md` §3 — добавлены `FORMAKUB_ENV` и `FORMAKUB_RULES_PUBLICATION_ENABLED`.

### 12.6. Остающийся технический пробел

`npm run preflight` не проверяет `FORMAKUB_ENV`/`FORMAKUB_RULES_PUBLICATION_ENABLED`; startup-проверка есть, но preflight может пропустить противоречивую конфигурацию. Это единственный выявленный технический gap, закрываемый без production (B7).
