"use client";

import type { FurnitureConfig, FurnitureType } from "./types";
import { normalizeKitchen } from "./defaults";
import { safeParseConfig } from "./schema";

const VERSION = "v1";

function keyFor(type: FurnitureType): string {
  return `formakub:draft:${type}:${VERSION}`;
}

export function saveLocalDraft(config: FurnitureConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(config.kind), JSON.stringify(config));
  } catch {
    // Storage may be disabled in private mode. The project can still be saved on the server.
  }
}

export function loadLocalDraft(type: FurnitureType): FurnitureConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(type));
    if (!raw) return null;
    const parsed = safeParseConfig(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.kind !== type) return null;
    return parsed.data.kind === "kitchen"
      ? normalizeKitchen(parsed.data)
      : parsed.data;
  } catch {
    return null;
  }
}

export function clearLocalDraft(type: FurnitureType): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(type));
  } catch {
    // Ignore storage errors.
  }
}

export function hasAnyLocalDraft(): FurnitureType | null {
  if (typeof window === "undefined") return null;
  if (loadLocalDraft("kitchen")) return "kitchen";
  if (loadLocalDraft("wardrobe")) return "wardrobe";
  return null;
}
