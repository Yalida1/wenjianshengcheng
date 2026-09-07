from __future__ import annotations

from fastapi.testclient import TestClient


def test_login_and_csrf_protection(client: TestClient) -> None:
    unauthenticated = client.get("/api/v1/auth/me")
    assert unauthenticated.status_code == 401
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "TestAdmin123!"},
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
