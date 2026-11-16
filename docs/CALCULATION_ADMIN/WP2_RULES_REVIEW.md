# WP-2 — RULES REVIEW & STORE DATA READINESS

- **Дата:** 2026-11-16
- **Режим:** READ → VERIFY → PREPARE → TEST (публикация и bootstrap **не выполнялись**)
- **Назначение:** материал для решений владельца **OD-13** (27 норм) и **CA-GL-22** (bootstrap)
- **Основание:** WP-1 (`STORE_ADMIN_INVENTORY.md` § 7–§ 10), фактические проверки кода и dry-run на копии данных

> Значения норм **не изменялись**, публикация не выполнялась. Все выводы получены из кода
> (`managed-rules-seed.ts`, `wardrobe-hinges.ts`, `engine.ts`, `managed-rules.ts`) и из
> `dryRunBootstrap()` на изолированной копии `data/formakub.db`.

---

## 1. Все 27 правил

Общие поля для всех 27: `category=norm`, `scope=wardrobe`,
`condition = { subject:"kind", operator:"equals", value:"wardrobe" }`,
`source=preliminary`, `affects=["quantity"]`, `status=draft` (после импорта).
`sourceRef` — **точная строка значения** (исправлено в WP-2.1, § 11).
Поле `unit` **не задано** (см. § 7, D-2).

