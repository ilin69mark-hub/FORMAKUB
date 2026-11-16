import { archiveCatalogItem } from "./catalogs";
import { archiveModulePreset } from "./presets";
import type { ActorContext } from "./parameters";
import type { CatalogItem, ModulePreset } from "./schema";

/**
 * CA-T-503 — применение архивирования из панели.
 *
 * Тонкая обвязка над существующими сервисами CA-T-204/CA-T-205: без
 * собственных правил жизненного цикла, без новых операций. Ошибки сервиса
 * (ссылки из проектов → 409, недопустимый переход, конфликт) пробрасываются
 * вызывающему сообщением.
 */

export interface CatalogArchiveRequest {
  catalog: string;
  id: string;
  actor: ActorContext;
}

export interface PresetArchiveRequest {
  family: string;
  id: string;
  actor: ActorContext;
}

export type ArchiveResult<T> =
  | { ok: true; item: T; message: string }
  | { ok: false; message: string };

function asMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export async function applyCatalogArchive(
  request: CatalogArchiveRequest,
): Promise<ArchiveResult<CatalogItem>> {
  try {
    const archived = await archiveCatalogItem(
      request.catalog,
      request.id,
      request.actor,
    );
    return {
      ok: true,
      item: archived,
      message: `В архиве: ${archived.catalog}:${archived.id}, статус ${archived.status}.`,
    };
  } catch (error) {
    return { ok: false, message: asMessage(error, "Не удалось архивировать элемент.") };
  }
}

export async function applyPresetArchive(
  request: PresetArchiveRequest,
): Promise<ArchiveResult<ModulePreset>> {
  try {
    const archived = await archiveModulePreset(
      request.family,
      request.id,
      request.actor,
    );
    return {
      ok: true,
      item: archived,
      message: `В архиве: ${archived.family}:${archived.id}, статус ${archived.status}, version ${archived.version}.`,
    };
  } catch (error) {
    return { ok: false, message: asMessage(error, "Не удалось архивировать пресет.") };
  }
}
