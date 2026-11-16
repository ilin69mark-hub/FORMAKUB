import { cookies } from "next/headers";

import type { ActorContext } from "@/lib/admin/parameters";

import {
  SESSION_COOKIE,
  getAdminSession,
  type AdminSession,
} from "./session-store";

/** Текущая server-side сессия из httpOnly cookie; иначе null (fail-closed). */
export async function getCurrentSession(
  now = new Date().toISOString(),
): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const id = cookieStore.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  return getAdminSession(id, now);
}

export function actorFromSession(session: AdminSession): ActorContext {
  return {
    actorId: session.actorId,
    actorRole: session.role,
  };
}
