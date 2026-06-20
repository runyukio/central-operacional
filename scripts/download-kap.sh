#!/bin/zsh

set -euo pipefail

QUEUE_URL="https://kap.sgp-adm.corp.kuaishou.com/aias-data-engine/queue/stat/detailList/export"
AUDITOR_URL="https://kap.sgp-adm.corp.kuaishou.com/aias-data-engine/auditor/stat/detailList/export"
REFERER="https://kap.sgp-adm.corp.kuaishou.com/data-center/overview"
COOKIE_FILE="${KAP_COOKIE_FILE:-$HOME/.kap_cookie}"
QUEUE_BODY_FILE="${KAP_QUEUE_BODY_FILE:-${KAP_BODY_FILE:-$HOME/.kap_body.json}}"
AUDITOR_BODY_FILE="${KAP_AUDITOR_BODY_FILE:-$HOME/.kap_auditor_body.json}"
OUTPUT_DIR="${KAP_OUTPUT_DIR:-$HOME/Downloads/KAP}"
ENV_FILE="${KAP_ENV_FILE:-$HOME/.kap_env}"
SCRIPT_DIR="${0:A:h}"
TRANSFORM_SCRIPT="${KAP_TRANSFORM_SCRIPT:-$SCRIPT_DIR/kap-transform.js}"
BUNDLE_SCRIPT="${KAP_BUNDLE_SCRIPT:-$SCRIPT_DIR/kap-realtime-bundle.js}"
CURL_BIN="${KAP_CURL_BIN:-/usr/bin/curl}"
NOW="$(date +"%Y-%m-%d_%H-%M-%S")"
RUN_MINUTE="$(date +"%M")"
DOWNLOAD_RETRIES="${KAP_DOWNLOAD_RETRIES:-3}"
RETRY_DELAY_SECONDS="${KAP_RETRY_DELAY_SECONDS:-15}"
TEMP_FILES=()
QUEUE_OUTPUT_FILE=""
AUDITOR_OUTPUT_FILE=""
LOCK_DIR=""

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

KAP_ALLOWED_MINUTES="${KAP_ALLOWED_MINUTES:-00,10,20,30,40,50}"
if [[ "${KAP_ENFORCE_ALLOWED_MINUTE_SLOTS:-true}" == "true" ]]; then
  allowed_current_minute=false
  IFS=',' read -rA allowed_minutes <<< "$KAP_ALLOWED_MINUTES"
  for allowed_minute in "${allowed_minutes[@]}"; do
    allowed_minute="${allowed_minute//[[:space:]]/}"
    if [[ "$RUN_MINUTE" == "$allowed_minute" ]]; then
      allowed_current_minute=true
      break
    fi
  done

  if [[ "$allowed_current_minute" != "true" ]]; then
    echo "Skipping KAP download: current minute $RUN_MINUTE is outside allowed minute slots ($KAP_ALLOWED_MINUTES)."
    exit 0
  fi
fi

if ! [[ "$DOWNLOAD_RETRIES" = <-> ]] || (( DOWNLOAD_RETRIES < 1 )); then
  DOWNLOAD_RETRIES=3
fi

if ! [[ "$RETRY_DELAY_SECONDS" = <-> ]] || (( RETRY_DELAY_SECONDS < 1 )); then
  RETRY_DELAY_SECONDS=15
fi

