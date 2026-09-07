from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from .config import get_settings

SESSION_COOKIE = "docchain_session"
CSRF_COOKIE = "docchain_csrf"
CSRF_HEADER = "X-CSRF-Token"

password_hasher = PasswordHasher(time_cost=3, memory_cost=65_536, parallelism=2)


@dataclass(frozen=True)
class SessionClaims:
    user_id: str
    organization_id: str
    session_version: int
    expires_at: int


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters")
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def _encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_session_token(user_id: str, organization_id: str, session_version: int) -> str:
    settings = get_settings()
    payload = {
        "uid": user_id,
        "oid": organization_id,
        "sv": session_version,
        "exp": int(time.time()) + settings.session_ttl_seconds,
    }
    encoded = _encode(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(settings.app_secret_key.encode(), encoded.encode(), hashlib.sha256).digest()
    return f"{encoded}.{_encode(signature)}"


def parse_session_token(token: str) -> SessionClaims | None:
    try:
        encoded, signature = token.split(".", 1)
        expected = hmac.new(get_settings().app_secret_key.encode(), encoded.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_decode(signature), expected):
            return None
        payload = json.loads(_decode(encoded))
        if int(payload["exp"]) < int(time.time()):
            return None
        return SessionClaims(
            user_id=str(payload["uid"]),
            organization_id=str(payload["oid"]),
            session_version=int(payload["sv"]),
            expires_at=int(payload["exp"]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)
