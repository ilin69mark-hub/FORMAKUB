"use client";

import type { FurnitureConfig, FurnitureType } from "./types";
import { normalizeKitchen } from "./defaults";
import { safeParseConfig } from "./schema";

const VERSION = "v1";
const PENDING_SAVE_VERSION = "v1";

function keyFor(type: FurnitureType): string {
  return `formakub:draft:${type}:${VERSION}`;
}

function pendingSaveKeyFor(type: FurnitureType): string {
  return `formakub:save-operation:${type}:${PENDING_SAVE_VERSION}`;
}

export interface PendingSaveOperation {
  operationId: string;
  configFingerprint: string;
}

export function savePendingSaveOperation(
  type: FurnitureType,
  operation: PendingSaveOperation,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      pendingSaveKeyFor(type),
      JSON.stringify(operation),
    );
  } catch {
    // Storage disabled: retry still works within the current page.
  }
}

export function loadPendingSaveOperation(
  type: FurnitureType,
): PendingSaveOperation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(pendingSaveKeyFor(type));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingSaveOperation>;
    if (
      typeof value.operationId !== "string" ||
      value.operationId.length === 0 ||
      typeof value.configFingerprint !== "string" ||
      value.configFingerprint.length === 0
    ) {
      return null;
    }
    return {
      operationId: value.operationId,
      configFingerprint: value.configFingerprint,
    };
  } catch {
    return null;
  }
}

export function clearPendingSaveOperation(type: FurnitureType): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(pendingSaveKeyFor(type));
  } catch {
    // Ignore storage errors.
  }
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
