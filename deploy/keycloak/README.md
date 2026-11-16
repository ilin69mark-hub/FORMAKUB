# Keycloak provisioning — formakub Calculation Admin

ADR-02: OIDC Authorization Code + PKCE, client roles, server-side sessions.
This directory contains a **non-secret** realm template. Do not commit real
client secrets, passwords, or production hostnames.

## Realm template

`realm-formakub.json` defines:

- realm `formakub`;
- public PKCE client `formakub-admin` (redirect URI `http://localhost:3000/api/auth/callback`);
- bearer/audience client `formakub-admin-api`;
- client roles `calc-viewer`, `calc-admin`, `price.publish`;
- audience mapper: `formakub-admin` access token gets `formakub-admin-api` in `aud`.

Production must add the real redirect URI(s) to `formakub-admin.redirectUris`,
for example `https://<admin-host>/api/auth/callback`, and matching
`post.logout.redirect.uris`.

## Required deployment variables

| Variable | Required | Notes |
|---|---|---|
| `KEYCLOAK_ISSUER_URL` | yes | e.g. `https://<keycloak-host>/realms/formakub`; no trailing slash required |
| `FORMAKUB_AUTH_SECRET` | yes | >= 32 chars, signs the OIDC state cookie |
| `KEYCLOAK_CLIENT_ID` | no | default `formakub-admin` |
| `KEYCLOAK_AUDIENCE` | no | default `formakub-admin-api` |
| `KEYCLOAK_CLIENT_SECRET` | no | only for confidential clients; public PKCE client leaves empty |
| `FORMAKUB_AUTH_REDIRECT_URI` | no | explicit callback behind reverse proxy |
| `FORMAKUB_ADMIN_UI` | no | feature gate only; **not** an authorization mechanism |

`docker-compose.yml` passes these variables into the app. Empty issuer/secret
makes auth fail closed (503); no fake credentials are generated.

## Roles → application permissions

| Keycloak client role (on `formakub-admin-api`) | Application result |
|---|---|
| `calc-viewer` | read-only; no write permissions |
| `calc-admin` | `catalog.write`, `price.write`, `recalc.run` |
| `price.publish` | independent `price.publish`; not inherited from `calc-admin` |

`calc-admin` without `price.publish` can create/validate drafts but cannot
publish. Assign `price.publish` only to the intended publisher account/group.

## Automated local checks

```bash
npm run preflight          # validates required env + compose + realm template
npm run restore-drill      # isolated backup→restore→integrity drill
npm run smoke:browser      # disposable Keycloak + temp SQLite + Chrome CDP
```

`smoke:browser` requires Chrome and Docker; it stops the test containers and
Chrome on exit. It never uses production users, secrets, or `data/formakub.db`.

## Provisioning checklist

1. Import `realm-formakub.json` into Keycloak (or recreate realm/clients/roles).
2. Set production redirect/logout URIs on `formakub-admin`.
3. Ensure `formakub-admin-api` is included in access-token audience.
4. Create users/groups and assign client roles on `formakub-admin-api`.
5. Set deployment variables above; never commit their values.
6. Start the app and verify:
   - `GET /admin` without session → redirect to Keycloak login;
   - login as viewer → admin pages/API read; write → 403;
   - login as admin → draft/validate allowed; publish → 403;
   - login as publisher (`calc-admin` + `price.publish`) → publish allowed;
   - logout → session cookie removed; `/admin` redirects to login;
   - denied API operations appear in `AdminAuditLog` with `result=denied`.
7. For local verification without Keycloak, do not invent credentials; use a
   disposable local realm and test users, never the production realm.
