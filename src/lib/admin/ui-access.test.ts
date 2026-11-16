import { describe, expect, it } from "vitest";

import { isAdminUiEnabled } from "./ui-access";

describe("guard-заглушка Calculation Admin (CA-T-501)", () => {
  it("в development панель доступна", () => {
    expect(isAdminUiEnabled({ NODE_ENV: "development" })).toBe(true);
  });

  it("в production по умолчанию закрыта", () => {
    expect(isAdminUiEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("явный флаг разрешает локальный smoke в production-сборке", () => {
    expect(
      isAdminUiEnabled({ NODE_ENV: "production", FORMAKUB_ADMIN_UI: "1" }),
    ).toBe(true);
  });
});