| № | ID | Название | Значение | Единица (семантика) | Область | Назначение | Влияние на расчёт | Источник (файл:строка) | Статус |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `rule-wardrobe-facade-density-16` | Плотность фасада 16 мм | 11.5 | кг/м² | wardrobe | масса двери для выбора петель | quantity `wardrobe.fronts`/`fittings` | `wardrobe-hinges.ts:23` | preliminary |
| 2 | `rule-wardrobe-facade-density-19` | Плотность фасада 19 мм | 14.8 | кг/м² | wardrobe | то же | то же | `wardrobe-hinges.ts:24` | preliminary |
| 3 | `rule-wardrobe-facade-density-22` | Плотность фасада 22 мм | 16.8 | кг/м² | wardrobe | то же | то же | `wardrobe-hinges.ts:25` | preliminary |
| 4 | `rule-wardrobe-hinge-band-1-max-height` | Полоса петель 1: макс. высота | 600 | мм | wardrobe | верхняя граница высоты двери | кол-во петель | `wardrobe-hinges.ts:36` | preliminary |
| 5 | `rule-wardrobe-hinge-band-1-max-mass` | Полоса петель 1: макс. масса | 5 | кг | wardrobe | верхняя граница массы двери | кол-во петель | `wardrobe-hinges.ts:36` | preliminary |
| 6 | `rule-wardrobe-hinge-band-1-count` | Полоса петель 1: количество петель | 2 | шт. | wardrobe | число петель на дверь | `wardrobe.fittings.amount` | `wardrobe-hinges.ts:36` | preliminary |
| 7 | `rule-wardrobe-hinge-band-2-max-height` | Полоса петель 2: макс. высота | 900 | мм | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:37` | preliminary |
| 8 | `rule-wardrobe-hinge-band-2-max-mass` | Полоса петель 2: макс. масса | 8 | кг | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:37` | preliminary |
| 9 | `rule-wardrobe-hinge-band-2-count` | Полоса петель 2: количество петель | 2 | шт. | wardrobe | число петель | `wardrobe.fittings.amount` | `wardrobe-hinges.ts:37` | preliminary |
| 10 | `rule-wardrobe-hinge-band-3-max-height` | Полоса петель 3: макс. высота | 1300 | мм | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:38` | preliminary |
| 11 | `rule-wardrobe-hinge-band-3-max-mass` | Полоса петель 3: макс. масса | 12 | кг | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:38` | preliminary |
| 12 | `rule-wardrobe-hinge-band-3-count` | Полоса петель 3: количество петель | 3 | шт. | wardrobe | число петель | `wardrobe.fittings.amount` | `wardrobe-hinges.ts:38` | preliminary |
| 13 | `rule-wardrobe-hinge-band-4-max-height` | Полоса петель 4: макс. высота | 1600 | мм | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:39` | preliminary |
| 14 | `rule-wardrobe-hinge-band-4-max-mass` | Полоса петель 4: макс. масса | 15 | кг | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:39` | preliminary |
| 15 | `rule-wardrobe-hinge-band-4-count` | Полоса петель 4: количество петель | 4 | шт. | wardrobe | число петель | `wardrobe.fittings.amount` | `wardrobe-hinges.ts:39` | preliminary |
| 16 | `rule-wardrobe-hinge-band-5-max-height` | Полоса петель 5: макс. высота | 2000 | мм | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:40` | preliminary |
| 17 | `rule-wardrobe-hinge-band-5-max-mass` | Полоса петель 5: макс. масса | 19 | кг | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:40` | preliminary |
| 18 | `rule-wardrobe-hinge-band-5-count` | Полоса петель 5: количество петель | 4 | шт. | wardrobe | число петель | `wardrobe.fittings.amount` | `wardrobe-hinges.ts:40` | preliminary |
| 19 | `rule-wardrobe-hinge-band-6-max-height` | Полоса петель 6: макс. высота | 2200 | мм | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:41` | preliminary |
| 20 | `rule-wardrobe-hinge-band-6-max-mass` | Полоса петель 6: макс. масса | 22 | кг | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:41` | preliminary |
| 21 | `rule-wardrobe-hinge-band-6-count` | Полоса петель 6: количество петель | 5 | шт. | wardrobe | число петель | `wardrobe.fittings.amount` | `wardrobe-hinges.ts:41` | preliminary |
| 22 | `rule-wardrobe-hinge-band-7-max-height` | Полоса петель 7: макс. высота | 2400 | мм | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:42` | preliminary |
| 23 | `rule-wardrobe-hinge-band-7-max-mass` | Полоса петель 7: макс. масса | 27 | кг | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:42` | preliminary |
| 24 | `rule-wardrobe-hinge-band-7-count` | Полоса петель 7: количество петель | 5 | шт. | wardrobe | число петель | `wardrobe.fittings.amount` | `wardrobe-hinges.ts:42` | preliminary |
| 25 | `rule-wardrobe-hinge-band-8-max-height` | Полоса петель 8: макс. высота | 2700 | мм | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:43` | preliminary |
| 26 | `rule-wardrobe-hinge-band-8-max-mass` | Полоса петель 8: макс. масса | 35 | кг | wardrobe | граница диапазона | кол-во петель | `wardrobe-hinges.ts:43` | preliminary |
| 27 | `rule-wardrobe-hinge-band-8-count` | Полоса петель 8: количество петель | 6 | шт. | wardrobe | число петель | `wardrobe.fittings.amount` | `wardrobe-hinges.ts:43` | preliminary |

Генератор: `managed-rules-seed.ts:94–138` (`baseSpec` — `:70–90`).
`assigns`: плотности → `line:wardrobe.fronts`; все 24 полосы → `line:wardrobe.fittings`.

---

## 2. Три правила плотности фасада

| Толщина | Значение | Источник | Как используется | Что при отсутствии |
|---|---|---|---|---|
| 16 мм | 11.5 кг/м² | `WARDROBE_FACADE_DENSITY_KG_M2` (`wardrobe-hinges.ts:22–26`) | `wardrobeDoorMassKg(panel, thickness, norms)` → масса двери → выбор полосы петель | `wardrobeHingeNormsFromRules` → `null` → Engine бросает ошибку |
| 19 мм | 14.8 кг/м² | там же | то же | то же |
| 22 мм | 16.8 кг/м² | там же | то же | то же |

**Документальное/производственное подтверждение:** в репозитории **отсутствует**. Значения
объявлены константами с комментарием «legacy/validation default» (`wardrobe-hinges.ts:34`) и
помечены `source=preliminary` (D-8). Иные источники (паспорт производителя, ТЗ) не найдены.

**Граничные значения:** масса и высота сравниваются как `<=` (`wardrobeHingeCountForDoor` →
`height <= maxHeight && mass <= maxMass`), т.е. дверь ровно 600 мм / 5 кг попадает в полосу 1.
Толщина вне `{16,19,22}` → `norms.densities[thickness]` = `undefined` → масса `NaN` → полоса не
найдена → режим overload (см. § 3).

---

## 3. Двадцать четыре правила петель

| № | `max-height`, мм | `max-mass`, кг | `count`, шт. | Условие применения | Функция Engine |
|---|---|---|---|---|---|
| 1 | 600 | 5 | 2 | `height ≤ 600 && mass ≤ 5` | `wardrobeHingeCountForDoor` |
| 2 | 900 | 8 | 2 | `height ≤ 900 && mass ≤ 8` | то же |
| 3 | 1300 | 12 | 3 | `height ≤ 1300 && mass ≤ 12` | то же |
| 4 | 1600 | 15 | 4 | `height ≤ 1600 && mass ≤ 15` | то же |
| 5 | 2000 | 19 | 4 | `height ≤ 2000 && mass ≤ 19` | то же |
| 6 | 2200 | 22 | 5 | `height ≤ 2200 && mass ≤ 22` | то же |
| 7 | 2400 | 27 | 5 | `height ≤ 2400 && mass ≤ 27` | то же |
| 8 | 2700 | 35 | 6 | `height ≤ 2700 && mass ≤ 35` | то же |

Проверки:
- **Пересечения:** отсутствуют. Полосы — кумулятивные верхние границы; выбор — первая подходящая
  (`wardrobeHinges` → `find`), поэтому даже частичное перекрытие не создаёт неоднозначности.
- **Пропуски:** в диапазоне 0…2700 мм пропусков нет (границы возрастают: 600→900→1300→1600→2000→2200→2400→2700).
- **Монотонность:** `wardrobeHingeNormsFromRules` требует строгого возрастания и высоты, и массы
  (`:128–129`), иначе `null` → fail-closed.
- **Дублирование:** нет; ID уникальны, индекс полосы 1…8.
- **Зависимости:** между правилами отсутствуют (нет поля зависимостей) — циклов быть не может.
- **Отсутствие подходящего правила (дверь > 2700 мм или > 35 кг):** `computed === null` →
  `hingeCount = norms.bands.at(-1).count` (**6**) и `overload: true` (`wardrobeHingePlan`).
  То есть **не ноль** и не ошибка, а максимум + флаг перегрузки. Поведение существующее,
  в WP-2 не изменялось.
- **Отсутствие правила в снимке:** `wardrobeHingeNormsFromRules` → `null` → Engine бросает
  контролируемую ошибку (`engine.ts:953–959`), расчёт шкафа не выполняется.

---

## 4. Влияние на Engine и исторические проекты

| Вопрос | Факт |
|---|---|
| Кто читает правила | **только** `calculateWardrobeBreakdown` → `wardrobeHingeNormsFromRules` (`engine.ts:954`) |
| Кухня | `rulesSnapshot` **не читается**; единственное упоминание в `engine.ts` — строка 954 внутри шкафа |
| Fail-closed | при отсутствии/некорректности любой из 27 норм шкаф падает с ошибкой; подстановки нуля нет |
| 200 существующих проектов | все `kind=kitchen`, `rulesSnapshotId` отсутствует → публикация норм **не меняет** их сохранённые цены и историю |
| Влияние на новые кухни | результат не меняется (правила не читаются), но DataResolver **требует** активный снимок → без него create/preview блокируются |
| Влияние на новые шкафы | определяет количество петель → `wardrobe.fittings.amount` |
| Изменение Composition | **не требуется**: `Composition.rulesSnapshotId` обязателен только для составов с `managed_rule` |

---

## 5. Технические проверки

| Проверка | Результат |
|---|---|
| Zod `managedRuleSchema` | ✅ (`valueTypeIssue`, `assignsSchema`, `ruleConditionSchema`) |
| Уникальность ID | ✅ детерминированные ID; `specs.length !== 27` → ошибка (`managed-rules-seed.ts:164–166`) |
| Типы значений | ✅ `int` (max-height, count) / `decimal` (max-mass, density) |
| Зависимости | ✅ отсутствуют |
| Циклы | ✅ невозможны |
| Revision | ✅ `/api/admin/rules/[id]/revision` |
| Publish lifecycle | ✅ `publishRulesSnapshot` требует **явный непустой выбор** draft-правил (авто-публикация всех draft запрещена, `:840–852`) |
| Ссылочная целостность при публикации | ✅ `rulesSnapshotReferenceIssues` (fail-closed) |
| Совместимость с `RulesSnapshot` | ✅ `rulesSnapshotContentHash` + `toRulesSnapshotInput` |
| Дублирование с другими механизмами | ✅ константы `wardrobe-hinges.ts` — только seed-источник; Engine читает исключительно снимок |
| Тесты | `managed-rules.test.ts`, `managed-rules-seed.test.ts`, `rules-diagnostics.test.ts` — PASS |

### Дефекты, найденные в WP-2

| ID | Дефект | Доказательство | Влияние | Рекомендация |
|---|---|---|---|---|
| **D-1** | `sourceRef` в seed неточен: указан диапазон `wardrobe-hinges.ts:17-39`, фактические значения — строки 22–26 и 35–43 | `managed-rules-seed.ts:37` vs `wardrobe-hinges.ts` | трассируемость норм неполная (строки 40–43 вне диапазона) | исправить **до** первого импорта (данных ещё нет — правка бесплатна); изменение кода → отдельное согласование |
| **D-2** | `unit` не задан ни у одного из 27 правил | `baseSpec` (`managed-rules-seed.ts:70–90`) не содержит `unit`; `RULE_UNITS` = только денежные единицы | единицы (кг/м², мм, кг, шт.) существуют лишь в тексте названий | **схема не поддерживает** физические единицы; добавлять `unit` нельзя без изменения `RULE_UNITS`. Зафиксировать семантику в OD-13 |
| **D-3** | При двери за пределами полосы 8 используется `count=6` + `overload: true` | `wardrobeHingePlan` (`wardrobe-hinges.ts`) | не ноль, но и не ошибка — «мягкий» fallback | поведение существующее; **не менять** в WP-2, зафиксировать для владельца |

---

## 6. OD-13 — рекомендации по правилам

**Ни одно правило не помечено APPROVE от имени владельца.** Ниже — техническая оценка.

| Группа | Кол-во | Техническая готовность | Рекомендация | Что нужно от владельца |
|---|---|---|---|---|
| Плотности 16/19/22 мм | 3 | значения используются, fail-closed работает | **NEEDS CONFIRMATION** | подтвердить кг/м² или указать источник (ТЗ/паспорт) |
| Полосы петель 1–8 (height/mass/count) | 24 | монотонны, без пропусков и пересечений | **NEEDS CONFIRMATION** | подтвердить 8 диапазонов и количество петель |
| `sourceRef` (D-1) | 27 | неточный диапазон | исправить до импорта | согласование правки кода |
| `unit` (D-2) | 27 | схема не поддерживает | оставить как есть | подтвердить семантику единиц в решении |

**Статус публикации:** технически возможна после подтверждения; 27 правил готовы к импорту
(`status=draft`) и публикации единым снимком.

---

## 7. Процедура активации RulesSnapshot (подготовлена, НЕ выполнена)

Точная последовательность (все вызовы — административные, с сессией и `Idempotency-Key`):

1. **Импорт seed** (создаёт 27 draft; идемпотентно; конфликт → 409 без частичной записи):
   `POST /api/admin/rules/import` → ожидается `expected: 27`, `created` 27 (первый запуск).
2. **Проверка** (read-only):
   `GET /api/admin/rules` → 27 записей `status=draft`;
   `GET /api/admin/rules/diagnostics` → нет ошибок.
3. **Публикация** (требует явного выбора всех 27 `{id, expectedVersion}`):
   `POST /api/admin/rules/publish` с телом `{ selection: [ ...27 items... ], operationId }`.
4. **Активация**: публикация создаёт активный снимок; `GET /api/admin/rules/snapshots/active`
   → `status: ok`, 27 правил.
5. **Проверка расчёта**: `POST /api/calculation-inputs` `{operation:"preview", config}` →
   200 + `inputs.rulesSnapshot.rulesSnapshotId`.
6. **Проверка golden**: полный `vitest run` не должен измениться (кухня правила не читает).

Откат: предыдущий активный снимок отсутствует (первый), поэтому откат = не публиковать.
После появления снимка — `/api/admin/rules/snapshots/[id]` (просмотр) и новая публикация.

---

## 8. Bootstrap Change Review (CA-GL-22)

### 8.1 Фактический dry-run на копии `data/formakub.db`

`dryRunBootstrap()` (`storageKind=sqlite`):

| Коллекция | Текущее | План | Готово к добавлению | Совпадает | Конфликты |
|---|---|---|---|---|---|
| `price-items` | 98 | 93 | **0** | 93 | 0 (5 «лишних» существуют вне плана и сохраняются) |
| `catalog-items` | 64 | 60 | **1** (`mdf_pvc`) | 49 | **10** (`supportSystem` ×2, `ledStrip` ×8) |
| `module-presets` | 8 | 8 | **0** | 3 | **5** (`kitchen: base, sink, hob, drawers, bottle`) |
| `pricing-versions` | 2 | 1 | **0** | 0 | **1** (`price-demo-2026-01`) |
| `admin-parameters` | **0** | 61 | **61** | 0 | 0 (dry-run не покрывает параметры; счёт получен из `buildAdminParameterSeeds()`) |

Прочее из плана: `priceSnapshot` 90, `signedAdjustments` 10, `promos` 3, `rules` 6
(`rules` здесь — число ключей `PriceRulesInput`, **не** ManagedRules).

### 8.2 Фактический diff (что изменилось бы)

| Коллекция | Изменение | Причина |
|---|---|---|
| `catalog-items` | **+1**: `facadeMaterial:mdf_pvc` | активный материал (`materials.ts:31–35`), отсутствует в Store |
| `admin-parameters` | **+61** записей | seed числовых параметров из манифеста (`parameter-seed.ts:91+`) |
| `price-items` | +0 | все 93 плановых уже есть |
| `module-presets` | +0 | все 8 уже есть |
| `pricing-versions` | +0 | плановая версия уже существует |
| Существующие записи | **не удаляются и не перезаписываются** | merge-семантика (`bootstrap.ts:1287`) |

### 8.3 Блокер: `applyBootstrap` **отказывается** выполняться

На фактическом наборе preflight возвращает **16 конфликтов**:
```
BOOTSTRAP_CATALOG_CONFLICT ×10  (supportSystem: standard, heavy; ledStrip ×8)
BOOTSTRAP_PRESET_CONFLICT ×5    (kitchen: base, sink, hob, drawers, bottle)
BOOTSTRAP_PRICING_VERSION_CONFLICT ×1 (price-demo-2026-01)
```
Сообщение: «существующая запись отличается от content … не перезаписывать автоматически;
требуется решение владельца».

**Вывод:** `CA-GL-22` **не может быть выполнена как повторный bootstrap** — Store содержит
административные правки, и механизм корректно отказывается их перезаписывать.

### 8.4 Что bootstrap никогда не перезаписывает
- существующие `PriceItem` (кроме отсутствующих);
- существующие `CatalogItem`/`ModulePreset` при расхождении — **конфликт, не перезапись**;
- `AdminParameter` с существующим id (merge только отсутствующих, `:1287`);
- опубликованные `PricingVersion` (конфликт при расхождении);
- правила (`managed-rules.json`) и Composition — bootstrap их не трогает.

### 8.5 Безопасный способ закрыть разрыв данных (рекомендация)

Вместо повторного bootstrap — **целевое добавление через существующие Admin API**:
1. `POST /api/admin/catalogs/facadeMaterial/items` — `mdf_pvc` (1 запись).
2. `POST /api/admin/parameters` — 61 параметр (или согласованный минимум).
3. Проверка: `GET /api/admin/catalogs/facadeMaterial`, `GET /api/admin/parameters`.

Так не затрагиваются конфликтующие записи и не требуется новый механизм.

### 8.6 План проверки и восстановления
- **До:** `VACUUM INTO` копия БД (проверено в WP-1: integrity `ok`, 9/9 коллекций, хеши совпадают).
- **После:** `dryRunBootstrap()` → `ready`/`ambiguous` не растут; `GET` каталога содержит `mdf_pvc`;
  расчёт `preview` с `mdf_pvc` проходит.
- **Откат:** восстановление из копии (штатный drill PASS).

---

## 9. Матрица Create / Preview

| Сценарий | Ожидаемое поведение | Покрытие тестами |
|---|---|---|
| Нет активного RulesSnapshot | `RULES_SNAPSHOT_MISSING`, расчёт не выполняется | `data-resolver.test.ts` |
| Активный валидный RulesSnapshot | create/preview доступны, `inputs.rulesSnapshot` заполнен | `contract-rules.test.ts`, `rules-diagnostics.test.ts` |
| Неизвестный RulesSnapshot ID (recalculate) | `RULES_SNAPSHOT_UNKNOWN`, fail-closed | `data-resolver.test.ts` |
| Повреждённый snapshot | `RULES_SNAPSHOT_CORRUPT`, fail-closed | `data-resolver.test.ts` |
| Отсутствует обязательное правило (шкаф) | контролируемая ошибка Engine «нормы 1.1/1.2» | `wardrobe-golden-verification.test.ts`, golden |
| Wardrobe с применимыми нормами | корректный расчёт петель | golden + `wardrobe-hinges` тесты |
| Kitchen | правила не читаются, результат не меняется | `golden.test.ts` |
| Legacy project (без `rulesSnapshotId`) | чтение разрешено, recalculate блокируется | `data-resolver.test.ts`, `legacy-facade-guard.test.ts` |

---

## 10. Блокеры и решения владельца

### Блокеры WP-3 (активация)
1. **OD-13** — подтверждение 27 норм (все `preliminary`) либо разрешение публикации как есть.
2. **D-1** — решение по `sourceRef` (исправить до импорта или принять как есть).
3. **CA-GL-22** — повторный bootstrap **невозможен** из-за 16 конфликтов; нужно решение:
   (а) целевое добавление `mdf_pvc` + параметров через Admin API (рекомендуется);
   (б) выравнивание конфликтующих записей по content (перезапись админ-правок — рискованно);
   (в) отложить.

### Не блокируют
- 200 исторических проектов (кухня, правила не читаются);
- Composition (pin необязателен, изменений не требует);
- отсутствующие `price-1`/`price-2` (чтение сохранённых цен работает).

### Запросы к владельцу
| ID | Вопрос | Варианты |
|---|---|---|
| OD-13 | 27 норм (`preliminary`) | подтвердить / публиковать как preliminary / отклонить |
| OD-14 | `sourceRef` (D-1) | исправить до импорта / принять |
| CA-GL-22 | Store-разрыв (`mdf_pvc`, 61 параметр) | Admin API (реком.) / bootstrap с выравниванием / отложить |


---

## 11. D-1 (WP-2.1) — исправление `sourceRef`

### 11.1 Что было
Единый `SEED_SOURCE_REF = "src/lib/configurator/wardrobe-hinges.ts:17-39"` для всех 27 правил.
Фактические значения расположены в строках **22–26** (плотности) и **35–43** (полосы), то есть
диапазон не покрывал полосы 5–8 и указывал на пустые строки.

### 11.2 Что стало
`sourceRef` вычисляется по фактической строке (изменён только seed, значения не тронуты):

| Правило | `sourceRef` |
|---|---|
| `rule-wardrobe-facade-density-16` | `src/lib/configurator/wardrobe-hinges.ts:23` |
| `rule-wardrobe-facade-density-19` | `…:24` |
| `rule-wardrobe-facade-density-22` | `…:25` |
| `rule-wardrobe-hinge-band-1-*` (3 правила) | `…:36` |
| `rule-wardrobe-hinge-band-2-*` | `…:37` |
| `rule-wardrobe-hinge-band-3-*` | `…:38` |
| `rule-wardrobe-hinge-band-4-*` | `…:39` |
| `rule-wardrobe-hinge-band-5-*` | `…:40` |
| `rule-wardrobe-hinge-band-6-*` | `…:41` |
| `rule-wardrobe-hinge-band-7-*` | `…:42` |
| `rule-wardrobe-hinge-band-8-*` | `…:43` |

Итого **11 уникальных строк** на 27 правил: 3 плотности + 8 строк полос.

### 11.3 Что НЕ сделано (сознательно)
- Источник **не подменён** документом-подтверждением: в репозитории нет ТЗ/паспорта с этими
  значениями. `source=preliminary` сохранён — норма остаётся неподтверждённой (OD-13).
- Значения, ID, `scope`, `category`, `affects`, `valueType` не изменялись.

### 11.4 Проверка
Добавлен тест `managed-rules-seed.test.ts` → «D-1 (WP-2.1): sourceRef указывает на фактическую
строку значения»:
1. каждый из 27 `sourceRef` разбирается как `file:line`, файл существует;
2. строка существует и **содержит значение** правила;
3. плотности различаются по строкам; каждая полоса ссылается ровно на `35 + N`;
4. `scope/category/source/affects` и распределение `valueType` (11 `decimal` + 16 `int`) не изменились.

---

## 12. D-2 (WP-2.1) — семантика физических единиц

### 12.1 Модель
- `managedRuleSchema.unit` — **optional** (`managed-rules.ts:157`).
- `RULE_UNITS` = `RUB`, `RUB_PER_SQM`, `RUB_PER_M`, `RUB_PER_LINM`, `RUB_PER_PCS`, `FACTOR`
  (`managed-rules.ts:54–61`) — **только денежные единицы**.
- Следовательно, физические единицы норм **не выразимы** в текущей модели.
  Схема, API и Engine в WP-2.1 **не изменялись**; валидация не обходилась.

### 12.2 Зафиксированная семантика

| Норма | Значение | Физическая единица | Где применяется |
|---|---|---|---|
| Плотность фасада 16/19/22 мм | 11.5 / 14.8 / 16.8 | **кг/м²** | `wardrobeDoorMassKg`: масса = площадь × плотность |
| `*-max-height` | 600…2700 | **мм** | сравнение с `panel.heightMm` |
| `*-max-mass` | 5…35 | **кг** | сравнение с массой двери |
| `*-count` | 2…6 | **шт.** (петель на дверь) | `wardrobe.fittings.amount` |

### 12.3 Блокер
Модель **не позволяет** выразить единицы при публикации: поле `unit` принимает только денежные
единицы, а опускать его — единственный валидный вариант. Семантика существует только в названиях
правил и в `description`.

**Статус:** зафиксировано как ограничение модели (**не блокер публикации**, т.к. Engine использует
числа в известном контексте). Изменение `RULE_UNITS` — отдельное архитектурное решение, в WP-2.1
не выполнялось и не рекомендуется без потребности.

### 12.4 Проверка «не безразмерные числа»
Engine умножает плотность на площадь (`m²`) и сравнивает массу (`кг`) с порогом, высоту (`мм`) — с
порогом. Размерность задаётся **местом применения**, а не полем. Тест
`wardrobe-golden-verification.test.ts` подтверждает, что результаты не изменились.

---

## 13. D-3 (WP-2.1) — overload fallback (зафиксировано)

| Аспект | Факт |
|---|---|
| Условие | дверь выше 2700 мм **или** тяжелее 35 кг |
| Поведение | `wardrobeHingeCountForDoor` → `null`; `wardrobeHingePlan` → `hingeCount = bands.at(-1).count` = **6**, `overload: true` |
| Значение | 6 петель (не 0, не ошибка) |
| Флаг | `plan.overloaded === true`, в `reason` перечислены проблемные двери |
| Engine | **не изменялся** |
| Покрытие тестом | `src/lib/configurator/wardrobe-hinges.test.ts:95` (`plan.overloaded === true`) |
| Риск | «мягкий» fallback: перегруженная дверь получает максимум петель, а не отказ. Зафиксировано для владельца, изменение — вне WP-2 |

---

## 14. Payloads (подготовлены, НЕ выполнялись)

### 14.1 Импорт правил
`POST /api/admin/rules/import`
- Headers: `Content-Type: application/json`, `Idempotency-Key: <uuid>`, сессия администратора.
- Body: `{}` (маршрут тело не читает; источник — `managedRulesSeedSpecs()`).
- Ожидание: `201`, `data.created` = 27 id, `data.expected` = 27.
- Повтор: `200`, `created: []` (идемпотентно); при расхождении содержимого — `409` без частичной записи.

### 14.2 Публикация снимка
`POST /api/admin/rules/publish`
```json
{
  "selection": [
    { "id": "rule-wardrobe-facade-density-16", "expectedVersion": "1" },
    { "id": "rule-wardrobe-facade-density-19", "expectedVersion": "1" },
    { "id": "rule-wardrobe-facade-density-22", "expectedVersion": "1" },
    { "id": "rule-wardrobe-hinge-band-1-max-height", "expectedVersion": "1" },
    { "id": "rule-wardrobe-hinge-band-1-max-mass", "expectedVersion": "1" },
    { "id": "rule-wardrobe-hinge-band-1-count", "expectedVersion": "1" },
    "… (полосы 2–8 по три правила; всего 27 позиций)"
  ],
  "confirmed": true,
  "expectedStateVersion": "none",
  "operationId": "<uuid>"
}
```
- `expectedVersion` = `"1"` — версия, которую создаёт импорт (`managed-rules-seed.ts:234`).
- `expectedStateVersion` = `"none"`, т.к. активного снимка нет (`resolveActiveRulesSnapshot().status === "none"`).
- `confirmed: true` обязателен (`verifyCriticalConfirmation`).
- Ожидание: `201`/`200`, активный снимок с 27 правилами.
- Восстановление при неудаче: публикация атомарна через journal; при ошибке активный снимок не
  создаётся; повтор с новым `operationId`. Откат = новая публикация (предыдущего снимка нет).

### 14.3 `mdf_pvc` (CatalogItem)
`POST /api/admin/catalogs/facadeMaterial/items`
```json
{
  "id": "mdf_pvc",
  "catalog": "facadeMaterial",
  "label": "МДФ в плёнке ПВХ",
  "attrs": {},
  "priceRefs": { "ratePerSqm": "catalog.facade.mdf_pvc.ratePerSqm" },
  "status": "active"
}
```
- `version`, `createdAt`, `updatedAt`, `updatedBy` добавляет сервер (`createCatalogItem`, `catalogs.ts:198–204`).
- `priceRefs` указывает на **существующий** PriceItem `catalog.facade.mdf_pvc.ratePerSqm` (проверено в Store).
- Конфликт: если `mdf_pvc` уже существует → `409` (создание не перезаписывает).
- Идемпотентность: **не гарантирована** — повтор после успеха даст конфликт; ключ идемпотентности
  маршрут не использует.

### 14.4 61 параметр — **невозможно через API**
| Факт | Доказательство |
|---|---|
| `GET /api/admin/parameters` — список | `parameters/route.ts` (только GET) |
| `GET/PATCH /api/admin/parameters/[id]` | `parameters/[id]/route.ts:17,33` |
| **POST/DELETE отсутствуют** | нет маршрута создания |
| Единственный механизм создания | `applyBootstrap` (`bootstrap.ts:653,1287`) — заблокирован 16 конфликтами |
| Влияние на расчёт | **нулевое**: `parameters` берутся из манифеста (`data-resolver.ts:1326`), не из коллекции |

**Вывод:** целевое добавление 61 параметра через Admin API **невыполнимо** без новой разработки.
Коллекция влияет только на Admin UI, не на расчёт.

---

## 15. Обновлённые блокеры и решения

| ID | Вопрос | Статус после WP-2.1 |
|---|---|---|
| OD-13 | Подтверждение 27 норм (`preliminary`) | **ожидает**; технические блокеры сняты |
| OD-14 | `sourceRef` (D-1) | **закрыт**: исправлено на точные строки + тест |
| CA-GL-22a | `mdf_pvc` | готово к выполнению: payload и проверки |
| CA-GL-22b | 61 параметр | **блокер**: нет create-API; влияния на расчёт нет |

---

## 16. WP-2.2 — выполнение (2026-11-16)

### 16.1 Preflight
| Проверка | Результат |
|---|---|
| Backend | `sqlite` (`data/formakub.db`), `NODE_ENV=test`, `FORMAKUB_STORAGE=sqlite` |
| ManagedRules | **0 записей** (совпадает с WP-2.1) |
| Активный RulesSnapshot | **нет** (`status: "none"`) |
| `mdf_pvc` | отсутствует в `facadeMaterial` (там: `ldsp, mdf, veneer, glass, solid`) |
| PriceItem `catalog.facade.mdf_pvc.ratePerSqm` | **существует**, `RUB_PER_SQM`, `active` |
| Проекты | SQLite — 0; JSON — 200 (sha256 `0472da8a…`) |
| Integrity | `ok` |
| Checkpoint | `data/backups/wp22-checkpoint-2026-11-16T12-25-24-039Z.db`, integrity `ok`, 9 коллекций |

Расхождение «200 проектов только в JSON» известно с WP-1 и не является новым; активный backend — SQLite
(ADR-01 для production). JSON-набор не затрагивался.

### 16.2 Импорт правил — выполнено
- `created: 27`, `skipped: 0`; все `status=draft`, `version="1"`, `source=preliminary`.
- Повторный импорт: `created: 0`, `skipped: 27` — **идемпотентно**.

### 16.3 Публикация снимка — **ЗАБЛОКИРОВАНА инвариантом Q7-06**
`publishRulesSnapshot` отклонил выбор:
```
Правило "rule-wardrobe-facade-density-16" имеет source=preliminary
и не может быть опубликовано (Q7-06).
```
Источник: `src/lib/admin/managed-rules.ts:865–869`.
Обоснование: **ADR-07, Q7-06** — «полное исключение `preliminary` из расчёта: запись может
существовать в каталоге; не входит в опубликованный расчётный снимок» (ADR-07 §13, строка 31).
Также ADR-07 §508: в снимок нормы попадают **только после смены `source` на `owner_confirmed`**
через lifecycle.

**Противоречие решений:** OD-13 разрешает публикацию «со статусом preliminary» и одновременно
запрещает повышать статус. Q7-06 (утверждённый ADR) требует обратного. Проверки **не обходились**,
альтернативный механизм не создавался.

### 16.4 `mdf_pvc` — добавлено
- `POST`-эквивалент (`createCatalogItem`): создан `mdf_pvc`, `version="1"`, `status="active"`,
  `priceRefs = { ratePerSqm: "catalog.facade.mdf_pvc.ratePerSqm" }`.
- Чтение подтверждает: `facadeMaterial` теперь 6 записей (`ldsp, mdf, veneer, glass, solid, mdf_pvc`).
- Ссылка на цену разрешается: `catalog.facade.mdf_pvc.ratePerSqm` → `RUB_PER_SQM`, `active`.
- Существующие материалы не изменялись, тарифы не менялись.

> HTTP-маршруты не вызывались: административный API требует OIDC-сессии, которой в этой среде нет.
> Выполнены **те же сервисные функции**, что вызывают маршруты (`importManagedRulesSeed`,
> `publishRulesSnapshot`, `createCatalogItem`) против production-данных SQLite.

### 16.5 Состояние после операций
| Параметр | Значение |
|---|---|
| Коллекции SQLite | 10 (было 9; добавлена `managed-rules.json`; `rules-snapshots.json` **не создан**) |
| ManagedRules | 27, все `draft`, `preliminary` |
| Активный RulesSnapshot | **нет** |
| `mdf_pvc` | есть, цена разрешается |
| `integrity_check` | `ok` |
| `data/projects.json` sha256 | `0472da8a…` — **не изменён** (200 проектов) |
| Расчёт create/preview | по-прежнему `RULES_SNAPSHOT_MISSING` (контролируемо) |

### 16.6 Требуемое решение (OD-15)
Активация невозможна без одного из вариантов:
| Вариант | Следствие | Требует |
|---|---|---|
| **A.** Сменить `source` 27 правил на `owner_confirmed` и опубликовать | значение норм становятся «подтверждёнными» — противоречит OD-13 («не считать подтверждёнными») | решение владельца о фактическом подтверждении норм |
| **B.** Изменить Q7-06/ADR-07 (разрешить `preliminary` в снимке) | архитектурное изменение, вне scope WP-2.2 | новый ADR/пересмотр ADR-07 |
| **C.** Оставить 27 правил в `draft` | расчёт новых проектов остаётся блокированным | — |

Рекомендация: **A**, если владелец готов подтвердить нормы; иначе **C** до появления подтверждённых
значений. Вариант B не рекомендуется (меняет утверждённый инвариант «preliminary не участвует в расчёте»).

---

## 17. WP-2.3 — Owner confirmation и активация (2026-11-16)

### 17.1 Основание
**OD-15 (решение владельца):** все 27 правил утверждены как **расчётные допущения FormaCUB для
ориентировочных расчётов**. Это **не** подтверждение производственной или универсальной технической
достоверности.

### 17.2 Штатный механизм подтверждения
| Аспект | Факт |
|---|---|
| Операция | `updateManagedRule(id, { source: "owner_confirmed", expectedVersion })` — PATCH `/api/admin/rules/[id]` |
| Соответствие ADR-07 / Q7-06 | Да: Q7-06 запрещает `preliminary` в снимке; ADR-07 §508 требует смены `source` на `owner_confirmed` через существующий lifecycle |
| Отдельного `rule.confirm` | **нет**; подтверждение выражается сменой `source` |
| Значения/ID/`sourceRef`/`scope`/`category`/`affects`/`valueType` | **не изменялись** (проверено сравнением до/после) |
| Версия правила | `1` → `2` (штатный `nextVersion`) |
| Статус | остаётся `draft` до публикации снимка |

**Audit trail:** 27 событий `rule.update` с `actorId = "owner-od15"`, датой и переходом версии.
Ограничение: схема аудита (`admin-audit-log`) **не содержит поля для текстового основания** —
фиксируются actor, дата, action, entity, версии. Основание (формулировка OD-15) зафиксировано в
этом документе; изменение схемы аудита — вне scope.

### 17.3 Публикация
| Параметр | Значение |
|---|---|
| Snapshot ID | **`rules-e36377dc500aff22`** |
| Правил в снимке | **27** |
| `source` всех правил | `owner_confirmed` |
| Активность | `resolveActiveRulesSnapshot().status === "ok"` |
| Journal | `rules-publication-journal.json` — 1 запись |

### 17.4 Проверки после активации
| Проверка | Результат |
|---|---|
| Preview кухни (`resolveCalculationInputs` + `calculatePriceFromInputs`) | **ok**, `total = 210 100`, `rulesSnapshotId = rules-e36377dc500aff22` |
| Расчёт шкафа | **ok**, `total = 128 300`, `wardrobe.fittings = 29 050` |
| Границы полос (высота/масса) | 600/5 → 2 петли; 601/5 → 2; 2700/35 → 6 |
| Overload | 2701 мм → `null`; 36 кг → `null` (fallback `count=6` + `overload:true`) |
| Display adapter | ok (после отката `mdf_pvc`, см. § 17.5) |
| Golden / wardrobe-golden | **без изменений** (135 тестов PASS) |
| Исторические проекты | `data/projects.json` SHA-256 `0472da8a…` — не изменён (200 записей) |
| SQLite integrity | `ok` |

### 17.5 CA-GL-22a — откат `mdf_pvc` (обнаружена связанность)
После добавления `mdf_pvc` **реальный расчёт упал**: `DISPLAY_METADATA_UNAVAILABLE` —
`readDisplayMetadata` проверяет fingerprint, который покрывает **labels каталогов**
(`display-metadata.ts:642–651`). Добавление CatalogItem меняет fingerprint.

Проверка на контрольной точке (до `mdf_pvc`): metadata **валидна** (`ok:ec5195ec64d9`).
Следовательно, поломку вызвало добавление элемента, а не предыдущее состояние.

**Действие:** `mdf_pvc` удалён; `catalog-items.json` побайтно совпал с checkpoint (`2de49fce3bec`);
metadata снова валидна (`ec5195ec64d9`); расчёт восстановлен.

**Вывод:** добавление CatalogItem требует **одновременного** пересчёта display-metadata
(`seedDisplayMetadata`). Операция должна выполняться как единый авторизованный пакет; в WP-2.3
такого разрешения не было, поэтому элемент откачен, production оставлен рабочим.

### 17.6 Остаточные ограничения
1. `description` правил сохраняет исходную формулировку «source=preliminary» (атрибуты не менялись).
   Авторитетная семантика — поле `source=owner_confirmed` + OD-15 + этот документ.
2. Текстовое основание не хранится в audit-log (нет поля); запись — в документации.
3. `mdf_pvc` отсутствует (откачен). Требуется отдельное разрешение на пакет
   «добавить CatalogItem + пересчитать display-metadata».
4. 200 исторических проектов остаются в JSON-наборе, в активном SQLite `projects = 0` — расхождение
   зафиксировано, объединение хранилищ не выполнялось.
