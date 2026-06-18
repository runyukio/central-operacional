#!/bin/zsh

set -euo pipefail

QUEUE_URL="https://kap.sgp-adm.corp.kuaishou.com/aias-data-engine/queue/stat/detailList/export"
AUDITOR_URL="https://kap.sgp-adm.corp.kuaishou.com/aias-data-engine/auditor/stat/detailList/export"
REFERER="https://kap.sgp-adm.corp.kuaishou.com/data-center/overview"
COOKIE_FILE="${KAP_COOKIE_FILE:-$HOME/.kap_cookie}"
QUEUE_BODY_FILE="${KAP_QUEUE_BODY_FILE:-${KAP_BODY_FILE:-$HOME/.kap_body.json}}"
AUDITOR_BODY_FILE="${KAP_AUDITOR_BODY_FILE:-$HOME/.kap_auditor_body.json}"
OUTPUT_DIR="${KAP_OUTPUT_DIR:-$HOME/Downloads/KAP}"
SCRIPT_DIR="${0:A:h}"
TRANSFORM_SCRIPT="${KAP_TRANSFORM_SCRIPT:-$SCRIPT_DIR/kap-transform.js}"
BUNDLE_SCRIPT="${KAP_BUNDLE_SCRIPT:-$SCRIPT_DIR/kap-realtime-bundle.js}"
NOW="$(date +"%Y-%m-%d_%H-%M-%S")"
TEMP_FILES=()
QUEUE_OUTPUT_FILE=""
AUDITOR_OUTPUT_FILE=""

cleanup() {
  if (( ${#TEMP_FILES[@]} > 0 )); then
    rm -f "${TEMP_FILES[@]}"
  fi
}
trap cleanup EXIT

if [[ ! -f "$COOKIE_FILE" ]]; then
  echo "Cookie file not found: $COOKIE_FILE"
  echo "Create it with the full value copied after the browser's Cookie: header."
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

COOKIE="$(tr -d '\r\n' < "$COOKIE_FILE")"

body_source_for_queue() {
  if [[ -f "$QUEUE_BODY_FILE" ]]; then
    echo "$QUEUE_BODY_FILE"
    return
  fi

  local fallback_body
  fallback_body="$(mktemp)"
  TEMP_FILES+=("$fallback_body")
  printf '%s' '{"queueIds":[13222],"skillGroupCodeList":[],"skillGroupQueueIds":[]}' > "$fallback_body"
  echo "$fallback_body"
}

download_report() {
  local label="$1"
  local url="$2"
  local body_source="$3"
  local out_file="$OUTPUT_DIR/${label}_kap_$NOW.xlsx"
  local headers_file="$OUTPUT_DIR/headers_${label}_$NOW.txt"
  local http_code
  local content_type

  echo "Downloading $label..."

  http_code="$(
    curl -sS \
      -D "$headers_file" \
      -o "$out_file" \
      -w "%{http_code}" \
      -X POST "$url" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -H "Accept-Language: en" \
      -H "Cache-Control: no-cache" \
      -H "Pragma: no-cache" \
      -H "Origin: https://kap.sgp-adm.corp.kuaishou.com" \
      -H "Referer: $REFERER" \
      -H "kapApiUriLocation: $REFERER" \
      -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15" \
      -H "Cookie: $COOKIE" \
      --data @"$body_source"
  )"

  content_type="$(grep -i '^content-type:' "$headers_file" | tail -1 | tr -d '\r' || true)"

  if [[ "$http_code" != "200" ]]; then
    echo "$label download failed: HTTP $http_code"
    echo "$content_type"
    echo "Headers: $headers_file"
    echo "Response: $out_file"
    exit 1
  fi

  if [[ "$content_type" != *"spreadsheetml.sheet"* ]]; then
    echo "$label download failed: response is not an Excel file."
    echo "$content_type"
    echo "Headers: $headers_file"
    echo "Response: $out_file"
    exit 1
  fi

  echo "$label download complete:"
  echo "$out_file"

  if [[ -f "$TRANSFORM_SCRIPT" ]]; then
    node "$TRANSFORM_SCRIPT" "$label" "$out_file" "$NOW"
  else
    echo "Transform script not found, skipping layout generation: $TRANSFORM_SCRIPT"
  fi

  if [[ "$label" == "queue" ]]; then
    QUEUE_OUTPUT_FILE="$out_file"
  elif [[ "$label" == "auditor" ]]; then
    AUDITOR_OUTPUT_FILE="$out_file"
  fi
}

QUEUE_BODY_SOURCE="$(body_source_for_queue)"

if [[ ! -f "$AUDITOR_BODY_FILE" ]]; then
  echo "Auditor body file not found: $AUDITOR_BODY_FILE"
  echo "Create it with the JSON body copied from the auditor export request."
  exit 1
fi

download_report "queue" "$QUEUE_URL" "$QUEUE_BODY_SOURCE"
download_report "auditor" "$AUDITOR_URL" "$AUDITOR_BODY_FILE"

REALTIME_XLSX="$OUTPUT_DIR/realtime_kap_$NOW.xlsx"

if [[ -f "$BUNDLE_SCRIPT" ]]; then
  echo "Building Real Time workbook..."
  node "$BUNDLE_SCRIPT" "$QUEUE_OUTPUT_FILE" "$AUDITOR_OUTPUT_FILE" "$NOW" "$REALTIME_XLSX"
else
  echo "Bundle script not found, skipping Real Time workbook: $BUNDLE_SCRIPT"
  REALTIME_XLSX=""
fi

if [[ "${KAP_UPLOAD_ENABLED:-false}" == "true" ]]; then
  if [[ -z "$REALTIME_XLSX" || ! -f "$REALTIME_XLSX" ]]; then
    echo "Real Time workbook not found; upload skipped."
    exit 1
  fi
  if [[ -z "${REALTIME_SITE_URL:-}" || -z "${REALTIME_IMPORT_TOKEN:-}" ]]; then
    echo "REALTIME_SITE_URL and REALTIME_IMPORT_TOKEN are required when KAP_UPLOAD_ENABLED=true."
    exit 1
  fi

  echo "Uploading Real Time workbook..."
  upload_response="$(
    curl -sS \
      -X POST "${REALTIME_SITE_URL%/}/api/realtime/import" \
      -H "Authorization: Bearer $REALTIME_IMPORT_TOKEN" \
      -F "source=kap-local" \
      -F "file=@$REALTIME_XLSX"
  )"
  echo "$upload_response"
fi
