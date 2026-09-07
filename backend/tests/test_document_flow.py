from __future__ import annotations

import io
import uuid
import zipfile

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from pypdf import PdfReader

REQUIREMENT_FIELDS = {
    "project_name": ("项目名称", "宁夏政务服务平台建设项目", None),
    "project_owner": ("项目单位", "宁夏示例单位", None),
    "construction_scope": ("建设范围", "建设统一申报和事项管理能力", None),
    "project_period": ("项目总建设周期", 18, "月"),
}


def _create_project(client: TestClient) -> str:
    response = client.post(
        "/api/v1/projects",
        json={"code": f"FLOW-{uuid.uuid4().hex[:8]}", "name": "宁夏政务服务平台建设项目"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _confirm_required_fields(client: TestClient, project_id: str) -> None:
    for key, (label, value, unit) in REQUIREMENT_FIELDS.items():
        created = client.post(
            f"/api/v1/field-values?project_id={project_id}&stage=requirement",
            json={
                "field_key": key,
                "field_label": label,
                "value": value,
                "normalized_value": value,
                "unit": unit,
                "criticality": "P0",
                "status": "missing",
                "source_type": "user_input",
            },
        )
        assert created.status_code == 201, created.text
        field = created.json()
        confirmed = client.post(
            f"/api/v1/field-values/{field['id']}/confirm",
            json={"revision": field["revision"], "evidence_acknowledged": True},
        )
        assert confirmed.status_code == 200, confirmed.text


def _generate(client: TestClient, project_id: str) -> tuple[str, str]:
    templates = client.get("/api/v1/templates?stage=requirement&generation_only=true")
    assert templates.status_code == 200
    template = templates.json()[0]
    generated = client.post(
        f"/api/v1/generation-jobs?project_id={project_id}&stage=requirement",
        json={
            "template_id": template["id"],
            "template_version": template["current_version"],
            "idempotency_key": f"generation-{uuid.uuid4()}",
        },
    )
    assert generated.status_code == 202, generated.text
    assert generated.json()["status"] == "succeeded"
    documents = client.get(f"/api/v1/documents?project_id={project_id}").json()
    document_id = documents[0]["id"]
    detail = client.get(f"/api/v1/documents/{document_id}").json()
    return document_id, detail["versions"][0]["id"]


def _review_all_blocks(client: TestClient, version_id: str) -> None:
    detail = client.get(f"/api/v1/documents/versions/{version_id}").json()
    for section in detail["sections"]:
        for block in section["blocks"]:
            response = client.patch(
                f"/api/v1/documents/blocks/{block['id']}",
                json={"content": block["content"], "reviewed": True, "revision": block["revision"]},
            )
            assert response.status_code == 200, response.text


def test_p0_gate_blocks_missing_fields(authenticated_client: TestClient) -> None:
    project_id = _create_project(authenticated_client)
    _document_id, version_id = _generate(authenticated_client, project_id)
    validation = authenticated_client.post(f"/api/v1/documents/versions/{version_id}/validate")
    assert validation.status_code == 200
    assert validation.json()["issue_counts"]["P0"] >= len(REQUIREMENT_FIELDS)
    finalize = authenticated_client.post(
        f"/api/v1/documents/versions/{version_id}/finalize",
        json={"revision": 1, "declaration": "已完成审核并申请定稿"},
    )
    assert finalize.status_code == 422
    assert finalize.json()["error"]["code"] == "finalization_blocked"


def test_full_flow_finalizes_and_exports_real_files(authenticated_client: TestClient) -> None:
    project_id = _create_project(authenticated_client)
    _confirm_required_fields(authenticated_client, project_id)
    document_id, version_id = _generate(authenticated_client, project_id)
    _review_all_blocks(authenticated_client, version_id)
    validation = authenticated_client.post(f"/api/v1/documents/versions/{version_id}/validate")
    assert validation.status_code == 200
    assert validation.json()["status"] == "passed"
    finalized = authenticated_client.post(
        f"/api/v1/documents/versions/{version_id}/finalize",
        json={"revision": 1, "declaration": "关键字段和生成内容已完成人工复核"},
    )
    assert finalized.status_code == 200, finalized.text

    for output_format in ("docx", "pdf", "xlsx"):
        response = authenticated_client.post(
            f"/api/v1/exports?version_id={version_id}",
            json={
                "output_format": output_format,
                "idempotency_key": f"export-{output_format}-{uuid.uuid4()}",
            },
        )
        assert response.status_code == 202, response.text
        job = response.json()
        assert job["status"] == "succeeded", job
        download = authenticated_client.get(f"/api/v1/exports/{job['id']}/download")
        assert download.status_code == 200, download.text
        content = download.content
        if output_format == "docx":
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                assert "word/document.xml" in archive.namelist()
        elif output_format == "pdf":
            assert len(PdfReader(io.BytesIO(content)).pages) >= 2
        else:
            workbook = load_workbook(io.BytesIO(content), read_only=True)
            assert workbook.sheetnames == ["文档结构", "字段来源"]

    detail = authenticated_client.get(f"/api/v1/documents/{document_id}").json()
    assert detail["versions"][0]["immutable"] is True


def test_forbidden_cross_stage_mapping_is_rejected(authenticated_client: TestClient) -> None:
    project_id = _create_project(authenticated_client)
    response = authenticated_client.post(
        f"/api/v1/field-values?project_id={project_id}&stage=tender",
        json={
            "field_key": "procurement_budget",
            "field_label": "招标预算",
            "value": 1000000,
            "criticality": "P0",
            "status": "extracted",
            "source_type": "extracted",
            "evidence": {
                "excerpt": "可研总投资 100 万元",
                "source_stage": "feasibility",
                "source_field_key": "total_investment",
            },
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "forbidden_field_mapping"
