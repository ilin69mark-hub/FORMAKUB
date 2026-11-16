import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyBootstrap } from "@/lib/admin/bootstrap";
import { seedDisplayMetadata } from "@/lib/admin/display-metadata";
import { defaultKitchen } from "@/lib/configurator/defaults";
import { seedRulesSnapshotFixture } from "@/lib/server/rules-test-fixture";
import { getProject, saveProject } from "@/lib/server/projects";
import { createLead, listLeads } from "@/lib/server/leads";

let dir = "";

const CUSTOMER = {
  name: "Интеграция Клиент",
  contact: "+79990001122",
  email: "client@test.local",
  preferredContact: "phone" as const,
  consent: true as const,
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-lead-project-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  process.env.FORMAKUB_STORAGE = "sqlite";
  await applyBootstrap({
    pricingVersionId: "price-lead.1",
    now: "2026-11-16T00:00:00.000Z",
  });
  await seedDisplayMetadata({ actorId: "test", actorRole: "system" });
  await seedRulesSnapshotFixture();
});

afterAll(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  delete process.env.FORMAKUB_STORAGE;
  rmSync(dir, { recursive: true, force: true });
});

describe("CA-GL-25 end-to-end (server path)", () => {
  it("проект сохраняется, заявка создаётся и читается с корректным projectId", async () => {
    const saved = await saveProject({
      config: defaultKitchen(),
      operationId: "lead-project-save-1",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const projectId = saved.project.id;
    expect(projectId).toMatch(/^[a-z0-9]{8}$/);

    const read = await getProject(projectId);
    expect(read.status).toBe("ok");

    const created = await createLead({
      config: saved.project.config,
      customer: CUSTOMER,
      source: "configurator-kitchen",
      interest: "kitchen",
      projectId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.lead.projectId).toBe(projectId);
    expect(created.lead.customer).toEqual(CUSTOMER);
    expect(created.lead.price?.total).toBe(saved.project.price.total);
    expect(created.lead.config?.kind).toBe("kitchen");

    const leads = await listLeads();
    expect(leads).toHaveLength(1);
    expect(leads[0]?.id).toBe(created.lead.id);
    expect(leads[0]?.projectId).toBe(projectId);
    expect(leads[0]?.createdAt).toBe(created.lead.createdAt);

    /* Связанный проект по-прежнему открывается. */
    const reopened = await getProject(leads[0]!.projectId!);
    expect(reopened.status).toBe("ok");
    if (reopened.status === "ok") {
      expect(reopened.project.price.total).toBe(saved.project.price.total);
    }
  });

  it("несуществующий и некорректный projectId отклоняются", async () => {
    const missing = await createLead({
      customer: CUSTOMER,
      projectId: "zzzzzzzz",
    });
    expect(missing.ok).toBe(false);

    const malformed = await createLead({
      customer: CUSTOMER,
      projectId: "BAD",
    });
    expect(malformed.ok).toBe(false);
  });

  it("legacy-заявка без projectId по-прежнему создаётся", async () => {
    const before = (await listLeads()).length;
    const legacy = await createLead({ customer: CUSTOMER });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(legacy.lead.projectId).toBeUndefined();
    expect((await listLeads()).length).toBe(before + 1);
  });
});
