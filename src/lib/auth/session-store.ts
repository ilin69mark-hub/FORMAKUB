import { randomBytes } from "node:crypto";

import { readCollectionStatus, updateCollection } from "@/lib/server/store";

import type { AdminPermission, AdminRole } from "./permissions";

export const SESSION_COOKIE = "formakub_admin_session";
export const OIDC_STATE_COOKIE = "formakub_oidc_state";
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSIONS_COLLECTION = "admin-sessions.json";

export interface AdminSession {
  id: string;
  actorId: string;
  actorName: string;
  role: AdminRole;
  permissions: AdminPermission[];
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
  /** Server-side only: used as id_token_hint for RP-initiated logout. */
  idToken?: string;
}

export interface CreateSessionInput {
  actorId: string;
  actorName?: string;
  role: AdminRole;
  permissions: AdminPermission[];
  idToken?: string;
  now?: string;
}

function nowMs(value?: string): number {
  return value === undefined ? Date.now() : Date.parse(value);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function expired(session: AdminSession, atMs: number): boolean {
  const absolute = Date.parse(session.absoluteExpiresAt);
  const idle = Date.parse(session.lastSeenAt) + SESSION_IDLE_MS;
  return !Number.isFinite(absolute) || !Number.isFinite(idle) || atMs >= absolute || atMs >= idle;
}

export async function createAdminSession(
  input: CreateSessionInput,
): Promise<AdminSession> {
  const at = nowMs(input.now);
  const id = randomBytes(32).toString("base64url");
  const session: AdminSession = {
    id,
    actorId: input.actorId,
    actorName: input.actorName ?? input.actorId,
    role: input.role,
    permissions: [...input.permissions],
    createdAt: iso(at),
    lastSeenAt: iso(at),
    absoluteExpiresAt: iso(at + SESSION_ABSOLUTE_MS),
    ...(input.idToken ? { idToken: input.idToken } : {}),
  };

  await updateCollection<AdminSession, void>(SESSIONS_COLLECTION, (items) => ({
    items: [...items.filter((item) => !expired(item, at)), session],
    result: undefined,
  }));
  return session;
}

export async function getAdminSession(
  id: string,
  now = new Date().toISOString(),
): Promise<AdminSession | null> {
  const at = nowMs(now);
  const read = await readCollectionStatus<AdminSession>(SESSIONS_COLLECTION);
  if (read.status !== "ok") return null;
  const session = read.items.find((item) => item.id === id);
  if (!session || expired(session, at)) {
    if (session) {
      await updateCollection<AdminSession, void>(SESSIONS_COLLECTION, (items) => ({
        items: items.filter((item) => item.id !== id),
        result: undefined,
      }));
    }
    return null;
  }

  const updated: AdminSession = { ...session, lastSeenAt: iso(at) };
  await updateCollection<AdminSession, void>(SESSIONS_COLLECTION, (items) => ({
    items: items.map((item) => (item.id === id ? updated : item)),
    result: undefined,
  }));
  return updated;
}

export async function deleteAdminSession(id: string): Promise<void> {
  await updateCollection<AdminSession, void>(SESSIONS_COLLECTION, (items) => ({
    items: items.filter((item) => item.id !== id),
    result: undefined,
  }));
}

export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  };
}
