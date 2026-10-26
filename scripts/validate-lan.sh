#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://10.1.1.40:8080}"
base_url="${base_url%/}"

page="$(curl --fail --silent --show-error "$base_url/")"
asset_path="$(printf '%s' "$page" | grep -oE '/assets/[^" ]+' | head -n 1 || true)"
[[ -n "$asset_path" ]] || { echo "dashboard root did not include built assets" >&2; exit 1; }
curl --fail --silent --show-error --output /dev/null "$base_url$asset_path"

health="$(curl --fail --silent --show-error --header 'X-Forwarded-For: 203.0.113.77' "$base_url/health")"
node -e 'const h=JSON.parse(process.argv[1]); if (h.ok !== true || h.mode !== "dry") process.exit(1)' "$health"

snapshot="$(curl --fail --silent --show-error "$base_url/snapshot")"
node -e '
  const s = JSON.parse(process.argv[1]);
  const expected = ["bee1", "bee2", "bee3"];
  const actual = (s.bees ?? []).map((b) => b.bee).sort();
  const age = Date.now() - s.market?.refreshedAt;
  if (s.mode !== "dry" || actual.join(",") !== expected.join(",") || !Number.isFinite(age) || age > 120_000) process.exit(1);
' "$snapshot"

for path in setup/complete hive/join keeper/connect lab/overlay; do
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --request POST --header 'content-type: application/json' --data '{}' "$base_url/$path")"
  [[ "$status" == 405 ]] || { echo "POST /$path returned $status (expected 405)" >&2; exit 1; }
done

echo "LAN smoke check passed: dashboard assets, healthy dry mode, three bees, fresh public feed, POST routes rejected."
