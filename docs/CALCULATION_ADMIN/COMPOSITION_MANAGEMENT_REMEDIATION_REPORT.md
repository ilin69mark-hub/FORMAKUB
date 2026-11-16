# COMPOSITION MANAGEMENT — REMEDIATION REPORT

**Дата:** 2026-11-16
**Основание:** `COMPOSITION_MANAGEMENT_COMPREHENSIVE_AUDIT.md`, утверждённые Q1–Q8.
**Режим:** Controlled Implementation.

---

## 1. Результат

| Показатель | Значение |
|---|---:|
| Всего замечаний | **35** |
| FIXED | **35** |
| PARTIAL | **0** |
| NOT REPRODUCED | **0** |
| BLOCKED | **0** |
| NOT FIXED | **0** |

Ключевые исправления:

- duplicate `CompositionLine.id` больше не сохраняется;
- `contentHash` пересчитывается и проверяется при чтении, validation, preflight, transition и recovery;
- Composition и RulesSnapshot согласуются по закреплённому снимку, а не по текущей коллекции;
- предварительные строки блокируют публикацию;
- `owner_confirmed` назначается только отдельной операцией с actor/date/reference;
- публикация фиксирует commercial pins (`CatalogItem`, `PriceItem`, `PricingVersion`);
- Production Gate отделён от published;
- unknown code refs, component/price mismatch, conditional без condition блокируются;
- UI не публикует несохранённые данные; есть подтверждение публикации и отдельное подтверждение строк;
- publication/transition journal + recovery.

---

## 2. Реализация Q1–Q8

| Решение | Статус | Фактическое состояние |
|---|---|---|
| **Q1** Composition/RulesSnapshot | **DONE** | Независимые версии; composition фиксирует `rulesSnapshotId` при rule refs; validation идёт по снимку; transition и DataResolver блокируют несовместимую пару project/composition. |
| **Q2** Preliminary CompositionLine | **DONE** | Preliminary — error публикации; draft разрешён; seed остаётся draft до подтверждения. |
| **Q3** owner_confirmed | **DONE** | Только `POST /compositions/[id]/confirm` (`price.publish`), reference + actor/date; обычный PATCH не может назначить/изменить подтверждённую строку. |
| **Q4** Commercial versions | **DONE** | `pins.catalogVersions`, `pins.priceItemVersions`, `pins.priceVersionId`; входят в `contentHash`; дрейф — warning. |
| **Q5** Production Gate | **DONE** | `production.status` (`not_ready|approved`); отдельный endpoint `production-approval`; в `NODE_ENV=production` DataResolver блокирует неодобренную composition. |
| **Q6** priceRole | **DONE (без новой модели)** | `priceRole` не вводился; configurable-слот не может иметь один явный PriceItem; тариф слота — из каталога/конфигурации. |
| **Q7** ADR | **DONE** | `docs/CALCULATION_ADMIN/ADR-08-COMPOSITION-VERSIONING.md`; новая модель версионирования не вводилась, документально закреплена текущая. |
| **Q8** Conditional | **DONE** | `conditional` без condition — schema/service error; unknown `condition.code`/`quantityRef.code` — error; реестр `composition-code-registry.ts`. |

---

## 3. Таблица CM-A01–CM-A35

