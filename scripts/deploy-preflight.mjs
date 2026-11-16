#!/usr/bin/env node
/**
 * Deployment preflight — no secrets are printed.
 * Usage: node scripts/deploy-preflight.mjs
 * Required env: KEYCLOAK_ISSUER_URL, FORMAKUB_AUTH_SECRET.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}
function warn(message) {
  warnings.push(message);
}
function validUrl(name, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      fail(`${name}: ожидался http(s) URL`);
    }
    return url;
  } catch {
    fail(`${name}: некорректный URL`);
    return null;
  }
}

const issuer = process.env.KEYCLOAK_ISSUER_URL?.trim();
if (!issuer) fail("KEYCLOAK_ISSUER_URL не задан");
else {
  const url = validUrl("KEYCLOAK_ISSUER_URL", issuer);
  if (url && !url.pathname.includes("/realms/")) {
    warn("KEYCLOAK_ISSUER_URL не содержит /realms/<realm> — проверьте");
  }
}

const secret = process.env.FORMAKUB_AUTH_SECRET?.trim();
if (!secret) fail("FORMAKUB_AUTH_SECRET не задан");
else if (secret.length < 32) fail("FORMAKUB_AUTH_SECRET короче 32 символов");

const clientId = process.env.KEYCLOAK_CLIENT_ID?.trim() || "formakub-admin";
const audience = process.env.KEYCLOAK_AUDIENCE?.trim() || "formakub-admin-api";
if (!clientId) fail("KEYCLOAK_CLIENT_ID пуст");
if (!audience) fail("KEYCLOAK_AUDIENCE пуст");

const redirect = process.env.FORMAKUB_AUTH_REDIRECT_URI?.trim();
if (redirect) {
  const url = validUrl("FORMAKUB_AUTH_REDIRECT_URI", redirect);
  if (url && url.pathname !== "/api/auth/callback") {
    fail("FORMAKUB_AUTH_REDIRECT_URI должен указывать на /api/auth/callback");
  }
}

if (process.env.FORMAKUB_ADMIN_UI === "1") {
  warn("FORMAKUB_ADMIN_UI=1 — это feature gate, не авторизация; допустимо только для smoke");
}

const compose = readFileSync("docker-compose.yml", "utf8");
for (const key of [
  "KEYCLOAK_ISSUER_URL",
  "KEYCLOAK_CLIENT_ID",
  "KEYCLOAK_AUDIENCE",
  "FORMAKUB_AUTH_SECRET",
  "FORMAKUB_STORAGE",
  "FORMAKUB_BACKUP_INTERVAL_MS",
]) {
  if (!compose.includes(key)) fail(`docker-compose.yml не содержит ${key}`);
}
if (!compose.includes("app-data:/app/data")) fail("docker-compose.yml: отсутствует volume app-data:/app/data");
if (!compose.includes("FORMAKUB_STORAGE=sqlite")) fail("docker-compose.yml: production storage не sqlite");

try {
  execFileSync("docker", ["compose", "config"], { stdio: "pipe" });
} catch {
  fail("docker compose config завершился ошибкой");
}

const realmPath = "deploy/keycloak/realm-formakub.json";
if (!existsSync(realmPath)) fail(`${realmPath} отсутствует`);
else {
  const realm = JSON.parse(readFileSync(realmPath, "utf8"));
  if (realm.realm !== "formakub") fail("realm template: realm != formakub");
  const admin = (realm.clients ?? []).find((client) => client.clientId === "formakub-admin");
  if (!admin) fail("realm template: нет client formakub-admin");
  if (admin && admin.publicClient !== true) fail("realm template: formakub-admin должен быть public PKCE client");
  if (admin && admin.attributes?.["pkce.code.challenge.method"] !== "S256") {
    fail("realm template: PKCE S256 не задан");
  }
  const api = (realm.clients ?? []).find((client) => client.clientId === "formakub-admin-api");
  if (!api) fail("realm template: нет client formakub-admin-api");
  const roles = realm.roles?.client?.["formakub-admin-api"]?.map((role) => role.name) ?? [];
  for (const role of ["calc-viewer", "calc-admin", "price.publish"]) {
    if (!roles.includes(role)) fail(`realm template: нет роли ${role}`);
  }
}

// Heuristic: no obvious private keys / inline secrets in deployment templates.
for (const file of ["deploy/keycloak/realm-formakub.json", ".env.example"]) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) fail(`${file}: содержит private key`);
  if (/S3_SECRET_ACCESS_KEY\s*=\s*\S+/.test(text) && !file.endsWith(".env.example")) {
    fail(`${file}: похоже на inline S3 secret`);
  }
}

if (warnings.length) {
  console.log("WARNINGS:");
  for (const item of warnings) console.log(`- ${item}`);
}
if (failures.length) {
  console.error("PREFLIGHT FAILED:");
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}
console.log("PREFLIGHT PASS");
