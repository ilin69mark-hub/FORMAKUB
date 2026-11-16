import { NextResponse } from "next/server";
import { z } from "zod";

import { BUILD_CALC_VERSION } from "@/lib/configurator/versions";
import { furnitureConfigSchema, projectIdSchema } from "@/lib/configurator/schema";
import { resolveCalculationInputs } from "@/lib/server/data-resolver";
import { calculatePriceFromInputs, getProject } from "@/lib/server/projects";

/**
 * CA-T-306C — read-only доставка CalculationInputs.
 *
 * Клиент присылает только намерение (create/preview/recalculate) и config
 * либо projectId. Цены/каталоги/пресеты/parameters/calcVersion/priceVersion
 * не принимаются: их разрешает существующий DataResolver на сервере.
 * Endpoint ничего не записывает.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * E2: `compositionVersionId` — additive-optional только для create/preview.
 * Для recalculate pin берётся из сохранённого проекта (единый источник,
 * дублирование в запросе не допускается). Старые запросы без поля
 * продолжают работать; обязательность не меняется.
 */
const compositionVersionIdSchema = z.string().trim().min(1).optional();

const calculationInputsRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("create"),
    config: furnitureConfigSchema,
    compositionVersionId: compositionVersionIdSchema,
  }),
  z.strictObject({
    operation: z.literal("preview"),
    config: furnitureConfigSchema,
    compositionVersionId: compositionVersionIdSchema,
  }),
  z.strictObject({
    operation: z.literal("recalculate"),
    projectId: projectIdSchema,
    expectedProjectCalcVersion: z.string().trim().min(1),
    expectedSourcePriceVersion: z.string().trim().min(1).nullable().optional(),
  }),
]);

function fail(
  status: number,
  error: string,
  issues?: ReadonlyArray<{ code: string; path: string; message: string; entityId?: string }>,
  reason?: string,
) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(issues ? { issues } : {}),
      ...(reason ? { reason } : {}),
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return fail(415, "Ожидается JSON-запрос.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Некорректный JSON.");
  }

  const parsed = calculationInputsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      422,
      "Запрос CalculationInputs не прошёл проверку.",
      parsed.error.issues.map((issue) => ({
        code: "INVALID_REQUEST",
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  try {
    let resolution;
    if (parsed.data.operation === "recalculate") {
      const project = await getProject(parsed.data.projectId);
      if (project.status === "not_found") {
        return fail(404, "Проект не найден.");
      }
      if (project.status === "quarantined") {
        return fail(409, "Данные проекта повреждены.", undefined, project.reason);
      }
      if (project.status === "unsupported") {
        return fail(422, "Проект несовместим с текущей схемой.", undefined, project.reason);
      }
      resolution = await resolveCalculationInputs({
        operation: "recalculate",
        project: project.project,
        expectedProjectCalcVersion: parsed.data.expectedProjectCalcVersion,
        requiredExecutedCalcVersion: BUILD_CALC_VERSION,
        expectedSourcePriceVersion:
          parsed.data.expectedSourcePriceVersion !== undefined
            ? parsed.data.expectedSourcePriceVersion
            : project.project.priceVersion ?? null,
      });
    } else {
      resolution = await resolveCalculationInputs({
        operation: parsed.data.operation,
        config: parsed.data.config,
        ...(parsed.data.compositionVersionId
          ? { compositionVersionId: parsed.data.compositionVersionId }
          : {}),
      });
    }

    if (!resolution.ok) {
      return fail(
        422,
        "Не удалось разрешить CalculationInputs.",
        resolution.issues,
      );
    }

    // CA-T-504/Public Calculator: единый расчётный путь сервер-авторитетно
    // считает PriceBreakdown тем же Engine/Display Adapter, что и сохранение
    // проекта. Клиент не вызывает legacy pricing и не собирает inputs.
    // E2: trace вычисляется после Engine на его готовом breakdown и не
    // влияет на price/итоги (В-2). Без composition-pin контекст не передаётся.
    const calculated = await calculatePriceFromInputs(resolution.value.request, {
      compositionPreflight: resolution.value.compositionPreflight,
    });
    if (!calculated.ok) {
      return fail(
        422,
        "Не удалось рассчитать стоимость.",
        calculated.issues,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        schemaVersion: resolution.value.request.schemaVersion,
        inputs: resolution.value.request.inputs,
        price: calculated.price,
        // E2: additive-поле; отсутствует для legacy-запросов без pin (В-1).
        ...(calculated.compositionTrace === undefined
          ? {}
          : { compositionTrace: calculated.compositionTrace }),
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  } catch (error) {
    console.error(
      "Failed to resolve calculation inputs",
      error instanceof Error ? error.message : error,
    );
    return fail(500, "Не удалось получить расчётные данные.");
  }
}
