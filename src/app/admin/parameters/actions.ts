"use server";

import { revalidatePath } from "next/cache";

import {
  applyParameterValueEdit,
  type ParameterEditResult,
} from "@/lib/admin/parameters-edit";
import { isAdminUiEnabled } from "@/lib/admin/ui-access";
import { actorFromSession, getCurrentSession } from "@/lib/auth/session";
import { auditDenied } from "@/lib/auth/audit-denied";

/**
 * CA-T-502 — server action для правки значения AdminParameter.
 *
 * Не создаёт новый HTTP-контур: вызывает существующий сервис CA-T-203 из
 * того же Next-приложения. Auth/RBAC не подключены (CA-T-602/603), поэтому
 * действие дополнительно закрыто guard-заглушкой CA-T-501 и выполняется от
 * явно локального оператора — права не подразумеваются.
 */

export interface ParameterActionState {
  ok: boolean;
  message: string;
}

export async function updateParameterValueAction(
  _previous: ParameterActionState | null,
  formData: FormData,
): Promise<ParameterActionState> {
  if (!isAdminUiEnabled()) {
    return {
      ok: false,
      message:
        "Панель отключена: для production-маршрута нужна аутентификация (CA-T-602).",
    };
  }
  const session = await getCurrentSession();
  if (!session) {
    await auditDenied({
      action: "param.update",
      entityType: "parameter",
      entityId: String(formData.get("id") ?? ""),
      actor: null,
      reason: "unauthenticated",
    });
    return { ok: false, message: "Требуется аутентификация." };
  }
  if (session.role !== "calc-admin") {
    await auditDenied({
      action: "param.update",
      entityType: "parameter",
      entityId: String(formData.get("id") ?? ""),
      actor: actorFromSession(session),
      reason: "calc-admin required",
    });
    return { ok: false, message: "Недостаточно прав: требуется calc-admin." };
  }

  let result: ParameterEditResult;
  try {
    result = await applyParameterValueEdit({
      id: String(formData.get("id") ?? ""),
      expectedVersion: String(formData.get("expectedVersion") ?? ""),
      rawValue: formData.has("value") ? String(formData.get("value")) : null,
      actor: actorFromSession(session),
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Не удалось применить изменение.",
    };
  }

  // Данные всегда перечитываются из фактического источника, в том числе
  // после конфликта версии — форма получает актуальную version.
  revalidatePath("/admin/parameters");

  return { ok: result.ok, message: result.message };
}
