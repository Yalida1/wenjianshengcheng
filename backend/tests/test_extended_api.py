from __future__ import annotations

import io

from docx import Document
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy import select

import backend.scripts.seed as seed_module
from backend.app.db import SessionLocal
from backend.app.models import TemplateVersion
from backend.app.services.storage import get_storage, sha256_bytes
from backend.tests.test_document_flow import (
    _confirm_required_fields,
    _create_project,
    _generate,
    _review_all_blocks,
)


def _docx_bytes() -> bytes:
    stream = io.BytesIO()
    document = Document()
    document.add_heading("来源材料", level=1)
    document.add_paragraph("项目名称：扩展接口测试项目")
    document.save(stream)
    return stream.getvalue()


def test_file_versions_parse_results_and_stage_source_options(
    authenticated_client: TestClient,
) -> None:
    project_id = _create_project(authenticated_client)
    uploaded = authenticated_client.post(
        f"/api/v1/files?project_id={project_id}&stage=requirement",
        files={
            "upload": (
                "source.docx",
                _docx_bytes(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()["id"]
    versions = authenticated_client.get(f"/api/v1/files/{file_id}/versions")
    assert versions.status_code == 200
    assert versions.json()[0]["sha256"]
    jobs = authenticated_client.get(f"/api/v1/files/{file_id}/parse-jobs").json()
    result = authenticated_client.get(f"/api/v1/parse-jobs/{jobs[0]['id']}/result")
    assert result.status_code == 200, result.text
    assert result.json()["blocks"][0]["text"] == "来源材料"
    sources = authenticated_client.get(
        f"/api/v1/projects/{project_id}/stages/requirement/sources"
    )
    assert any(item["id"] == versions.json()[0]["id"] for item in sources.json())


def test_demo_template_has_docx_source_sections_variables_and_profile(
    authenticated_client: TestClient,
) -> None:
    templates = authenticated_client.get(
        "/api/v1/templates?stage=tender&generation_only=true"
    ).json()
    template = next(
        item for item in templates if item["source_kind"] == "platform_reference_template"
    )
    detail = authenticated_client.get(f"/api/v1/templates/{template['id']}")
    assert detail.status_code == 200
    version = detail.json()["versions"][0]
    assert version["sha256"] and version["storage_key"]
    preflight = authenticated_client.get(
        f"/api/v1/templates/{template['id']}/versions/1/preflight"
    )
    assert preflight.json()["valid"] is True
    sections = authenticated_client.get(
        f"/api/v1/templates/{template['id']}/versions/1/sections"
    )
    variables = authenticated_client.get(
        f"/api/v1/templates/{template['id']}/versions/1/variables"
    )
    assert len(sections.json()) == 5
    assert {item["variable_key"] for item in variables.json()} >= {
        "procurement_budget",
        "maximum_price",
    }
    profiles = authenticated_client.get("/api/v1/format-profiles")
    assert profiles.status_code == 200
    assert profiles.json()[0]["strict_compliance"] is False


def test_builtin_template_categories_and_generation_boundary(
    authenticated_client: TestClient,
) -> None:
    templates = authenticated_client.get("/api/v1/templates?current_only=true")
    assert templates.status_code == 200
    items = templates.json()
    assert {item["source_kind"] for item in items} >= {
        "national_official_text",
        "adapted_from_official_outline",
        "platform_reference_template",
    }
    official = next(item for item in items if item["source_kind"] == "national_official_text")
    assert official["generation_enabled"] is False
    assert official["issuing_authority"]
    assert official["source_url"].startswith("https://")
    adapted_feasibility = next(
        item
        for item in items
        if item["name"] == "政府投资项目可研报告适配模板（2023年大纲）"
    )
    adapted_sections = authenticated_client.get(
        f"/api/v1/templates/{adapted_feasibility['id']}/versions/1/sections"
    )
    assert adapted_sections.status_code == 200
    assert len(adapted_sections.json()) == 10
    generation_templates = authenticated_client.get(
        "/api/v1/templates?current_only=true&generation_only=true"
    ).json()
    assert all(item["generation_enabled"] for item in generation_templates)
    assert all(item["source_kind"] != "national_official_text" for item in generation_templates)

    project_id = _create_project(authenticated_client)
    official_feasibility = next(
        item
        for item in items
        if item["source_kind"] == "national_official_text" and item["stage"] == "feasibility"
    )
    blocked = authenticated_client.post(
        f"/api/v1/generation-jobs?project_id={project_id}&stage=feasibility",
        json={
            "template_id": official_feasibility["id"],
            "template_version": official_feasibility["current_version"],
            "idempotency_key": "official-text-must-not-generate",
        },
    )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["code"] == "template_not_applicable"

    missing_source = authenticated_client.post(
        "/api/v1/templates",
        json={
            "name": "待补来源的正式模板",
            "stage": "contract",
            "source_kind": "other_official_template",
            "format_profile": {},
        },
    )
    assert missing_source.status_code == 422
    assert missing_source.json()["error"]["code"] == "official_source_metadata_missing"


def test_repeated_seed_keeps_hash_bound_to_stored_template(monkeypatch: MonkeyPatch) -> None:
    with SessionLocal() as db:
        version = db.scalar(
            select(TemplateVersion).where(TemplateVersion.storage_key.is_not(None))
        )
        assert version is not None
        assert version.storage_key is not None
        storage_key = version.storage_key
        stored_sha256 = sha256_bytes(get_storage().get(storage_key))

    monkeypatch.setattr(seed_module, "build_demo_template", lambda _stage, _name: b"new bytes")
    seed_module.seed()

    with SessionLocal() as db:
        version = db.scalar(select(TemplateVersion).where(TemplateVersion.storage_key == storage_key))
        assert version is not None
        assert version.sha256 == stored_sha256
        assert version.sha256 == sha256_bytes(get_storage().get(storage_key))


def test_comments_comparison_events_and_finalized_upstream_source(
    authenticated_client: TestClient,
) -> None:
    project_id = _create_project(authenticated_client)
    _confirm_required_fields(authenticated_client, project_id)
    document_id, version_id = _generate(authenticated_client, project_id)
    detail = authenticated_client.get(f"/api/v1/documents/versions/{version_id}").json()
    block_id = detail["sections"][0]["blocks"][0]["id"]
    comment = authenticated_client.post(
        f"/api/v1/documents/versions/{version_id}/comments",
        json={"content_block_id": block_id, "body": "请复核本节字段来源。"},
    )
    assert comment.status_code == 201, comment.text
    resolved = authenticated_client.post(
        f"/api/v1/documents/comments/{comment.json()['id']}/resolve",
        json={"revision": comment.json()["revision"]},
    )
    assert resolved.json()["status"] == "resolved"

    revision = authenticated_client.post(
        f"/api/v1/documents/versions/{version_id}/revisions"
    )
    assert revision.status_code == 201, revision.text
    comparison = authenticated_client.post(
        "/api/v1/comparisons",
        json={"left_version_id": version_id, "right_version_id": revision.json()["id"]},
    )
    assert comparison.status_code == 201, comparison.text
    compared = authenticated_client.get(f"/api/v1/comparisons/{comparison.json()['id']}")
    assert compared.json()["summary"]["unchanged"] > 0

    _review_all_blocks(authenticated_client, version_id)
    assert (
        authenticated_client.post(f"/api/v1/documents/versions/{version_id}/validate").json()[
            "status"
        ]
        == "passed"
    )
    current = authenticated_client.get(f"/api/v1/documents/{document_id}").json()
    source_version = next(item for item in current["versions"] if item["id"] == version_id)
    finalized = authenticated_client.post(
        f"/api/v1/documents/versions/{version_id}/finalize",
        json={"revision": source_version["revision"], "declaration": "字段和内容已复核"},
    )
    assert finalized.status_code == 200, finalized.text
    sources = authenticated_client.get(
        f"/api/v1/projects/{project_id}/stages/feasibility/sources"
    )
    assert any(item["id"] == version_id for item in sources.json())


def test_contract_payment_check_rejects_inconsistent_totals(
    authenticated_client: TestClient,
) -> None:
    response = authenticated_client.post(
        "/api/v1/contract-payment-check",
        json={
            "final_contract_amount": 1000,
            "items": [
                {"label": "首款", "ratio": 40, "amount": 400, "trigger": "合同生效"},
                {"label": "尾款", "ratio": 50, "amount": 500, "trigger": "验收完成"},
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["valid"] is False
    assert len(response.json()["errors"]) == 2


def test_project_object_permission_denies_non_member(
    authenticated_client: TestClient, client: TestClient
) -> None:
    project_id = _create_project(authenticated_client)
    created_user = authenticated_client.post(
        "/api/v1/users",
        json={
            "email": "viewer@example.com",
            "display_name": "只读用户",
            "password": "ViewerPass123!",
            "role_keys": ["viewer"],
        },
    )
    assert created_user.status_code == 201, created_user.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "viewer@example.com", "password": "ViewerPass123!"},
    )
    assert login.status_code == 200
    client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
    denied = client.get(f"/api/v1/projects/{project_id}")
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "project_forbidden"
