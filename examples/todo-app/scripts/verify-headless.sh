#!/usr/bin/env bash
# Headless verification of the Phase 1 acceptance app (spec 14.2).
#
# Boots the single Vite+Nitro dev server and asserts, over HTTP:
#   health, manifest (+ summary budget, ETag/304, 400, 403), OpenAPI x-* metadata,
#   registration + FACILIS_INITIAL_ADMIN, login/session, todo CRUD, RLS isolation,
#   background jobs (enqueue/status/cancel), cross-user 404, input-validation 400s and
#   the anonymous 401 contract.
#
# Usage: ./scripts/verify-headless.sh        (from examples/todo-app)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$BASH_SOURCE")/.." && pwd)"
PORT="${FACILIS_VERIFY_PORT:-5199}"
HOST="127.0.0.1"
BASE="http://$HOST:$PORT"
TMP=/tmp
LOG="$TMP/facilis-todo-verify.log"
COOKIES_A="$TMP/facilis-cookies-a.txt"
COOKIES_B="$TMP/facilis-cookies-b.txt"
rm -f "$COOKIES_A" "$COOKIES_B"

cd "$APP_DIR"

fail() {
  echo "FAIL: $*" >&2
  echo '--- dev server log (tail) ---' >&2
  tail -40 "$LOG" >&2 || true
  exit 1
}

# Runs a JS expression against the JSON on stdin; prints it as JSON or a string.
json() {
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const v=$1;console.log(typeof v==='object'?JSON.stringify(v):String(v))})"
}

status() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

# --- boot -------------------------------------------------------------------
echo "booting vite dev on $BASE (log: $LOG)"
PORT="$PORT" FACILIS_INITIAL_ADMIN="admin@example.com" \
  pnpm exec vite dev --host "$HOST" --port "$PORT" --strictPort >"$LOG" 2>&1 &
PID=$!
cleanup() { kill -TERM -- "-$PID" 2>/dev/null || true; }
trap cleanup EXIT

ready=""
for _ in $(seq 1 120); do
  if curl -sf --max-time 2 "$BASE/__facilis/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
[ -n "$ready" ] || fail "dev server never answered /__facilis/health"

# --- health + manifest ------------------------------------------------------
HEALTH="$(curl -sf "$BASE/__facilis/health")"
echo "health: $HEALTH"
echo "$HEALTH" | json "j.status ?? j.revision" >/dev/null || fail "health is not JSON"

REVISION="$(curl -sf "$BASE/__facilis/manifest/revision")"
echo "revision: $REVISION"
REVISION_ID="$(echo "$REVISION" | json "j.revision")"
[ -n "$REVISION_ID" ] || fail "manifest/revision returned no revision"

MANIFEST="$(curl -sf "$BASE/__facilis/manifest")"
echo "$MANIFEST" | json "Object.keys(j.manifest ?? {})" >/dev/null || fail "manifest missing"
echo "$MANIFEST" | json "j.revision" >/dev/null || fail "manifest has no revision"
echo "$MANIFEST" | json "JSON.stringify(j.warnings)" | grep -q '\[\]' \
  || fail "manifest reports warnings: $(echo "$MANIFEST" | json "JSON.stringify(j.warnings)")"
echo "manifest: full, no warnings"

SUMMARY="$(curl -sf "$BASE/__facilis/manifest?format=summary")"
chars="$(echo "$SUMMARY" | json "JSON.stringify(j).length")"
[ "$chars" -lt 2000 ] || fail "summary manifest is $chars chars (> 2000)"
echo "summary manifest: $chars chars"

# --- OpenAPI metadata (the A16 contract) ------------------------------------
SPEC="$(curl -sf "$BASE/_openapi.json")"
echo "$SPEC" | json "(j.paths?.['/api/todos']?.get?.['x-db-tables'] ?? null)" | grep -q todos \
  || fail "/api/todos GET has no x-db-tables in /_openapi.json"
echo "openapi: /api/todos carries x-db-tables"
echo "$SPEC" | json "(j.paths?.['/api/todos']?.post?.['x-permission'] ?? null)" | grep -q 'todos:write' \
  || fail "/api/todos POST has no x-permission in /_openapi.json"
echo "openapi: /api/todos POST carries x-permission"
[ "$(status "$BASE/_facilis/openapi.json")" = "200" ] || fail "native spec not kept on /_facilis"
echo "openapi: native spec kept on /_facilis/openapi.json"

# --- auth -------------------------------------------------------------------
register() {
  local body
  body=$(printf '{"email":"%s","password":"password123"}' "$2")
  curl -sf -X POST -H 'content-type: application/json' -c "$1" -d "$body" "$BASE/api/auth/register"
}
login() {
  local body
  body=$(printf '{"email":"%s","password":"password123"}' "$2")
  curl -sf -X POST -H 'content-type: application/json' -c "$1" -d "$body" "$BASE/api/auth/login"
}

ADMIN_JSON="$(register "$COOKIES_A" "admin@example.com")"
echo "register admin: $ADMIN_JSON"
echo "$ADMIN_JSON" | json "j.role" | grep -q admin \
  || fail "FACILIS_INITIAL_ADMIN registration was not granted admin"
login "$COOKIES_A" "admin@example.com" >/dev/null

USER_JSON="$(register "$COOKIES_B" "user@example.com")"
echo "register user: $USER_JSON"
login "$COOKIES_B" "user@example.com" >/dev/null

SESSION="$(curl -sf -b "$COOKIES_B" "$BASE/api/auth/session")"
echo "session: $SESSION"
echo "$SESSION" | json "j.authenticated" | grep -q true || fail "session not authenticated"
echo "$SESSION" | json "j.roles" | grep -q '\[.*user' || fail "user role missing from session"

