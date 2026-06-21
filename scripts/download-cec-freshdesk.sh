#!/bin/zsh

set -euo pipefail

REPORT_URL="${FRESHDESK_REPORT_URL:-https://freshdesk-us.freshreports.com/api/v1/reportgroups/1438838/download?pages=3}"
AUTH_TOKEN_FILE="${FRESHDESK_AUTH_TOKEN_FILE:-$HOME/.freshdesk_auth_token}"
BODY_FILE="${FRESHDESK_BODY_FILE:-$HOME/.freshdesk_report_body.json}"
COOKIE_FILE="${FRESHDESK_COOKIE_FILE:-}"
OUTPUT_DIR="${FRESHDESK_OUTPUT_DIR:-$HOME/Downloads/CEC}"
ENV_FILE="${FRESHDESK_ENV_FILE:-$HOME/.freshdesk_env}"
REALTIME_ENV_FILE="${REALTIME_ENV_FILE:-${KAP_ENV_FILE:-$HOME/.kap_env}}"
SCRIPT_DIR="${0:A:h}"
RESPONSE_EXTRACTOR="${FRESHDESK_RESPONSE_EXTRACTOR:-$SCRIPT_DIR/freshdesk-download-response.js}"
PDF_PARSER="${FRESHDESK_PDF_PARSER:-$SCRIPT_DIR/parse-cec-freshdesk-pdf.py}"
CURL_BIN="${FRESHDESK_CURL_BIN:-/usr/bin/curl}"
NOW="$(date +"%Y-%m-%d_%H-%M-%S")"
DOWNLOAD_RETRIES="${FRESHDESK_DOWNLOAD_RETRIES:-3}"
RETRY_DELAY_SECONDS="${FRESHDESK_RETRY_DELAY_SECONDS:-10}"
BUNDLED_PYTHON="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
PYTHON_BIN="${FRESHDESK_PYTHON_BIN:-$BUNDLED_PYTHON}"

if [[ -f "$REALTIME_ENV_FILE" ]]; then
  set -a
  source "$REALTIME_ENV_FILE"
  set +a
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

RTS_ENABLED="${FRESHDESK_RTS_ENABLED:-true}"
RTS_HELPER="${FRESHDESK_RTS_HELPER:-$SCRIPT_DIR/freshdesk-rts-download-url.js}"
CEC_UPLOAD_ENABLED="${CEC_UPLOAD_ENABLED:-${KAP_UPLOAD_ENABLED:-false}}"

if ! [[ "$DOWNLOAD_RETRIES" = <-> ]] || (( DOWNLOAD_RETRIES < 1 )); then
  DOWNLOAD_RETRIES=3
fi

if ! [[ "$RETRY_DELAY_SECONDS" = <-> ]] || (( RETRY_DELAY_SECONDS < 1 )); then
  RETRY_DELAY_SECONDS=10
fi

if [[ ! -f "$AUTH_TOKEN_FILE" ]]; then
  echo "Freshdesk auth token file not found: $AUTH_TOKEN_FILE"
  echo "Create it with the x-auth-token value copied from the Freshreports request."
  exit 1
fi

if [[ ! -f "$BODY_FILE" ]]; then
  echo "Freshdesk request body file not found: $BODY_FILE"
  echo "Create it with the JSON body copied from the Freshreports download request."
  exit 1
fi

if [[ ! -f "$RESPONSE_EXTRACTOR" ]]; then
  echo "Response extractor not found: $RESPONSE_EXTRACTOR"
  exit 1
fi

if [[ ! -f "$PDF_PARSER" ]]; then
  echo "CEC PDF parser not found: $PDF_PARSER"
  exit 1
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="${FRESHDESK_PYTHON_BIN:-python3}"
fi

if [[ "$RTS_ENABLED" != "false" && ! -f "$RTS_HELPER" ]]; then
  echo "RTS helper not found: $RTS_HELPER"
  exit 1
fi

AUTH_TOKEN="$(tr -d '\r\n' < "$AUTH_TOKEN_FILE")"
COOKIE_HEADER=""
if [[ -n "$COOKIE_FILE" && -f "$COOKIE_FILE" ]]; then
  COOKIE_HEADER="$(tr -d '\r\n' < "$COOKIE_FILE")"
fi

mkdir -p "$OUTPUT_DIR" "$OUTPUT_DIR/logs"

REQUEST_ID="$(uuidgen 2>/dev/null || printf '%s' "$NOW")"
RESPONSE_FILE="$OUTPUT_DIR/logs/freshdesk_cec_response_$NOW.json"
HEADERS_FILE="$OUTPUT_DIR/logs/freshdesk_cec_headers_$NOW.txt"
PDF_FILE="$OUTPUT_DIR/cec_freshdesk_$NOW.pdf"
LATEST_PDF="$OUTPUT_DIR/cec_freshdesk_latest.pdf"
JSON_FILE="$OUTPUT_DIR/cec_freshdesk_$NOW.json"
LATEST_JSON="$OUTPUT_DIR/cec_freshdesk_latest.json"

