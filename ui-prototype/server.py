#!/usr/bin/env python3
import csv
import io
import json
import posixpath
import re
import sys
import zipfile
from cgi import FieldStorage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]


def local_path_from_request(path):
    clean = posixpath.normpath(unquote(path.split("?", 1)[0]))
    clean = clean.lstrip("/")
    return ROOT / clean


def text_content(element):
    return "".join(element.itertext()).strip()


def parse_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ElementTree.fromstring(zf.read("xl/sharedStrings.xml"))
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    values = []
    for item in root.findall("x:si", ns):
        values.append(text_content(item))
    return values


def column_index(cell_ref):
    letters = re.sub(r"[^A-Z]", "", cell_ref.upper())
    value = 0
    for letter in letters:
        value = value * 26 + (ord(letter) - ord("A") + 1)
    return max(value - 1, 0)


def parse_worksheet(xml_bytes, shared_strings):
    root = ElementTree.fromstring(xml_bytes)
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows = []
    for row in root.findall(".//x:sheetData/x:row", ns):
        values = []
        for cell in row.findall("x:c", ns):
            idx = column_index(cell.get("r", "A1"))
            while len(values) <= idx:
                values.append("")
            kind = cell.get("t", "")
            raw = ""
            if kind == "inlineStr":
                inline = cell.find("x:is", ns)
                raw = text_content(inline) if inline is not None else ""
            else:
                v = cell.find("x:v", ns)
                raw = v.text if v is not None and v.text is not None else ""
                if kind == "s" and raw.isdigit():
                    shared_idx = int(raw)
                    if shared_idx < len(shared_strings):
                        raw = shared_strings[shared_idx]
            values[idx] = str(raw).strip()
        if any(values):
            rows.append(values)
    return rows


def parse_xlsx(data):
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shared_strings = parse_shared_strings(zf)
        sheet_paths = sorted(
            name for name in zf.namelist()
            if name.startswith("xl/worksheets/") and name.endswith(".xml")
        )
        parsed = []
        for sheet_path in sheet_paths:
            rows = parse_worksheet(zf.read(sheet_path), shared_strings)
            if rows:
                parsed.append((sheet_path.rsplit("/", 1)[-1].replace(".xml", ""), rows))
        if not parsed:
            return "Workbook", []
        return max(parsed, key=lambda item: len(item[1]))


def parse_csv(data):
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = data.decode("utf-8", errors="replace")
    rows = [[cell.strip() for cell in row] for row in csv.reader(io.StringIO(text))]
    return "CSV", [row for row in rows if any(row)]


def normalize_key(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def get_field(row_map, *names, exact=False):
    targets = [normalize_key(name) for name in names]
    for key, value in row_map.items():
        normalized = normalize_key(key)
        for target in targets:
            if exact:
                if normalized == target:
                    return value
            elif target and (target == normalized or target in normalized):
                return value
    return ""


def normalize_rows(sheet_name, rows):
    if not rows:
        return {"sheet": sheet_name, "headers": [], "rows": []}

    header_index = 0
    for idx, row in enumerate(rows[:12]):
        non_empty = [value for value in row if value]
        if len(non_empty) >= 2 and any(re.search(r"account|strategy|instrument|template|period|algo", value, re.I) for value in non_empty):
            header_index = idx
            break

    headers = rows[header_index]
    if not headers or not any(headers):
        headers = [f"Column {idx + 1}" for idx in range(max(len(row) for row in rows))]
        data_rows = rows
    else:
        headers = [header or f"Column {idx + 1}" for idx, header in enumerate(headers)]
        data_rows = rows[header_index + 1:]

    normalized = []
    for row_number, row in enumerate(data_rows, start=header_index + 2):
        if not any(row):
            continue
        row_map = {
            headers[idx] if idx < len(headers) else f"Column {idx + 1}": value
            for idx, value in enumerate(row)
            if value
        }
        account = get_field(row_map, "account", "accounts", "account name", "account attach", "prop account", "nt account", "ninja account", exact=True)
        firm = get_field(row_map, "firm", "prop firm", "company", exact=True)
        strategy = get_field(row_map, "strategy", "algo", "bot", "strategy type", "algorithm", exact=True)
        instrument = get_field(row_map, "instrument", "symbol", "market", "trading symbol", exact=True)
        period = get_field(row_map, "period", "trading period", "session", exact=True)
        template = get_field(row_map, "template", "nt template", "ninja template", exact=True)
        first_values = [value for value in row if value]
        raw = account or firm or " / ".join(first_values[:3]) or f"Row {row_number}"
        normalized.append({
            "rowNumber": row_number,
            "raw": raw,
            "account": account,
            "firm": firm,
            "strategy": strategy,
            "instrument": instrument,
            "period": period,
            "template": template,
            "cells": row_map,
        })
    return {"sheet": sheet_name, "headers": headers, "rows": normalized}


class PrototypeHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        return str(local_path_from_request(path))

    def do_POST(self):
        if self.path != "/api/blueprint/preview":
            self.send_error(404)
            return

        form = FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        file_item = form["blueprint"] if "blueprint" in form else None
        if file_item is None or not getattr(file_item, "filename", ""):
            self.send_json({"ok": False, "error": "No blueprint file was uploaded."}, status=400)
            return

        filename = Path(file_item.filename).name
        data = file_item.file.read()
        try:
            if filename.lower().endswith(".csv"):
                sheet_name, rows = parse_csv(data)
            else:
                sheet_name, rows = parse_xlsx(data)
            payload = normalize_rows(sheet_name, rows)
            payload.update({"ok": True, "filename": filename})
            self.send_json(payload)
        except Exception as exc:
            self.send_json({"ok": False, "error": f"Could not parse blueprint: {exc}"}, status=400)

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5177
    server = ThreadingHTTPServer(("127.0.0.1", port), PrototypeHandler)
    print(f"Serving Vincere UI prototype on http://127.0.0.1:{port}/ui-prototype/index.html", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
