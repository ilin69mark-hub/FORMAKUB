import { checkRateLimit, clientKey } from "@/lib/server/rate-limit";

/** CA-T-604: same-origin проверка для admin-мутаций. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const allowed = new Set([new URL(request.url).host]);
    // Behind a container/proxy the request URL can be 0.0.0.0 while the
    // browser uses the configured public origin.
    const configured = process.env.FORMAKUB_AUTH_REDIRECT_URI?.trim();
    if (configured) {
      try {
        allowed.add(new URL(configured).host);
      } catch {
        // Некорректная конфигурация не расширяет allowlist.
      }
    }
    return allowed.has(new URL(origin).host);
  } catch {
    return false;
  }
}

export function adminMutationRateLimit(headers: Headers) {
  return checkRateLimit(`admin:${clientKey(headers)}`);
}
