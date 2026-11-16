# ADR-02: Аутентификация и RBAC Calculation Admin

- **ID:** ADR-02
- **Статус:** **APPROVED** (решение владельца 2026-11-10)
- **Архитектурный статус:** **ACCEPTED**
- **Статус реализации:** **IMPLEMENTED / PARTIAL deployment** (OIDC+sessions+RBAC+deny-audit реализованы; локальный Keycloak smoke пройден 2026-11-10; production provisioning/секреты — OPEN)
- **Задача:** CA-T-601 (`CALCULATION_ADMIN_IMPLEMENTATION_PLAN.md`, Фаза 6)
- **Связанные решения:** B1–B10 (дизайн §15.1), R-03 (single-instance), R-06/CA-Q-002 (`price.publish`), ADR-01 (SQLite)

## Статус сверки (2026-11-10)

- Локальный Keycloak (disposable realm, test users) подтвердил реальный OIDC Authorization Code + PKCE login, server-side session и logout.
- RBAC подтверждён: `calc-viewer` read 200 / write 403; `calc-admin` draft 201 / publish 403; `calc-admin` + `price.publish` publish 200.
- Denied API-операции пишутся в `AdminAuditLog` (`result=denied`).
- Production issuer/secret/redirect URI и реальные пользователи остаются deployment-задачей владельца; фиктивные credentials не создаются.

## Решение

1. **Authentication:** OIDC Authorization Code + PKCE.
2. **RBAC:** приложение — источник истины для ролей и permissions; роли из клиентских данных не принимаются.
3. **Роли:** `calc-viewer` (read-only) и `calc-admin` (изменение).
4. **Permissions:** `catalog.write`, `price.write`, `price.publish`, `recalc.run`.
   - `price.publish` назначается **независимо** от `price.write`;
   - `catalog.write` — отдельно от `price.publish`;
   - `calc-admin` не получает `price.publish` автоматически;
   - отдельная роль `calc-publisher` не требуется.
5. **Sessions:** server-side session store; absolute TTL **8 часов**, idle timeout **30 минут**; logout/revoke и очистка истёкших сессий обязательны.
6. **Default access:** deny by default для `/admin*` и `/api/admin/**`.
7. **Audit:** actor берётся из проверенной сессии/claims; отказы (`result=denied`) пишутся в `AdminAuditLog`.
8. **CSRF/limits:** origin/content-type checks, `SameSite` cookie, rate-limit мутаций, Zod и ограничение payload.
9. **`FORMAKUB_ADMIN_UI`** — только dev/feature gate, **не** аутентификация.
10. **Reverse-proxy auth** — только допустимый deployment fallback при private network, strip клиентских auth-заголовков и доверии только proxy.

## Keycloak (выбранный IdP)

- **Realm:** `formakub`.
- **OIDC client:** `formakub-admin`.
- **PKCE:** `S256` обязателен.
- **Issuer:** только через обязательную переменную `KEYCLOAK_ISSUER_URL`; hostname в коде не фиксируется.
- **Audience:** `formakub-admin-api`.
- **Resource client:** отдельный `formakub-admin-api` для audience.
- **Client roles:** передаются в проверенном access token (`resource_access["formakub-admin-api"].roles`); mapping выполняет сервер; клиентские роли не принимаются.
- **Fail-closed:** отсутствие `KEYCLOAK_ISSUER_URL` или `FORMAKUB_AUTH_SECRET` останавливает auth (503), без фиктивного входа.
- **Конфигурация:** `KEYCLOAK_CLIENT_ID`/`KEYCLOAK_AUDIENCE` могут переопределяться, defaults — `formakub-admin`/`formakub-admin-api`; `KEYCLOAK_CLIENT_SECRET` — только для confidential client; `FORMAKUB_AUTH_REDIRECT_URI` — опционально для reverse proxy.

## Открытый пункт до CA-T-602

> **Статус (2026-11-13):** CA-T-602/603 по коду отмечены **DONE** в плане (v0.77–v0.78, 2026-11-10); открытым остаётся deployment-предусловие ниже — provisioning/realm/client/roles/audience mapper и секреты в среде владельца. **Решение владельца Q6 по целевой модели Calculation Admin (2026-11-13, `ADMIN_TARGET_STRUCTURE_RECONCILIATION.md` §16):** CA-T-602 и CA-T-603 остаются блокирующими для безопасной публикации — публикация в production не описывается как безопасная до выполнения этих блокеров (включая deployment); Этап 1 целевой модели авторизацией не расширяется; статусы задач настоящим документом не изменяются.

Конкретный **issuer URL** и provisioning realm/client/roles/audience mapper в Keycloak выполняются в среде владельца. Hostname в репозитории не задаётся; отсутствие issuer — fail-closed. Неизвестная роль/группа → deny; «viewer по умолчанию» запрещён.

## Обязательные требования B1–B10

B1–B10 из дизайна §15.1 обязательны без изменений, включая отдельное `price.publish`, `catalog.write`, аудит отказов, подтверждения и `ValidationResult.passed=false → 422`.

## Последствия

- Требуется OIDC-клиент и server-side session storage в SQLite/Storage Adapter.
- Существующие `local-ui`/`local-prototype` server actions должны быть переведены на аутентифицированного actor в CA-T-602/603.
- Admin API не выпускается до CA-T-602–605 и CA-T-607.
- Multi-instance session/revocation не поддерживается в текущей single-instance архитектуре.

## Критерии приёмки

- Нет сессии → 401/redirect; нет permission → 403.
- `calc-viewer` не изменяет/публикует.
- `calc-admin` без `price.publish` не публикует; с permission — публикует.
- Истёкшая absolute/idle session → 401/redirect; logout/revoke → 401.
- Неизвестная OIDC-группа → deny.
- Чужой origin → 403; rate-limit работает.
- Каждый deny → `AdminAuditLog.result=denied`.
- `ValidationResult.passed=false` → 422.
- Нет admin API без auth; feature flag не считается защитой.
