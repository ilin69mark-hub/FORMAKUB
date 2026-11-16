import { describe, expect, it } from "vitest";

import { priceCapabilities } from "./prices-ui";

describe("UI-RBAC: priceCapabilities", () => {
  it("calc-viewer: без price.write и price.publish", () => {
    expect(priceCapabilities(["calc.view"])).toEqual({
      canWrite: false,
      canPublish: false,
    });
  });

  it("calc-admin без price.publish: запись есть, публикации нет", () => {
    expect(priceCapabilities(["price.write"])).toEqual({
      canWrite: true,
      canPublish: false,
    });
  });

  it("publisher: запись и публикация", () => {
    expect(priceCapabilities(["price.write", "price.publish"])).toEqual({
      canWrite: true,
      canPublish: true,
    });
  });

  it("пустой набор permissions → всё запрещено (fail-closed)", () => {
    expect(priceCapabilities([])).toEqual({ canWrite: false, canPublish: false });
  });
});
