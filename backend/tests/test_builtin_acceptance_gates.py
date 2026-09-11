from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.db import SessionLocal
from backend.app.models import AuditLog, DocumentContentBlock, DocumentSection
from backend.app.services.providers import CONTRACT_FIELD_KEYS, _draft_paragraphs
from backend.app.services.validation import PLACEHOLDER_PATTERN, _searchable_content_text


def _project(client: TestClient) -> str:
    response = client.post(
        "/api/v1/projects",
        json={"code": f"ACCEPT-{uuid.uuid4().hex[:8]}", "name": "内置模板专项门禁项目"},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _generate_requirement(client: TestClient, project_id: str) -> tuple[str, str]:
    template = client.get(
        "/api/v1/templates?stage=requirement&generation_only=true"
    ).json()[0]
    response = client.post(
        f"/api/v1/generation-jobs?project_id={project_id}&stage=requirement",
        json={
            "template_id": template["id"],
            "template_version": template["current_version"],
            "idempotency_key": f"acceptance-{uuid.uuid4()}",
        },
    )
    assert response.status_code == 202, response.text
    document = client.get(f"/api/v1/documents?project_id={project_id}").json()[0]
    detail = client.get(f"/api/v1/documents/{document['id']}").json()
    return str(document["id"]), str(detail["versions"][0]["id"])


def _login_as(client: TestClient, account: str, password: str) -> None:
    response = client.post("/api/v1/auth/login", json={"email": account, "password": password})
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]


def _create_member(
    admin: TestClient,
    project_id: str,
    *,
    email: str,
    role_key: str,
    project_role: str,
) -> tuple[str, str]:
    password = "AcceptanceOnly123!"  # noqa: S105 - deterministic test credential
    created = admin.post(
        "/api/v1/users",
        json={
            "email": email,
            "display_name": "专项验收用户",
            "password": password,
            "role_keys": [role_key],
        },
    )
    assert created.status_code == 201, created.text
    linked = admin.post(
        f"/api/v1/projects/{project_id}/members",
        json={"user_id": created.json()["id"], "role_key": project_role},
    )
    assert linked.status_code == 201, linked.text
    return email, password