# --- CRUD + RLS isolation ---------------------------------------------------
TODO="$(curl -sf -b "$COOKIES_A" -X POST -H 'content-type: application/json' \
  -d '{"title":"admin only todo"}' "$BASE/api/todos")"
echo "admin created: $TODO"
TODO_ID="$(echo "$TODO" | json "j.id")"
[ -n "$TODO_ID" ] || fail "todo creation returned no id"

ADMIN_LIST="$(curl -sf -b "$COOKIES_A" "$BASE/api/todos")"
echo "admin sees: $ADMIN_LIST"
echo "$ADMIN_LIST" | json "j.length" | grep -qx 1 || fail "admin should see exactly 1 todo"

USER_LIST="$(curl -sf -b "$COOKIES_B" "$BASE/api/todos")"
echo "user sees: $USER_LIST"
echo "$USER_LIST" | json "j.length" | grep -qx 0 \
  || fail "RLS leak: the second user sees the admin todo"

curl -sf -b "$COOKIES_A" -X PATCH -H 'content-type: application/json' \
  -d '{"done":true}' "$BASE/api/todos/$TODO_ID" >/dev/null || fail "patch failed"
curl -sf -b "$COOKIES_B" -X DELETE "$BASE/api/todos/$TODO_ID" >/dev/null 2>&1 || true
STATUS="$(status -b "$COOKIES_B" -X DELETE "$BASE/api/todos/$TODO_ID")"
[ "$STATUS" = "404" ] || fail "cross-user DELETE returned $STATUS, expected 404 (RLS)"
echo "cross-user DELETE => 404 (RLS hides the row)"

STATUS="$(status -b "$COOKIES_A" -X DELETE "$BASE/api/todos/$TODO_ID")"
[ "$STATUS" = "200" ] || fail "owner DELETE returned $STATUS, expected 200"
echo "owner DELETE => 200"

# --- background jobs (D-102) ------------------------------------------------
# Scheduled an hour out so the scheduler cannot claim it while we inspect/cancel it.
RUN_AT="$(node -e 'console.log(new Date(Date.now() + 60 * 60 * 1000).toISOString())')"
JOB="$(curl -sf -b "$COOKIES_A" -X POST -H 'content-type: application/json' \
  -d "{\"runAt\":\"$RUN_AT\"}" "$BASE/api/jobs")" || fail "job enqueue failed"
echo "job enqueued: $JOB"
JOB_ID="$(echo "$JOB" | json "j.id")"
[ -n "$JOB_ID" ] || fail "job enqueue returned no id"

JOB_GET="$(curl -sf -b "$COOKIES_A" "$BASE/api/jobs/$JOB_ID")"
echo "job status: $JOB_GET"
echo "$JOB_GET" | json "j.id" | grep -qx "$JOB_ID" \
  || fail "GET /api/jobs/$JOB_ID returned a different id"
echo "$JOB_GET" | json "j.status" | grep -qx queued \
  || fail "scheduled job is not queued (it raced the scheduler)"

JOB_CANCEL="$(curl -sf -b "$COOKIES_A" -X DELETE "$BASE/api/jobs/$JOB_ID")"
echo "job cancel: $JOB_CANCEL"
echo "$JOB_CANCEL" | json "j.cancelled" | grep -qx true \
  || fail "DELETE /api/jobs/$JOB_ID did not return cancelled:true"

JOB_CANCELLED="$(curl -sf -b "$COOKIES_A" "$BASE/api/jobs/$JOB_ID")"
echo "$JOB_CANCELLED" | json "j.status" | grep -qx cancelled \
  || fail "cancelled job did not report status cancelled"
echo "jobs: enqueue -> queued -> cancel -> cancelled OK"

# --- contract guards --------------------------------------------------------
STATUS="$(status "$BASE/api/todos")"
[ "$STATUS" = "401" ] || fail "anonymous GET /api/todos returned $STATUS, expected 401"
echo "anonymous GET /api/todos => 401"

STATUS="$(status -b "$COOKIES_A" -X POST -H 'content-type: application/json' \
  -d '{"title":""}' "$BASE/api/todos")"
[ "$STATUS" = "400" ] || fail "invalid body returned $STATUS, expected 400"
CODE="$(curl -s -b "$COOKIES_A" -X POST -H 'content-type: application/json' \
  -d '{"title":""}' "$BASE/api/todos" | json "j.code")"
[ "$CODE" = "invalid_input" ] || fail "invalid body code $CODE, expected invalid_input"
STATUS="$(status -b "$COOKIES_A" "$BASE/api/todos?includeDone=maybe")"
[ "$STATUS" = "400" ] || fail "invalid query returned $STATUS, expected 400"
echo "input validation => 400 invalid_input"

STATUS="$(status -H "If-None-Match: W/\"$REVISION_ID\"" "$BASE/__facilis/manifest")"
[ "$STATUS" = "304" ] || fail "If-None-Match returned $STATUS, expected 304"
STATUS="$(status "$BASE/__facilis/manifest?sections=nope")"
[ "$STATUS" = "400" ] || fail "invalid sections returned $STATUS, expected 400"
STATUS="$(status -H 'Origin: http://evil.test' "$BASE/__facilis/manifest")"
[ "$STATUS" = "403" ] || fail "cross-origin manifest returned $STATUS, expected 403"
echo "manifest guards: 304 / 400 / 403 OK"

echo "OK: Phase 1 acceptance checks passed"
