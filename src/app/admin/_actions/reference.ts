"use server";

import { revalidatePath } from "next/cache";

import {
  applyCatalogArchive,
  applyPresetArchive,
  type ArchiveResult,
} from "@/lib/admin/reference-archive";
import { isAdminUiEnabled } from "@/lib/admin/ui-access";
import { actorFromSession, getCurrentSession } from "@/lib/auth/session";
import { authorizePermission } from "@/lib/auth/permissions";
import { auditDenied } from "@/lib/auth/audit-denied";

/**
 * CA-T-503 — server actions архивирования справочников и пресетов.
 *
 * Не создаёт HTTP-контур: вызывает существующие сервисы CA-T-204/CA-T-205
 * из того же приложения. Guard-заглушка CA-T-501 действует и здесь; RBAC
 * отсутствует (CA-T-602/603).
 */

export interface ReferenceActionState {
  ok: boolean;
  message: string;
}

function guard(): ReferenceActionState | null {
  if (isAdminUiEnabled()) return null;
  return {
    ok: false,
    message:
      "Панель отключена: для production-маршрута нужна аутентификация (CA-T-602).",
  };
}

export async function archiveCatalogItemAction(
  _previous: ReferenceActionState | null,
  formData: FormData,
): Promise<ReferenceActionState> {
  const denied = guard();
  if (denied) return denied;
  const session = await getCurrentSession();
  if (!session) {
    await auditDenied({
      action: "catalog.archive",
      entityType: "catalogItem",
      entityId: String(formData.get("id") ?? ""),
      actor: null,
      reason: "unauthenticated",
    });
    return { ok: false, message: "Требуется аутентификация." };
  }
  const allowed = authorizePermission(session, "catalog.write");
  if (!allowed.ok) {
    await auditDenied({
      action: "catalog.archive",
      entityType: "catalogItem",
      entityId: String(formData.get("id") ?? ""),
      actor: actorFromSession(session),
      reason: allowed.message,
    });
    return { ok: false, message: allowed.message };
  }

  let result: ArchiveResult<unknown>;
  try {
    result = await applyCatalogArchive({
      catalog: String(formData.get("catalog") ?? ""),
      id: String(formData.get("id") ?? ""),
      actor: actorFromSession(session),
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Не удалось архивировать элемент.",
    };
  }

  revalidatePath("/admin", "layout");
  return { ok: result.ok, message: result.message };
}

export async function archiveModulePresetAction(
  _previous: ReferenceActionState | null,
  formData: FormData,
): Promise<ReferenceActionState> {
  const denied = guard();
  if (denied) return denied;
  const session = await getCurrentSession();
  if (!session) {
    await auditDenied({
      action: "preset.update",
      entityType: "modulePreset",
      entityId: String(formData.get("id") ?? ""),
      actor: null,
      reason: "unauthenticated",
    });
    return { ok: false, message: "Требуется аутентификация." };
  }
  const allowed = authorizePermission(session, "catalog.write");
  if (!allowed.ok) {
    await auditDenied({
      action: "preset.update",
      entityType: "modulePreset",
      entityId: String(formData.get("id") ?? ""),
      actor: actorFromSession(session),
      reason: allowed.message,
    });
    return { ok: false, message: allowed.message };
  }

  let result: ArchiveResult<unknown>;
  try {
    result = await applyPresetArchive({
      family: String(formData.get("family") ?? ""),
      id: String(formData.get("id") ?? ""),
      actor: actorFromSession(session),
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Не удалось архивировать пресет.",
    };
  }

  revalidatePath("/admin", "layout");
  return { ok: result.ok, message: result.message };
}
