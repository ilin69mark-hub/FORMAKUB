import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLead, listLeads } from "./leads";
import { updateCollection } from "./store";

let dir = "";

const CUSTOMER = {
  name: "Тест Клиент",
  contact: "+70000000000",
  preferredContact: "phone" as const,
  consent: true as const,
};

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-leads-project-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  delete process.env.FORMAKUB_STORAGE;
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-GL-25: заявка связана с сохранённым проектом", () => {
  it("несуществующий проект отклоняется", async () => {
    const result = await createLead({ customer: CUSTOMER, projectId: "zzzzzzzz" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe("projectId");
    expect(await listLeads()).toHaveLength(0);
  });

  it("невалидная запись проекта не привязывается", async () => {
    await updateCollection<Record<string, unknown>, void>(
      "projects.json",
      () => ({
        items: [{ id: "proj0001", config: {}, price: {} }],
        result: undefined,
      }),
    );
    const created = await createLead({
      customer: CUSTOMER,
      projectId: "proj0001",
    });
    expect(created.ok).toBe(false);
    expect(await listLeads()).toHaveLength(0);
  });

  it("заявка без projectId остаётся валидной (legacy)", async () => {
    const created = await createLead({ customer: CUSTOMER });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.lead.projectId).toBeUndefined();
    expect((await listLeads()).length).toBe(1);
  });
});