cleanup() {
  if (( ${#TEMP_FILES[@]} > 0 )); then
    rm -f "${TEMP_FILES[@]}"
  fi
  if [[ -n "$LOCK_DIR" && -d "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

notify_failure() {
  local message="$1"
  if [[ "${KAP_NOTIFY_ON_FAILURE:-true}" != "true" || ! -x /usr/bin/osascript ]]; then
    return
  fi

  /usr/bin/osascript \
    -e 'on run argv' \
    -e 'display notification (item 1 of argv) with title "KAP Real Time"' \
    -e 'end run' \
    "$message" >/dev/null 2>&1 || true
}

check_cookie_freshness() {
  local max_age_hours="${KAP_COOKIE_MAX_AGE_HOURS:-72}"
  if ! [[ "$max_age_hours" = <-> ]] || (( max_age_hours <= 0 )); then
    return
  fi

  local now_epoch
  local cookie_epoch
  local age_hours
  now_epoch="$(date +%s)"
  cookie_epoch="$(stat -f %m "$COOKIE_FILE" 2>/dev/null || echo 0)"
  if ! [[ "$cookie_epoch" = <-> ]] || (( cookie_epoch <= 0 )); then
    return
  fi

  age_hours=$(( (now_epoch - cookie_epoch) / 3600 ))
  if (( age_hours >= max_age_hours )); then
    echo "Cookie KAP has $age_hours hour(s); refresh recommended (limit: $max_age_hours h)."
    notify_failure "Cookie KAP com ${age_hours}h. Atualize o cookie para evitar parada do Real Time."
  fi
}

persist_failure_artifacts() {
  local label="$1"
  local reason="$2"
  local headers_file="$3"
  local response_file="$4"
  local failure_dir="${KAP_FAILURE_DIR:-$OUTPUT_DIR/logs/failures}"
  local stamp
  local headers_copy
  local response_copy

  stamp="$(date +"%Y-%m-%d_%H-%M-%S")"
  mkdir -p "$failure_dir"
  headers_copy="$failure_dir/${label}_${stamp}_headers.txt"
  response_copy="$failure_dir/${label}_${stamp}_response.txt"

  cp "$headers_file" "$headers_copy" 2>/dev/null || true
  cp "$response_file" "$response_copy" 2>/dev/null || true

  echo "$label final failure: $reason"
  echo "Saved failure headers: $headers_copy"
  echo "Saved failure response: $response_copy"
}

if [[ ! -f "$COOKIE_FILE" ]]; then
  echo "Cookie file not found: $COOKIE_FILE"
  echo "Create it with the full value copied after the browser's Cookie: header."
  exit 1
fi

check_cookie_freshness

mkdir -p "$OUTPUT_DIR"
LOCK_DIR="${KAP_LOCK_DIR:-$OUTPUT_DIR/.kap-download.lock}"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another KAP download is already running; skipping this cycle."
  exit 0
fi

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
  local out_file
  local headers_file
  local http_code
  local content_type
  local curl_status
  local attempt=1
  local failure_reason=""

  while (( attempt <= DOWNLOAD_RETRIES )); do
    out_file="$(mktemp "${TMPDIR:-/tmp}/kap_${label}_xlsx_XXXXXX")"
    headers_file="$(mktemp "${TMPDIR:-/tmp}/kap_${label}_headers_XXXXXX")"
    TEMP_FILES+=("$out_file" "$headers_file")

    echo "Downloading $label (attempt $attempt/$DOWNLOAD_RETRIES)..."

    set +e
    http_code="$(
      "$CURL_BIN" -sS \
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
    curl_status=$?
    set -e

    content_type="$(grep -i '^content-type:' "$headers_file" | tail -1 | tr -d '\r' || true)"

    if (( curl_status != 0 )); then
      failure_reason="curl exit $curl_status"
    elif [[ "$http_code" != "200" ]]; then
      failure_reason="HTTP $http_code"
    elif [[ "$content_type" != *"spreadsheetml.sheet"* ]]; then
      failure_reason="response is not an Excel file ($content_type)"
    else
      failure_reason=""
      break
    fi

    echo "$label download failed on attempt $attempt/$DOWNLOAD_RETRIES: $failure_reason"
    if (( attempt < DOWNLOAD_RETRIES )); then
      sleep $(( RETRY_DELAY_SECONDS * attempt ))
    fi
    attempt=$(( attempt + 1 ))
  done

  if [[ -n "$failure_reason" ]]; then
    persist_failure_artifacts "$label" "$failure_reason" "$headers_file" "$out_file"
    notify_failure "Falha no download KAP $label após $DOWNLOAD_RETRIES tentativa(s)."
    exit 1
  fi

  echo "$label download complete:"
  echo "temporary file ready"

  if [[ "${KAP_WRITE_LAYOUT_HISTORY:-false}" == "true" && -f "$TRANSFORM_SCRIPT" ]]; then
    node "$TRANSFORM_SCRIPT" "$label" "$out_file" "$NOW"
  elif [[ "${KAP_WRITE_LAYOUT_HISTORY:-false}" == "true" ]]; then
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

REALTIME_XLSX="${KAP_REALTIME_OUTPUT_FILE:-$OUTPUT_DIR/realtime_kap.xlsx}"

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

  upload_attempt=1
  upload_response=""
  while (( upload_attempt <= DOWNLOAD_RETRIES )); do
    echo "Uploading Real Time workbook (attempt $upload_attempt/$DOWNLOAD_RETRIES)..."
    set +e
    upload_response="$(
      "$CURL_BIN" -sS \
        --http1.1 \
        -X POST "${REALTIME_SITE_URL%/}/api/realtime/import" \
        -H "Authorization: Bearer $REALTIME_IMPORT_TOKEN" \
        -F "source=kap-local" \
        -F "file=@-;filename=$(basename "$REALTIME_XLSX");type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" \
        < "$REALTIME_XLSX"
    )"
    upload_status=$?
    set -e

    if (( upload_status == 0 )) && [[ "$upload_response" == *'"success":true'* ]]; then
      break
    fi

    echo "Upload failed on attempt $upload_attempt/$DOWNLOAD_RETRIES."
    if [[ -n "$upload_response" ]]; then
      echo "$upload_response"
    fi
    if (( upload_attempt < DOWNLOAD_RETRIES )); then
      sleep $(( RETRY_DELAY_SECONDS * upload_attempt ))
    fi
    upload_attempt=$(( upload_attempt + 1 ))
  done

  echo "$upload_response"
  if [[ "$upload_response" != *'"success":true'* ]]; then
    notify_failure "Falha no upload KAP Real Time após $DOWNLOAD_RETRIES tentativa(s)."
    exit 1
  fi
fi