current_cycle_download() {
  local minute="$(date +%M)"
  local rounded_minute="00"
  if (( 10#$minute >= 30 )); then
    rounded_minute="30"
  fi
  date +"%Y-%m-%d %H:$rounded_minute"
}

update_latest_file() {
  local source_file="$1"
  local latest_file="$2"
  local label="$3"

  if cp -f "$source_file" "$latest_file" 2>/dev/null; then
    echo "Latest $label: $latest_file"
  else
    echo "Latest $label could not be updated, continuing: $latest_file"
  fi
}

process_downloaded_pdf() {
  local cycle_download="${FRESHDESK_CYCLE_DOWNLOAD:-$(current_cycle_download)}"
  echo "Parsing CEC Freshdesk PDF..."
  "$PYTHON_BIN" "$PDF_PARSER" --input "$PDF_FILE" --output "$JSON_FILE" --cycle "$cycle_download"
  update_latest_file "$JSON_FILE" "$LATEST_JSON" "JSON"
  echo "CEC Freshdesk JSON: $JSON_FILE"

  if [[ "$CEC_UPLOAD_ENABLED" == "true" ]]; then
    upload_cec_snapshot
  else
    echo "CEC upload disabled. Set CEC_UPLOAD_ENABLED=true or KAP_UPLOAD_ENABLED=true to upload automatically."
  fi
}

upload_cec_snapshot() {
  local site_url="${REALTIME_SITE_URL:-}"
  local token="${REALTIME_IMPORT_TOKEN:-}"
  if [[ -z "$site_url" ]]; then
    echo "REALTIME_SITE_URL not configured; skipping CEC upload."
    return 0
  fi
  if [[ -z "$token" ]]; then
    echo "REALTIME_IMPORT_TOKEN not configured; skipping CEC upload."
    return 0
  fi

  local endpoint="${site_url%/}/api/realtime/cec/import"
  local attempt=1
  local http_code=""
  local curl_status=0
  local upload_response="$OUTPUT_DIR/logs/freshdesk_cec_upload_$NOW.json"
  local failure_reason=""

  while (( attempt <= DOWNLOAD_RETRIES )); do
    echo "Uploading CEC Freshdesk snapshot (attempt $attempt/$DOWNLOAD_RETRIES)..."
    set +e
    http_code="$(
      "$CURL_BIN" -sS \
        -L \
        -o "$upload_response" \
        -w "%{http_code}" \
        -X POST "$endpoint" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        --data-binary @- \
        < "$JSON_FILE"
    )"
    curl_status=$?
    set -e

    if (( curl_status != 0 )); then
      failure_reason="curl exit $curl_status"
    elif [[ "$http_code" != "200" ]]; then
      failure_reason="HTTP $http_code"
    else
      failure_reason=""
      cat "$upload_response"
      echo
      break
    fi

    echo "CEC upload failed on attempt $attempt/$DOWNLOAD_RETRIES: $failure_reason"
    if (( attempt < DOWNLOAD_RETRIES )); then
      sleep $(( RETRY_DELAY_SECONDS * attempt ))
    fi
    attempt=$(( attempt + 1 ))
  done

  if [[ -n "$failure_reason" ]]; then
    echo "CEC upload failed: $failure_reason"
    echo "Response: $upload_response"
    exit 1
  fi
}

post_download_request() {
  local attempt=1
  local http_code=""
  local curl_status=0
  local failure_reason=""

  while (( attempt <= DOWNLOAD_RETRIES )); do
    echo "Requesting CEC Freshdesk report (attempt $attempt/$DOWNLOAD_RETRIES)..."

    local cookie_args=()
    if [[ -n "$COOKIE_HEADER" ]]; then
      cookie_args=(-H "Cookie: $COOKIE_HEADER")
    fi

    set +e
    http_code="$(
      "$CURL_BIN" -sS \
        --http1.1 \
        -D "$HEADERS_FILE" \
        -o "$RESPONSE_FILE" \
        -w "%{http_code}" \
        -X POST "$REPORT_URL" \
        -H "Accept: application/json, */*" \
        -H "Accept-Language: en-GB,en-US;q=0.9,en;q=0.8" \
        -H "Cache-Control: no-cache" \
        -H "Content-Type: application/json; charset=utf-8" \
        -H "Origin: https://freshdesk-us.freshreports.com" \
        -H "Pragma: no-cache" \
        -H "Referer: https://freshdesk-us.freshreports.com/" \
        -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15" \
        -H "api-request-id: $REQUEST_ID" \
        -H "x-auth-token: $AUTH_TOKEN" \
        "${cookie_args[@]}" \
        --data @"$BODY_FILE"
    )"
    curl_status=$?
    set -e

    if (( curl_status != 0 )); then
      failure_reason="curl exit $curl_status"
    elif [[ "$http_code" != "200" ]]; then
      failure_reason="HTTP $http_code"
    else
      failure_reason=""
      break
    fi

    echo "CEC Freshdesk request failed on attempt $attempt/$DOWNLOAD_RETRIES: $failure_reason"
    if (( attempt < DOWNLOAD_RETRIES )); then
      sleep $(( RETRY_DELAY_SECONDS * attempt ))
    fi
    attempt=$(( attempt + 1 ))
  done

  if [[ -n "$failure_reason" ]]; then
    echo "Freshdesk request failed: $failure_reason"
    echo "Headers: $HEADERS_FILE"
    echo "Response: $RESPONSE_FILE"
    exit 1
  fi
}

