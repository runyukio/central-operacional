#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
patterns=(
  'REALTIME_HOURS_AGENT_TOKEN[[:space:]]*='
  'cloudToken[[:space:]]*"?[[:space:]]*:[[:space:]]*"[^"$]'
  'AQAAANCMnd8BFdERjHoAwE/Cl\+sB'
  'BEGIN PRIVATE KEY'
  'BEGIN RSA PRIVATE KEY'
)

failed=0
for pattern in "${patterns[@]}"; do
  if grep -RInE --exclude-dir=.git --exclude='*.md' --exclude='verify-no-secrets.sh' "$pattern" "$root"; then
    echo "Potential secret pattern detected: $pattern" >&2
    failed=1
  fi
done
exit "$failed"
