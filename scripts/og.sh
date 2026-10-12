#!/usr/bin/env bash
# Render the Open Graph card templates in apps/web/og/*.html to apps/web/og/out/*.png (1200×630; OG_W/OG_H override).
# Serves the repo root on a throwaway port so the templates can load fonts and the town renders, then
# screenshots each card through scripts/shot.sh (one headless Chrome at a time). Usage: scripts/og.sh [name…]
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=5287
mkdir -p "$ROOT/apps/web/og/out"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 0.5
names=("$@")
[ ${#names[@]} -eq 0 ] && names=($(cd "$ROOT/apps/web/og" && ls *.html | sed 's/\.html$//'))
for n in "${names[@]}"; do
  "$ROOT/scripts/shot.sh" "http://127.0.0.1:$PORT/apps/web/og/$n.html" "$ROOT/apps/web/og/out/$n.png" "${OG_W:-1200}" "${OG_H:-630}" 1500
done