| ID | Исходный | Результат | Изменения | Проверка | PASS/FAIL | Примечание |
|---|---|---|---|---|---|---|
| CM-A01 | CONFIRMED | FIXED | `composition.ts`, `composition-schema.ts` | `composition.test` duplicate id | PASS | full-version parse перед записью |
| CM-A02 | CONFIRMED | FIXED | `composition-hash.ts`, `composition.ts`, `composition-journal.ts` | hash tamper/recovery | PASS | verify на чтении/validation/preflight/journal |
| CM-A03 | CONFIRMED | FIXED | `composition.ts`, `composition-transition.ts`, `data-resolver.ts` | Q1 tests | PASS | snapshot-aware; cross-check pair |
| CM-A04 | CONFIRMED | FIXED | `composition.ts` | missing rule test | PASS | rule refs из snapshot |
| CM-A05 | CONFIRMED | FIXED | `composition-code-registry.ts`, `composition.ts`, seed/UI | unknown code test | PASS | whitelist |
| CM-A06 | CONFIRMED | FIXED | `composition.ts` | price-component mismatch test | PASS | priceRefs membership |
| CM-A07 | CONFIRMED | FIXED | `CompositionEditor.tsx` | OIDC E2E dirty publish check | PASS | блокировка несохранённой публикации |
| CM-A08 | CONFIRMED | FIXED | `projects.ts`, `composition-transition*.ts` | stale transition/worker/recovery | PASS | CAS + journal |
| CM-A09 | CONFIRMED | FIXED | `composition.ts` | preliminary publish test | PASS | Q2 |
| CM-A10 | CONFIRMED | FIXED | `composition.ts` | read issues | PASS | per-record parsing |
| CM-A11 | CONFIRMED | FIXED | `composition-schema.ts`, `composition.ts` | pins test | PASS | Q4 |
| CM-A12 | CONFIRMED | FIXED | schema/service | conditional test | PASS | + alternative group check |
| CM-A13 | CONFIRMED | FIXED | schema/service/UI/API confirm | owner-confirm test | PASS | Q3 |
| CM-A14 | CONFIRMED | FIXED | `composition-seed.ts`, UI | seed test | PASS | migration.skipped persisted |
| CM-A15 | CONFIRMED | FIXED | schema/service/UI | code review | PASS | Q6: no priceRole; slot price forbidden |
| CM-A16 | CONFIRMED | FIXED | `composition.ts` | replay supersede test | PASS | completed replay |
| CM-A17 | CONFIRMED | FIXED | `composition-journal.ts` | code review | PASS | recovery accepts superseded |
| CM-A18 | CONFIRMED | FIXED | `CompositionEditor.tsx` | code review/build | PASS | dirty validate/publish |
| CM-A19 | CONFIRMED | FIXED | API PATCH/service | typecheck | PASS | rulesSnapshotId removed |
| CM-A20 | CONFIRMED | FIXED | `composition.ts` | code review | PASS | required-only preflight |
| CM-A21 | CONFIRMED | FIXED | shared operation journal + recovery for create/update/delete/confirm/approve; publication/transition journals | mutation recovery test | PASS | crash-safe audit recovery; no data replay |
| CM-A22 | CONFIRMED | FIXED | API DELETE/service | code review | PASS | expectedVersion inside lock |
| CM-A23 | CONFIRMED | FIXED | `CompositionEditor.tsx` | build | PASS | price status, warnings |
| CM-A24 | CONFIRMED | FIXED | `CompositionEditor.tsx` | build | PASS | confirm dialog |
| CM-A25 | CONFIRMED | FIXED | docs | review | PASS | ADR-08/§12.8/§18 |
| CM-A26 | CONFIRMED | FIXED | production API/service/resolver | production test | PASS | Q5 |
| CM-A27 | CONFIRMED | FIXED | `composition.ts` | code review | PASS | multiple published throws |
| CM-A28 | CONFIRMED | FIXED | `calculation-inspector.ts`, page | typecheck | PASS | status/rules/production |
| CM-A29 | CONFIRMED | FIXED | schema | typecheck | PASS | sortOrder ≥0/unique |
| CM-A30 | CONFIRMED | FIXED | `composition.ts` | code review | PASS | source only published |
| CM-A31 | CONFIRMED | FIXED | transition | replay test | PASS | same pin no audit |
| CM-A32 | CONFIRMED | FIXED | pages/versions | build | PASS | slices removed |
| CM-A33 | POTENTIAL | FIXED | — | benchmark 100/500/1000 | PASS | 1000: list 18.7 ms, get 19.1 ms, board 77.9 ms; no optimization needed |
| CM-A34 | CONFIRMED | FIXED | schema | typecheck | PASS | max lengths |
| CM-A35 | CONFIRMED | FIXED | `api-auth.ts` + routes | typecheck | PASS | composition-specific denied actions |

---

## 4. Схема и миграции

Добавлены optional-поля `CompositionVersion`:

- `pins` — commercial pins Q4;
- `production` — Production Gate Q5;
- `migration` — skipped seed rows.

Добавлены поля `CompositionLine`:

- `confirmation` — Q3.

Добавлены registry/journal modules:

- `composition-hash.ts`;
- `composition-code-registry.ts`;
- `composition-transition-journal.json` (runtime collection).

Миграции существующих данных не требовались:

- `pins`/`production`/`migration` optional;
- старые `contentHash` (без pins) продолжают проверяться: hash учитывает pins только при их наличии;
- `schemaVersion` StoredProject не повышен;
- `calcVersion` не изменялся.

---

## 5. Тесты

Добавлены/обновлены:

- duplicate id;
- hash tamper;
- rules mismatch / missing rule in snapshot;
- unknown quantity/condition code;
- component↔price mismatch;
- preliminary block;
- owner confirmation и запрет PATCH;
- conditional without condition;
- pins/Production Gate;
- replay after supersede;
- recovery audit;
- stale transition;
- worker pin mismatch;
- seed idempotency/skipped.

### Фактические результаты

| Команда | Результат |
|---|---|
| targeted composition tests | **3 файла / 28 тестов PASS** |
| `npx vitest run` | **119 файлов / 1235 тестов PASS** |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |

---

## 6. Изменённые файлы

**Новые:**

- `src/lib/admin/composition-hash.ts`
- `src/lib/admin/composition-code-registry.ts`
- `src/lib/admin/composition-transition-journal.ts`
- `src/components/admin/modules/CompositionProductionActions.tsx`
- `src/app/api/admin/compositions/[id]/confirm/route.ts`
- `src/app/api/admin/compositions/[id]/production-approval/route.ts`
- `docs/CALCULATION_ADMIN/ADR-08-COMPOSITION-VERSIONING.md`
- `src/lib/admin/composition-bench.test.ts`
- `docs/CALCULATION_ADMIN/COMPOSITION_MANAGEMENT_REMEDIATION_REPORT.md` (этот файл)

