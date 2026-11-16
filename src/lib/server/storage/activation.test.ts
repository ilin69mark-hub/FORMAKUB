import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildImportSpec } from "@/lib/admin/import";
import { readCollection, updateCollection } from "@/lib/server/store";
import { backupDatabase, restoreDatabase, rotateBackups, verifyIntegrity } from "./backup";
import { runScheduledBackup, s3ConfigFromEnv, uploadFileToS3 } from "./s3";
import { getStorage, resolveStorageKind } from "./index";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-activ-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown): void {
  writeFileSync(path.join(dir, file), JSON.stringify(data), "utf8");
}

/** JSON-фикстуры всех сущностей ДО миграции (включая ранее подтверждённые 93/90). */
function seedJsonCollections(): void {
  writeJson("projects.json", [
    {
      id: "p1",
      config: { version: 1, calcVersion: "calc-2026.11.0", modules: [] },
      price: 221600,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    },
  ]);
  writeJson("leads.json", [{ id: "l1", createdAt: "2026-11-01T00:00:00.000Z" }]);

  // 93 PriceItem — тот же состав, что подтверждён CA-T-208 (buildImportSpec).
  const spec = buildImportSpec();
  expect(spec.entries.length).toBe(93);
  writeJson(
    "price-items.json",
    spec.entries.map((entry) => ({
      id: entry.id,
      scope: entry.scope,
      label: entry.label,
      unit: entry.unit,
      usage: entry.usage,
      status: "active",
      editable: entry.editable,
      sourceRef: entry.sourceRef,
      createdAt: "2026-11-08T00:00:00.000Z",
      updatedAt: "2026-11-08T00:00:00.000Z",
      updatedBy: "seed",
    })),
  );

  const used = spec.entries.filter((entry) => entry.usage === "used");
  expect(used.length).toBe(90);
  writeJson("pricing-versions.json", [
    {
      id: "price-demo-2026-01",
      label: "Draft",
      status: "draft",
      snapshot: used.map((entry) => ({ priceItemId: entry.id, amount: entry.value })),
      rules: { rounding: 100, minOrder: 45000 },
      promos: [],
      baseSchema: 1,
      createdAt: "2026-11-08T00:00:00.000Z",
      createdBy: "seed",
    },
    {
      id: "price-2026.10.9",
      label: "Историческая",
      status: "superseded",
      snapshot: [{ priceItemId: "kitchen.shelf", amount: 999 }],
      rules: { rounding: 100, minOrder: 45000 },
      promos: [],
      baseSchema: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      createdBy: "seed",
      publishedSeq: 1,
    },
  ]);
  writeJson("pricing-changes.json", [
    {
      id: "ch-1",
      versionId: "price-2026.10.9",
      targetType: "priceItem",
      targetKey: "kitchen.shelf",
      field: "amount",
      oldValue: 900,
      newValue: 999,
      createdBy: "seed",
      createdAt: "2026-10-02T00:00:00.000Z",
    },
  ]);
  writeJson("admin-audit-log.json", [
    {
      id: "ev-1",
      action: "diagnostic.run",
      entityType: "priceItem",
      entityId: "import",
      actorId: "admin-1",
      actorRole: "calc-admin",
      result: "ok",
      createdAt: "2026-11-08T00:00:00.000Z",
    },
  ]);
  writeJson("module-presets.json", [{ id: "base", family: "kitchen", priceRef: "kitchen.shelf" }]);
  writeJson("catalog-items.json", [{ id: "compact_hpl", catalog: "bodyMaterial", label: "Compact HPL" }]);
  writeJson("admin-parameters.json", [{ id: "kitchen.led.endMargin", scope: "kitchen" }]);
  writeJson("parameter-dependencies.json", [
    {
      id: "dep-1",
      sourceType: "preset",
      sourceId: "kitchen:base",
      targetType: "calculation",
      targetId: "calculateKitchenPrice",
      targetFile: "src/lib/configurator/pricing.ts",
      targetFunction: "calculateKitchenPrice",
      effect: "price",
      evidence: "CONFIRMED",
      syncRisk: false,
    },
  ]);
}

