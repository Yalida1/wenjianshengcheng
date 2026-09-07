from __future__ import annotations

from fastapi.testclient import TestClient


def test_project_creation_creates_four_stages(authenticated_client: TestClient) -> None:
    created = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "NX-001", "name": "宁夏政务服务平台建设项目"},
    )
    assert created.status_code == 201, created.text
    project = created.json()
    stages = authenticated_client.get(f"/api/v1/projects/{project['id']}/stages")
    assert stages.status_code == 200
    assert {item["stage"] for item in stages.json()} == {
        "requirement",
        "feasibility",
        "tender",
        "contract",
    }


def test_revision_conflict_returns_409(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "NX-002", "name": "并发测试项目"},
    ).json()
    updated = authenticated_client.patch(
        f"/api/v1/projects/{project['id']}",
        json={"name": "第一次修改", "revision": project["revision"]},
    )
    assert updated.status_code == 200
    conflict = authenticated_client.patch(
        f"/api/v1/projects/{project['id']}",
        json={"name": "覆盖修改", "revision": project["revision"]},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "revision_conflict"
