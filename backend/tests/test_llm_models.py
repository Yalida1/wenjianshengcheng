"""Organization LLM model profile API tests."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_admin_can_manage_llm_models(authenticated_client: TestClient) -> None:
    listed = authenticated_client.get("/api/v1/llm-models")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["items"] == []
    assert body["active_id"] is None
    assert body["env_fallback"]["provider"] == "demo"

    created = authenticated_client.post(
        "/api/v1/llm-models",
        json={
            "name": "DeepSeek 正式",
            "provider": "openai_compatible",
            "base_url": "https://api.deepseek.com",
            "model_name": "deepseek-chat",
            "api_key": "sk-test-secret-key-001",
            "timeout_seconds": 120,
            "notes": "生产",
            "activate": True,
        },
    )
    assert created.status_code == 201, created.text
    profile = created.json()
    assert profile["name"] == "DeepSeek 正式"
    assert profile["is_active"] is True
    assert profile["has_api_key"] is True
    assert profile["api_key_hint"] is not None
    assert "sk-test" not in (profile["api_key_hint"] or "")
    assert profile["api_key"] is None if "api_key" in profile else True

    listed2 = authenticated_client.get("/api/v1/llm-models")
    assert listed2.status_code == 200
    assert listed2.json()["active_id"] == profile["id"]

    demo = authenticated_client.post(
        "/api/v1/llm-models",
        json={
            "name": "演示模型",
            "provider": "demo",
            "activate": False,
        },
    )
    assert demo.status_code == 201, demo.text
    demo_id = demo.json()["id"]

    activated = authenticated_client.post(f"/api/v1/llm-models/{demo_id}/activate")
    assert activated.status_code == 200, activated.text
    assert activated.json()["is_active"] is True

    catalog = authenticated_client.get("/api/v1/llm-models").json()
    active_rows = [item for item in catalog["items"] if item["is_active"]]
    assert len(active_rows) == 1
    assert active_rows[0]["id"] == demo_id

    current = next(item for item in catalog["items"] if item["id"] == profile["id"])
    patched = authenticated_client.patch(
        f"/api/v1/llm-models/{profile['id']}",
        json={
            "name": "DeepSeek 备用",
            "notes": "备用通道",
            "revision": current["revision"],
        },
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "DeepSeek 备用"
    assert patched.json()["notes"] == "备用通道"
    assert patched.json()["has_api_key"] is True

    deleted = authenticated_client.delete(f"/api/v1/llm-models/{profile['id']}")
    assert deleted.status_code == 204

    final = authenticated_client.get("/api/v1/llm-models").json()
    assert len(final["items"]) == 1
    assert final["items"][0]["id"] == demo_id


def test_llm_model_requires_api_key_for_openai(authenticated_client: TestClient) -> None:
    response = authenticated_client.post(
        "/api/v1/llm-models",
        json={
            "name": "缺少密钥",
            "provider": "openai_compatible",
            "base_url": "https://api.deepseek.com",
            "model_name": "deepseek-chat",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "api_key_required"


def test_llm_models_require_admin(client: TestClient) -> None:
    response = client.get("/api/v1/llm-models")
    assert response.status_code in {401, 403}
