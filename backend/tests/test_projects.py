from __future__ import annotations

import io
from pathlib import Path

from docx import Document
from fastapi.testclient import TestClient


def _docx_bytes() -> bytes:
    stream = io.BytesIO()
    document = Document()
    document.add_heading("项目概况", level=1)
    document.add_paragraph("项目名称：待删除项目")
    document.save(stream)
    return stream.getvalue()


def test_project_creation_creates_lifecycle_stages(authenticated_client: TestClient) -> None:
    created = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "NX-001", "name": "宁夏政务服务平台建设项目"},
    )
    assert created.status_code == 201, created.text
    project = created.json()
    stages = authenticated_client.get(f"/api/v1/projects/{project['id']}/stages")
    assert stages.status_code == 200
    assert {item["stage"] for item in stages.json()} == {
        "demand",
        "requirement",
        "feasibility",
        "tender",
        "contract",
    }


def test_project_creation_without_code_assigns_rule_based_code(
    authenticated_client: TestClient,
) -> None:
    created = authenticated_client.post(
        "/api/v1/projects",
        json={"name": "仅名称新建项目", "project_type": "enterprise_investment"},
    )
    assert created.status_code == 201, created.text
    project = created.json()
    assert project["name"] == "仅名称新建项目"
    assert project["description"] is None
    assert project["project_type"] == "enterprise_investment"
    assert project["code"].startswith("enterprise_investment_")
    assert not project["code"].startswith("TMP-")

    second = authenticated_client.post(
        "/api/v1/projects",
        json={"name": "同日同类型第二项", "project_type": "enterprise_investment"},
    )
    assert second.status_code == 201, second.text
    assert second.json()["code"].startswith("enterprise_investment_")
    assert second.json()["code"] != project["code"]
    first_seq = int(project["code"].rsplit("_", 1)[-1])
    second_seq = int(second.json()["code"].rsplit("_", 1)[-1])
    assert second_seq == first_seq + 1


