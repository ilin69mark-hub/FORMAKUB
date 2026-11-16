import { describe, expect, it } from "vitest";

import { verifyCriticalConfirmation } from "./confirmations";

const base = {
  operation: "publish" as const,
  confirmed: true,
  expectedVersion: "v1",
  currentVersion: "v1",
};

describe("CA-T-606: critical confirmations", () => {
  it("пропускает подтверждённую операцию с актуальной версией", () => {
    expect(verifyCriticalConfirmation(base)).toEqual({ ok: true });
  });

  it("требует явного подтверждения", () => {
    expect(verifyCriticalConfirmation({ ...base, confirmed: false })).toMatchObject({
      ok: false,
      status: 409,
      code: "CONFIRMATION_REQUIRED",
    });
  });

  it("отклоняет конфликт версий", () => {
    expect(
      verifyCriticalConfirmation({ ...base, expectedVersion: "old" }),
    ).toMatchObject({
      ok: false,
      status: 409,
      code: "VERSION_CONFLICT",
    });
  });

  it("поддерживает recalc/archive/rollback", () => {
    for (const operation of ["recalc", "archive", "rollback"] as const) {
      expect(verifyCriticalConfirmation({ ...base, operation })).toEqual({ ok: true });
    }
  });
});