download_pdf_url() {
  local download_url="$1"
  local attempt=1
  local http_code=""
  local curl_status=0
  local failure_reason=""
  local pdf_headers="$OUTPUT_DIR/logs/freshdesk_cec_pdf_headers_$NOW.txt"

  while (( attempt <= DOWNLOAD_RETRIES )); do
    echo "Downloading CEC Freshdesk PDF (attempt $attempt/$DOWNLOAD_RETRIES)..."
    set +e
    http_code="$(
      "$CURL_BIN" -sS \
        --http1.1 \
        -L \
        -D "$pdf_headers" \
        -o "$PDF_FILE" \
        -w "%{http_code}" \
        -H "Accept: application/pdf, application/octet-stream, */*" \
        -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15" \
        "$download_url"
    )"
    curl_status=$?
    set -e

    if (( curl_status != 0 )); then
      failure_reason="curl exit $curl_status"
    elif [[ "$http_code" != "200" ]]; then
      failure_reason="HTTP $http_code"
    elif ! head -c 4 "$PDF_FILE" | grep -q "%PDF"; then
      failure_reason="downloaded file is not a PDF"
    else
      failure_reason=""
      break
    fi

    echo "CEC PDF download failed on attempt $attempt/$DOWNLOAD_RETRIES: $failure_reason"
    if (( attempt < DOWNLOAD_RETRIES )); then
      sleep $(( RETRY_DELAY_SECONDS * attempt ))
    fi
    attempt=$(( attempt + 1 ))
  done

  if [[ -n "$failure_reason" ]]; then
    echo "Freshdesk PDF download failed: $failure_reason"
    echo "Headers: $pdf_headers"
    exit 1
  fi

  update_latest_file "$PDF_FILE" "$LATEST_PDF" "PDF"
  echo "CEC Freshdesk PDF: $PDF_FILE"
  process_downloaded_pdf
}

if [[ "$RTS_ENABLED" != "false" ]]; then
  echo "Requesting CEC Freshdesk report through RTS listener..."
  set +e
  DOWNLOAD_URL="$(
    FRESHDESK_REPORT_URL="$REPORT_URL" \
    FRESHDESK_AUTH_TOKEN_FILE="$AUTH_TOKEN_FILE" \
    FRESHDESK_BODY_FILE="$BODY_FILE" \
    FRESHDESK_RTS_LOG_DIR="$OUTPUT_DIR/logs" \
    node "$RTS_HELPER"
  )"
  rts_status=$?
  set -e

  if (( rts_status == 0 )) && [[ -n "$DOWNLOAD_URL" ]]; then
    download_pdf_url "$DOWNLOAD_URL"
    exit 0
  fi

  echo "RTS listener did not return a PDF URL; falling back to direct response inspection."
fi

post_download_request

content_type="$(grep -i '^content-type:' "$HEADERS_FILE" | tail -1 | tr -d '\r' || true)"
if [[ "$content_type" == *"application/pdf"* ]] || head -c 4 "$RESPONSE_FILE" | grep -q "%PDF"; then
  mv "$RESPONSE_FILE" "$PDF_FILE"
  update_latest_file "$PDF_FILE" "$LATEST_PDF" "PDF"
  echo "CEC Freshdesk PDF: $PDF_FILE"
  process_downloaded_pdf
  exit 0
fi

echo "Freshdesk JSON response: $RESPONSE_FILE"
node "$RESPONSE_EXTRACTOR" "$RESPONSE_FILE" --summary
echo

set +e
DOWNLOAD_URL="$(node "$RESPONSE_EXTRACTOR" "$RESPONSE_FILE" --url)"
extract_status=$?
set -e

if (( extract_status != 0 )) || [[ -z "$DOWNLOAD_URL" ]]; then
  echo "No PDF URL found in the JSON response yet."
  echo "Open the response file above to inspect the next Freshreports step."
  exit 2
fi

download_pdf_url "$DOWNLOAD_URL"
