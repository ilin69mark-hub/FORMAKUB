export type AdminRole = "calc-viewer" | "calc-admin";

export type AdminPermission =
  | "catalog.write"
  | "price.write"
  | "price.publish"
  | "recalc.run";

export interface MappedIdentity {
  role: AdminRole;
  permissions: AdminPermission[];
}

export interface RoleMappingResult {
  ok: boolean;
  identity?: MappedIdentity;
  reason?: string;
}

const BASE_ADMIN_PERMISSIONS: AdminPermission[] = [
  "catalog.write",
  "price.write",
  "recalc.run",
];

const EXPLICIT_PERMISSIONS: AdminPermission[] = [
  "catalog.write",
  "price.write",
  "price.publish",
  "recalc.run",
];

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Keycloak client roles из проверенного access token.
 * Роли разрешаются только из resource_access[audience]; realm-роли не
 * используются как RBAC-источник.
 */
export function mapKeycloakRoles(
  payload: Record<string, unknown>,
  audience: string,
): RoleMappingResult {
  const resourceAccess =
    typeof payload.resource_access === "object" && payload.resource_access !== null
      ? (payload.resource_access as Record<string, unknown>)
      : {};
  const resource =
    typeof resourceAccess[audience] === "object" && resourceAccess[audience] !== null
      ? (resourceAccess[audience] as Record<string, unknown>)
      : {};
  const roles = new Set(stringArray(resource.roles));

  const isAdmin = roles.has("calc-admin");
  const isViewer = roles.has("calc-viewer");
  if (!isAdmin && !isViewer) {
    return {
      ok: false,
      reason: `в access token нет client role calc-admin/calc-viewer для "${audience}"`,
    };
  }

  if (!isAdmin) {
    return { ok: true, identity: { role: "calc-viewer", permissions: [] } };
  }

  const permissions = new Set<AdminPermission>(BASE_ADMIN_PERMISSIONS);
  for (const permission of EXPLICIT_PERMISSIONS) {
    if (roles.has(permission)) permissions.add(permission);
  }
  return {
    ok: true,
    identity: {
      role: "calc-admin",
      permissions: [...permissions].sort(),
    },
  };
}

export function hasPermission(
  identity: Pick<MappedIdentity, "permissions">,
  permission: AdminPermission,
): boolean {
  return identity.permissions.includes(permission);
}

export type AuthorizationResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string };

export function authorizePermission(
  identity: Pick<MappedIdentity, "role" | "permissions"> | null,
  permission: AdminPermission,
): AuthorizationResult {
  if (!identity) {
    return { ok: false, status: 401, message: "Требуется аутентификация." };
  }
  if (!hasPermission(identity, permission)) {
    return {
      ok: false,
      status: 403,
      message: `Недостаточно прав: требуется ${permission}.`,
    };
  }
  return { ok: true };
}
