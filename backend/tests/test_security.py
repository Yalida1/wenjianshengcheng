from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.db import SessionLocal
from backend.app.models import User
from backend.app.security import hash_password
from backend.scripts.seed import seed


def test_login_and_csrf_protection(client: TestClient) -> None:
    unauthenticated = client.get("/api/v1/auth/me")
    assert unauthenticated.status_code == 401
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin", "password": "admin123"},
    )
    assert login.status_code == 200
    blocked = client.post(
        "/api/v1/projects",
        json={"code": "P001", "name": "测试项目"},
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "csrf_invalid"


def test_login_rate_limit_has_uniform_auth_error(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "missing@example.com", "password": "wrong"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_seed_migrates_legacy_admin_credentials(client: TestClient) -> None:
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.email == "admin"))
        assert admin is not None
        previous_session_version = admin.session_version
        admin.email = "admin@example.com"
        admin.password_hash = hash_password("LegacyPassword123!")
        db.commit()

    seed()

    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.email == "admin"))
        assert admin is not None
        assert admin.session_version == previous_session_version + 1
        assert db.scalar(select(User).where(User.email == "admin@example.com")) is None

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin", "password": "admin123"},
    )
    assert login.status_code == 200
