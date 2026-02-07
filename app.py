from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict

from flask import Flask, Response, jsonify, request, send_from_directory
import requests

APP = Flask(__name__, static_folder="public", static_url_path="")

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATA_FILE = DATA_DIR / "latest.json"
CONFIG_FILE = DATA_DIR / "config.json"
DEVICES_DIR = DATA_DIR / "devices"
DEVICES_DIR.mkdir(parents=True, exist_ok=True)

BASIC_USER = os.environ.get("BASIC_USER", "passwall")
BASIC_PASS = os.environ.get("BASIC_PASS", "passwall")


def _unauthorized() -> Response:
    return Response("Unauthorized", 401, {"WWW-Authenticate": 'Basic realm="Passwall"'})


def _check_basic_auth() -> bool:
    auth = request.authorization
    if not auth:
        return False
    return auth.username == BASIC_USER and auth.password == BASIC_PASS


def _safe_device_key(value: str) -> str:
    key = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())
    return key[:64] or "default"


def _device_key(payload: Dict[str, Any]) -> str:
    dev = str(payload.get("device") or "").strip()
    ip = str(payload.get("ip") or "").strip()
    if dev:
        return _safe_device_key(dev)
    if ip:
        return _safe_device_key(ip)
    return "default"


def _latest_path(key: str) -> Path:
    return DEVICES_DIR / f"{key}.json"


def _history_path(key: str) -> Path:
    return DEVICES_DIR / f"{key}.jsonl"


def _read_latest(key: str) -> Dict[str, Any]:
    path = _latest_path(key)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _write_latest(key: str, payload: Dict[str, Any]) -> None:
    _latest_path(key).write_text(json.dumps(payload, ensure_ascii=False))


def _append_history(key: str, payload: Dict[str, Any]) -> None:
    record = {
        "t": int(time.time()),
        "total_bytes": int(payload.get("total_bytes") or 0),
        "lan_bytes": int(payload.get("lan_bytes") or 0),
        "local_bytes": int(payload.get("local_bytes") or 0),
    }
    with _history_path(key).open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _read_config() -> Dict[str, Any]:
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text())
    except Exception:
        return {}


def _write_config(payload: Dict[str, Any]) -> None:
    CONFIG_FILE.write_text(json.dumps(payload, ensure_ascii=False))


def _pull_once() -> Dict[str, Any]:
    cfg = _read_config()
    url = cfg.get("router_url")
    user = cfg.get("router_user")
    passwd = cfg.get("router_pass")
    if not url:
        return {"error": "router_url not set"}

    try:
        auth = (user, passwd) if user is not None else None
        resp = requests.get(url, auth=auth, timeout=5)
        if resp.status_code != 200:
            return {"error": f"http {resp.status_code}"}
        data = resp.json()
        data.setdefault("received_at", int(time.time()))
        key = _device_key(data)
        _write_latest(key, data)
        _append_history(key, data)
        return {"ok": True}
    except Exception as exc:
        return {"error": str(exc)}


def _pull_loop() -> None:
    while True:
        cfg = _read_config()
        enabled = bool(cfg.get("enabled"))
        interval = int(cfg.get("interval", 10))
        if interval < 3:
            interval = 3
        if enabled:
            _pull_once()
        time.sleep(interval)


@APP.get("/")
def index() -> Response:
    if not _check_basic_auth():
        return _unauthorized()
    return send_from_directory(APP.static_folder, "index.html")


@APP.get("/api/status")
def status() -> Response:
    if not _check_basic_auth():
        return _unauthorized()
    key = request.args.get("device", "default")
    return jsonify(_read_latest(key))


@APP.post("/api/ingest")
def ingest() -> Response:
    if not _check_basic_auth():
        return _unauthorized()

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "invalid json"}), 400

    payload.setdefault("received_at", int(time.time()))
    key = _device_key(payload)
    _write_latest(key, payload)
    _append_history(key, payload)
    return jsonify({"ok": True})


@APP.get("/api/config")
def get_config() -> Response:
    if not _check_basic_auth():
        return _unauthorized()
    cfg = _read_config()
    cfg.pop("router_pass", None)
    return jsonify(cfg)


@APP.post("/api/config")
def set_config() -> Response:
    if not _check_basic_auth():
        return _unauthorized()
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "invalid json"}), 400

    cfg = _read_config()
    for key in ("router_url", "router_user", "router_pass", "enabled", "interval"):
        if key in payload:
            cfg[key] = payload[key]
    _write_config(cfg)
    return jsonify({"ok": True})


@APP.post("/api/pull")
def pull_now() -> Response:
    if not _check_basic_auth():
        return _unauthorized()
    result = _pull_once()
    return jsonify(result)


@APP.get("/api/devices")
def devices() -> Response:
    if not _check_basic_auth():
        return _unauthorized()
    items = []
    for path in DEVICES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        key = path.stem
        items.append(
            {
                "key": key,
                "device": data.get("device") or key,
                "ip": data.get("ip") or "",
                "received_at": data.get("received_at") or 0,
                "total_bytes": data.get("total_bytes") or 0,
                "lan_bytes": data.get("lan_bytes") or 0,
                "local_bytes": data.get("local_bytes") or 0,
            }
        )
    items.sort(key=lambda x: x["received_at"], reverse=True)
    return jsonify(items)


@APP.get("/api/history")
def history() -> Response:
    if not _check_basic_auth():
        return _unauthorized()
    key = request.args.get("device", "default")
    since = request.args.get("since")
    try:
        since_ts = int(since) if since else int(time.time()) - 24 * 3600
    except Exception:
        since_ts = int(time.time()) - 24 * 3600

    path = _history_path(key)
    if not path.exists():
        return jsonify([])

    points = []
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if int(rec.get("t") or 0) >= since_ts:
                    points.append(rec)
    except Exception:
        return jsonify([])

    return jsonify(points[-2000:])


@APP.get("/healthz")
def healthz() -> Response:
    return jsonify({"ok": True})


if __name__ == "__main__":
    t = threading.Thread(target=_pull_loop, daemon=True)
    t.start()
    APP.run(host="0.0.0.0", port=8080)
