#!/usr/bin/env python3
import argparse
import json
import os
import re
from pathlib import Path

try:
    import pdfplumber
except ModuleNotFoundError as exc:
    raise SystemExit(
        "pdfplumber is required to parse the CEC Freshdesk PDF. "
        "Use the bundled Codex Python runtime or install it with: python3 -m pip install pdfplumber"
    ) from exc


STATUS_KEYS = {
    "on-hold": "onHold",
    "open": "open",
    "new": "new",
}


def main():
    parser = argparse.ArgumentParser(description="Parse Freshdesk CEC report PDF into a Real Time CEC JSON snapshot.")
    parser.add_argument("--input", required=True, help="Path to Freshdesk PDF.")
    parser.add_argument("--output", required=True, help="Path to output JSON.")
    parser.add_argument("--cycle", default="", help="Cycle download label, for example 2026-06-21 13:30.")
    parser.add_argument("--source", default="freshdesk-pdf")
    args = parser.parse_args()

    pdf_path = Path(args.input).expanduser()
    if not pdf_path.exists():
        raise SystemExit(f"Input PDF not found: {pdf_path}")

    text = extract_text(pdf_path)
    snapshot = parse_snapshot(text, pdf_path.name, args.cycle, args.source)

    output_path = Path(args.output).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output_path)


def extract_text(pdf_path: Path) -> str:
    pages = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    return "\n".join(pages)


def parse_snapshot(text: str, file_name: str, cycle: str, source: str) -> dict:
    generated_date = first_match(r"Generated Date:\s*([0-9]{2}-[0-9]{2}-[0-9]{4})", text)
    groups = parse_groups(text)
    departments = parse_departments(text)
    return {
        "cycleDownload": cycle,
        "fileName": file_name,
        "source": source,
        "generatedDate": generated_date,
        "groups": groups,
        "departments": departments,
        "rawText": text,
    }


def parse_groups(text: str) -> list[dict]:
    normal_total, p0_total, p0_l2_total = parse_backlog_totals(text)
    on_hold_values = parse_status_values("On-hold", text)
    open_values = parse_status_values("Open", text)
    new_values = parse_status_values("New", text)

    return [
        {
            "key": "normal",
            "label": "Normal Backlog",
            "backlog": normal_total,
            "onHold": value_at(on_hold_values, 0),
            "open": value_at(open_values, 0),
            "new": value_at(new_values, 0),
        },
        {
            "key": "p0",
            "label": "P0 Backlog",
            "backlog": p0_total,
            "onHold": value_at(on_hold_values, 1),
            "open": value_at(open_values, 1),
            "new": value_at(new_values, 1),
        },
        {
            "key": "p0_l2",
            "label": "P0 with L2",
            "backlog": p0_l2_total,
            "onHold": value_at(on_hold_values, 2),
            "open": value_at(open_values, 2),
            "new": value_at(new_values, 2),
        },
    ]


def parse_backlog_totals(text: str) -> tuple[int, int, int]:
    normal_total = 0
    p0_total = 0
    p0_l2_total = 0

    first_totals = re.search(r"(?m)^\s*(\d+)\s+KP-Normal-Mail-Br:.*?\s+(\d+)\s*$", text)
    if first_totals:
        normal_total = parse_int(first_totals.group(1))
        p0_total = parse_int(first_totals.group(2))

    status_totals = re.search(r"(?m)^\s*(\d+)\s+Open:\s*\d+.*?\s+(\d+)\s+(\d+)\s*$", text)
    if status_totals:
        normal_total = parse_int(status_totals.group(1)) or normal_total
        p0_total = parse_int(status_totals.group(2)) or p0_total
        p0_l2_total = parse_int(status_totals.group(3))

    return normal_total, p0_total, p0_l2_total


def parse_status_values(label: str, text: str) -> list[int]:
    return [parse_int(value) for value in re.findall(rf"{re.escape(label)}:\s*([0-9][0-9.,]*)", text, flags=re.IGNORECASE)]


def parse_departments(text: str) -> list[dict]:
    departments = []
    for name, count, percent in re.findall(r"([A-Za-zÀ-ÿ0-9_\- ]+?):\s*([0-9][0-9.,]*)\s*\(([0-9.,]+)%\)", text):
        clean_name = re.sub(r"^\d+\s+", "", " ".join(name.split()))
        if clean_name.lower() in STATUS_KEYS:
            continue
        departments.append({
            "name": clean_name,
            "group": infer_group(clean_name),
            "backlog": parse_int(count),
            "percent": parse_float(percent),
        })
    return dedupe_departments(departments)


def infer_group(name: str) -> str:
    comparable = name.lower()
    if "normal" in comparable:
        return "normal"
    if "portuguese l2" in comparable:
        return "p0_l2"
    if "po-" in comparable or "kp-po" in comparable:
        return "p0"
    return "other"


def dedupe_departments(departments: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for department in departments:
        key = (department["name"], department["group"])
        if key in seen:
            continue
        seen.add(key)
        result.append(department)
    return result


def first_match(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(1).strip() if match else None


def parse_int(value) -> int:
    text = str(value or "").strip().replace(".", "").replace(",", "")
    if not text:
        return 0
    try:
        return int(text)
    except ValueError:
        return 0


def parse_float(value) -> float | None:
    text = str(value or "").strip().replace(",", ".")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def value_at(values: list[int], index: int) -> int:
    return values[index] if index < len(values) else 0


if __name__ == "__main__":
    main()
