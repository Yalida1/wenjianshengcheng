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


def hash_password(password: str, *, minimum_length: int = 12) -> str:
    if len(password) < minimum_length:
        raise ValueError(f"Password must contain at least {minimum_length} characters")
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


def _secret_key_material(purpose: str) -> bytes:
    return hashlib.sha256(f"{purpose}:{get_settings().app_secret_key}".encode()).digest()


def _keystream(key: bytes, iv: bytes, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        block = hashlib.sha256(key + iv + counter.to_bytes(4, "big")).digest()
        output.extend(block)
        counter += 1
    return bytes(output[:length])


def seal_secret(plaintext: str) -> str:
    """Authenticated obfuscation for at-rest secrets (API keys)."""
    raw = plaintext.encode("utf-8")
    key = _secret_key_material("llm-api-key")
    iv = secrets.token_bytes(16)
    ciphertext = bytes(a ^ b for a, b in zip(raw, _keystream(key, iv, len(raw)), strict=True))
    tag = hmac.new(key, iv + ciphertext, hashlib.sha256).digest()[:16]
    return _encode(iv + tag + ciphertext)


def unseal_secret(token: str) -> str | None:
    try:
        data = _decode(token)
        if len(data) < 33:
            return None
        iv, tag, ciphertext = data[:16], data[16:32], data[32:]
        key = _secret_key_material("llm-api-key")
        expected = hmac.new(key, iv + ciphertext, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(tag, expected):
            return None
        plaintext = bytes(
            a ^ b for a, b in zip(ciphertext, _keystream(key, iv, len(ciphertext)), strict=True)
        )
        return plaintext.decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def mask_secret(secret: str | None) -> str | None:
    if not secret:
        return None
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:3]}{'*' * max(4, len(secret) - 7)}{secret[-4:]}"
