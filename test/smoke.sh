#!/usr/bin/env bash
# End-to-end smoke test. Starts the app on a scratch data directory, exercises
# the main paths, and fails the build on any unexpected result.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT="${SMOKE_PORT:-3199}"
BASE="http://127.0.0.1:$PORT"
JAR="$TMP/cookies"
PASS=0
FAIL=0

cleanup() {
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then
    printf '  ok    %s\n' "$1"; PASS=$((PASS+1))
  else
    printf '  FAIL  %s (got %q, want %q)\n' "$1" "$2" "$3"; FAIL=$((FAIL+1))
  fi
}

csrf() { curl -s -b "$JAR" -c "$JAR" "$BASE/images" \
  | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/.*value="//;s/"//'; }

# A minimal valid PNG, built without any image library.
python3 - "$TMP/pic.png" <<'PY'
import sys, zlib, struct
def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
w = h = 8
raw = b''.join(b'\x00' + bytes([9, 40, 90] * w) for _ in range(h))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw))
       + chunk(b'IEND', b''))
open(sys.argv[1], 'wb').write(png)
PY

echo "contactsheet smoke test"

export DATA_DIR="$TMP/data" SESSION_SECRET="smoke-test-secret" PORT="$PORT"
export SITE_NAME="Smoke Test"

node "$ROOT/scripts/adduser.js" >/dev/null 2>&1 <<< "" || true
node -e "
import('$ROOT/src/db.js').then(async (m) => {
  const { hashPassword } = await import('$ROOT/src/auth.js');
  m.q.insertUser.run('smoke', hashPassword('smoke-password-123'), Date.now());
  process.exit(0);
});
" || { echo "  FAIL  could not seed user"; exit 1; }

node "$ROOT/src/server.js" > "$TMP/server.log" 2>&1 &
APP_PID=$!

for _ in $(seq 1 40); do
  curl -sf "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 0.25
done

check "health endpoint" "$(curl -s "$BASE/healthz")" '{"ok":true}'
check "login page renders" \
  "$(curl -s -c "$JAR" "$BASE/images" | grep -c 'name="password"')" "1"

# --- authentication ---
C="$(csrf)"
check "wrong password rejected" \
  "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' -X POST "$BASE/images/login" \
     -d "_csrf=$C&username=smoke&password=nope")" "401"
check "failure written to auth log" \
  "$(grep -c 'LOGIN_FAILED' "$DATA_DIR/log/auth.log")" "1"

curl -s -b "$JAR" -c "$JAR" -o /dev/null -X POST "$BASE/images/login" \
  -d "_csrf=$C&username=smoke&password=smoke-password-123"
check "signed in" \
  "$(curl -s -b "$JAR" "$BASE/images" | grep -c 'id="drop"')" "1"

# --- upload ---
C="$(csrf)"
RESP="$(curl -s -b "$JAR" -X POST "$BASE/images/upload" -H "X-CSRF-Token: $C" \
        -F "title=Smoke frame" -F "images=@$TMP/pic.png")"
ID="$(echo "$RESP" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')"
check "upload returned an id" "$([ -n "$ID" ] && echo yes || echo no)" "yes"
check "public image served anonymously" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/images/$ID")" "200"
check "served bytes match source" \
  "$(curl -s "$BASE/images/$ID" | cmp -s - "$TMP/pic.png" && echo same || echo differs)" "same"
check "title stored" \
  "$(curl -s -b "$JAR" "$BASE/images" | grep -c 'value="Smoke frame"')" "1"
check "extension suffix resolves" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/images/$ID.png")" "200"

# --- rejection of non-images ---
printf '<?php system($_GET[0]); ?>' > "$TMP/evil.png"
check "disguised script rejected" \
  "$(curl -s -b "$JAR" -X POST "$BASE/images/upload" -H "X-CSRF-Token: $C" \
     -F "images=@$TMP/evil.png" | grep -c 'not a supported image format')" "1"

# --- authorisation ---
check "upload without session refused" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/images/upload" \
     -F "images=@$TMP/pic.png")" "403"
check "path traversal refused" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/images/..%2f..%2fetc%2fpasswd")" "404"

# --- private visibility ---
curl -s -b "$JAR" -X PATCH "$BASE/images/$ID" -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $C" -d '{"visibility":"private"}' >/dev/null
check "private image hidden from anonymous" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/images/$ID")" "404"
check "private image visible when signed in" \
  "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/images/$ID")" "200"

curl -sI "$BASE/images/$ID" | grep -iv '^date' > "$TMP/h_private"
curl -sI "$BASE/images/zzzzzzzzzz" | grep -iv '^date' > "$TMP/h_missing"
check "private 404 indistinguishable from missing" \
  "$(cmp -s "$TMP/h_private" "$TMP/h_missing" && echo same || echo differs)" "same"

# --- search ---
check "search finds by title" \
  "$(curl -s -b "$JAR" "$BASE/images?q=smoke" | grep -c 'class="frame ')" "1"
check "search rejects nonsense cleanly" \
  "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/images?q=%27+OR+1%3D1+--")" "200"

# --- title validation ---
check "title XSS escaped" \
  "$(curl -s -b "$JAR" -X PATCH "$BASE/images/$ID" -H "Content-Type: application/json" \
     -H "X-CSRF-Token: $C" -d '{"title":"<script>alert(1)</script>"}' >/dev/null; \
     curl -s -b "$JAR" "$BASE/images" | grep -c '<script>alert(1)</script>')" "0"

# --- CSRF ---
check "PATCH without CSRF token refused" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PATCH "$BASE/images/$ID" \
     -H "Content-Type: application/json" -d '{"visibility":"public"}')" "403"

# --- delete ---
curl -s -b "$JAR" -X DELETE "$BASE/images/$ID" -H "X-CSRF-Token: $C" >/dev/null
check "deleted image gone" \
  "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/images/$ID")" "404"

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
