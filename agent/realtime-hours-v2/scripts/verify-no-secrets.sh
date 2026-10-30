#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
patterns=(
  'REALTIME_HOURS_AGENT_TOKEN[[:space:]]*='
  'cloudToken[[:space:]]*"?[[:space:]]*:[[:space:]]*"[^"$]'
  'AQAAANCMnd8BFdERjHoAwE/Cl\+sB'
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
)

failed=0
for pattern in "${patterns[@]}"; do
  if grep -RInE --exclude-dir=.git --exclude='*.md' --exclude='verify-no-secrets.sh' -e "$pattern" "$root"; then
    echo "Potential secret pattern detected: $pattern" >&2
    failed=1
  else
    result=$?
    if (( result > 1 )); then exit "$result"; fi
  fi
done
exit "$failed"