def test_project_code_rule_get_and_put(authenticated_client: TestClient) -> None:
    current = authenticated_client.get("/api/v1/project-code-rules")
    assert current.status_code == 200, current.text
    rule = current.json()
    assert rule["pattern"] == "{project_type}_{date}_{seq}"
    assert rule["seq_width"] == 4
    assert "preview" in rule

    updated = authenticated_client.put(
        "/api/v1/project-code-rules",
        json={
            "pattern": "XM_{date}_{seq}",
            "date_format": "YYYYMMDD",
            "seq_width": 3,
            "reset_scope": "day",
            "revision": rule["revision"],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["pattern"] == "XM_{date}_{seq}"
    assert updated.json()["seq_width"] == 3
    assert updated.json()["preview"].startswith("XM_")

    created = authenticated_client.post(
        "/api/v1/projects",
        json={"name": "改规则后新建", "project_type": "government_investment"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["code"].startswith("XM_")



def test_project_patch_can_update_code(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"name": "待回填编号项目"},
    ).json()
    updated = authenticated_client.patch(
        f"/api/v1/projects/{project['id']}",
        json={"code": "XM-2026-0099", "revision": project["revision"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["code"] == "XM-2026-0099"
    assert updated.json()["revision"] == project["revision"] + 1


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


def test_admin_can_delete_complete_project_graph(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "DEL-001", "name": "待删除项目"},
    ).json()
    uploaded = authenticated_client.post(
        f"/api/v1/files?project_id={project['id']}&stage=requirement",
        files={
            "upload": (
                "source.docx",
                _docx_bytes(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert uploaded.status_code == 201, uploaded.text
    storage_dir = (
        Path("data/test-objects").resolve()
        / project["organization_id"]
        / uploaded.json()["id"]
    )
    assert storage_dir.is_dir()

    deleted = authenticated_client.request(
        "DELETE",
        f"/api/v1/projects/{project['id']}",
        json={"revision": project["revision"], "confirmation_code": project["code"]},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {
        "project_id": project["id"],
        "deleted": True,
        "storage_objects_deleted": 1,
        "storage_cleanup_failed": 0,
    }
    assert authenticated_client.get(f"/api/v1/projects/{project['id']}").status_code == 404
    assert not storage_dir.exists()

    logs = authenticated_client.get("/api/v1/audit-logs?page=1&page_size=50")
    assert logs.status_code == 200
    assert any(
        item["action"] == "project.delete" and item["object_id"] == project["id"]
        for item in logs.json()["items"]
    )


def test_project_delete_checks_revision_and_confirmation_code(
    authenticated_client: TestClient,
) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "DEL-002", "name": "删除校验项目"},
    ).json()
    revision_conflict = authenticated_client.request(
        "DELETE",
        f"/api/v1/projects/{project['id']}",
        json={"revision": project["revision"] + 1, "confirmation_code": project["code"]},
    )
    assert revision_conflict.status_code == 409
    assert revision_conflict.json()["error"]["code"] == "revision_conflict"

    wrong_code = authenticated_client.request(
        "DELETE",
        f"/api/v1/projects/{project['id']}",
        json={"revision": project["revision"], "confirmation_code": "WRONG-CODE"},
    )
    assert wrong_code.status_code == 422
    assert wrong_code.json()["error"]["code"] == "project_confirmation_mismatch"
    assert authenticated_client.get(f"/api/v1/projects/{project['id']}").status_code == 200


def test_project_delete_requires_system_admin(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "DEL-003", "name": "权限校验项目"},
    ).json()
    created_user = authenticated_client.post(
        "/api/v1/users",
        json={
            "email": "editor@example.com",
            "display_name": "项目编制人员",
            "password": "editor-pass-123",
            "role_keys": ["project_editor"],
        },
    )
    assert created_user.status_code == 201, created_user.text
    login = authenticated_client.post(
        "/api/v1/auth/login",
        json={"email": "editor@example.com", "password": "editor-pass-123"},
    )
    assert login.status_code == 200, login.text
    authenticated_client.headers["X-CSRF-Token"] = login.json()["csrf_token"]

    forbidden = authenticated_client.request(
        "DELETE",
        f"/api/v1/projects/{project['id']}",
        json={"revision": project["revision"], "confirmation_code": project["code"]},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "forbidden"


def test_project_types_seeded_and_custom_type_can_create_project(
    authenticated_client: TestClient,
) -> None:
    listed = authenticated_client.get("/api/v1/project-types")
    assert listed.status_code == 200, listed.text
    codes = {item["code"] for item in listed.json()}
    assert {"government_investment", "enterprise_investment"} <= codes

    created_type = authenticated_client.post(
        "/api/v1/project-types",
        json={
            "code": "municipal_special",
            "name": "市政专项项目",
            "description": "组织自定义类型",
            "sort_order": 30,
        },
    )
    assert created_type.status_code == 201, created_type.text
    assert created_type.json()["is_system"] is False

    project = authenticated_client.post(
        "/api/v1/projects",
        json={"name": "自定义类型项目", "project_type": "municipal_special"},
    )
    assert project.status_code == 201, project.text
    assert project.json()["project_type"] == "municipal_special"


def test_inactive_project_type_rejects_project_creation(
    authenticated_client: TestClient,
) -> None:
    created_type = authenticated_client.post(
        "/api/v1/project-types",
        json={"code": "paused_type", "name": "暂停类型", "sort_order": 40},
    )
    assert created_type.status_code == 201, created_type.text
    patched = authenticated_client.patch(
        f"/api/v1/project-types/{created_type.json()['id']}",
        json={"is_active": False, "revision": created_type.json()["revision"]},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["is_active"] is False

    rejected = authenticated_client.post(
        "/api/v1/projects",
        json={"name": "停用类型项目", "project_type": "paused_type"},
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "project_type_inactive"

    active_only = authenticated_client.get("/api/v1/project-types?active_only=true")
    assert active_only.status_code == 200
    assert all(item["code"] != "paused_type" for item in active_only.json())


def test_adhoc_workspace_can_be_created_and_filtered(authenticated_client: TestClient) -> None:
    managed = authenticated_client.post(
        "/api/v1/projects",
        json={"name": "正式管理项目", "project_type": "government_investment"},
    )
    assert managed.status_code == 201, managed.text
    assert managed.json()["workspace_kind"] == "managed"

    adhoc = authenticated_client.post(
        "/api/v1/projects",
        json={
            "name": "临时编标任务",
            "project_type": "government_investment",
            "workspace_kind": "adhoc",
        },
    )
    assert adhoc.status_code == 201, adhoc.text
    assert adhoc.json()["workspace_kind"] == "adhoc"

    only_adhoc = authenticated_client.get("/api/v1/projects?workspace_kind=adhoc&page_size=100")
    assert only_adhoc.status_code == 200
    assert {item["id"] for item in only_adhoc.json()["items"]} == {adhoc.json()["id"]}

    only_managed = authenticated_client.get("/api/v1/projects?workspace_kind=managed&page_size=100")
    assert only_managed.status_code == 200
    assert managed.json()["id"] in {item["id"] for item in only_managed.json()["items"]}
    assert adhoc.json()["id"] not in {item["id"] for item in only_managed.json()["items"]}


def test_non_admin_cannot_write_project_types(authenticated_client: TestClient) -> None:
    created_user = authenticated_client.post(
        "/api/v1/users",
        json={
            "email": "type-editor@example.com",
            "display_name": "编制人员",
            "password": "editor-pass-123",
            "role_keys": ["project_editor"],
        },
    )
    assert created_user.status_code == 201, created_user.text
    login = authenticated_client.post(
        "/api/v1/auth/login",
        json={"email": "type-editor@example.com", "password": "editor-pass-123"},
    )
    assert login.status_code == 200, login.text
    authenticated_client.headers["X-CSRF-Token"] = login.json()["csrf_token"]

    forbidden = authenticated_client.post(
        "/api/v1/project-types",
        json={"code": "forbidden_type", "name": "无权限类型"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "forbidden"

    readable = authenticated_client.get("/api/v1/project-types?active_only=true")
    assert readable.status_code == 200
    assert len(readable.json()) >= 2

