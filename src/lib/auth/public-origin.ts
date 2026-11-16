import type { AuthConfig } from "./config";

/**
 * Origin for browser redirects. Behind a proxy/container the request origin can
 * be 0.0.0.0; an explicit FORMAKUB_AUTH_REDIRECT_URI is the canonical public
 * origin and must be used for callback/logout redirects.
 */
export function publicOrigin(config: Pick<AuthConfig, "redirectUri">, requestUrl: string): string {
  if (config.redirectUri) {
    return new URL(config.redirectUri).origin;
  }
  return new URL(requestUrl).origin;
}
