#!/usr/bin/env bash
# Copyright 2026 Alexander L. Penny
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# End-to-end single sign-on test. Starts test/mock-idp.mjs (a throwaway
# OIDC + OAuth2 provider on https://localhost:8443 with a self-signed
# certificate) and walks real sign-ins through it: account linking,
# autoCreate, allow rules, OAuth2 with a GitHub-style emails list, state /
# replay / provider mix-up attacks, disabled accounts, and config checks.
# Needs node, curl, python3 and openssl.  Run: npm run test:sso
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$ROOT/test"; TMP="$(mktemp -d)"
PORT="${SSO_TEST_PORT:-3299}"; BASE="http://127.0.0.1:$PORT"; IDP="https://localhost:8443"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then printf '  ok    %s\n' "$1"; PASS=$((PASS+1)); else printf '  FAIL  %s (got %q, want %q)\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi; }
cleanup() { kill ${APP_PID:-} ${IDP_PID:-} 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 1 \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost" 2>/dev/null
node "$T/mock-idp.mjs" "$TMP/key.pem" "$TMP/cert.pem" > "$TMP/idp.log" 2>&1 & IDP_PID=$!
sleep 1
setuser() { curl -s --cacert "$TMP/cert.pem" -X POST "$IDP/set-user" -d "$1" >/dev/null; }

export NODE_EXTRA_CA_CERTS="$TMP/cert.pem" DATA_DIR="$TMP/data" SESSION_SECRET=sso-test PORT PUBLIC_ORIGIN="$BASE"
mkdir -p "$DATA_DIR"

# --- an old (1.1-style) database: one user already linked to subject u1 ---
python3 - "$DATA_DIR/images.db" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.executescript("""
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, email TEXT COLLATE NOCASE, oidc_subject TEXT, created_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0);
INSERT INTO users (username, password_hash, email, oidc_subject, created_at) VALUES ('alice','x','a@example.com','u1',0);
""")
c.commit()
PY

printf 'oidc-secret\n' > "$TMP/grp-secret"
cat > "$TMP/providers.json" <<JSON
{ "providers": [
  { "_comment": "comments are allowed",
    "id": "idp", "issuer": "$IDP", "clientId": "oidc-client", "clientSecretEnv": "IDP_SECRET",
    "label": "Corp SSO", "color": "#fd4b2d", "icon": "/images/logo.png",
    "autoCreate": true, "allowedEmailDomains": ["corp.test"] },
  { "id": "grp", "issuer": "$IDP", "clientId": "oidc-client", "clientSecretFile": "$TMP/grp-secret",
    "tokenAuthMethod": "client_secret_post", "useUserinfo": true,
    "autoCreate": true, "requiredGroups": ["uploaders"] },
  { "id": "gh", "preset": "github", "clientId": "oauth-client", "clientSecret": "oauth-secret",
    "authorizationUrl": "$IDP/authorize", "tokenUrl": "$IDP/token",
    "userinfoUrl": "$IDP/user", "emailsUrl": "$IDP/user/emails" }
] }
JSON
chmod 600 "$TMP/providers.json"

start() {
  node "$ROOT/src/server.js" > "$TMP/app.log" 2>&1 & APP_PID=$!
  for _ in $(seq 1 40); do curl -sf "$BASE/healthz" >/dev/null 2>&1 && return; sleep 0.25; done
  echo "app did not start:"; cat "$TMP/app.log"; exit 1
}
export OIDC_ISSUER_URL="$IDP" OIDC_CLIENT_ID=legacy-client OIDC_CLIENT_SECRET=legacy-secret
export OIDC_PROVIDERS_FILE="$TMP/providers.json" IDP_SECRET=oidc-secret LIBRARY_MODE=per-user
start

# sso <login-path> [jar] -> prints "<final-url> <status>"
sso() {
  local jar="${2:-$TMP/jar-$RANDOM}"
  curl -s -L --cacert "$TMP/cert.pem" -b "$jar" -c "$jar" -o "$TMP/last.html" \
    -w '%{url_effective} %{http_code}' "$BASE$1"
}
signed_in() { grep -c 'id="drop"' "$TMP/last.html"; }

check "old single link migrated" "$(grep -c 'moved 1 single sign-on link' "$TMP/app.log")" "1"
check "redirect URIs logged" "$(grep -c 'redirect URI' "$TMP/app.log")" "4"
PAGE="$(curl -s "$BASE/images")"
check "one button per provider" "$(echo "$PAGE" | grep -c 'class="btn sso sso--')" "4"
check "provider label + colour rendered" \
  "$(echo "$PAGE" | grep -c 'Corp SSO\|sso--idp,.sso--idp:hover.*#fd4b2d')" "2"
check "no failed-sign-in notice" "$(echo "$PAGE" | grep -ci 'banned')" "0"

# 1. legacy provider, migrated link
setuser '{"sub":"u1","email":"a@example.com"}'
R="$(sso /images/oidc/login)"
check "legacy provider: linked user signs in" "$R $(signed_in)" "$BASE/images 200 1"
# 2. same email, different subject at the same provider
setuser '{"sub":"u-evil","email":"a@example.com","email_verified":true}'
R="$(sso /images/oidc/login)"
check "legacy provider: other subject with same email refused" "${R##* }" "403"

# 3. autoCreate with an allowed domain
setuser '{"sub":"c1","email":"bob@corp.test","email_verified":true,"preferred_username":"bob"}'
R="$(sso /images/oidc/idp/login)"
check "autoCreate: allowed domain gets an account" "$R $(signed_in)" "$BASE/images 200 1"
check "autoCreate: username from preferred_username" "$(node $ROOT/scripts/lsusers.js | grep -c 'bob .*email=bob@corp.test  sso=idp')" "1"
setuser '{"sub":"c2","email":"eve@evil.test","email_verified":true}'
check "autoCreate: other domain refused" "$(sso /images/oidc/idp/login | cut -d' ' -f2)" "403"
setuser '{"sub":"c3","email":"carol@corp.test"}'
check "autoCreate: unverified email refused" "$(sso /images/oidc/idp/login | cut -d' ' -f2)" "403"

# 4. group rule (groups from userinfo), client_secret_post, secret from file
setuser '{"sub":"g1","email":"dan@x.test","email_verified":true,"groups":["uploaders"]}'
R="$(sso /images/oidc/grp/login)"
check "requiredGroups: member gets in" "$R $(signed_in)" "$BASE/images 200 1"
setuser '{"sub":"g2","email":"zed@x.test","email_verified":true,"groups":["others"]}'
check "requiredGroups: non-member refused" "$(sso /images/oidc/grp/login | cut -d' ' -f2)" "403"

# 5. GitHub-style OAuth2: link to alice by her verified (non-primary) email
setuser '{"id":42,"login":"octo","email":null,"emails":[{"email":"nope@x.test","primary":true,"verified":false},{"email":"a@example.com","primary":false,"verified":true}]}'
R="$(sso /images/oidc/gh/login)"
check "oauth2: linked by verified email" "$R $(signed_in)" "$BASE/images 200 1"
check "oauth2: alice now has both links" "$(node $ROOT/scripts/lsusers.js | grep -c 'alice .*sso=default,gh')" "1"
setuser '{"id":42,"login":"octo","email":null,"emails":[]}'
R="$(sso /images/oidc/gh/login)"
check "oauth2: later sign-ins use the subject link" "$R $(signed_in)" "$BASE/images 200 1"
setuser '{"id":43,"login":"x","emails":[{"email":"a@example.com","primary":true,"verified":false}]}'
check "oauth2: unverified-only email refused" "$(sso /images/oidc/gh/login | cut -d' ' -f2)" "403"
check "refusal shown on the sign-in page" "$(grep -c 'did not confirm that your email' "$TMP/last.html")" "1"

# 6. mix-up: a callback for provider idp replayed at provider gh
setuser '{"sub":"c1","email":"bob@corp.test","email_verified":true}'
J="$TMP/jmix"
AUTH="$(curl -s -b "$J" -c "$J" -o /dev/null -w '%{redirect_url}' "$BASE/images/oidc/idp/login")"
CB="$(curl -s --cacert "$TMP/cert.pem" -o /dev/null -w '%{redirect_url}' "$AUTH")"
check "callback replayed at another provider refused" \
  "$(curl -s -b "$J" -o /dev/null -w '%{http_code}' "${CB/\/idp\/callback/\/gh\/callback}")" "403"

# 7. tampered state, then replay of a good callback
J="$TMP/jstate"
AUTH="$(curl -s -b "$J" -c "$J" -o /dev/null -w '%{redirect_url}' "$BASE/images/oidc/idp/login")"
CB="$(curl -s --cacert "$TMP/cert.pem" -o /dev/null -w '%{redirect_url}' "$AUTH")"
check "tampered state refused" "$(curl -s -b "$J" -c "$J" -o /dev/null -w '%{http_code}' "${CB/state=/state=x}")" "403"
J="$TMP/jreplay"
AUTH="$(curl -s -b "$J" -c "$J" -o /dev/null -w '%{redirect_url}' "$BASE/images/oidc/idp/login")"
CB="$(curl -s --cacert "$TMP/cert.pem" -o /dev/null -w '%{redirect_url}' "$AUTH")"
check "good callback accepted" "$(curl -s -b "$J" -c "$J" -o /dev/null -w '%{http_code}' "$CB")" "302"
check "same callback replayed refused" "$(curl -s -b "$J" -o /dev/null -w '%{http_code}' "$CB")" "403"
check "callback with no handshake cookie refused" "$(curl -s -o /dev/null -w '%{http_code}' "$CB")" "403"

# 8. disabled accounts
python3 -c "import sqlite3; c=sqlite3.connect('$DATA_DIR/images.db'); c.execute(\"UPDATE users SET disabled=1 WHERE username='bob'\"); c.commit()"
check "disabled account refused" "$(sso /images/oidc/idp/login | cut -d' ' -f2)" "403"

check "failures reach the fail2ban log" "$(grep -c 'LOGIN_FAILED .*reason="sso_' "$DATA_DIR/log/auth.log")" "10"
check "successes logged with provider" "$(grep -c 'LOGIN_OK .*(sso:' "$DATA_DIR/log/auth.log")" "6"
kill $APP_PID; wait $APP_PID 2>/dev/null

# 9. config validation refuses to start
bad() { # bad <label> <json> <expected text>
  echo "$2" > "$TMP/bad.json"
  out="$(OIDC_PROVIDERS_FILE="$TMP/bad.json" timeout 10 node "$ROOT/src/server.js" 2>&1)"
  check "rejects: $1" "$(echo "$out" | grep -qF -- "$3" && echo 1 || echo 0)" "1"
}
unset OIDC_ISSUER_URL OIDC_CLIENT_ID OIDC_CLIENT_SECRET
bad "typo'd setting" '{"providers":[{"id":"a","issuer":"https://x.test","clientId":"c","clientSecret":"s","autocreate":true}]}' 'unknown setting "autocreate"'
bad "http issuer" '{"providers":[{"id":"a","issuer":"http://x.test","clientId":"c","clientSecret":"s"}]}' 'must start with https'
bad "two secrets" '{"providers":[{"id":"a","issuer":"https://x.test","clientId":"c","clientSecret":"s","clientSecretEnv":"X"}]}' 'exactly one of'
bad "duplicate id" '{"providers":[{"id":"a","issuer":"https://x.test","clientId":"c","clientSecret":"s"},{"id":"a","issuer":"https://x.test","clientId":"c","clientSecret":"s"}]}' 'used twice'
bad "bad colour" '{"providers":[{"id":"a","issuer":"https://x.test","clientId":"c","clientSecret":"s","color":"red;}body{x"}]}' 'hex colour'
bad "javascript icon" '{"providers":[{"id":"a","issuer":"https://x.test","clientId":"c","clientSecret":"s","icon":"javascript:alert(1)"}]}' '"icon" must be'
bad "oauth2 without subject" '{"providers":[{"id":"a","type":"oauth2","authorizationUrl":"https://x.test/a","tokenUrl":"https://x.test/t","userinfoUrl":"https://x.test/u","clientId":"c","clientSecret":"s"}]}' 'claims.subject'
bad "reserved id" '{"providers":[{"id":"default","issuer":"https://x.test","clientId":"c","clientSecret":"s"}]}' 'reserved'
out="$(PUBLIC_ORIGIN= OIDC_PROVIDERS_FILE="$TMP/providers.json" timeout 10 node "$ROOT/src/server.js" 2>&1)"
check "rejects: SSO without PUBLIC_ORIGIN" "$(echo "$out" | grep -c 'PUBLIC_ORIGIN is not set')" "1"
out="$(LIBRARY_MODE=shared OIDC_PROVIDERS_FILE="$TMP/providers.json" timeout 3 node "$ROOT/src/server.js" 2>&1)"
check "warns: autoCreate with shared library" "$(echo "$out" | grep -c 'autoCreate on while LIBRARY_MODE=shared')" "2"

echo; echo "  sso: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
