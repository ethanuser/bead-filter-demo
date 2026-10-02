"""Minimal Onshape REST client (stdlib only).

Reads ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY from ~/.onshape_keys
(lines of the form: export NAME="value"). Keys are never printed.
"""
import base64
import json
import os
import re
import ssl
import urllib.error
import urllib.request

BASE = "https://cad.onshape.com/api/v10"
KEY_FILE = os.path.expanduser("~/.onshape_keys")

# Target document (from the shared link)
DID = "9cf2562a18b5316e9baa5f92"
WID = "2c59e5f8703463703524c173"
EID = "6b2402b60281b75f5ddda6c8"

CALLS = 0

# python.org Python ships without a CA bundle; use the macOS system one.
_SSL = ssl.create_default_context(
    cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None
)


def _load_keys():
    keys = {}
    with open(KEY_FILE) as f:
        for line in f:
            m = re.match(r'\s*(?:export\s+)?(\w+)\s*=\s*"?([^"\n]*)"?', line)
            if m:
                keys[m.group(1)] = m.group(2).strip()
    return keys["ONSHAPE_ACCESS_KEY"], keys["ONSHAPE_SECRET_KEY"]


_ACCESS, _SECRET = _load_keys()
_AUTH = "Basic " + base64.b64encode(f"{_ACCESS}:{_SECRET}".encode()).decode()


def request(method, path, body=None, accept="application/json"):
    global CALLS
    CALLS += 1
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Authorization", _AUTH)
    req.add_header("Accept", accept)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, context=_SSL) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:2000]}")
    if accept == "application/json":
        return json.loads(raw) if raw else None
    return raw


def get(path, **kw):
    return request("GET", path, **kw)


def post(path, body, **kw):
    return request("POST", path, body, **kw)


def ps(suffix=""):
    """Path prefix for the target Part Studio."""
    return f"/partstudios/d/{DID}/w/{WID}/e/{EID}{suffix}"
