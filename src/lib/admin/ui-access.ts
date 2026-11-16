/**
 * CA-T-501 — guard-заглушка UI-каркаса.
 *
 * Панель не публикуется наружу до CA-T-602/609: в production маршруты
 * `/admin*` отвечают 404, локальная разработка доступна без сессии.
 * Явный флаг `FORMAKUB_ADMIN_UI=1` разрешает прототип в production-сборке
 * (например, для локального smoke-теста). Полноценная auth/RBAC — CA-T-602/603.
 */
export function isAdminUiEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env.FORMAKUB_ADMIN_UI === "1";
}
