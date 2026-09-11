"""Applicable field resolver and tender field profile tests."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db import SessionLocal
from backend.app.field_catalog import BASE_FIELD_DEFINITIONS
from backend.app.models import (
    FieldDefinition,
    FieldValue,
    ProcurementAnalysisRun,
    ProcurementPlan,
    Template,
    TemplateVariable,
    TemplateVersion,
    TenderDocumentGroup,
    User,
)
from backend.app.services.applicable_fields import resolve_project_applicable_field_union
from backend.app.services.field_extraction import extract_field_candidates
from backend.app.tender_field_profiles import (
    classify_empty_reason,
    profile_fields,
    resolve_profile_name,
)


def _tender_catalog_size() -> int:
    return len(BASE_FIELD_DEFINITIONS["tender"])


def _create_plan_with_groups(
    db: Session,
    *,
    user: User,
    project_id: str,
    groups: list[dict[str, object]],
) -> list[str]:
    run = ProcurementAnalysisRun(
        organization_id=user.organization_id,
        project_id=project_id,
        source_kind="uploaded_file",
        source_version_id=str(uuid4()),
        source_sha256="a" * 64,
        status="succeeded",
        provider_name="demo",
        model_name="demo",
        prompt_version="test",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(run)
    db.flush()
    plan = ProcurementPlan(
        organization_id=user.organization_id,
        project_id=project_id,
        analysis_run_id=run.id,
        source_kind="uploaded_file",
        source_version_id=run.source_version_id,
        source_sha256=run.source_sha256,
        version=1,
        name="方案",
        status="draft",
        is_recommended=True,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(plan)
    db.flush()
    ids: list[str] = []
    for index, spec in enumerate(groups):
        group = TenderDocumentGroup(
            organization_id=user.organization_id,
            plan_id=plan.id,
            code=str(spec.get("code") or f"DOC-{index + 1}"),
            name=str(spec.get("name") or "招标文件"),
            procurement_category=str(spec.get("procurement_category") or "other"),
            business_subcategory=(
                str(spec["business_subcategory"])
                if spec.get("business_subcategory") is not None
                else None
            ),
            procurement_method="public_tender",
            scope=str(spec.get("scope") or "范围"),
            rationale=str(spec.get("rationale") or "test"),
            template_id=spec.get("template_id"),  # type: ignore[arg-type]
            template_version=spec.get("template_version"),  # type: ignore[arg-type]
            status="active",
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(group)
        db.flush()
        ids.append(group.id)
    db.commit()
    return ids


def test_profiles_differ_and_generic_is_small() -> None:
    service_keys = {item.field_key for item in profile_fields("service")}
    goods_keys = {item.field_key for item in profile_fields("goods")}
    assert service_keys != goods_keys
    assert "technical_specifications" in service_keys
    assert "procurement_list" in goods_keys
    assert "installation_requirements" in goods_keys
    assert "installation_requirements" not in service_keys
    generic_keys = {item.field_key for item in profile_fields("generic")}
    assert "tender_method" in generic_keys
    assert "data_security_requirements" not in generic_keys
    assert "procurement_list" not in generic_keys
    assert len(generic_keys) < _tender_catalog_size()
    assert len(service_keys) < _tender_catalog_size()
    assert len(goods_keys) < _tender_catalog_size()


def test_resolve_profile_name_from_category() -> None:
    assert resolve_profile_name(procurement_category="服务采购") == "service"
    assert resolve_profile_name(procurement_category="设备采购") == "goods"
    assert resolve_profile_name(procurement_category="施工招标") == "works"
    assert resolve_profile_name(group_name="独立评估服务包招标文件") == "evaluation"
    assert resolve_profile_name(procurement_category="other") == "generic"


def test_compliance_empty_reason_not_extraction_failed() -> None:
    assert (
        classify_empty_reason("procurement_budget", has_total_investment=True)
        == "COMPLIANCE_NOT_AUTO_MAPPED"
    )
    assert (
        classify_empty_reason("maximum_price", has_total_investment=True)
        == "COMPLIANCE_NOT_AUTO_MAPPED"
    )
    assert classify_empty_reason("bid_bond") == "DECISION_REQUIRED"
    assert classify_empty_reason("acceptance_criteria") == "MATERIAL_NOT_FOUND"


def test_applicable_fields_api_differs_by_group(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-DIFF", "name": "适用字段差异项目", "description": None},
    )
    assert project.status_code == 201, project.text
    project_id = project.json()["id"]

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        group_a_id, group_b_id = _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {
                    "code": "DOC-A",
                    "name": "平台开发实施服务包招标文件",
                    "procurement_category": "服务采购",
                    "scope": "软件服务",
                },
                {
                    "code": "DOC-B",
                    "name": "设备采购包招标文件",
                    "procurement_category": "设备采购",
                    "scope": "设备供货",
                },
            ],
        )

    resp_a = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{group_a_id}/applicable-fields"
    )
    resp_b = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{group_b_id}/applicable-fields"
    )
    assert resp_a.status_code == 200, resp_a.text
    assert resp_b.status_code == 200, resp_b.text
    keys_a = {item["field_key"] for item in resp_a.json()["fields"]}
    keys_b = {item["field_key"] for item in resp_b.json()["fields"]}
    assert keys_a != keys_b
    assert resp_a.json()["profile"] == "service"
    assert resp_b.json()["profile"] == "goods"
    assert "procurement_list" in keys_b
    assert "data_security_requirements" in keys_a
    assert len(keys_a) < _tender_catalog_size()
    assert len(keys_b) < _tender_catalog_size()


def test_generic_core_not_full_catalog(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-CORE", "name": "核心字段项目", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        (group_id,) = _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[{"code": "DOC-G", "name": "通用招标文件", "procurement_category": "other"}],
        )

    response = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{group_id}/applicable-fields"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["resolution_source"] == "core"
    assert payload["profile"] == "generic"
    assert payload["setup_incomplete"] is True
    assert payload["setup_incomplete_reason"]
    keys = {item["field_key"] for item in payload["fields"]}
    assert len(keys) < _tender_catalog_size()
    # Minimal material collection — process/decision clauses are not extraction targets here.
    assert "project_name" in keys
    assert "procurement_scope" in keys
    assert "acceptance_criteria" in keys
    assert "tender_number" not in keys
    assert "bid_deadline" not in keys
    assert "data_security_requirements" not in keys
    assert "procurement_list" not in keys
    assert all(item.get("input_role") == "material" for item in payload["fields"])


def test_full_catalog_template_registry_falls_back_to_profile(
    authenticated_client: TestClient,
) -> None:
    """Builtin seed historically registered every tender field on templates.

    That registry must not force the UI back to the full ~37-field list.
    """

    from backend.app.field_catalog import BASE_FIELD_DEFINITIONS

    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-FULL", "name": "全量变量回退项目", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        template = Template(
            organization_id=user.organization_id,
            name="全量变量模板",
            stage="tender",
            specialty="通用",
            procurement_type="服务采购",
            status="published",
            source_kind="platform_reference_template",
            generation_enabled=True,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(
            organization_id=user.organization_id,
            template_id=template.id,
            version=1,
            status="published",
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(version)
        db.flush()
        for key, _label, _data_type, _unit, _criticality, required in BASE_FIELD_DEFINITIONS[
            "tender"
        ]:
            db.add(
                TemplateVariable(
                    organization_id=user.organization_id,
                    template_version_id=version.id,
                    variable_key=key,
                    field_key=key,
                    required=required,
                    created_by=user.id,
                    updated_by=user.id,
                )
            )
        db.flush()
        (group_id,) = _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {
                    "code": "DOC-FULL",
                    "name": "服务包",
                    "procurement_category": "服务采购",
                    "template_id": template.id,
                    "template_version": 1,
                }
            ],
        )

    response = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{group_id}/applicable-fields"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["resolution_source"] == "profile"
    assert payload["profile"] == "service"
    assert len(payload["fields"]) < len(BASE_FIELD_DEFINITIONS["tender"])
    assert "data_security_requirements" in {item["field_key"] for item in payload["fields"]}
    assert "bid_opening" in {item["field_key"] for item in payload["fields"]}
    assert "procurement_list" not in {item["field_key"] for item in payload["fields"]}


def test_template_variables_take_priority(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-TPL", "name": "模板优先项目", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        template = Template(
            organization_id=user.organization_id,
            name="精简招标模板",
            stage="tender",
            specialty="通用",
            status="published",
            source_kind="platform_reference_template",
            generation_enabled=True,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(
            organization_id=user.organization_id,
            template_id=template.id,
            version=1,
            status="published",
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(version)
        db.flush()
        for key in ("project_name", "procurement_scope", "acceptance_criteria"):
            db.add(
                TemplateVariable(
                    organization_id=user.organization_id,
                    template_version_id=version.id,
                    variable_key=key,
                    field_key=key,
                    required=True,
                    created_by=user.id,
                    updated_by=user.id,
                )
            )
        db.flush()
        (group_id,) = _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {
                    "code": "DOC-T",
                    "name": "服务包",
                    "procurement_category": "服务采购",
                    "template_id": template.id,
                    "template_version": 1,
                }
            ],
        )

    response = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{group_id}/applicable-fields"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["resolution_source"] == "template"
    keys = {item["field_key"] for item in payload["fields"]}
    assert keys == {"project_name", "procurement_scope", "acceptance_criteria"}
    assert "tender_number" not in keys
    assert "bid_deadline" not in keys
    assert all(item["source"] == "template" for item in payload["fields"])


def test_template_variable_outside_profile_still_applicable(
    authenticated_client: TestClient,
) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-OVR", "name": "模板覆盖项目", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        template = Template(
            organization_id=user.organization_id,
            name="含澄清规则模板",
            stage="tender",
            specialty="通用",
            status="published",
            source_kind="platform_reference_template",
            generation_enabled=True,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(
            organization_id=user.organization_id,
            template_id=template.id,
            version=1,
            status="published",
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(version)
        db.flush()
        for key in ("project_name", "clarification_rules"):
            db.add(
                TemplateVariable(
                    organization_id=user.organization_id,
                    template_version_id=version.id,
                    variable_key=key,
                    field_key=key,
                    required=True,
                    created_by=user.id,
                    updated_by=user.id,
                )
            )
        db.flush()
        (group_id,) = _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {
                    "code": "DOC-O",
                    "name": "评估包",
                    "procurement_category": "评估服务",
                    "template_id": template.id,
                    "template_version": 1,
                }
            ],
        )

    response = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{group_id}/applicable-fields"
    )
    keys = {item["field_key"] for item in response.json()["fields"]}
    assert "clarification_rules" in keys
    clarification = next(
        item for item in response.json()["fields"] if item["field_key"] == "clarification_rules"
    )
    assert clarification["source"] == "template"


def test_compliance_not_auto_map_investment(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-CMP", "name": "合规映射项目", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        definition = db.scalar(
            select(FieldDefinition).where(
                FieldDefinition.organization_id == user.organization_id,
                FieldDefinition.stage == "feasibility",
                FieldDefinition.field_key == "total_investment",
            )
        )
        assert definition is not None
        db.add(
            FieldValue(
                organization_id=user.organization_id,
                project_id=project_id,
                stage="feasibility",
                definition_id=definition.id,
                field_key="total_investment",
                field_label=definition.field_label,
                data_type=definition.data_type,
                value=3_300_000,
                normalized_value=3_300_000,
                unit="元",
                criticality="P0",
                status="user_confirmed",
                source_type="user_input",
                created_by=user.id,
                updated_by=user.id,
            )
        )
        db.flush()
        (group_id,) = _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {
                    "code": "DOC-C",
                    "name": "服务包",
                    "procurement_category": "服务采购",
                }
            ],
        )

    response = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{group_id}/applicable-fields"
    )
    by_key = {item["field_key"]: item for item in response.json()["fields"]}
    assert by_key["procurement_budget"]["empty_reason_code"] == "COMPLIANCE_NOT_AUTO_MAPPED"
    assert by_key["maximum_price"]["empty_reason_code"] == "COMPLIANCE_NOT_AUTO_MAPPED"
    assert "总投资" in by_key["procurement_budget"]["empty_reason_message"]

    definitions = [
        SimpleNamespace(
            field_key="procurement_budget",
            field_label="招标预算",
            data_type="money",
            rules={"aliases": ["招标预算", "采购预算"]},
        ),
        SimpleNamespace(
            field_key="maximum_price",
            field_label="最高限价",
            data_type="money",
            rules={"aliases": ["最高限价"]},
        ),
    ]
    candidates = extract_field_candidates(
        [
            SimpleNamespace(
                text="建设投资为 330 万元。",
                sequence=1,
                page_number=1,
                section_path="投资",
                locator={},
                id="b1",
            )
        ],
        definitions,  # type: ignore[arg-type]
    )
    assert "procurement_budget" not in candidates
    assert "maximum_price" not in candidates


def test_hidden_fields_do_not_affect_completion_semantics() -> None:
    from backend.app.services.validation import BLOCKING_FIELD_STATUSES

    applicable_required = {"project_name", "procurement_scope"}
    current = {
        "project_name": SimpleNamespace(status="user_confirmed", value="A"),
        "procurement_scope": SimpleNamespace(status="user_confirmed", value="范围"),
    }
    assert applicable_required <= set(current)
    assert "bid_deadline" not in applicable_required
    assert current["project_name"].status not in BLOCKING_FIELD_STATUSES


def test_semantic_acceptance_criteria_extraction() -> None:
    definition = SimpleNamespace(
        field_key="acceptance_criteria",
        field_label="验收标准及材料",
        data_type="text",
        rules={
            "aliases": [
                "验收标准及材料",
                "验收指标",
                "质量目标",
                "交付物",
                "接收证据",
            ]
        },
    )
    blocks = [
        SimpleNamespace(
            text="本章说明核心产出及质量目标，系统可用率不低于 99.5%。",
            sequence=1,
            page_number=2,
            section_path="质量目标",
            locator={},
            id="1",
        ),
        SimpleNamespace(
            text="验收指标及统计口径需单独建表，并在抽检中核对。",
            sequence=2,
            page_number=3,
            section_path="验收指标",
            locator={},
            id="2",
        ),
        SimpleNamespace(
            text="交付物与移交要求包括源代码、部署文档与培训记录。",
            sequence=3,
            page_number=4,
            section_path="交付物",
            locator={},
            id="3",
        ),
        SimpleNamespace(
            text="联调结束后应保留接收证据以便复核。",
            sequence=4,
            page_number=5,
            section_path="接收证据",
            locator={},
            id="4",
        ),
    ]
    candidates = extract_field_candidates(blocks, [definition])  # type: ignore[arg-type]
    assert "acceptance_criteria" in candidates
    assert candidates["acceptance_criteria"].extraction_method == "rule_based_semantic_sections"


def test_extraction_union_excludes_unrelated_catalog_keys(
    authenticated_client: TestClient,
) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-UNI", "name": "并集抽取项目", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {
                    "code": "DOC-U",
                    "name": "评估包",
                    "procurement_category": "评估服务",
                }
            ],
        )
        keys = resolve_project_applicable_field_union(
            db, project_id=project_id, organization_id=user.organization_id
        )
    # Known evaluation profile without template still exposes process fields for formal tender,
    # but setup_incomplete on the group blocks finalize.
    assert "bid_opening" in keys
    assert "project_name" in keys
    assert "procurement_list" not in keys
    assert len(keys) < _tender_catalog_size()


def test_stage_applicable_fields_batch(authenticated_client: TestClient) -> None:
    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-BAT", "name": "批量适用字段", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {"code": "A", "name": "服务采购文件", "procurement_category": "服务采购"},
                {"code": "B", "name": "设备采购文件", "procurement_category": "设备采购"},
            ],
        )

    response = authenticated_client.get(
        f"/api/v1/projects/{project_id}/stages/tender/applicable-fields"
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["groups"]) == 2


def _confirm_scoped_fields(
    client: TestClient,
    *,
    project_id: str,
    group_id: str,
    values: dict[str, object],
) -> None:
    definitions = {
        item["field_key"]: item
        for item in client.get("/api/v1/field-definitions?stage=tender").json()
    }
    current = {
        item["field_key"]: item
        for item in client.get(f"/api/v1/field-values?project_id={project_id}&stage=tender").json()
    }
    for field_key, value in values.items():
        definition = definitions[field_key]
        target_key = f"doc::{group_id}::{field_key}"
        existing = current.get(target_key)
        if existing is None:
            created = client.post(
                f"/api/v1/field-values?project_id={project_id}&stage=tender",
                json={
                    "field_key": target_key,
                    "field_label": definition["field_label"],
                    "data_type": definition["data_type"],
                    "value": value,
                    "normalized_value": value,
                    "unit": definition["unit"],
                    "criticality": definition["criticality"],
                    "status": "missing",
                    "source_type": "user_input",
                    "confidence": None,
                    "evidence": None,
                },
            )
            assert created.status_code == 201, created.text
            field = created.json()
        else:
            patched = client.patch(
                f"/api/v1/field-values/{existing['id']}",
                json={
                    "value": value,
                    "normalized_value": value,
                    "unit": definition["unit"],
                    "status": "missing",
                    "source_type": "user_input",
                    "revision": existing["revision"],
                    "evidence": None,
                },
            )
            assert patched.status_code == 200, patched.text
            field = patched.json()
        confirmed = client.post(
            f"/api/v1/field-values/{field['id']}/confirm",
            json={"revision": field["revision"], "evidence_acknowledged": True},
        )
        assert confirmed.status_code == 200, confirmed.text


def _make_tender_version(
    db: Session,
    *,
    user: User,
    project_id: str,
    plan_id: str,
    group_id: str,
) -> str:
    from backend.app.models import Document, DocumentVersion

    document = Document(
        organization_id=user.organization_id,
        project_id=project_id,
        stage="tender",
        title="测试招标文件",
        status="draft",
        current_version=1,
        procurement_plan_id=plan_id,
        procurement_document_group_id=group_id,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(document)
    db.flush()
    version = DocumentVersion(
        organization_id=user.organization_id,
        document_id=document.id,
        version=1,
        status="draft",
        provenance={"procurement_plan_id": plan_id},
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(version)
    db.commit()
    return version.id


def test_validation_ignores_non_applicable_p0_catalog_fields(
    authenticated_client: TestClient,
) -> None:
    """TEST 8: catalog P0 fields outside applicable set must not block this file."""

    from backend.app.models import DocumentVersion, ValidationIssue
    from backend.app.services.validation import validate_document_version

    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-P0", "name": "P0 仅当前文件", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        template = Template(
            organization_id=user.organization_id,
            name="两字段模板",
            stage="tender",
            specialty="通用",
            status="published",
            source_kind="platform_reference_template",
            generation_enabled=True,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(
            organization_id=user.organization_id,
            template_id=template.id,
            version=1,
            status="published",
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(version)
        db.flush()
        for key in ("project_name", "procurement_scope"):
            db.add(
                TemplateVariable(
                    organization_id=user.organization_id,
                    template_version_id=version.id,
                    variable_key=key,
                    field_key=key,
                    required=True,
                    created_by=user.id,
                    updated_by=user.id,
                )
            )
        db.flush()
        (group_id,) = _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {
                    "code": "DOC-P0",
                    "name": "服务包",
                    "procurement_category": "服务采购",
                    "template_id": template.id,
                    "template_version": 1,
                }
            ],
        )
        plan = db.scalar(
            select(ProcurementPlan).where(ProcurementPlan.project_id == project_id)
        )
        assert plan is not None
        version_id = _make_tender_version(
            db,
            user=user,
            project_id=project_id,
            plan_id=plan.id,
            group_id=group_id,
        )

    _confirm_scoped_fields(
        authenticated_client,
        project_id=project_id,
        group_id=group_id,
        values={
            "project_name": "适用字段门禁项目",
            "procurement_scope": "仅本文件范围",
        },
    )
    # Non-applicable catalog P0 left empty / missing — must not gate this file.
    authenticated_client.post(
        f"/api/v1/field-values?project_id={project_id}&stage=tender",
        json={
            "field_key": f"doc::{group_id}::bid_bond",
            "field_label": "投标保证金",
            "data_type": "text",
            "value": None,
            "normalized_value": None,
            "unit": None,
            "criticality": "P0",
            "status": "missing",
            "source_type": "user_input",
            "confidence": None,
            "evidence": None,
        },
    )

    with SessionLocal() as db:
        version = db.get(DocumentVersion, version_id)
        assert version is not None
        run = validate_document_version(db, version)
        db.commit()
        issues = list(
            db.scalars(
                select(ValidationIssue).where(ValidationIssue.validation_run_id == run.id)
            )
        )
    missing_keys = {
        (issue.location or {}).get("field_key")
        for issue in issues
        if issue.rule_key == "required_field_missing"
    }
    assert "bid_bond" not in missing_keys
    assert "bid_deadline" not in missing_keys
    assert "project_name" not in missing_keys
    assert "procurement_scope" not in missing_keys


def test_template_required_field_blocks_validation(
    authenticated_client: TestClient,
) -> None:
    """TEST 9: template-required field left unconfirmed blocks finalize validation."""

    from backend.app.models import DocumentVersion, ValidationIssue
    from backend.app.services.validation import validate_document_version

    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "AF-BLK", "name": "模板阻断项目", "description": None},
    )
    project_id = project.json()["id"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "admin"))
        assert user is not None
        template = Template(
            organization_id=user.organization_id,
            name="含验收模板",
            stage="tender",
            specialty="通用",
            status="published",
            source_kind="platform_reference_template",
            generation_enabled=True,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(template)
        db.flush()
        tpl_version = TemplateVersion(
            organization_id=user.organization_id,
            template_id=template.id,
            version=1,
            status="published",
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(tpl_version)
        db.flush()
        for key in ("project_name", "acceptance_criteria"):
            db.add(
                TemplateVariable(
                    organization_id=user.organization_id,
                    template_version_id=tpl_version.id,
                    variable_key=key,
                    field_key=key,
                    required=True,
                    created_by=user.id,
                    updated_by=user.id,
                )
            )
        db.flush()
        (group_id,) = _create_plan_with_groups(
            db,
            user=user,
            project_id=project_id,
            groups=[
                {
                    "code": "DOC-BLK",
                    "name": "评估包",
                    "procurement_category": "评估服务",
                    "template_id": template.id,
                    "template_version": 1,
                }
            ],
        )
        plan = db.scalar(
            select(ProcurementPlan).where(ProcurementPlan.project_id == project_id)
        )
        assert plan is not None
        version_id = _make_tender_version(
            db,
            user=user,
            project_id=project_id,
            plan_id=plan.id,
            group_id=group_id,
        )

    _confirm_scoped_fields(
        authenticated_client,
        project_id=project_id,
        group_id=group_id,
        values={"project_name": "模板阻断项目"},
    )

    with SessionLocal() as db:
        version = db.get(DocumentVersion, version_id)
        assert version is not None
        run = validate_document_version(db, version)
        db.commit()
        issues = list(
            db.scalars(
                select(ValidationIssue).where(ValidationIssue.validation_run_id == run.id)
            )
        )
    assert any(
        issue.rule_key == "required_field_missing"
        and (issue.location or {}).get("field_key") == "acceptance_criteria"
        for issue in issues
    )