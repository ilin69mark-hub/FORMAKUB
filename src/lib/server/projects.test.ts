import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { defaultKitchen } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";
import { BUILD_CALC_VERSION, SUPPORTED_SCHEMA_VERSION } from "@/lib/configurator/versions";

import { getProject, saveProject } from "./projects";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-store-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(path.join(dir, "projects.json"), { force: true });
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeProjects(items: unknown): void {
  writeFileSync(path.join(dir, "projects.json"), JSON.stringify(items), "utf8");
}

function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const config = defaultKitchen();
  return {
    id: "abcdefgh",
    config,
    price: calculatePrice(config),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("штампы версий при сохранении (CA-T-107)", () => {
  it("новый проект содержит schemaVersion и calcVersion", async () => {
    const saved = await saveProject({ config: defaultKitchen() });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(saved.project.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(saved.project.calcVersion).toBe(BUILD_CALC_VERSION);
    expect(BUILD_CALC_VERSION).toMatch(/^calc-\d{4}\.\d{1,2}\.\d+$/);

    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(onDisk[0].calcVersion).toBe(BUILD_CALC_VERSION);
  });
});

describe("чтение старых и несовместимых проектов (CA-T-104, CA-T-106)", () => {
  it("запись без schemaVersion читается как v1 и не дозаписывается (S1)", async () => {
    writeProjects([stored()]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.versionsInferred).toBe(true);
    expect(result.project.schemaVersion).toBeUndefined();

    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "projects.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(onDisk[0].schemaVersion).toBeUndefined();
  });

  it("запись с поддерживаемой версией читается обычным порядком", async () => {
    writeProjects([stored({ schemaVersion: 1, calcVersion: "calc-2026.1.0" })]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.versionsInferred).toBe(false);
  });

  it("схема новее поддерживаемой → raw-режим с пометкой, а не 404", async () => {
    writeProjects([stored({ schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 })]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("unsupported");
    if (result.status !== "unsupported") return;
    expect(result.reason).toMatch(/новее поддерживаемой/);
    expect(result.project.id).toBe("abcdefgh");
  });

  it("конфиг, не проходящий текущие правила → unsupported с сохранённой ценой", async () => {
    const config = defaultKitchen();
    writeProjects([stored({ config: { ...config, modules: [] } })]);

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("unsupported");
    if (result.status !== "unsupported") return;
    expect(result.project.price.total).toBe(
      calculatePrice(defaultKitchen()).total,
    );
  });

  it("битая запись без config → карантин, файл не изменён (I-09)", async () => {
    const broken = stored();
    delete broken.config;
    writeProjects([broken]);
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("quarantined");
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);
  });

  it("нет файла и нет записи → not_found", async () => {
    expect((await getProject("abcdefgh")).status).toBe("not_found");

    writeProjects([stored({ id: "zzzzzzzz" })]);
    expect((await getProject("abcdefgh")).status).toBe("not_found");
  });
});

describe("повреждённое хранилище (CA-T-106, I-09)", () => {
  it("некорректный JSON → карантин вместо 500, файл не изменён", async () => {
    const raw = "{ это не JSON";
    writeFileSync(path.join(dir, "projects.json"), raw, "utf8");

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("quarantined");
    if (result.status === "quarantined") {
      expect(result.reason).toMatch(/некорректный JSON/);
    }
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(raw);
  });

  it("валидный не-массив → карантин вместо молчаливого []", async () => {
    const raw = JSON.stringify({ note: "not a collection" });
    writeFileSync(path.join(dir, "projects.json"), raw, "utf8");

    const result = await getProject("abcdefgh");
    expect(result.status).toBe("quarantined");
    if (result.status === "quarantined") {
      expect(result.reason).toMatch(/массив/);
    }
  });

  it("запись в повреждённое хранилище отменяется, данные не затираются", async () => {
    const raw = JSON.stringify({ note: "not a collection" });
    writeFileSync(path.join(dir, "projects.json"), raw, "utf8");

    await expect(saveProject({ config: defaultKitchen() })).rejects.toThrow(
      /повреждено/,
    );
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(raw);
  });
});
