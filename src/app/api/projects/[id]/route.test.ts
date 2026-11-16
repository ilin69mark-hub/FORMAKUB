import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/projects/[id]/route";
import { defaultKitchen } from "@/lib/configurator/defaults";

let dir = "";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-get-snapshot-"));
  process.env.FORMAKUB_DATA_DIR = dir;
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeProject(price: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    path.join(dir, "projects.json"),
    JSON.stringify([
      {
        id: "abcdefgh",
        config: defaultKitchen(),
        price,
        createdAt: "2026-11-09T00:00:00.000Z",
        updatedAt: "2026-11-09T00:00:00.000Z",
        ...extra,
      },
    ]),
    "utf8",
  );
}

describe("CA-T-413: GET проекта возвращает сохранённый snapshot", () => {
  it("versioned project: сохранённая цена, без пересчёта и записи", async () => {
    writeProject(
      { total: 777, currency: "RUB" },
      { schemaVersion: 1, calcVersion: "calc-2026.11.0", priceVersion: "price-1" },
    );
    const before = readFileSync(path.join(dir, "projects.json"), "utf8");

    const response = await GET(
      new Request("http://localhost/api/projects/abcdefgh"),
      context("abcdefgh"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: { price: { total: number }; priceRecalculated: boolean };
    };
    expect(body.project.price.total).toBe(777);
    expect(body.project.priceRecalculated).toBe(false);
    expect(readFileSync(path.join(dir, "projects.json"), "utf8")).toBe(before);
  });

  it("legacy project без priceVersion: сохранённая цена", async () => {
    writeProject({ total: 888, currency: "RUB" });

    const response = await GET(
      new Request("http://localhost/api/projects/abcdefgh"),
      context("abcdefgh"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: { price: { total: number }; priceRecalculated: boolean };
    };
    expect(body.project.price.total).toBe(888);
    expect(body.project.priceRecalculated).toBe(false);
  });

  it("отсутствующий price snapshot не заменяется текущей ценой", async () => {
    writeProject({}, { schemaVersion: 1, priceVersion: "price-1" });

    const response = await GET(
      new Request("http://localhost/api/projects/abcdefgh"),
      context("abcdefgh"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      project: { price: Record<string, unknown> };
    };
    expect(body.project.price).toEqual({});
  });
});
