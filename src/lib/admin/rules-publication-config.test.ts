import { describe, expect, it } from "vitest";

import {
  evaluateRulesPublicationConfig,
  rulesPublicationBlocked,
} from "./rules-publication-config";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("NEW-N4 / D-9: production publication config", () => {
  it("dev/test по умолчанию: публикация не блокируется", () => {
    const state = evaluateRulesPublicationConfig(env({ NODE_ENV: "test" }));
    expect(state.production).toBe(false);
    expect(state.blocked).toBe(false);
  });

  it("production без флага блокируется (NODE_ENV и явный маркер)", () => {
    expect(rulesPublicationBlocked(env({ NODE_ENV: "production" }))).toBe(true);
    const explicit = evaluateRulesPublicationConfig(
      env({ FORMAKUB_ENV: "production" }),
    );
    expect(explicit.production).toBe(true);
    expect(explicit.blocked).toBe(true);
    expect(explicit.reason).toMatch(/FORMAKUB_RULES_PUBLICATION_ENABLED/);
  });

  it("production с флагом 1 разрешает прохождение gate", () => {
    const state = evaluateRulesPublicationConfig(
      env({
        NODE_ENV: "production",
        FORMAKUB_ENV: "production",
        FORMAKUB_RULES_PUBLICATION_ENABLED: "1",
      }),
    );
    expect(state.production).toBe(true);
    expect(state.enabled).toBe(true);
    expect(state.blocked).toBe(false);
  });

  it("некорректный флаг блокирует", () => {
    for (const flag of ["yes", "true", "2"]) {
      const state = evaluateRulesPublicationConfig(
        env({
          NODE_ENV: "production",
          FORMAKUB_RULES_PUBLICATION_ENABLED: flag,
        }),
      );
      expect(state.blocked).toBe(true);
      expect(state.issues.join(" ")).toMatch(/недопустим/);
    }
  });

  it("противоречивые маркеры блокируют", () => {
    const a = evaluateRulesPublicationConfig(
      env({ NODE_ENV: "production", FORMAKUB_ENV: "development" }),
    );
    expect(a.blocked).toBe(true);
    expect(a.issues.join(" ")).toMatch(/противоречие/);

    const b = evaluateRulesPublicationConfig(
      env({ NODE_ENV: "test", FORMAKUB_ENV: "production" }),
    );
    expect(b.blocked).toBe(true);
    expect(b.issues.join(" ")).toMatch(/противоречие/);
  });

  it("dev с флагом 1 не становится production", () => {
    const state = evaluateRulesPublicationConfig(
      env({
        NODE_ENV: "test",
        FORMAKUB_ENV: "development",
        FORMAKUB_RULES_PUBLICATION_ENABLED: "1",
      }),
    );
    expect(state.production).toBe(false);
    expect(state.blocked).toBe(false);
  });
});
