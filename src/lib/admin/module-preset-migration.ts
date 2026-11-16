/**
 * Контролируемая миграция `basePrice` → `priceRef` (CA-T-201,
 * решение владельца 2026-11-07; дизайн §6.3: `priceRef` FK→PriceItem.id,
 * сумма входит в `priceVersion` через снимок).
 *
 * Свойства безопасности:
 * - исходные записи не изменяются и не удаляются (input не мутируется);
 * - сопоставление — только однозначное: ровно один PriceItem с суммой
 *   `basePrice`; отсутствие или неоднозначность → запись не конвертируется;
 * - при любом несопоставленном элементе `ok=false` и `migrated=[]` —
 *   частичная запись не выполняется, молчаливая потеря стоимости исключена;
 * - фиктивные PriceItem не создаются, соответствия не подбираются.
 */

export interface PriceRefCandidate {
  /** PriceItem.id (запись ставки). */
  id: string;
  /** Сумма ставки: снимок версии прайса (PriceItem сумму не хранит — X-3). */
  amount: number;
}

export interface UnresolvedPresetPrice {
  id: string;
  basePrice: number;
  reason: "no_match" | "ambiguous";
  /** id кандидатов с совпавшей суммой (для ambiguous — ≥ 2). */
  candidates: string[];
}

export interface PresetPriceMigrationResult<T> {
  /** true — все записи сопоставлены; только тогда `migrated` допустимо писать. */
  ok: boolean;
  /** Конвертированные записи: `basePrice` исключён, `priceRef` добавлен. */
  migrated: Array<Omit<T, "basePrice"> & { priceRef: string }>;
  unresolved: UnresolvedPresetPrice[];
  /** Исходные записи без изменений (для проверки/отката оператором). */
  unchanged: readonly T[];
}

/**
 * Миграция записей пресетов, содержащих `basePrice`, на `priceRef`.
 *
 * @param presets   записи с `id` и `basePrice` (исходные данные не мутируются)
 * @param priceItems ставки с суммами (из снимка/черновика версии прайса);
 *                   если список пуст или суммы не совпадают — записи не
 *                   конвертируются, возвращается список проблемных
 */
export function migratePresetBasePrice<T extends { id: string; basePrice: number }>(
  presets: readonly T[],
  priceItems: readonly PriceRefCandidate[],
): PresetPriceMigrationResult<T> {
  const migrated: Array<Omit<T, "basePrice"> & { priceRef: string }> = [];
  const unresolved: UnresolvedPresetPrice[] = [];

  for (const preset of presets) {
    const matches = priceItems.filter((item) => item.amount === preset.basePrice);

    if (matches.length === 1) {
      const rest = { ...preset } as Record<string, unknown>;
      delete rest.basePrice;
      migrated.push({
        ...rest,
        priceRef: matches[0].id,
      } as Omit<T, "basePrice"> & { priceRef: string });
    } else {
      unresolved.push({
        id: preset.id,
        basePrice: preset.basePrice,
        reason: matches.length === 0 ? "no_match" : "ambiguous",
        candidates: matches.map((item) => item.id),
      });
    }
  }

  const ok = unresolved.length === 0 && migrated.length === presets.length;
  return {
    // Частичная конвертация не возвращается: писать можно только при ok.
    ok,
    migrated: ok ? migrated : [],
    unresolved,
    unchanged: presets,
  };
}
