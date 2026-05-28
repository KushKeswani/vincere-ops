#!/usr/bin/env python3
"""Send a one-off agent checkpoint to Telegram without storing secrets here."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_ENV_PATH = Path(
    "/Users/kushkeswani/Projects/trading/Agents/Agent Pheonix/projectx/.env"
)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def token_and_chat() -> tuple[str, str]:
    token = (
        os.environ.get("PROJECTX_TELEGRAM_BOT_TOKEN")
        or os.environ.get("TELEGRAM_BOT_TOKEN")
        or ""
    ).strip()
    chat = (
        os.environ.get("PROJECTX_TELEGRAM_CHAT_ID")
        or os.environ.get("TELEGRAM_CHAT_ID")
        or ""
    ).strip()
    return token, chat


def send_message(text: str) -> None:
    token, chat = token_and_chat()
    if not token or not chat:
        raise SystemExit(
            "Telegram token/chat id not configured. Set PROJECTX_TELEGRAM_BOT_TOKEN "
            "and PROJECTX_TELEGRAM_CHAT_ID, or provide --env-path."
        )

    if len(text) > 4000:
        text = text[:3990] + " ...(truncated)"

    payload = json.dumps(
        {"chat_id": chat, "text": text, "disable_web_page_preview": True}
    ).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise SystemExit(f"Telegram HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Telegram network error: {exc.reason}") from exc

    data = json.loads(body)
    if not data.get("ok"):
        raise SystemExit(f"Telegram API error: {data}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("message", nargs="*", help="Message text to send.")
    parser.add_argument(
        "--env-path",
        default=str(DEFAULT_ENV_PATH),
        help="Optional env file containing Telegram variables.",
    )
    args = parser.parse_args()

    load_env_file(Path(args.env_path).expanduser())
    message = " ".join(args.message).strip() or sys.stdin.read().strip()
    if not message:
        parser.error("Provide a message argument or stdin body.")

    send_message(message)
    print("Telegram checkpoint sent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
