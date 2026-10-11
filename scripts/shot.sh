#!/usr/bin/env bash
# Headway screenshot helper: ONE headless Chrome at a time machine-wide (mkdir lock), low priority, hard timeout.
# Usage: scripts/shot.sh <url> <out.png> [width=1280] [height=800] [virtual_time_ms=6000]
set -u
URL="$1"; OUT="$2"; W="${3:-1280}"; H="${4:-800}"; BUDGET="${5:-6000}"
LOCK=/tmp/headway-shot.lock
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for _ in $(seq 1 300); do
  mkdir "$LOCK" 2>/dev/null && break
  if [ -d "$LOCK" ] && [ $(( $(date +%s) - $(stat -f %m "$LOCK") )) -gt 90 ]; then rm -rf "$LOCK"; fi
  sleep 1
done
trap 'rm -rf "$LOCK"' EXIT
nice -n 10 "$CHROME" --headless=new --user-data-dir=/tmp/headway-shot-profile --hide-scrollbars \
  --window-size="$W,$H" --virtual-time-budget="$BUDGET" --screenshot="$OUT" "$URL" >/dev/null 2>&1 &
PID=$!
( sleep 60; kill -9 "$PID" 2>/dev/null ) & WATCH=$!
wait "$PID"; kill "$WATCH" 2>/dev/null
[ -s "$OUT" ] && echo "ok $OUT" || { echo "screenshot failed: $URL" >&2; exit 1; }