describe("resolveStorageKind (ADR-01, production-активация)", () => {
  it("production: отсутствие FORMAKUB_STORAGE → sqlite (без тихого fallback на JSON)", () => {
    expect(resolveStorageKind("production", undefined)).toBe("sqlite");
    expect(resolveStorageKind("production", "")).toBe("sqlite");
    expect(resolveStorageKind("production", "sqlite")).toBe("sqlite");
  });

  it("production: любое иное значение → явная ошибка запуска", () => {
    expect(() => resolveStorageKind("production", "json-file")).toThrow(
      /единственное основное хранилище/,
    );
    expect(() => resolveStorageKind("production", "SQLITE")).toThrow(/остановлено|исключён/);
    expect(() => resolveStorageKind("production", "bogus")).toThrow(/остановлено|исключён/);
  });

  it("вне production: json-file по умолчанию (тесты/миграция), sqlite — по явному включению", () => {
    expect(resolveStorageKind("test", undefined)).toBe("json-file");
    expect(resolveStorageKind("development", "json-file")).toBe("json-file");
    expect(resolveStorageKind("test", "sqlite")).toBe("sqlite");
    expect(() => resolveStorageKind("test", "bogus")).toThrow(/Неизвестное значение/);
  });

  it("getStorage в production: отсутствие настроек → sqlite (не JSON); json-file → явная ошибка до кэша", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      // Отсутствие FORMAKUB_STORAGE не откатывает production на JSON.
      delete process.env.FORMAKUB_STORAGE;
      expect(getStorage().kind).toBe("sqlite");

      // Явно недопустимое значение — ошибка, а не тихий fallback
      // (бросается до кэширования: повторный вызов также бросает).
      vi.stubEnv("FORMAKUB_STORAGE", "json-file");
      expect(() => getStorage()).toThrow(/ADR-01/);
      expect(() => getStorage()).toThrow(/ADR-01/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("миграция JSON → SQLite: сверка до/после (§5, ADR-01 п.7)", () => {
  it("первое обращение мигрирует все сущности: counts, id, содержимое, 93/90", async () => {
    seedJsonCollections();

    // Фактический триггер миграции: первое чтение через единый фасад.
    const projects = await readCollection<Record<string, unknown>>("projects.json");
    const items = await readCollection<Record<string, unknown>>("price-items.json");
    const versions = await readCollection<Record<string, unknown>>("pricing-versions.json");
    const changes = await readCollection<Record<string, unknown>>("pricing-changes.json");
    const audit = await readCollection<Record<string, unknown>>("admin-audit-log.json");
    const presets = await readCollection<Record<string, unknown>>("module-presets.json");

    // Counts и содержимое после миграции.
    expect(projects.length).toBe(1);
    expect(projects[0]).toMatchObject({ id: "p1", price: 221600 });
    expect(items.length).toBe(93); // ранее подтверждённые данные CA-T-208
    expect(new Set(items.map((item) => item.id)).size).toBe(93);
    const draftVersion = versions.find((version) => version.id === "price-demo-2026-01") as
      | { status: string; snapshot: Array<{ priceItemId: string; amount: number }> }
      | undefined;
    expect(draftVersion?.status).toBe("draft");
    expect(draftVersion?.snapshot.length).toBe(90); // ранее подтверждённый снимок
    expect(new Set(draftVersion!.snapshot.map((entry) => entry.priceItemId)).size).toBe(90);
    expect(changes.length).toBe(1);
    expect(audit.length).toBe(1);
    expect(presets.length).toBe(1);

    // Идентификаторы и значения сохранены по каждой сущности.
    expect(items.some((item) => item.id === "kitchen.shelf")).toBe(true);
    expect(changes[0]).toMatchObject({ versionId: "price-2026.10.9", field: "amount" });

    // Физика: БД создана, исходные JSON убраны из обращения (архив CA-T-103),
    // параллельных источников истины нет.
    expect(existsSync(path.join(dir, "formakub.db"))).toBe(true);
    expect(existsSync(path.join(dir, "projects.json"))).toBe(false);
    const archives = readdirSync(dir).filter((name) => name.includes(".migrated-"));
    expect(archives.length).toBeGreaterThanOrEqual(9);

    // Повторные обращения не мигрируют повторно (идемпотентность).
    const archivesBefore = readdirSync(dir).filter((name) => name.includes(".migrated-")).length;
    const again = await readCollection<Record<string, unknown>>("price-items.json");
    expect(again.length).toBe(93);
    expect(
      readdirSync(dir).filter((name) => name.includes(".migrated-")).length,
    ).toBe(archivesBefore);
  });

  it("повреждённый источник: миграция отменяется, файлы не изменяются, повтор идемпотентно отказывает", async () => {
    writeJson("projects.json", []);
    writeFileSync(path.join(dir, "leads.json"), "{битый json", "utf8");
    const leadsBefore = readFileSync(path.join(dir, "leads.json"), "utf8");
    const projectsBefore = readFileSync(path.join(dir, "projects.json"), "utf8");

    await expect(readCollection("projects.json")).rejects.toThrow(/отменена/);
    await expect(readCollection("projects.json")).rejects.toThrow(/отменена/);

    expect(readFileSync(path.join(dir, "leads.json"), "utf8")).toBe(leadsBefore);
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(projectsBefore);
    expect(
      readdirSync(dir).filter((name) => name.includes(".migrated-")).length,
    ).toBe(0);
  });

  it("после миграции приложение читает именно SQLite (единый адаптер)", async () => {
    seedJsonCollections();
    await readCollection("price-items.json"); // триггер миграции

    const storage = getStorage();
    expect(storage.kind).toBe("sqlite");
    expect(storage.location("price-items.json")).toBe(path.join(dir, "formakub.db"));

    // Запись уходит в SQLite: JSON-файл коллекции не воссоздаётся.
    await updateCollection("leads.json", (items) => ({
      items: [...items, { id: "l2", createdAt: "2026-11-09T00:00:00.000Z" }],
      result: undefined,
    }));
    expect(existsSync(path.join(dir, "leads.json"))).toBe(false);
    expect((await readCollection("leads.json")).length).toBe(2);
  });
});

describe("backup/restore (ADR-03 в объёме карточки INFRA-SQLITE-001)", () => {
  it("backup активной WAL-базы: integrity ok, все данные в копии", async () => {
    seedJsonCollections();
    await readCollection("price-items.json"); // миграция → активная БД с WAL

    const result = await backupDatabase(path.join(dir, "backups"));

    expect(result.integrity).toBe("ok");
    expect(existsSync(result.file)).toBe(true);
    expect(verifyIntegrity(result.file)).toBe("ok");

    // Содержимое копии: те же 93 ставки (снимок согласован при активной БД).
    const copy = await readCollectionFrom(result.file, "price-items.json");
    expect(copy.length).toBe(93);
  });

  it("restore: согласованное состояние в целевом каталоге, повторное чтение успешно", async () => {
    seedJsonCollections();
    await readCollection("price-items.json");
    const result = await backupDatabase(path.join(dir, "backups"));

    const target = path.join(dir, "restore-target");
    const restored = restoreDatabase(result.file, target);

    expect(restored.integrity).toBe("ok");
    expect(restored.restoredTo).toBe(path.join(target, "formakub.db"));
    expect(existsSync(result.file)).toBe(true); // копия не удаляется

    // Повторное чтение восстановленных данных (вне зависят от env: прямое
    // чтение через Storage Adapter по переключённому каталогу).
    const prev = process.env.FORMAKUB_DATA_DIR;
    process.env.FORMAKUB_DATA_DIR = target;
    try {
      const items = await readCollection("price-items.json");
      const versions = await readCollection("pricing-versions.json");
      expect(items.length).toBe(93);
      expect(
        (versions[0] as { snapshot: unknown[] }).snapshot.length,
      ).toBe(90);
    } finally {
      process.env.FORMAKUB_DATA_DIR = prev;
    }
  });

  it("повреждённая резервная копия → restore отклонён, целевой каталог не создаётся", () => {
    const broken = path.join(dir, "broken.db");
    writeFileSync(broken, "это не база", "utf8");
    const target = path.join(dir, "never-created");

    expect(() => restoreDatabase(broken, target)).toThrow(/повреждена|integrity/);
    expect(existsSync(target)).toBe(false);
  });
});

describe("конфигурация инфраструктуры (статические проверки)", () => {
  it("docker-compose.yml: FORMAKUB_STORAGE=sqlite и постоянный volume /app/data", () => {
    const compose = readFileSync(path.join(process.cwd(), "docker-compose.yml"), "utf8");
    expect(compose).toContain("FORMAKUB_STORAGE=sqlite");
    expect(compose).toContain("/app/data");
    expect(compose).toMatch(/app-data:\s*$/m);
  });

  it("Dockerfile: каталог /app/data создан с владельцем приложения (наследование прав volume)", () => {
    const dockerfile = readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    expect(dockerfile).toContain("mkdir -p /app/data");
    expect(dockerfile).toContain("chown nextjs:nodejs /app/data");
  });

  it(".env.example документирует FORMAKUB_STORAGE", () => {
    const env = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    expect(env).toContain("FORMAKUB_STORAGE");
  });

  it("docker-compose.yml: ADR-03 backup/S3-переменные прокидываются без фиктивных значений", () => {
    const compose = readFileSync(path.join(process.cwd(), "docker-compose.yml"), "utf8");
    expect(compose).toContain("FORMAKUB_BACKUP_INTERVAL_MS");
    for (const key of [
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_REGION",
      "S3_PREFIX",
    ]) {
      expect(compose).toContain(key);
    }
    // Пустые значения не превращаются в выдуманные credentials.
    expect(compose).toContain("${S3_ENDPOINT:-}");
    expect(compose).toContain("${S3_ACCESS_KEY_ID:-}");
  });

  it(".env.example документирует backup и S3 (ADR-03)", () => {
    const env = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    expect(env).toContain("FORMAKUB_BACKUP_INTERVAL_MS");
    expect(env).toContain("S3_ENDPOINT");
    expect(env).toContain("S3_BUCKET");
    expect(env).toContain("S3_ACCESS_KEY_ID");
    expect(env).toContain("S3_SECRET_ACCESS_KEY");
  });
});

/** Прямое чтение коллекции из произвольного файла БД (для проверки копий/восстановления). */
async function readCollectionFrom(dbFile: string, collection: string): Promise<unknown[]> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT payload FROM collection_state WHERE collection = ?")
      .get(collection) as { payload: string } | undefined;
    if (!row) return [];
    return JSON.parse(row.payload) as unknown[];
  } finally {
    db.close();
  }
}


// ─── Ротация резервных копий (ADR-03: 48 hourly / 30 daily / 12 monthly) ───

describe("ротация резервных копий ADR-03 (48/30/12)", () => {
  function seedTier(dirBk: string, tier: string, count: number, startMs: number): void {
    for (let i = 0; i < count; i++) {
      const file = path.join(dirBk, `formakub-${tier}-2026-01-01T${String(i).padStart(2, "0")}.db`);
      writeFileSync(file, `копия ${tier} ${i}`, "utf8");
      const time = new Date(startMs + i * 1000);
      utimesSync(file, time, time); // детерминированный mtime: чем новее index, тем новее файл
    }
  }

  it("корзины удерживают retention; излишки удалены; чужие/ручные файлы не трогаются", () => {
    const dirBk = path.join(dir, "rot");
    mkdirSync(dirBk, { recursive: true });
    const old = Date.now() - 5 * 60 * 60 * 1000;
    seedTier(dirBk, "hourly", 50, old);
    seedTier(dirBk, "daily", 31, old);
    seedTier(dirBk, "monthly", 13, old);
    // Ручной/исторический бэкап без tier-префикса и посторонний файл.
    writeFileSync(path.join(dirBk, "formakub-2026-11-08T00-00-00.db"), "ручной", "utf8");
    writeFileSync(path.join(dirBk, "notes.txt"), "посторонний", "utf8");

    const result = rotateBackups(dirBk);

    const count = (tier: string) =>
      readdirSync(dirBk).filter(
        (name) => name.startsWith(`formakub-${tier}-`) && name.endsWith(".db"),
      ).length;
    expect(count("hourly")).toBe(48);
    expect(count("daily")).toBe(30);
    expect(count("monthly")).toBe(12);
    // Удалено: hourly 2 + daily 1 + monthly 1 = 4.
    expect(result.removed.length).toBe(4);
    expect(existsSync(path.join(dirBk, "formakub-2026-11-08T00-00-00.db"))).toBe(true);
    expect(existsSync(path.join(dirBk, "notes.txt"))).toBe(true);

    // Идемпотентность: повторная ротация ничего не удаляет.
    const again = rotateBackups(dirBk);
    expect(again.removed).toEqual([]);
    expect(count("hourly")).toBe(48);
  });

  it("backupDatabase(tier) именует файл по корзине и запускает ротацию автоматически", async () => {
    seedJsonCollections();
    await readCollection("price-items.json"); // миграция → БД существует
    const dirBk = path.join(dir, "auto");
    mkdirSync(dirBk, { recursive: true });
    seedTier(dirBk, "daily", 31, Date.now() - 5 * 60 * 60 * 1000);

    const result = await backupDatabase(dirBk, "daily");

    expect(path.basename(result.file).startsWith("formakub-daily-")).toBe(true);
    expect(result.integrity).toBe("ok");
    // Авто-ротация внутри backupDatabase: 31 старая + 1 новая = 32 → 30.
    const daily = readdirSync(dirBk).filter(
      (name) => name.startsWith("formakub-daily-") && name.endsWith(".db"),
    );
    expect(daily.length).toBe(30);
  });
});

// ─── S3-совместимая выгрузка (ADR-03, конфигурация через ENV) ───

describe("S3-выгрузка (ADR-03)", () => {
  it("без полного ENV-конфига выгрузка выключена; значения по умолчанию не выдумываются", () => {
    expect(s3ConfigFromEnv({})).toBeNull();
    expect(
      s3ConfigFromEnv({ S3_ENDPOINT: "http://s3.local", S3_BUCKET: "b" }),
    ).toBeNull(); // нет ключей

    const cfg = s3ConfigFromEnv({
      S3_ENDPOINT: "http://s3.local/",
      S3_BUCKET: "backups",
      S3_ACCESS_KEY_ID: "ak",
      S3_SECRET_ACCESS_KEY: "sk",
    });
    // Контракт: внешние слеши нормализуются; при выгрузке префикс
    // соединяется как "<prefix>/<key>".
    expect(cfg).toEqual({
      endpoint: "http://s3.local",
      region: "us-east-1",
      bucket: "backups",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      prefix: "backups",
    });
  });

  it("реальный PUT-транспорт: path-style URL, SigV4-заголовки, тело байт-в-байт, ошибки не маскируются", async () => {
    interface Received {
      method?: string;
      url?: string;
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }
    const received: Received[] = [];
    let respondWith = 200;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        received.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        res.writeHead(respondWith);
        res.end(respondWith === 200 ? "" : "AccessDenied");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      const cfg = s3ConfigFromEnv({
        S3_ENDPOINT: `http://127.0.0.1:${port}`,
        S3_BUCKET: "backups",
        S3_ACCESS_KEY_ID: "AKIA_TEST",
        S3_SECRET_ACCESS_KEY: "secret-key-test",
        S3_REGION: "eu-central-1",
        S3_PREFIX: "formakub/",
      });
      expect(cfg).not.toBeNull();
      const localFile = path.join(dir, "copy.db");
      writeFileSync(localFile, "данные-бэкапа", "utf8");

      const result = await uploadFileToS3(cfg!, localFile, "formakub-hourly-x.db");
      expect(result.status).toBe(200);
      expect(result.key).toBe("formakub/formakub-hourly-x.db");

      const request = received[0]!;
      expect(request.method).toBe("PUT");
      expect(new URL(request.url!, "http://localhost").pathname).toBe(
        "/backups/formakub/formakub-hourly-x.db",
      );
      const auth = String(request.headers.authorization);
      expect(auth).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIA_TEST\/\d{8}\/eu-central-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
      expect(String(request.headers["x-amz-content-sha256"])).toBe(
        createHash("sha256").update(request.body).digest("hex"),
      );
      expect(String(request.headers["x-amz-date"])).toMatch(/^\d{8}T\d{6}Z$/);
      expect(request.body.toString("utf8")).toBe("данные-бэкапа");

      // Отклонение сервера пробрасывается, не маскируется.
      respondWith = 403;
      await expect(uploadFileToS3(cfg!, localFile, "y.db")).rejects.toThrow(/HTTP 403/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("runScheduledBackup: копия создаётся; без S3-конфига выгрузка пропускается", async () => {
    seedJsonCollections();
    await readCollection("price-items.json"); // миграция → активная БД

    const out = await runScheduledBackup();

    expect(out.backup.integrity).toBe("ok");
    expect(existsSync(out.backup.file)).toBe(true);
    expect(out.uploaded).toBeNull(); // ENV не задан → выгрузка выключена
  });
});
