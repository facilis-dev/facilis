#!/usr/bin/env bash
# Phase 0 spike verification: boots `vite dev` headlessly in both modes and probes
# the endpoints the Phase 0 tickets care about. Evidence is written to $EVIDENCE.
set -u

EVIDENCE="${EVIDENCE:-/tmp/phase0-evidence}"
mkdir -p "$EVIDENCE"

run_dev() {
  local mode="$1" port="$2"
  local log="$EVIDENCE/dev-$mode.log"
  local out="$EVIDENCE/dev-$mode"
  local envv=""
  if [ "$mode" = "fallback" ]; then envv="FACILIS_OPENAPI_AST_FALLBACK=1"; fi

  # shellcheck disable=SC2086
  env $envv setsid pnpm exec vite dev --host 127.0.0.1 --port "$port" --strictPort > "$log" 2>&1 &
  local pid=$!
  local ready=0 code
  for _ in $(seq 1 120); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)
    if [ "$code" = "200" ]; then ready=1; break; fi
    sleep 0.5
  done
  echo "READY=$ready"

  curl -s -o /dev/null -w "GET / => HTTP %{http_code} %{content_type}\n" "http://127.0.0.1:$port/" > "$out.client.txt"
  curl -s -o "$out.manifest.json" -w "GET /__facilis/manifest => HTTP %{http_code} %{content_type}\n" "http://127.0.0.1:$port/__facilis/manifest" > "$out.manifest.status.txt"
  curl -s -o "$out.openapi.json" -w "GET /_openapi.json => HTTP %{http_code} %{content_type}\n" "http://127.0.0.1:$port/_openapi.json" > "$out.openapi.status.txt"
  curl -s -o /dev/null -w "GET /api/health => HTTP %{http_code}\n" "http://127.0.0.1:$port/api/health" > "$out.health.txt"
  curl -s -o /dev/null -w "GET /api/health-wrapped => HTTP %{http_code}\n" "http://127.0.0.1:$port/api/health-wrapped" > "$out.wrapped.txt"
  if [ "$mode" = "fallback" ]; then
    curl -s -o /dev/null -w "GET /_facilis/openapi.json (internal) => HTTP %{http_code}\n" "http://127.0.0.1:$port/_facilis/openapi.json" > "$out.internal.txt"
  fi

  kill -TERM -- "-$pid" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-$pid" 2>/dev/null || true

  echo "=== $mode statuses ==="
  cat "$out.client.txt" "$out.manifest.status.txt" "$out.openapi.status.txt" "$out.health.txt" "$out.wrapped.txt"
  if [ -f "$out.internal.txt" ]; then cat "$out.internal.txt"; fi
  echo "=== $mode manifest body ==="
  cat "$out.manifest.json"; echo
  echo "=== $mode openapi routes (metadata of interest) ==="
  node -e "
    const fs = require('fs');
    const spec = JSON.parse(fs.readFileSync('$out.openapi.json', 'utf8'));
    for (const [p, ops] of Object.entries(spec.paths || {})) {
      const op = ops.get || ops.post || {};
      const keep = {};
      if (op.description) keep.description = op.description;
      if (op['x-permission']) keep['x-permission'] = op['x-permission'];
      if (op['x-db-tables']) keep['x-db-tables'] = op['x-db-tables'];
      if (op['x-db-columns']) keep['x-db-columns'] = op['x-db-columns'];
      console.log(p, '=>', JSON.stringify(keep));
    }
  "
}

echo '######## DEFAULT MODE (Nitro-native metadata only) ########'
run_dev default 5293
echo
echo '######## AST FALLBACK MODE (framework-owned pass) ########'
run_dev fallback 5294
echo
echo "stray vite dev processes: $(ps aux | grep '[v]ite dev' | wc -l)"
