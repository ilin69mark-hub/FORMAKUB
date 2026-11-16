#!/usr/bin/env bash
# Reproducible local browser smoke: disposable Keycloak + temp SQLite copy + Chrome CDP.
# Does not touch data/formakub.db or production Keycloak.
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/formakub-browser-smoke.XXXXXX")"
KC_PORT="${KC_PORT:-18082}"
APP_PORT="${APP_PORT:-3010}"
NOPRICE_PORT="${NOPRICE_PORT:-$((APP_PORT + 1))}"
CHROME_PORT="${CHROME_PORT:-9222}"
KC_NAME="formakub-browser-kc-$$"
APP_PID=""
APP2_PID=""
CHROME_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; fi
  if [[ -n "$APP2_PID" ]]; then kill "$APP2_PID" 2>/dev/null || true; fi
  if [[ -n "$CHROME_PID" ]]; then kill "$CHROME_PID" 2>/dev/null || true; fi
  docker rm -f "$KC_NAME" >/dev/null 2>&1 || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

# 1. Disposable realm with test users (passwords random, never printed).
python3 - "$ROOT" "$APP_PORT" <<'PY'
import json, sys, secrets, pathlib
root=pathlib.Path(sys.argv[1]); app_port=sys.argv[2]
realm=json.loads(pathlib.Path('deploy/keycloak/realm-formakub.json').read_text())
realm['sslRequired']='none'
realm['clients'][0]['redirectUris']=[f'http://localhost:{app_port}/api/auth/callback']
realm['clients'][0]['webOrigins']=[f'http://localhost:{app_port}']
realm['clients'][0]['attributes']['post.logout.redirect.uris']=f'http://localhost:{app_port}/*'
roles={"viewer":["calc-viewer"],"admin":["calc-admin"],"publisher":["calc-admin","price.publish"]}
users=[]
for name, rs in roles.items():
    pw=secrets.token_hex(12); (root/f"{name}.pass").write_text(pw)
    users.append({"username":name,"enabled":True,"email":f"{name}@test.local","firstName":name,"lastName":"Test","emailVerified":True,"credentials":[{"type":"password","value":pw,"temporary":False}],"clientRoles":{"formakub-admin-api":rs}})
realm['users']=users
(root/'realm-test.json').write_text(json.dumps(realm,indent=2))
PY

# 2. Disposable Keycloak.
BOOT_PASS="$(openssl rand -hex 16)"
docker run -d --rm --name "$KC_NAME" -p "$KC_PORT:8080" \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD="$BOOT_PASS" \
  -v "$ROOT/realm-test.json:/opt/keycloak/data/import/realm-test.json:ro" \
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm >/dev/null

for _ in $(seq 1 90); do
  if curl -fsS "http://localhost:$KC_PORT/realms/formakub/.well-known/openid-configuration" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://localhost:$KC_PORT/realms/formakub/.well-known/openid-configuration" >/dev/null

# 3. Temp SQLite copy (source is read-only).
mkdir -p "$ROOT/data"
cp data/formakub.db "$ROOT/data/" 2>/dev/null || true
cp data/formakub.db-wal "$ROOT/data/" 2>/dev/null || true
cp data/formakub.db-shm "$ROOT/data/" 2>/dev/null || true
if [[ ! -f "$ROOT/data/formakub.db" ]]; then
  echo "browser-smoke: data/formakub.db not found; cannot smoke public prices" >&2
  exit 2
fi

# 4. App.
AUTH_SECRET="$(openssl rand -hex 24)"
nohup env \
  FORMAKUB_DATA_DIR="$ROOT/data" FORMAKUB_STORAGE=sqlite \
  KEYCLOAK_ISSUER_URL="http://localhost:$KC_PORT/realms/formakub" \
  KEYCLOAK_CLIENT_ID=formakub-admin KEYCLOAK_AUDIENCE=formakub-admin-api \
  FORMAKUB_AUTH_SECRET="$AUTH_SECRET" FORMAKUB_ADMIN_UI=1 \
  NEXT_PUBLIC_SITE_URL="http://localhost:$APP_PORT" \
  npx next dev -p "$APP_PORT" >"$ROOT/app.log" 2>&1 &
APP_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS "http://localhost:$APP_PORT/" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://localhost:$APP_PORT/" >/dev/null

# 5. Chrome CDP.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-first-run --no-default-browser-check --disable-gpu \
  --remote-debugging-port="$CHROME_PORT" --user-data-dir="$ROOT/chrome" \
  about:blank >"$ROOT/chrome.log" 2>&1 &
CHROME_PID=$!
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:$CHROME_PORT/json/version" >/dev/null 2>&1; then break; fi
  sleep 1
done

# 6. Run smoke.
SMOKE_BASE_URL="http://localhost:$APP_PORT" CHROME_PORT="$CHROME_PORT" \
SMOKE_VIEWER_PASS="$ROOT/viewer.pass" SMOKE_ADMIN_PASS="$ROOT/admin.pass" \
SMOKE_PUBLISHER_PASS="$ROOT/publisher.pass" node scripts/browser-smoke.mjs

# 7. No-published-version browser scenario.
kill "$APP_PID" 2>/dev/null || true
APP_PID=""
for _ in $(seq 1 30); do
  if ! curl -fsS "http://localhost:$APP_PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

mkdir -p "$ROOT/noprice"
cp "$ROOT/data/formakub.db" "$ROOT/noprice/" 2>/dev/null || true
cp "$ROOT/data/formakub.db-wal" "$ROOT/noprice/" 2>/dev/null || true
cp "$ROOT/data/formakub.db-shm" "$ROOT/noprice/" 2>/dev/null || true
node - "$ROOT/noprice/formakub.db" <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const file = process.argv[2];
const db = new DatabaseSync(file);
const row = db.prepare("SELECT payload FROM collection_state WHERE collection = 'pricing-versions.json'").get();
if (row) {
  const versions = JSON.parse(row.payload).map((version) => ({
    ...version,
    status: 'superseded',
    publishedAt: undefined,
    publishedBy: undefined,
  }));
  db.prepare("UPDATE collection_state SET payload = ? WHERE collection = 'pricing-versions.json'").run(JSON.stringify(versions));
}
db.close();
NODE

nohup env \
  FORMAKUB_DATA_DIR="$ROOT/noprice" FORMAKUB_STORAGE=sqlite \
  KEYCLOAK_ISSUER_URL="http://localhost:$KC_PORT/realms/formakub" \
  KEYCLOAK_CLIENT_ID=formakub-admin KEYCLOAK_AUDIENCE=formakub-admin-api \
  FORMAKUB_AUTH_SECRET="$AUTH_SECRET" FORMAKUB_ADMIN_UI=1 \
  NEXT_PUBLIC_SITE_URL="http://localhost:$NOPRICE_PORT" \
  npx next dev -p "$NOPRICE_PORT" >"$ROOT/app-noprice.log" 2>&1 &
APP2_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS "http://localhost:$NOPRICE_PORT/" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://localhost:$NOPRICE_PORT/" >/dev/null

SMOKE_ONLY_NO_PRICE=1 SMOKE_NO_PRICE_BASE_URL="http://localhost:$NOPRICE_PORT" \
CHROME_PORT="$CHROME_PORT" SMOKE_VIEWER_PASS="$ROOT/viewer.pass" \
SMOKE_ADMIN_PASS="$ROOT/admin.pass" SMOKE_PUBLISHER_PASS="$ROOT/publisher.pass" \
node scripts/browser-smoke.mjs
