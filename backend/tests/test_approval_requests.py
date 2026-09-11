from __future__ import annotations

from fastapi.testclient import TestClient


def test_project_deletion_requires_approval_flow(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "DEL-APP-001", "name": "待申请删除项目"},
    ).json()

    created = authenticated_client.post(
        f"/api/v1/projects/{project['id']}/deletion-requests",
        json={
            "revision": project["revision"],
            "confirmation_code": project["code"],
            "reason": "项目已取消，申请删除全部资料",
        },
    )
    assert created.status_code == 201, created.text
    request_item = created.json()
    assert request_item["status"] == "pending"
    assert request_item["request_type"] == "project_delete"
    assert request_item["target_code"] == project["code"]
    assert request_item["requester_name"]

    duplicate = authenticated_client.post(
        f"/api/v1/projects/{project['id']}/deletion-requests",
        json={
            "revision": project["revision"],
            "confirmation_code": project["code"],
            "reason": "重复提交",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "deletion_request_exists"

    listed = authenticated_client.get("/api/v1/approval-requests?status=pending")
    assert listed.status_code == 200, listed.text
    assert any(item["id"] == request_item["id"] for item in listed.json()["items"])

    approved = authenticated_client.post(
        f"/api/v1/approval-requests/{request_item['id']}/approve",
        json={"revision": request_item["revision"], "comment": "确认可删除"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert authenticated_client.get(f"/api/v1/projects/{project['id']}").status_code == 404

    logs = authenticated_client.get("/api/v1/audit-logs?page=1&page_size=50")
    assert logs.status_code == 200
    actions = {item["action"] for item in logs.json()["items"] if item["object_id"] in {request_item["id"], project["id"]}}
    assert "approval_request.create" in actions
    assert "approval_request.approve" in actions
    assert "project.delete" in actions


def test_project_deletion_request_can_be_rejected(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "DEL-APP-002", "name": "待驳回删除项目"},
    ).json()
    created = authenticated_client.post(
        f"/api/v1/projects/{project['id']}/deletion-requests",
        json={
            "revision": project["revision"],
            "confirmation_code": project["code"],
            "reason": "误建项目，申请删除",
        },
    ).json()

    rejected = authenticated_client.post(
        f"/api/v1/approval-requests/{created['id']}/reject",
        json={"revision": created["revision"], "comment": "仍需保留归档材料"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["review_comment"] == "仍需保留归档材料"
    assert authenticated_client.get(f"/api/v1/projects/{project['id']}").status_code == 200


def test_project_deletion_request_validates_confirmation_code(
    authenticated_client: TestClient,
) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "DEL-APP-003", "name": "校验确认码项目"},
    ).json()
    wrong = authenticated_client.post(
        f"/api/v1/projects/{project['id']}/deletion-requests",
        json={
            "revision": project["revision"],
            "confirmation_code": "WRONG",
            "reason": "测试错误确认码",
        },
    )
    assert wrong.status_code == 422
    assert wrong.json()["error"]["code"] == "project_confirmation_mismatch"
