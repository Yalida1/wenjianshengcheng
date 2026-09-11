"""Tests J/K/L: incremental extract, gates alignment, historical heal."""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db import SessionLocal
from backend.app.field_catalog import BUILTIN_ALIASES_VERSION, merge_missing_aliases
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
from backend.app.services.applicable_fields import (
    list_project_tender_groups,
    select_effective_procurement_plan,
)
from backend.app.services.incremental_extraction import refresh_field_candidates_from_parsed_blocks
from backend.app.services.procurement_planning import ensure_default_document_groups
from backend.app.tender_field_profiles import TENDER_MATERIAL_COLLECTION_FIELDS


def _admin(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == "admin"))
    assert user is not None
    return user


def _create_plan(
    db: Session,
    *,
    user: User,
    project_id: str,
    recommended: bool = True,
    status: str = "draft",
    version: int = 1,
    option_key: str = "recommended",
) -> ProcurementPlan:
    run = ProcurementAnalysisRun(
        organization_id=user.organization_id,
        project_id=project_id,
        source_kind="uploaded_file",
        source_version_id=str(uuid4()),
        source_sha256="b" * 64,
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
        version=version,
        option_key=option_key,
        name=f"方案-{option_key}",
        status=status,
        is_recommended=recommended,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(plan)
    db.flush()
    return plan


def _add_group(
    db: Session,
    *,
    user: User,
    plan: ProcurementPlan,
    code: str,
    name: str,
    category: str,
    template_id: str | None = None,
    template_version: int | None = None,
    organization_method: str | None = None,
    status: str = "active",
) -> TenderDocumentGroup:
    group = TenderDocumentGroup(
        organization_id=user.organization_id,
        plan_id=plan.id,
        code=code,
        name=name,
        procurement_category=category,
        procurement_method="public_tender",
        organization_method=organization_method,
        scope="范围",
        rationale="test",
        template_id=template_id,
        template_version=template_version,
        status=status,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(group)
    db.flush()
    return group


def test_j_incremental_extract_without_rereading_file(authenticated_client: TestClient) -> None:
    """J: template/profile switch refreshes from blocks; storage.get / LLM not called."""

    import io

    from docx import Document as DocxDocument

    stream = io.BytesIO()
    docx = DocxDocument()
    docx.add_paragraph("项目名称：增量抽取示范工程")
    docx.save(stream)
    content = stream.getvalue()

    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "J-INC", "name": "增量抽取", "description": None},
    )
    project_id = project.json()["id"]

    with SessionLocal() as db:
        user = _admin(db)
        plan = _create_plan(db, user=user, project_id=project_id, status="confirmed")
        group = _add_group(
            db,
            user=user,
            plan=plan,
            code="P01",
            name="服务包招标文件",
            category="服务采购",
        )
        db.commit()
        group_id = group.id
        org_id = user.organization_id
        actor_id = user.id

    upload = authenticated_client.post(
        f"/api/v1/files?project_id={project_id}&stage=tender",
        files={
            "upload": (
                "source.docx",
                content,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert upload.status_code == 201, upload.text
    file_id = upload.json()["id"]

    with (
        patch("backend.app.services.storage.get_storage") as get_storage,
        patch("backend.app.services.providers.get_provider") as get_provider,
    ):
        get_storage.return_value.get.side_effect = AssertionError("must not re-read file")
        get_provider.side_effect = AssertionError("must not call LLM")
        with SessionLocal() as db:
            summary = refresh_field_candidates_from_parsed_blocks(
                db,
                project_id=project_id,
                organization_id=org_id,
                actor_id=actor_id,
                reason="template_profile_switch",
                document_group_id=group_id,
            )
            db.commit()

    assert summary["files_processed"] >= 1
    assert get_storage.return_value.get.call_count == 0

    with SessionLocal() as db:
        user = _admin(db)
        template = Template(
            organization_id=user.organization_id,
            name="窄模板",
            stage="tender",
            specialty="通用",
            status="published",
            source_kind="other_official_template",
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
        for key in ("project_name", "procurement_scope"):
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
        group = db.get(TenderDocumentGroup, group_id)
        assert group is not None
        group.template_id = template.id
        group.template_version = 1
        db.commit()

    with patch("backend.app.services.storage.get_storage") as get_storage:
        get_storage.return_value.get.side_effect = AssertionError("must not re-read file")
        with SessionLocal() as db:
            again = refresh_field_candidates_from_parsed_blocks(
                db,
                project_id=project_id,
                organization_id=org_id,
                actor_id=actor_id,
                reason="template_bound",
            )
            db.commit()
            values = list(
                db.scalars(
                    select(FieldValue).where(
                        FieldValue.project_id == project_id,
                        FieldValue.stage == "tender",
                        FieldValue.is_current.is_(True),
                    )
                )
            )
    assert again["files_processed"] >= 1
    assert any("project_name" in item.field_key for item in values)

    with SessionLocal() as db:
        current = db.scalar(
            select(FieldValue).where(
                FieldValue.project_id == project_id,
                FieldValue.field_key.endswith("project_name"),
                FieldValue.is_current.is_(True),
            )
        )
        assert current is not None
        current.status = "user_confirmed"
        current.source_type = "user_input"
        current.value = "人工确认名"
        current.normalized_value = "人工确认名"
        db.commit()
        revision_before = current.revision

    with SessionLocal() as db:
        refresh_field_candidates_from_parsed_blocks(
            db,
            project_id=project_id,
            organization_id=org_id,
            actor_id=actor_id,
            reason="dropdown_switch",
        )
        db.commit()
        current = db.scalar(
            select(FieldValue).where(
                FieldValue.project_id == project_id,
                FieldValue.field_key.endswith("project_name"),
                FieldValue.is_current.is_(True),
            )
        )
        assert current is not None
        assert current.value == "人工确认名"
        assert current.revision == revision_before
    assert file_id


def test_k_gates_aligned_na_not_blocking_setup_incomplete(
    authenticated_client: TestClient,
) -> None:
    """K: page/completion/generation gates; N/A not blocking; real required not hidden."""

    from backend.app.models import DocumentVersion, ValidationIssue
    from backend.app.services.validation import validate_document_version
    from backend.tests.test_applicable_fields import _confirm_scoped_fields, _make_tender_version

    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "K-GATE", "name": "门禁对齐", "description": None},
    )
    project_id = project.json()["id"]

    with SessionLocal() as db:
        user = _admin(db)
        plan = _create_plan(db, user=user, project_id=project_id, status="draft")
        # Unknown category → material collection + setup_incomplete
        generic = _add_group(
            db,
            user=user,
            plan=plan,
            code="G1",
            name="未知类别文件",
            category="other",
        )
        # Goods profile without template — real required fields present, setup incomplete
        goods = _add_group(
            db,
            user=user,
            plan=plan,
            code="G2",
            name="设备采购包招标文件",
            category="设备采购",
        )
        db.commit()
        generic_id = generic.id
        goods_id = goods.id
        plan_id = plan.id

    resp_g = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{generic_id}/applicable-fields"
    )
    assert resp_g.status_code == 200
    payload_g = resp_g.json()
    assert payload_g["setup_incomplete"] is True
    keys_g = {item["field_key"] for item in payload_g["fields"]}
    assert keys_g == {item.field_key for item in TENDER_MATERIAL_COLLECTION_FIELDS}
    assert "installation_requirements" not in keys_g  # N/A hidden

    resp_b = authenticated_client.get(
        f"/api/v1/projects/{project_id}/document-groups/{goods_id}/applicable-fields"
    )
    payload_b = resp_b.json()
    assert payload_b["setup_incomplete"] is True
    keys_b = {item["field_key"] for item in payload_b["fields"]}
    assert "procurement_list" in keys_b  # real required not hidden
    assert "installation_requirements" in keys_b
    assert "data_security_requirements" not in keys_b  # service-only N/A
    decision = next(item for item in payload_b["fields"] if item["field_key"] == "procurement_budget")
    assert decision["input_role"] == "decision"
    assert decision["empty_reason_code"] == "DECISION_REQUIRED"

    # Even if all material fields confirmed, setup_incomplete must block validation finalize.
    with SessionLocal() as db:
        user = _admin(db)
        version_id = _make_tender_version(
            db, user=user, project_id=project_id, plan_id=plan_id, group_id=generic_id
        )

    material_values = {
        item.field_key: f"值-{item.field_key}"
        for item in TENDER_MATERIAL_COLLECTION_FIELDS
        if item.required
    }
    _confirm_scoped_fields(
        authenticated_client,
        project_id=project_id,
        group_id=generic_id,
        values=material_values,
    )
    with SessionLocal() as db:
        version = db.get(DocumentVersion, version_id)
        assert version is not None
        run = validate_document_version(db, version)
        db.commit()
        issues = list(
            db.scalars(select(ValidationIssue).where(ValidationIssue.validation_run_id == run.id))
        )
    assert any(issue.rule_key == "tender_setup_incomplete" for issue in issues)

    # Effective plan isolation: alternate plan groups must not appear.
    with SessionLocal() as db:
        user = _admin(db)
        alt = _create_plan(
            db,
            user=user,
            project_id=project_id,
            recommended=False,
            status="draft",
            version=2,
            option_key="alt",
        )
        _add_group(
            db,
            user=user,
            plan=alt,
            code="ALT",
            name="备选幽灵文件",
            category="服务采购",
        )
        db.commit()
        effective = select_effective_procurement_plan(db, project_id)
        assert effective is not None
        assert effective.id == plan_id
        groups = list_project_tender_groups(db, project_id)
        assert {item.code for item in groups} == {"G1", "G2"}
        assert "ALT" not in {item.code for item in groups}


def test_l_alias_upgrade_archive_stable_ids_heal_noop(authenticated_client: TestClient) -> None:
    """L: alias upgrade, archive misIDs, stable legitimate IDs, heal does not recreate."""

    from backend.scripts.heal_pending_doc_misidentify import (
        apply_findings,
        migrate_aliases,
        scan_misidentified_groups,
    )

    project = authenticated_client.post(
        "/api/v1/projects",
        json={"code": "L-HEAL", "name": "历史清理", "description": None},
    )
    project_id = project.json()["id"]

    with SessionLocal() as db:
        user = _admin(db)
        plan = _create_plan(db, user=user, project_id=project_id)
        good = _add_group(
            db,
            user=user,
            plan=plan,
            code="P01",
            name="合法服务包招标文件",
            category="服务采购",
            organization_method="user_confirmed_one_package_one_document",
        )
        bad = _add_group(
            db,
            user=user,
            plan=plan,
            code="BAD",
            name="采购包名称 | 类别 | 可研采购估算 | 主要范围",
            category="other",
            organization_method="platform_default_one_package_one_document",
        )
        definition = db.scalar(
            select(FieldDefinition).where(
                FieldDefinition.organization_id == user.organization_id,
                FieldDefinition.field_key == "delivery_period",
            )
        )
        assert definition is not None
        definition.rules = {
            "aliases": ["客户自定义别名", "交付周期"],
            "extract_mode": "label_value",
        }
        db.commit()
        good_id = good.id
        bad_id = bad.id
        org_id = user.organization_id
        actor_id = user.id
        plan_id = plan.id

    with SessionLocal() as db:
        alias_report = migrate_aliases(db, organization_id=org_id, apply=True)
        findings = scan_misidentified_groups(db, organization_id=org_id)
        targeted = [item for item in findings if item.object_id == bad_id]
        assert targeted and targeted[0].action == "archive"
        assert all(item.object_id != good_id for item in targeted)
        apply_report = apply_findings(db, targeted, actor_id=actor_id)
        db.commit()
        good = db.get(TenderDocumentGroup, good_id)
        bad = db.get(TenderDocumentGroup, bad_id)
        definition = db.scalar(
            select(FieldDefinition).where(
                FieldDefinition.organization_id == org_id,
                FieldDefinition.field_key == "delivery_period",
            )
        )
        assert good is not None and good.status == "active" and good.id == good_id
        assert bad is not None and bad.status == "archived"
        assert apply_report["archived_groups"] == 1
        assert alias_report["upgraded"] >= 1
        assert definition is not None
        assert "客户自定义别名" in definition.rules["aliases"]
        assert definition.rules["builtin_aliases_version"] == BUILTIN_ALIASES_VERSION

        plan = db.get(ProcurementPlan, plan_id)
        assert plan is not None
        assert ensure_default_document_groups(db, plan, user_id=actor_id, strategy=None) is False
        still = db.get(TenderDocumentGroup, bad_id)
        assert still is not None and still.status == "archived"
        active_codes = {
            item.code
            for item in db.scalars(
                select(TenderDocumentGroup).where(
                    TenderDocumentGroup.plan_id == plan_id,
                    TenderDocumentGroup.status == "active",
                )
            )
        }
        assert active_codes == {"P01"}
        db.commit()
    assert project_id


def test_merge_aliases_unit_keeps_custom() -> None:
    merged = merge_missing_aliases(
        {"aliases": ["客户自定义别名"], "extract_mode": "x"},
        "delivery_period",
        "交付周期",
    )
    assert "客户自定义别名" in merged["aliases"]
    assert merged["builtin_aliases_version"] == BUILTIN_ALIASES_VERSION
