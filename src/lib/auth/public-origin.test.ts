import { describe, expect, it } from "vitest";
import { publicOrigin } from "./public-origin";

describe("publicOrigin", () => {
  it("uses explicit redirect origin behind a proxy", () => {
    expect(
      publicOrigin(
        { redirectUri: "http://localhost:3000/api/auth/callback" },
        "http://0.0.0.0:3000",
      ),
    ).toBe("http://localhost:3000");
  });

  it("falls back to request origin without redirect uri", () => {
    expect(publicOrigin({}, "http://localhost:3000")).toBe("http://localhost:3000");
  });
});
