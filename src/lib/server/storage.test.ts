import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dataFilePath, readCollection, readCollectionStatus, updateCollection } from "./store";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-storage-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.FORMAKUB_STORAGE;
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

type Kind = "json-file" | "sqlite";

function setKind(kind: Kind): void {
  if (kind === "sqlite") process.env.FORMAKUB_STORAGE = "sqlite";
  else delete process.env.FORMAKUB_STORAGE;
}

/** Одинаковый контракт чтения/записи для обоих носителей. */
function contractSuite(kind: Kind): void {
  describe(`контракт хранилища: ${kind} (CA-T-103)`, () => {
    it("отсутствующая коллекция → missing, путь записи → []", async () => {
      setKind(kind);
      expect(await readCollectionStatus("projects.json")).toEqual({
        status: "missing",
      });
      expect(await readCollection("projects.json")).toEqual([]);
    });

    it("запись через update → чтение возвращает данные", async () => {
      setKind(kind);
      const saved = await updateCollection<{ id: string }, { id: string }>(
        "projects.json",
        (items) => ({
          items: [...items, { id: "a1" }],
          result: { id: "a1" },
        }),
      );
      expect(saved).toEqual({ id: "a1" });
      expect(await readCollection("projects.json")).toEqual([{ id: "a1" }]);
    });

    it("битые данные → corrupt, чтение-для-записи бросает, носитель не изменяется (I-09)", async () => {
      setKind(kind);
      const corruptSource = "{broken";
      writeFileSync(path.join(dir, "projects.json"), corruptSource, "utf8");

      if (kind === "json-file") {
        expect(await readCollectionStatus("projects.json")).toMatchObject({
          status: "corrupt",
        });
      }
      // json: карантин; sqlite: переход отменяется — чтение не «умолкает»
      await expect(readCollection("projects.json")).rejects.toThrow(
        /повреждено|отменена/,
      );
      expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(
        corruptSource,
      );
    });

    it("не-массив в источнике → corrupt (не молчаливый [])", async () => {
      setKind(kind);
      const raw = JSON.stringify({ note: "not a collection" });
      writeFileSync(path.join(dir, "projects.json"), raw, "utf8");

      if (kind === "json-file") {
        expect(await readCollectionStatus("projects.json")).toEqual({
          status: "corrupt",
          reason: "ожидался массив записей",
        });
      } else {
        // миграция отменяется на этапе переноса — читать нечего
        await expect(readCollection("projects.json")).rejects.toThrow(
          /отменена/,
        );
      }
      expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(raw);
    });

    it("параллельные update не теряют записи (транзакционная целостность)", async () => {
      setKind(kind);
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          updateCollection<number, number>("projects.json", (items) => ({
            items: [...items, i],
            result: i,
          })),
        ),
      );
      expect(await readCollection("projects.json")).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    it("location() указывает на физический носитель", () => {
      setKind(kind);
      const location = dataFilePath("projects.json");
      if (kind === "json-file") {
        expect(location).toBe(path.join(dir, "projects.json"));
      } else {
        expect(location).toBe(path.join(dir, "formakub.db"));
        expect(existsSync(location)).toBe(false); // до первого обращения
      }
    });
  });
}

contractSuite("json-file");
contractSuite("sqlite");

describe("SQLite: контролируемый переход JSON → SQLite (ADR-01, CA-T-103)", () => {
  it("перенос без потери данных; после перехода JSON не источник истины", async () => {
    const project = { id: "abcdefgh", price: { total: 100 } };
    const lead = { id: "FK-1", price: { total: 50 } };
    writeFileSync(
      path.join(dir, "projects.json"),
      JSON.stringify([project]),
      "utf8",
    );
    writeFileSync(path.join(dir, "leads.json"), JSON.stringify([lead]), "utf8");

    setKind("sqlite");
    expect(await readCollection("projects.json")).toEqual([project]);
    expect(await readCollection("leads.json")).toEqual([lead]);

    // исходные файлы убраны из обращения (данные сохранены рядом)
    expect(existsSync(path.join(dir, "projects.json"))).toBe(false);
    expect(
      readdirSync(dir).some((name) => name.startsWith("projects.json.migrated-")),
    ).toBe(true);

    // «параллельного» источника нет: свежий JSON поверх мигрированного не читается
    writeFileSync(path.join(dir, "projects.json"), "{не читается", "utf8");
    expect(await readCollection("projects.json")).toEqual([project]);

    // повторное открытие не дублирует перенос
    expect(await readCollection("projects.json")).toEqual([project]);
  });

  it("повреждённый источник → переход отменяется, данные и чтение не теряются", async () => {
    const raw = "{broken";
    writeFileSync(path.join(dir, "projects.json"), raw, "utf8");
    writeFileSync(path.join(dir, "leads.json"), JSON.stringify([]), "utf8");

    setKind("sqlite");
    await expect(readCollection("projects.json")).rejects.toThrow(/отменена/);
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(raw);
    expect(readdirSync(dir).some((name) => name.includes("migrated"))).toBe(
      false,
    );

    // после исправления источника переход выполняется
    writeFileSync(
      path.join(dir, "projects.json"),
      JSON.stringify([{ id: "ok" }]),
      "utf8",
    );
    expect(await readCollection("projects.json")).toEqual([{ id: "ok" }]);
  });

  it("база соответствует ADR-01: один файл, транзакционность записи", async () => {
    setKind("sqlite");
    await updateCollection<string, string>("projects.json", (items) => ({
      items: [...items, "x"],
      result: "x",
    }));
    const dbFile = path.join(dir, "formakub.db");
    expect(existsSync(dbFile)).toBe(true);

    // запись завершена транзакцией: чтение напрямую из БД идемпотентно
    const db = new DatabaseSync(dbFile);
    const row = db
      .prepare("SELECT payload FROM collection_state WHERE collection = ?")
      .get("projects.json") as { payload: string };
    db.close();
    expect(JSON.parse(row.payload)).toEqual(["x"]);
  });

  it("бизнес-код читает данные в совместимом виде (существующие проекты)", async () => {
    const stored = {
      id: "abcdefgh",
      config: { kind: "kitchen", version: 1 },
      price: { total: 221600, currency: "RUB" },
      schemaVersion: 1,
      calcVersion: "calc-2026.11.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    writeFileSync(
      path.join(dir, "projects.json"),
      JSON.stringify([stored]),
      "utf8",
    );

    setKind("sqlite");
    const read = await readCollectionStatus<typeof stored>("projects.json");
    expect(read).toEqual({ status: "ok", items: [stored] });
  });
});

describe("отсутствие обхода Storage Adapter (CA-T-103)", () => {
  it("store.ts не содержит прямого доступа к файловой системе", async () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/server/store.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/node:fs/);
    expect(source).toMatch(/getStorage\(\)/);
  });

  it("projects.ts и leads.ts обращаются к хранилищу только через store.ts", () => {
    for (const file of ["projects.ts", "leads.ts"]) {
      const source = readFileSync(
        path.join(process.cwd(), "src/lib/server", file),
        "utf8",
      );
      expect(source).toMatch(/from "\.\/store"/);
      expect(source).not.toMatch(/node:fs/);
      expect(source).not.toMatch(/storage\//);
    }
  });
});
