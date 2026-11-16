/**
 * Реестр допустимых code-ссылок CompositionLine.
 *
 * Это **не исполняемый реестр**: Composition Management не вычисляет формулы.
 * Он фиксирует стабильные идентификаторы существующих реализаций, чтобы
 * администратор не мог ввести произвольную строку в quantityRef/condition.
 * Расширение реестра — только вместе с реальным кодом-потребителем.
 */

export interface CompositionCodeRef {
  id: string;
  label: string;
  sourceRef: string;
  /** Где допустим идентификатор. */
  usage: "quantity" | "condition" | "both";
}

export const COMPOSITION_CODE_REFS: readonly CompositionCodeRef[] = [
  {
    id: "calculateKitchenBreakdown",
    label: "Расчёт кухонного модуля",
    sourceRef: "src/lib/configurator/engine.ts:calculateKitchenBreakdown",
    usage: "both",
  },
  {
    id: "facadeDoorCount",
    label: "Число створок фасада",
    sourceRef: "src/lib/configurator/facade-geometry.ts:facadeDoorCount",
    usage: "both",
  },
  {
    id: "kitchenFacadeField",
    label: "Поле фасада кухни",
    sourceRef: "src/lib/configurator/facade-geometry.ts:kitchenFacadeField",
    usage: "both",
  },
  {
    id: "sinkLayout",
    label: "Раскладка мойки",
    sourceRef: "src/lib/configurator/sink.ts:sinkLayout",
    usage: "both",
  },
  {
    id: "sinkFacadeTotals",
    label: "Итоги фасадов мойки",
    sourceRef: "src/lib/configurator/sink.ts:sinkFacadeTotals",
    usage: "both",
  },
  {
    id: "computeSupports",
    label: "Расчёт опор",
    sourceRef: "src/lib/configurator/supports.ts:computeSupports",
    usage: "both",
  },
  {
    id: "computeLighting",
    label: "Расчёт подсветки",
    sourceRef: "src/lib/configurator/lighting.ts:computeLighting",
    usage: "both",
  },
  {
    id: "applyPromo",
    label: "Применение промокода",
    sourceRef: "src/lib/configurator/pricing.ts:applyPromo",
    usage: "both",
  },
  {
    id: "wardrobeEdgePlan",
    label: "План кромки шкафа",
    sourceRef: "src/lib/configurator/wardrobe-edge.ts:wardrobeEdgePlan",
    usage: "quantity",
  },
  {
    id: "wardrobeHingePlan",
    label: "План петель шкафа",
    sourceRef: "src/lib/configurator/wardrobe-hinges.ts:wardrobeHingePlan",
    usage: "quantity",
  },
  {
    id: "wardrobeDrawerCount",
    label: "Количество ящиков шкафа",
    sourceRef: "src/lib/configurator/wardrobe-components.ts:wardrobeDrawerCount",
    usage: "quantity",
  },
  {
    id: "wardrobeRodCount",
    label: "Количество штанг шкафа",
    sourceRef: "src/lib/configurator/wardrobe-components.ts:wardrobeRodCount",
    usage: "quantity",
  },
  {
    id: "wardrobeGeometry",
    label: "Геометрия шкафа",
    sourceRef: "src/lib/configurator/wardrobe-geometry.ts:wardrobeGeometry",
    usage: "both",
  },
] as const;

const BY_ID = new Map(COMPOSITION_CODE_REFS.map((item) => [item.id, item]));

export function getCompositionCodeRef(
  id: string,
): CompositionCodeRef | undefined {
  return BY_ID.get(id);
}

/** Стабильный id по строке evidence из статического read-model. */
export function codeRefForEvidence(evidence: string): string | undefined {
  if (evidence.includes("engine.ts:calculateKitchenBreakdown")) {
    return "calculateKitchenBreakdown";
  }
  if (evidence.includes("facade-geometry.ts")) return "kitchenFacadeField";
  if (evidence.includes("sink.ts")) return "sinkLayout";
  if (evidence.includes("supports.ts")) return "computeSupports";
  if (evidence.includes("lighting.ts")) return "computeLighting";
  if (evidence.includes("pricing.ts:applyPromo")) return "applyPromo";
  if (evidence.includes("wardrobe-edge.ts")) return "wardrobeEdgePlan";
  if (evidence.includes("wardrobe-hinges.ts")) return "wardrobeHingePlan";
  if (evidence.includes("wardrobe-components.ts:wardrobeDrawerCount")) {
    return "wardrobeDrawerCount";
  }
  if (evidence.includes("wardrobe-components.ts:wardrobeRodCount")) {
    return "wardrobeRodCount";
  }
  if (evidence.includes("wardrobe-geometry.ts")) return "wardrobeGeometry";
  return undefined;
}

export function isCompositionCodeRef(
  id: string,
  usage: "quantity" | "condition",
): boolean {
  const entry = BY_ID.get(id);
  return Boolean(
    entry && (entry.usage === "both" || entry.usage === usage),
  );
}
