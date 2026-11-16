# Production Cutover Checklist — Calculation Admin

Status: local automated readiness is complete; the steps below require the
owner's production environment, secrets, or real user accounts. Do not put real
secrets in this file or in git.

## 0. Automated checks already available

Run from the repository root:

```bash
npm run typecheck
npm run lint
npm test
npm run preflight          # requires production env vars
npm run restore-drill      # isolated, never touches data/formakub.db
npm run smoke:browser      # disposable local Keycloak + temp SQLite + Chrome
curl -fsS http://localhost:3000/api/health
```

`npm run smoke:browser` starts a disposable Keycloak container, a temp copy of
the SQLite DB, and headless Chrome; it stops them on exit. It never uses
production users/secrets.

---

## 1. Choose the production Keycloak issuer

- Where: owner's Keycloak/IAM environment.
- Required value: `KEYCLOAK_ISSUER_URL`, e.g. `https://<keycloak-host>/realms/formakub`.
- Success: `curl -fsS "$KEYCLOAK_ISSUER_URL/.well-known/openid-configuration"`
  returns JSON whose `issuer` exactly matches the variable.
- Safe check: compare issuer string; do not print tokens/secrets.

## 2. Create/import the production realm and client

- Where: Keycloak admin console or `kcadm.sh`.
- Input: `deploy/keycloak/realm-formakub.json` (non-secret template).
- Required: realm `formakub`; public PKCE client `formakub-admin`; bearer
  client `formakub-admin-api`; client roles `calc-viewer`, `calc-admin`,
  `price.publish`; audience mapper to `formakub-admin-api`.
- Success: realm and both clients exist; PKCE S256 is enabled; access token
  contains `aud=formakub-admin-api` and `resource_access["formakub-admin-api"].roles`.
- Safe check: decode a test token locally; do not share it.

## 3. Set real secrets and URLs

- Where: deployment secret store / environment.
- Required:
  - `FORMAKUB_ADMIN_UI=1` (иначе production Admin UI закрыт; это feature gate, не авторизация)
  - `FORMAKUB_ENV=production` (явный production-маркер; обязателен для rules publication gate)
  - `FORMAKUB_RULES_PUBLICATION_ENABLED` — оставить пустым/`0` до закрытия CA-T-511 и подтверждения норм; `1` только на staging для первой публикации
  - `KEYCLOAK_ISSUER_URL`
  - `FORMAKUB_AUTH_SECRET` (>= 32 random chars)
  - `KEYCLOAK_CLIENT_ID` (default `formakub-admin`)
  - `KEYCLOAK_AUDIENCE` (default `formakub-admin-api`)
  - optional `KEYCLOAK_CLIENT_SECRET` only for a confidential client
  - optional `FORMAKUB_AUTH_REDIRECT_URI` (also canonical public origin for callback/logout redirects behind a proxy)
- Success: `npm run preflight` passes in the deployment environment.
- Safe check: preflight prints only PASS/FAIL, never secret values.

## 4. Configure production redirect/logout URIs

- Where: Keycloak client `formakub-admin`.
- Add exactly:
  - `https://<admin-host>/api/auth/callback`
  - post-logout URI `https://<admin-host>/*` (or the chosen landing page)
- Success: login callback stays on the expected host; logout returns to the
  expected page.
- Safe check: browser developer tools → network; verify `redirect_uri` matches.

## 5. Create real users/groups

- Where: Keycloak realm `formakub`.
- Required: at least one viewer, one admin, one publisher.
- Success: users can authenticate; no shared personal accounts.
- Safe check: login as each user in a private browser window.

## 6. Assign roles/permissions

- Where: Keycloak → client `formakub-admin-api` → client roles.
- Required:
  - viewer: `calc-viewer`
  - admin: `calc-admin`
  - publisher: `calc-admin` + `price.publish`
- Success: `calc-admin` does NOT automatically get `price.publish`.
- Safe check: `GET /api/admin/pricing-versions` (200 for all), create draft
  (viewer 403, admin 201), publish (admin 403, publisher 200).

## 7. Verify production login/logout

- Where: deployed app.
- Steps: open `/admin` without session → Keycloak login; log in; open
  `/admin/prices` and `/admin/projects`; log out.
- Success: authenticated pages load; logout revokes the app session
  (`/api/admin/*` becomes 401) and redirects to Keycloak `end_session_endpoint`
  (RP-initiated logout); a subsequent `/admin` must show the Keycloak login
  form, not silently re-authenticate via the old SSO session.
- Safe check: use a test account; do not use production admin credentials for
  exploratory testing.

## 8. Browser smoke on the deployment

- Where: deployed URL, real browser.
- Required: run the equivalent of `npm run smoke:browser` against the
  deployment (or use the checklist in `deploy/keycloak/README.md`).
- Success: unauth redirect, viewer/admin/publisher RBAC, denied audit, admin
  pages, public kitchen/wardrobe price, no unexpected JS errors.
- Safe check: use disposable/test data or a staging deployment; do not modify
  production projects.

## 9. Restore-drill on a production-like environment

- Where: separate staging environment with a copy of a production backup.
- Steps: stop the app; `restoreDatabase` to a **separate** target directory;
  `PRAGMA integrity_check`; start the app against the restored directory;
  verify expected collections/projects/prices; keep the original backup.
- Success: integrity `ok`, app reads restored data, historical prices/history
  present.
- Safe check: never restore over `data/formakub.db`; never delete the source
  backup. The local isolated analogue is `npm run restore-drill`.

## 10. Decide whether external S3 backup is mandatory

- Where: owner decision + deployment secret store.
- If mandatory: set complete `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, optional `S3_REGION`, `S3_PREFIX`; verify an upload
  and a restore from the external copy.
- If not mandatory: leave `S3_*` empty; local backups remain, and off-site
  RPO/RTO is not met.
- Success: owner records the decision and the corresponding RPO/RTO.
- Safe check: do not create fake credentials; verify with a disposable bucket.

---

## Not part of this checklist

- ADR-04 / OI-063 geometry editing boundaries — separate owner decision.

---

## 11. Managed Rules (NEW-N4)

- **Environment marker:** `FORMAKUB_ENV=production`; publication flag `FORMAKUB_RULES_PUBLICATION_ENABLED` remains empty/`0` until CA-T-511 is closed.
- **Seed:** `POST /api/admin/rules/import` (`catalog.write`) creates 27 draft rules with fixed ids and `source=preliminary`; repeat is idempotent (created=0). No snapshot is published by import.
- **Owner confirmation:** before the first publication, the 27 norm values require documentary owner confirmation; only then create new draft revisions with `source=owner_confirmed`.
- **First publication (staging only until CA-T-511):** explicit selection, `expectedVersion`, `confirmed`, `expectedStateVersion`; verify `contentHash`, `publishedSeq`, audit `rule.publish` with matching `requestId`.
- **Recovery:** restart triggers publication/transition recovery; never re-publish an existing snapshot to repair audit manually.
- Full procedure: `docs/CALCULATION_ADMIN/PRODUCTION_READINESS_RULES.md` §11.