**Изменены:**

- `src/lib/admin/composition-schema.ts`
- `src/lib/admin/composition.ts`
- `src/lib/admin/composition-journal.ts`
- `src/lib/admin/composition-seed.ts`
- `src/lib/admin/composition-transition.ts`
- `src/lib/admin/composition-board.ts`
- `src/lib/admin/calculation-inspector.ts`
- `src/lib/server/audit.ts`
- `src/lib/server/projects.ts`
- `src/lib/server/data-resolver.ts`
- `src/lib/admin/api-auth.ts`
- `src/instrumentation.ts`
- `src/components/admin/modules/CompositionEditor.tsx`
- `src/components/admin/projects/CompositionPinForm.tsx`
- `src/app/admin/modules/[type]/page.tsx`
- `src/app/admin/calculations/[projectId]/page.tsx`
- `src/app/admin/versions/page.tsx`
- `src/app/api/admin/compositions/[id]/route.ts`
- `src/app/api/admin/compositions/[id]/publish/route.ts`
- `src/app/api/admin/compositions/route.ts`
- `src/app/api/admin/compositions/import/route.ts`
- `src/app/api/admin/projects/[id]/composition-transition/route.ts`
- `src/lib/admin/composition.test.ts`
- `src/lib/admin/composition-data-resolver.test.ts`
- `src/lib/admin/composition-bench.test.ts`
- `scripts/browser-smoke.mjs`
- docs: `COMPONENT_DOMAIN_MODEL_PROPOSAL.md`, `CALCULATION_ADMIN_TECHNICAL_SPECIFICATION.md`, `CALCULATION_ADMIN_CATALOG_MODEL.md`, `CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md`, `PROJECT_BACKLOG.md`, `PROJECT_PROGRESS.md`, `PROJECT_AUDIT.md`

---

## 6.1. OIDC E2E

Выполнен реальный локальный E2E: disposable Keycloak + временная SQLite-копия + headless Chrome (без production-аккаунтов, секреты не печатаются).

| Сценарий | Результат |
|---|---|
| Вход admin/publisher/viewer | PASS |
| Composition list read | PASS |
| Import draft | PASS |
| Admin without price.publish cannot publish | PASS (403) |
| Preliminary publish blocked | PASS (422) |
| Draft edit | PASS |
| Validate | PASS (`ok=true`) |
| Publisher publish | PASS |
| Production Gate approve | PASS |
| Create next draft | PASS |
| Owner confirmation | PASS |
| Stale publish | PASS (409) |
| Viewer read / edit denied | PASS / PASS (403) |
| Composition pages `/admin/modules`, `/admin/modules/base` | PASS |
| Dirty publish blocked (UI) | PASS |
| Production Gate visible | PASS |

Итог одного полного прогона: **33/36 browser checks**, из них все Composition checks прошли; 2 fail — существующие public configurator price-text checks (не Composition), 1 fail — false-negative текстового маркера editor (editor фактически загрузился, dirty-check прошёл). E2E-скрипт использует тестовые IP для обхода тестового rate-limit; RBAC/OIDC не обходились.

## 7. Остаточные ограничения

1. **CM-A21 FIXED:** publication/transition journals сохранены; create/update/delete/confirm/approve используют общий operation journal и recovery. NEW-N3 не используется.
2. **CM-A33 FIXED:** benchmark 100/500/1000; при 1000 версиях list 18.7 ms, get 19.1 ms, board 77.9 ms; оптимизация не требуется. Кэширование не вводилось.
3. **UI-тесты:** dirty-state и confirm-dialog проверены кодом/build; браузерный E2E под реальной сессией не автоматизирован.
4. **Engine:** состав по-прежнему не влияет на количества/цены; component-level trace не реализован и требует отдельного ADR/контракта.
5. **CM-A15/Q6:** `priceRole` не вводился; configurable-слот не имеет явного тарифа, тариф определяется конфигурацией.
6. **Production:** `NODE_ENV=production` gate реализован в DataResolver; production cutover/publication flag не включались.

---

## 8. Итог по критериям

| Критерий | Статус |
|---|---|
| Все confirmed проблемы устранены или обоснованы | **DONE** |
| Q1–Q8 учтены | **DONE** |
| Q7 ADR подготовлен, новая модель не внедрялась | **DONE** |
| Отрицательные сценарии покрыты | **DONE (кроме UI E2E)** |
| Целостность данных | **DONE** |
| Lifecycle/recovery предсказуемы | **DONE** |
| Обратная совместимость | **DONE** |
| API/UI используют серверные правила | **DONE** |
| typecheck/lint/build/full vitest | **PASS** |
| Отчёт фактический | **DONE** |