def test_expired_template_cannot_start_generation(authenticated_client: TestClient) -> None:
    project_id = _project(authenticated_client)
    source_template = authenticated_client.get(
        "/api/v1/templates?stage=requirement&generation_only=true"
    ).json()[0]
    source = authenticated_client.get(
        f"/api/v1/templates/{source_template['id']}/versions/"
        f"{source_template['current_version']}/source"
    )
    assert source.status_code == 200

    created = authenticated_client.post(
        "/api/v1/templates",
        json={
            "name": "已过期专项验收模板",
            "stage": "requirement",
            "source_kind": "platform_reference_template",
            "format_profile": {"page_size": "A4"},
        },
    )
    template_id = created.json()["id"]
    versioned = authenticated_client.post(
        f"/api/v1/templates/{template_id}/versions",
        json={
            "effective_date": "2020-01-01",
            "expiry_date": "2020-12-31",
            "format_profile": {"page_size": "A4"},
        },
    )
    assert versioned.status_code == 200, versioned.text
    uploaded = authenticated_client.post(
        f"/api/v1/templates/{template_id}/versions/2/source",
        files={
            "upload": (
                "expired-template.docx",
                source.content,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    published = authenticated_client.post(f"/api/v1/templates/{template_id}/publish")
    assert published.status_code == 200, published.text
    available = authenticated_client.get(
        "/api/v1/templates?stage=requirement&generation_only=true"
    ).json()
    assert template_id not in {item["id"] for item in available}

    blocked = authenticated_client.post(
        f"/api/v1/generation-jobs?project_id={project_id}&stage=requirement",
        json={
            "template_id": template_id,
            "template_version": 2,
            "idempotency_key": f"expired-{uuid.uuid4()}",
        },
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "template_not_applicable"


def test_tender_ceiling_cannot_become_contract_amount(
    authenticated_client: TestClient,
) -> None:
    project_id = _project(authenticated_client)
    blocked = authenticated_client.post(
        f"/api/v1/field-values?project_id={project_id}&stage=contract",
        json={
            "field_key": "final_contract_amount",
            "field_label": "最终合同金额",
            "data_type": "money",
            "value": 9_500_000,
            "normalized_value": 9_500_000,
            "unit": "元",
            "criticality": "P0",
            "status": "extracted",
            "source_type": "extracted",
            "evidence": {
                "excerpt": "招标最高限价 9,500,000 元",
                "extraction_method": "test",
                "source_stage": "tender",
                "source_field_key": "maximum_price",
            },
        },
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "forbidden_field_mapping"


def test_viewer_cannot_confirm_fields_finalize_or_export(
    authenticated_client: TestClient, client: TestClient
) -> None:
    project_id = _project(authenticated_client)
    _document_id, version_id = _generate_requirement(authenticated_client, project_id)
    created_field = authenticated_client.post(
        f"/api/v1/field-values?project_id={project_id}&stage=requirement",
        json={
            "field_key": "project_name",
            "field_label": "项目名称",
            "data_type": "string",
            "value": "内置模板专项门禁项目",
            "normalized_value": "内置模板专项门禁项目",
            "criticality": "P0",
            "status": "missing",
            "source_type": "user_input",
        },
    )
    assert created_field.status_code == 201, created_field.text
    email, password = _create_member(
        authenticated_client,
        project_id,
        email=f"viewer-{uuid.uuid4().hex[:8]}@example.test",
        role_key="viewer",
        project_role="viewer",
    )
    _login_as(client, email, password)

    confirm = client.post(
        f"/api/v1/field-values/{created_field.json()['id']}/confirm",
        json={"revision": created_field.json()["revision"], "evidence_acknowledged": False},
    )
    assert confirm.status_code == 403
    finalize = client.post(
        f"/api/v1/documents/versions/{version_id}/finalize",
        json={"revision": 1, "declaration": "只读用户不得定稿"},
    )
    assert finalize.status_code == 403
    export = client.post(
        f"/api/v1/exports?version_id={version_id}",
        json={"output_format": "docx", "idempotency_key": f"viewer-{uuid.uuid4()}"},
    )
    assert export.status_code == 403
    with SessionLocal() as db:
        rejected = list(
            db.scalars(
                select(AuditLog).where(
                    AuditLog.actor_user_id.is_not(None),
                    AuditLog.action == "request.rejected",
                )
            )
        )
        assert len(rejected) >= 3


def test_fixed_template_block_and_template_structure_are_enforced(
    authenticated_client: TestClient, client: TestClient
) -> None:
    project_id = _project(authenticated_client)
    _document_id, version_id = _generate_requirement(authenticated_client, project_id)
    detail = authenticated_client.get(f"/api/v1/documents/versions/{version_id}").json()
    first_block = detail["sections"][0]["blocks"][0]
    with SessionLocal() as db:
        stored = db.get(DocumentContentBlock, first_block["id"])
        assert stored is not None
        stored.source_kind = "fixed_template"
        db.commit()

    email, password = _create_member(
        authenticated_client,
        project_id,
        email=f"editor-{uuid.uuid4().hex[:8]}@example.test",
        role_key="project_editor",
        project_role="editor",
    )
    _login_as(client, email, password)
    blocked = client.patch(
        f"/api/v1/documents/blocks/{first_block['id']}",
        json={"content": {"text": "试图修改固定条款"}, "reviewed": True, "revision": 1},
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "fixed_template_block_forbidden"

    with SessionLocal() as db:
        first_section = db.scalar(
            select(DocumentSection)
            .where(DocumentSection.document_version_id == version_id)
            .order_by(DocumentSection.sequence)
        )
        assert first_section is not None
        for stored_block in db.scalars(
            select(DocumentContentBlock).where(
                DocumentContentBlock.document_section_id == first_section.id
            )
        ):
            db.delete(stored_block)
        db.flush()
        db.delete(first_section)
        db.commit()
    validation = authenticated_client.post(f"/api/v1/documents/versions/{version_id}/validate")
    assert validation.status_code == 200, validation.text
    assert "required_sections_missing" in {
        issue["rule_key"] for issue in validation.json()["issues"]
    }


def test_common_placeholders_block_finalization(authenticated_client: TestClient) -> None:
    project_id = _project(authenticated_client)
    _document_id, version_id = _generate_requirement(authenticated_client, project_id)
    detail = authenticated_client.get(f"/api/v1/documents/versions/{version_id}").json()
    block = detail["sections"][0]["blocks"][0]
    updated = authenticated_client.patch(
        f"/api/v1/documents/blocks/{block['id']}",
        json={"content": {"text": "金额待填写，编号 TBD，主体 XXX"}, "reviewed": True, "revision": 1},
    )
    assert updated.status_code == 200, updated.text
    validation = authenticated_client.post(f"/api/v1/documents/versions/{version_id}/validate")
    assert validation.status_code == 200
    assert "unresolved_placeholder" in {
        issue["rule_key"] for issue in validation.json()["issues"]
    }


def test_nested_table_storage_is_not_mistaken_for_double_bracket_placeholder() -> None:
    table = {
        "headers": ["序号", "投标人填写内容"],
        "rows": [["1", "投标人填写"], ["2", "正常内容"]],
    }
    assert PLACEHOLDER_PATTERN.search(_searchable_content_text(table)) is None

    table["rows"][1][1] = "[[待替换变量]]"
    assert PLACEHOLDER_PATTERN.search(_searchable_content_text(table)) is not None


def test_contract_missing_note_does_not_require_upstream_stage_fields() -> None:
    fields = {key: "已确认值" for key in CONTRACT_FIELD_KEYS}
    paragraphs = _draft_paragraphs("contract", "agreement", "合同协议书", "项目名称", fields)
    assert "【待确认】" not in paragraphs[-1]
