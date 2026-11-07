import { describe, expect, it } from "vitest";

import { defaultKitchen } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";
import type { StoredProject } from "@/lib/configurator/types";
import { SUPPORTED_SCHEMA_VERSION } from "@/lib/configurator/versions";

import { MIGRATIONS, applyMigrations, schemaVersionOf } from "./migrations";

function record(overrides: Partial<StoredProject> = {}): StoredProject {
  const config = defaultKitchen();
  return {
    id: "abcdefgh",
    config,
    price: calculatePrice(config),
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("schemaVersionOf (дизайн §12 S1)", () => {
  it("берёт поле записи, если оно есть", () => {
    expect(schemaVersionOf(record({ schemaVersion: 3 }))).toBe(3);
  });

  it("без поля берёт config.version", () => {
    const project = record();
    delete project.schemaVersion;
    expect(schemaVersionOf(project)).toBe(1);
  });

  it("без поля и без config.version → поддерживаемая версия", () => {
    const project = record();
    delete project.schemaVersion;
    delete (project.config as { version?: number }).version;
    expect(schemaVersionOf(project)).toBe(SUPPORTED_SCHEMA_VERSION);
  });
});

describe("цепочка миграций (CA-T-105)", () => {
  it("содержит пустую ступень v1→v2", () => {
    const step = MIGRATIONS.find((item) => item.from === 1 && item.to === 2);
    expect(step).toBeDefined();
    const project = record();
    expect(step!.migrate(project)).toEqual(project);
  });

  it("до поддерживаемой версии ничего не применяет и запись не меняет", () => {
    const project = record();
    const outcome = applyMigrations(project);
    expect(outcome.applied).toEqual([]);
    expect(outcome.project).toEqual(project);
  });

  it("пустая ступень v1→v2 идемпотентна: двойной прогон даёт тот же результат", () => {
    const first = applyMigrations(record(), 2);
    expect(first.applied).toEqual([2]);
    expect(first.project.schemaVersion).toBe(2);
    expect(first.project.config).toEqual(defaultKitchen());

    const second = applyMigrations(first.project, 2);
    expect(second.applied).toEqual([]);
    expect(second.project).toEqual(first.project);
  });

  it("запись новее целевой версии не мигрируется", () => {
    expect(() => applyMigrations(record({ schemaVersion: 2 }), 1)).toThrow(
      /новее целевой/,
    );
  });

  it("отсутствующая ступень — явная ошибка, а не тихий пропуск", () => {
    expect(() => applyMigrations(record({ schemaVersion: 0 }), 1)).toThrow(
      /Отсутствует миграция/,
    );
  });
});
