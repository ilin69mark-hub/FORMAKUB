import { appendAuditEvent } from "@/lib/server/audit";
import { readCollection, updateCollection } from "@/lib/server/store";

import type { ActorContext } from "./parameters";
import {
  catalogItemSchema,
  type CatalogItem,
  type ReferenceSource,
} from "./schema";

/**
 * CA-T-306D Phase 1 — explicit source migration для 10 Reference Data записей.
 * Idempotent: заполняет только отсутствующий source; иное значение — отказ.
 */

const COLLECTION = "catalog-items.json";
const TARGETS: ReadonlyArray<{
  catalog: "supportSystem" | "ledStrip";
  id: string;
  source: ReferenceSource;
}> = [
  { catalog: "supportSystem", id: "standard", source: "preliminary" },
  { catalog: "supportSystem", id: "heavy", source: "preliminary" },
  { catalog: "ledStrip", id: "led-24v-4w8", source: "preliminary" },
  { catalog: "ledStrip", id: "led-24v-9w6", source: "preliminary" },
  { catalog: "ledStrip", id: "led-24v-14w4", source: "preliminary" },
  { catalog: "ledStrip", id: "led-24v-19w2", source: "preliminary" },
  { catalog: "ledStrip", id: "led-12v-4w8", source: "preliminary" },
  { catalog: "ledStrip", id: "led-12v-9w6", source: "preliminary" },
  { catalog: "ledStrip", id: "led-12v-14w4", source: "preliminary" },
  { catalog: "ledStrip", id: "led-12v-19w2", source: "preliminary" },
];

export interface CatalogSourceMigrationResult {
  migrated: string[];
  unchanged: string[];
}

function entity(catalog: string, id: string): string {
  return `${catalog}:${id}`;
}

export async function migrateCatalogSources(
  actor: ActorContext,
  now = new Date().toISOString(),
): Promise<CatalogSourceMigrationResult> {
  const items = await readCollection<CatalogItem>(COLLECTION);
  const migrated: string[] = [];
  const unchanged: string[] = [];
  const next = [...items];
  const changes: Array<{ item: CatalogItem; oldValue: unknown; newValue: unknown }> = [];

  for (const target of TARGETS) {
    const index = next.findIndex(
      (item) => item.catalog === target.catalog && item.id === target.id,
    );
    if (index < 0) {
      throw new Error(`Source migration: ${entity(target.catalog, target.id)} не найден.`);
    }
    const current = next[index]!;
    const existing = current.attrs.source;
    if (existing !== undefined) {
      if (existing !== target.source) {
        throw new Error(
          `Source migration: ${entity(target.catalog, target.id)} имеет source="${String(existing)}", ожидался "${target.source}" — автоматическая замена запрещена.`,
        );
      }
      unchanged.push(entity(target.catalog, target.id));
      continue;
    }
    if (!/^\d+$/.test(current.version)) {
      throw new Error(
        `Source migration: ${entity(target.catalog, target.id)} version="${current.version}" не является числовой строкой.`,
      );
    }
    const candidate = catalogItemSchema.parse({
      ...current,
      attrs: { ...current.attrs, source: target.source },
      version: String(Number(current.version) + 1),
      updatedAt: now,
      updatedBy: actor.actorId,
    });
    next[index] = candidate;
    migrated.push(entity(target.catalog, target.id));
    changes.push({
      item: candidate,
      oldValue: { attrs: current.attrs },
      newValue: { attrs: candidate.attrs },
    });
  }

  if (migrated.length === 0) return { migrated, unchanged };

  await updateCollection<CatalogItem, void>(COLLECTION, () => ({
    items: next,
    result: undefined,
  }));

  for (const change of changes) {
    await appendAuditEvent({
      action: "catalog.update",
      entityType: "catalog",
      entityId: entity(change.item.catalog, change.item.id),
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      result: "ok",
      oldValue: change.oldValue,
      newValue: change.newValue,
      paramVersion: change.item.version,
    });
  }

  return { migrated, unchanged };
}
