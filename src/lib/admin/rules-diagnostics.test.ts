import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rulesSnapshotContentHash } from "./managed-rules";
import {
  diagnoseProjectRules,
  diagnoseProjectRulesList,
  diagnoseRulesSnapshot,
} from "./rules-diagnostics";
import { rulesSnapshotFixture } from "@/lib/server/rules-test-fixture";

let dir = "";

const projectsPath = (): string => path.join(dir, "projects.json");
const snapshotsPath = (): string => path.join(dir, "rules-snapshots.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "formakub-rules-diag-"));
  process.env.FORMAKUB_DATA_DIR = dir;
  delete process.env.FORMAKUB_STORAGE;
  writeJson(snapshotsPath(), [rulesSnapshotFixture()]);
});

afterEach(() => {
  delete process.env.FORMAKUB_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data), "utf8");
}

function project(
  id: string,
  rulesSnapshotId: string | undefined,
  kind = "wardrobe",
): Record<string, unknown> {
  return {
    id,
    config: { kind },
    price: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(rulesSnapshotId === undefined ? {} : { rulesSnapshotId }),
  };
}

function withoutNormRules(): Record<string, unknown> {
  const snapshot = rulesSnapshotFixture() as {
    id: string;
    rules: Array<Record<string, unknown>>;
    contentHash: string;
    publishedSeq: number;
  };
  const rules = snapshot.rules.filter(
    (rule) => rule.id === "rule-test-hinge-band",
  );
  return {
    ...snapshot,
    id: "rules-no-norms",
    rules,
    contentHash: rulesSnapshotContentHash(rules),
  };
}

describe("NEW-N2: диагностика проектов", () => {
  it("legacy без rulesSnapshotId — причина и статус", async () => {
    writeJson(projectsPath(), [project("p-legacy", undefined)]);
    const result = await diagnoseProjectRules("p-legacy");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("legacy_no_snapshot");
    expect(result.data.reason).toMatch(/нет rulesSnapshotId/);
    expect(result.data.pinnedSnapshotId).toBeNull();
    expect(result.data.appliedRules).toEqual([]);
  });

  it("корректный закреплённый snapshot — applied rules и lineIds", async () => {
    writeJson(projectsPath(), [project("p-ok", "rules-test-fixture")]);
    const result = await diagnoseProjectRules("p-ok");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("ok");
    expect(result.data.pinnedSnapshotId).toBe("rules-test-fixture");
    expect(result.data.activeSnapshotId).toBe("rules-test-fixture");
    expect(result.data.appliedRules.length).toBeGreaterThan(0);
    expect(
      result.data.appliedRules.some(
        (rule) => rule.id === "rule-wardrobe-hinge-band-1-count" && rule.lineIds.length === 1,
      ),
    ).toBe(true);
  });

  it("неизвестный и повреждённый snapshot", async () => {
    writeJson(projectsPath(), [
      project("p-unknown", "rules-missing"),
      project("p-broken", "rules-test-fixture"),
    ]);
    const unknown = await diagnoseProjectRules("p-unknown");
    expect(unknown.ok && unknown.data.status).toBe("snapshot_unknown");

    writeFileSync(snapshotsPath(), "{broken", "utf8");
    const broken = await diagnoseProjectRules("p-broken");
    expect(broken.ok && broken.data.status).toBe("snapshot_corrupt");
    if (broken.ok) expect(broken.data.reason).toMatch(/поврежд/);
  });

  it("отсутствующие обязательные нормы — причина и список", async () => {
    writeJson(snapshotsPath(), [withoutNormRules()]);
    writeJson(projectsPath(), [project("p-missing", "rules-no-norms")]);
    const result = await diagnoseProjectRules("p-missing");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("required_rules_missing");
    expect(result.data.missingRequiredRuleIds).toContain(
      "rule-wardrobe-facade-density-16",
    );
    expect(result.data.missingRequiredRuleIds.length).toBeGreaterThan(20);
  });

  it("kitchen не требует wardrobe-норм", async () => {
    writeJson(snapshotsPath(), [withoutNormRules()]);
    writeJson(projectsPath(), [project("p-kitchen", "rules-no-norms", "kitchen")]);
    const result = await diagnoseProjectRules("p-kitchen");
    expect(result.ok && result.data.status).toBe("ok");
    if (result.ok) expect(result.data.missingRequiredRuleIds).toEqual([]);
  });

  it("список проектов и read-only: файлы не меняются", async () => {
    writeJson(projectsPath(), [
      project("p-ok", "rules-test-fixture"),
      project("p-legacy", undefined),
      project("p-unknown", "rules-missing"),
    ]);
    const beforeProjects = readFileSync(projectsPath(), "utf8");
    const beforeSnapshots = readFileSync(snapshotsPath(), "utf8");

    const list = await diagnoseProjectRulesList();
    expect(list.projects.map((item) => item.status).sort()).toEqual([
      "legacy_no_snapshot",
      "ok",
      "snapshot_unknown",
    ]);

    expect(readFileSync(projectsPath(), "utf8")).toBe(beforeProjects);
    expect(readFileSync(snapshotsPath(), "utf8")).toBe(beforeSnapshots);
  });

  it("404 для неизвестного проекта", async () => {
    writeJson(projectsPath(), []);
    const result = await diagnoseProjectRules("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("NEW-N2: диагностика snapshot", () => {
  it("валидный снимок: правила, версии, usedByProjectIds", async () => {
    writeJson(projectsPath(), [project("p-ok", "rules-test-fixture")]);
    const result = await diagnoseRulesSnapshot("rules-test-fixture");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("ok");
    expect(result.data.usedByProjectIds).toEqual(["p-ok"]);
    expect(result.data.rules.length).toBeGreaterThan(0);
    expect(result.data.missingRequiredRuleIds).toEqual([]);
  });

  it("отсутствующий и повреждённый снимок", async () => {
    const missing = await diagnoseRulesSnapshot("rules-missing");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);

    writeFileSync(snapshotsPath(), "{broken", "utf8");
    const broken = await diagnoseRulesSnapshot("rules-test-fixture");
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.status).toBe(500);
  });

  it("невалидный contentHash — invalid", async () => {
    const snapshot = rulesSnapshotFixture() as Record<string, unknown>;
    writeJson(snapshotsPath(), [{ ...snapshot, contentHash: "tampered" }]);
    const result = await diagnoseRulesSnapshot("rules-test-fixture");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("invalid");
    expect(result.data.issues.join(" ")).toMatch(/contentHash/);
  });
});

describe("NEW-N4 / D-8: preliminary-правила в диагностике", () => {
  it("seed из 27 preliminary виден, но не публикуем", async () => {
    const { importManagedRulesSeed } = await import("./managed-rules-seed");
    const { diagnoseManagedRules } = await import("./rules-diagnostics");
    await importManagedRulesSeed({ actorId: "admin-1", actorRole: "calc-admin" });

    const diagnosis = await diagnoseManagedRules();
    expect(diagnosis.expected).toBe(27);
    expect(diagnosis.seed.filter((item) => item.status === "draft")).toHaveLength(27);
    expect(diagnosis.rules).toHaveLength(27);
    expect(diagnosis.rules.every((rule) => rule.source === "preliminary")).toBe(true);
    expect(diagnosis.rules.every((rule) => rule.publishable === false)).toBe(true);
    expect(diagnosis.rules[0].reason).toMatch(/preliminary/);
  });
});
