import { describe, expect, it } from "vitest";

import {
  authorizePermission,
  hasPermission,
  mapKeycloakRoles,
} from "./permissions";

const audience = "formakub-admin-api";

function claims(roles: string[], realmRoles: string[] = []) {
  return {
    resource_access: { [audience]: { roles } },
    realm_access: { roles: realmRoles },
  };
}

describe("CA-T-602: Keycloak client roles", () => {
  it("calc-viewer — read-only без permissions", () => {
    const result = mapKeycloakRoles(claims(["calc-viewer"]), audience);
    expect(result.ok).toBe(true);
    expect(result.identity).toEqual({ role: "calc-viewer", permissions: [] });
  });

  it("calc-admin получает базовые permissions", () => {
    const result = mapKeycloakRoles(claims(["calc-admin"]), audience);
    expect(result.ok).toBe(true);
    expect(result.identity?.role).toBe("calc-admin");
    expect(result.identity?.permissions).toEqual([
      "catalog.write",
      "price.write",
      "recalc.run",
    ]);
    expect(hasPermission(result.identity!, "price.publish")).toBe(false);
  });

  it("price.publish назначается независимо", () => {
    const result = mapKeycloakRoles(
      claims(["calc-admin", "price.publish"]),
      audience,
    );
    expect(result.ok).toBe(true);
    expect(hasPermission(result.identity!, "price.publish")).toBe(true);
  });

  it("неизвестные роли и realm-роли не дают доступа", () => {
    const result = mapKeycloakRoles(
      claims(["unknown"], ["calc-admin"]),
      audience,
    );
    expect(result.ok).toBe(false);
  });

  it("viewer получает 403 на write, admin без publish — 403 на publish", () => {
    const viewer = mapKeycloakRoles(claims(["calc-viewer"]), audience).identity!;
    expect(authorizePermission(viewer, "catalog.write").ok).toBe(false);
    expect(authorizePermission(viewer, "price.publish")).toMatchObject({
      ok: false,
      status: 403,
    });

    const admin = mapKeycloakRoles(claims(["calc-admin"]), audience).identity!;
    expect(authorizePermission(admin, "catalog.write").ok).toBe(true);
    expect(authorizePermission(admin, "price.publish")).toMatchObject({
      ok: false,
      status: 403,
    });

    const publisher = mapKeycloakRoles(
      claims(["calc-admin", "price.publish"]),
      audience,
    ).identity!;
    expect(authorizePermission(publisher, "price.publish").ok).toBe(true);
  });

  it("без сессии — 401", () => {
    expect(authorizePermission(null, "catalog.write")).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});
