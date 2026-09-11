"""Organization branding API tests."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": "admin", "password": "admin123"})
    assert response.status_code == 200


def test_public_branding_defaults(client: TestClient) -> None:
    response = client.get("/api/v1/branding")
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "智能招标管理"
    assert payload["subtitle"] == "受控生成与定稿平台"
    assert payload["mark"] == "智"
    assert payload["has_custom_logo"] is False
    assert payload["logo_url"] is None


def test_admin_can_update_branding_and_logo(authenticated_client: TestClient) -> None:
    current = authenticated_client.get("/api/v1/branding")
    assert current.status_code == 200
    revision = current.json()["revision"]

    updated = authenticated_client.patch(
        "/api/v1/branding",
        json={
            "name": "智慧招采平台",
            "subtitle": "招标全流程管理",
            "mark": "慧",
            "revision": revision,
        },
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["name"] == "智慧招采平台"
    assert body["subtitle"] == "招标全流程管理"
    assert body["mark"] == "慧"
    assert body["revision"] == revision + 1

    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05"
        b"\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    uploaded = authenticated_client.post(
        f"/api/v1/branding/logo?revision={body['revision']}",
        files={"upload": ("logo.png", png, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    logo_meta = uploaded.json()
    assert logo_meta["has_custom_logo"] is True
    assert logo_meta["logo_url"] is not None

    logo = authenticated_client.get("/api/v1/branding/logo")
    assert logo.status_code == 200
    assert logo.headers["content-type"].startswith("image/png")
    assert logo.content.startswith(b"\x89PNG")

    cleared = authenticated_client.patch(
        "/api/v1/branding",
        json={"clear_logo": True, "revision": logo_meta["revision"]},
    )
    assert cleared.status_code == 200
    assert cleared.json()["has_custom_logo"] is False
    missing = authenticated_client.get("/api/v1/branding/logo")
    assert missing.status_code == 404
