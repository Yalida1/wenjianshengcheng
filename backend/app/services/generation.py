from __future__ import annotations

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import APIError
from ..models import (
    Document,
    DocumentBlock,
    DocumentContentBlock,
    DocumentSection,
    DocumentVersion,
    FieldSnapshot,
    FieldValue,
    FileVersion,
    GenerationEvent,
    GenerationJob,
    GenerationJobStep,
    Project,
    ProjectStage,
    Template,
    TemplateSection,
    TemplateVersion,
)
from .providers import (
    PENDING_MARKER,
    PROMPT_VERSION,
    SECTION_PLANS,
    DraftResponse,
    ProviderContext,
    SectionDraft,
    get_provider,
)
from .section_tree import SectionPlanItem, flatten_section_nodes, section_nodes_from_pairs
from .storage import get_storage
from .tender_document import TenderBlockSpec, tender_blocks_for_section, tender_notice_title

FORMAL_FIELD_STATUSES = {"user_confirmed", "system_authoritative", "template_default"}
DRAFT_CANDIDATE_STATUSES = {"extracted", "ai_suggested", "reference_only"}


def _template_section_plan(db: Session, template_version_id: str, stage: str) -> list[SectionPlanItem]:
    sections = list(
        db.scalars(
            select(TemplateSection)
            .where(TemplateSection.template_version_id == template_version_id)
            .order_by(TemplateSection.sequence)
        )
    )
    if not sections:
        return flatten_section_nodes(section_nodes_from_pairs(SECTION_PLANS[stage]))
    id_to_key = {section.id: section.key for section in sections}
    children_keys = {
        id_to_key[section.parent_id]
        for section in sections
        if section.parent_id and section.parent_id in id_to_key
    }
    return [
        SectionPlanItem(
            key=section.key,
            title=section.title,
            level=max(1, min(3, int(getattr(section, "level", 1) or 1))),
            parent_key=id_to_key.get(section.parent_id) if section.parent_id else None,
            sequence=section.sequence,
            has_children=section.key in children_keys,
        )
        for section in sections
    ]


def _expanded_section_keys(
    section_plan: list[SectionPlanItem],
    requested_keys: list[str] | None,
    *,
    include_descendants: bool = True,
) -> set[str]:
    all_keys = {item.key for item in section_plan}
    if requested_keys is None:
        return all_keys
    requested = set(requested_keys)
    unknown = sorted(requested - all_keys)
    if unknown:
        raise APIError(422, "generation_section_invalid", f"所选章节不存在：{', '.join(unknown)}")
    if not include_descendants:
        return requested
    selected = set(requested)
    changed = True
    while changed:
        changed = False
        for item in section_plan:
            if item.parent_key in selected and item.key not in selected:
                selected.add(item.key)
                changed = True
    return selected


def _draft_candidate_value(value: object) -> str:
    if isinstance(value, (dict, list)):
        rendered = json.dumps(value, ensure_ascii=False)
    else:
        rendered = str(value)
    return f"{PENDING_MARKER}{rendered}"


def field_values_by_key(
    fields: list[FieldValue], procurement_document_group_id: str | None = None
) -> dict[str, FieldValue]:
    """Resolve field values for a document group.

    Package-scoped keys never fall back to stage-shared unscoped values.
    Explicitly shared keys may fall back to unscoped stage candidates.
    """

    from ..field_catalog import PACKAGE_SCOPED_FIELD_KEYS, SHARED_FIELD_KEYS

    resolved: dict[str, FieldValue] = {}
    scoped_prefix = f"doc::{procurement_document_group_id}::" if procurement_document_group_id else None
    unscoped: dict[str, FieldValue] = {}
    for field in fields:
        if field.field_key.startswith("doc::"):
            continue
        unscoped[field.field_key] = field
    if scoped_prefix:
        for field in fields:
            if field.field_key.startswith(scoped_prefix):
                resolved[field.field_key.removeprefix(scoped_prefix)] = field
    for field_key, field in unscoped.items():
        if field_key in resolved:
            continue
        if field_key in PACKAGE_SCOPED_FIELD_KEYS:
            # No cross-package / stage fallback for scoped commercial fields.
            continue
        if procurement_document_group_id and field_key not in SHARED_FIELD_KEYS:
            # When resolving for a specific group, only shared keys fall back.
            continue
        resolved[field_key] = field
    if not procurement_document_group_id:
        resolved.update(unscoped)
    return resolved


def field_snapshot(
    fields: list[FieldValue],
    *,
    include_candidates: bool = False,
    procurement_document_group_id: str | None = None,
) -> tuple[str, dict[str, object]]:
    values: dict[str, object] = {}
    for field_key, field in field_values_by_key(fields, procurement_document_group_id).items():
        value = field.normalized_value if field.normalized_value is not None else field.value
        if value in (None, "", [], {}):
            continue
        if field.status in FORMAL_FIELD_STATUSES:
            values[field_key] = value
        elif include_candidates and field.status in DRAFT_CANDIDATE_STATUSES:
            values[field_key] = _draft_candidate_value(value)
    encoded = json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest(), values


def procurement_locked_values(
    values: dict[str, object], stage: str, procurement_snapshot: dict[str, object] | None
) -> tuple[str, dict[str, object]]:
    merged = dict(values)
    if procurement_snapshot:
        scope = procurement_snapshot.get("scope")
        if scope:
            merged["procurement_scope" if stage == "tender" else "contract_scope"] = scope
        if stage == "tender":
            confirmed_budget = procurement_snapshot.get("confirmed_budget")
            maximum_price = procurement_snapshot.get("maximum_price")
            if confirmed_budget is not None:
                merged["procurement_budget"] = confirmed_budget
            if maximum_price is not None:
                merged["maximum_price"] = maximum_price
    encoded = json.dumps(merged, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest(), merged


def _dict_value(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _list_value(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _source_context(db: Session, job: GenerationJob) -> list[str]:
    if job.source_kind != "uploaded_file" or not job.source_version_id:
        return []
    blocks = list(
        db.scalars(
            select(DocumentBlock)
            .where(DocumentBlock.file_version_id == job.source_version_id)
            .order_by(DocumentBlock.sequence)
        )
    )
    keywords = ("建设内容", "建设范围", "功能", "技术", "系统", "服务", "需求", "成果")
    forbidden_money = ("总投资", "建设投资", "预算", "最高限价", "合同金额", "资金")
    ranked: list[tuple[int, int, str]] = []
    for block in blocks:
        text = " ".join(block.text.split())
        if len(text) < 12 or any(marker in text for marker in forbidden_money):
            continue
        score = sum(1 for keyword in keywords if keyword in text)
        if score:
            ranked.append((-score, block.sequence, text[:500]))
    ranked.sort()
    return [text for _score, _sequence, text in ranked[:10]]


def document_version_sha256(db: Session, version: DocumentVersion) -> str:
    sections = list(
        db.scalars(
            select(DocumentSection)
            .where(DocumentSection.document_version_id == version.id)
            .order_by(DocumentSection.sequence)
        )
    )
    content: list[dict[str, object]] = []
    for section in sections:
        blocks = list(
            db.scalars(
                select(DocumentContentBlock)
                .where(DocumentContentBlock.document_section_id == section.id)
                .order_by(DocumentContentBlock.sequence)
            )
        )
        content.append(
            {
                "key": section.key,
                "title": section.title,
                "level": getattr(section, "level", 1),
                "parent_id": section.parent_id,
                "blocks": [block.content for block in blocks],
            }
        )
    encoded = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _locked_source(
    db: Session, project: Project, stage: str
) -> tuple[str | None, str | None, int | None, str | None]:
    stage_record = db.scalar(
        select(ProjectStage).where(ProjectStage.project_id == project.id, ProjectStage.stage == stage)
    )
    if stage_record is None or not stage_record.source_type:
        if stage == "requirement":
            return "structured_requirement", None, None, None
        raise APIError(422, "stage_source_missing", "下游阶段必须先选择上一阶段定稿或上传文件")
    if not stage_record.source_file_version_id:
        return stage_record.source_type, None, None, None
    if stage_record.source_type == "uploaded_file":
        file_version = db.get(FileVersion, stage_record.source_file_version_id)
        if file_version is None:
            raise APIError(422, "stage_source_missing", "锁定的上传文件版本不存在")
        return stage_record.source_type, file_version.id, file_version.version, file_version.sha256
    upstream_version = db.get(DocumentVersion, stage_record.source_file_version_id)
    if upstream_version is None or not upstream_version.immutable or upstream_version.status != "finalized":
        raise APIError(422, "stage_source_missing", "锁定的上游定稿版本不存在或已失效")
    return (
        stage_record.source_type,
        upstream_version.id,
        upstream_version.version,
        document_version_sha256(db, upstream_version),
    )


def build_generation_job(
    db: Session,
    *,
    project: Project,
    stage: str,
    template: Template,
    template_version: int,
    idempotency_key: str,
    user_id: str,
    include_candidates: bool = False,
    selected_section_keys: list[str] | None = None,
    include_descendants: bool = True,
    procurement_plan_id: str | None = None,
    procurement_document_group_id: str | None = None,
    procurement_batch_id: str | None = None,
    procurement_snapshot: dict[str, object] | None = None,
    template_applicability_confirmed: bool = False,
) -> GenerationJob:
    existing = db.scalar(select(GenerationJob).where(GenerationJob.idempotency_key == idempotency_key))
    if existing:
        if (
            existing.project_id != project.id
            or existing.stage != stage
            or existing.procurement_plan_id != procurement_plan_id
            or existing.procurement_document_group_id != procurement_document_group_id
        ):
            raise APIError(409, "idempotency_conflict", "幂等键已用于其他生成请求")
        return existing
    fields = list(
        db.scalars(
            select(FieldValue).where(
                FieldValue.project_id == project.id,
                FieldValue.stage == stage,
                FieldValue.is_current.is_(True),
            )
        )
    )
    snapshot_sha256, snapshot_values = field_snapshot(
        fields,
        include_candidates=include_candidates,
        procurement_document_group_id=procurement_document_group_id,
    )
    snapshot_sha256, snapshot_values = procurement_locked_values(snapshot_values, stage, procurement_snapshot)
    snapshot = FieldSnapshot(
        organization_id=project.organization_id,
        project_id=project.id,
        stage=stage,
        sha256=snapshot_sha256,
        values_json=snapshot_values,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(snapshot)
    db.flush()
    source_kind, source_version_id, source_version, source_sha256 = _locked_source(db, project, stage)
    locked_template = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == template.id,
            TemplateVersion.version == template_version,
            TemplateVersion.status == "published",
        )
    )
    if locked_template is None or not locked_template.storage_key:
        raise APIError(422, "template_source_missing", "模板没有可用的 DOCX 正式源")
    section_plan = _template_section_plan(db, locked_template.id, stage)
    selected_keys = _expanded_section_keys(
        section_plan, selected_section_keys, include_descendants=include_descendants
    )
    template_content = get_storage().get(locked_template.storage_key)
    template_sha256 = hashlib.sha256(template_content).hexdigest()
    if locked_template.sha256 and locked_template.sha256 != template_sha256:
        raise APIError(409, "template_integrity_error", "模板源文件 SHA-256 与锁定值不一致")
    provider = get_provider()
    job = GenerationJob(
        organization_id=project.organization_id,
        project_id=project.id,
        stage=stage,
        status="queued",
        idempotency_key=idempotency_key,
        field_snapshot_id=snapshot.id,
        source_kind=source_kind,
        source_version_id=source_version_id,
        source_file_version=source_version,
        source_sha256=source_sha256,
        template_id=template.id,
        template_version=template_version,
        template_sha256=template_sha256,
        prompt_version=PROMPT_VERSION,
        generation_provider=provider.name,
        generation_model=provider.model,
        procurement_plan_id=procurement_plan_id,
        procurement_document_group_id=procurement_document_group_id,
        procurement_batch_id=procurement_batch_id,
        procurement_snapshot=procurement_snapshot,
        template_applicability_confirmed=template_applicability_confirmed,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(job)
    db.flush()
    db.add(
        GenerationEvent(
            organization_id=project.organization_id,
            generation_job_id=job.id,
            sequence=1,
            event_type="queued",
            payload={
                "field_snapshot_sha256": snapshot_sha256,
                "selected_section_keys": [item.key for item in section_plan if item.key in selected_keys],
            },
            created_by=user_id,
            updated_by=user_id,
        )
    )
    for sequence, item in enumerate(section_plan, 1):
        db.add(
            GenerationJobStep(
                organization_id=project.organization_id,
                generation_job_id=job.id,
                step_key=item.key,
                sequence=sequence,
                status="pending" if item.key in selected_keys else "skipped",
                created_by=user_id,
                updated_by=user_id,
            )
        )
    return job


def execute_generation_job(db: Session, job_id: str) -> DocumentVersion:
    job = db.get(GenerationJob, job_id)
    if job is None:
        raise ValueError("Generation job not found")
    if job.status == "succeeded":
        candidates = db.scalars(
            select(DocumentVersion).where(DocumentVersion.organization_id == job.organization_id)
        )
        for existing in candidates:
            if existing.provenance.get("generation_job_id") == job.id:
                return existing
    if job.cancelled_at is not None:
        job.status = "cancelled"
        raise RuntimeError("Generation job was cancelled")
    project = db.get(Project, job.project_id)
    if project is None:
        raise ValueError("Project not found")
    fields = list(
        db.scalars(
            select(FieldValue).where(
                FieldValue.project_id == project.id,
                FieldValue.stage == job.stage,
                FieldValue.is_current.is_(True),
            )
        )
    )
    snapshot = db.get(FieldSnapshot, job.field_snapshot_id)
    formal_sha256, formal_values = field_snapshot(
        fields, procurement_document_group_id=job.procurement_document_group_id
    )
    candidate_sha256, candidate_values = field_snapshot(
        fields,
        include_candidates=True,
        procurement_document_group_id=job.procurement_document_group_id,
    )
    formal_sha256, formal_values = procurement_locked_values(
        formal_values, job.stage, job.procurement_snapshot
    )
    candidate_sha256, candidate_values = procurement_locked_values(
        candidate_values, job.stage, job.procurement_snapshot
    )
    if snapshot is None:
        job.status = "stale"
        raise RuntimeError("Field snapshot no longer exists")
    if snapshot.sha256 == formal_sha256:
        snapshot_sha256, values, snapshot_mode = formal_sha256, formal_values, "formal"
    elif snapshot.sha256 == candidate_sha256:
        snapshot_sha256, values, snapshot_mode = (
            candidate_sha256,
            candidate_values,
            "candidate_draft",
        )
    else:
        job.status = "stale"
        raise RuntimeError("Field snapshot changed after job creation")
    project_stage = db.scalar(
        select(ProjectStage).where(
            ProjectStage.project_id == project.id,
            ProjectStage.stage == job.stage,
        )
    )
    current_source_kind = (
        project_stage.source_type
        if project_stage and project_stage.source_type
        else ("structured_requirement" if job.stage == "requirement" else None)
    )
    if project_stage is None or current_source_kind != job.source_kind:
        job.status = "stale"
        raise RuntimeError("Stage source changed after job creation")
    if job.source_version_id:
        if job.source_kind == "uploaded_file":
            source_version = db.get(FileVersion, job.source_version_id)
            current_source_sha = source_version.sha256 if source_version else None
        else:
            upstream_version = db.get(DocumentVersion, job.source_version_id)
            current_source_sha = document_version_sha256(db, upstream_version) if upstream_version else None
        if current_source_sha != job.source_sha256:
            job.status = "stale"
            raise RuntimeError("Locked source changed after job creation")
    locked_template = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.template_id == job.template_id,
            TemplateVersion.version == job.template_version,
        )
    )
    if locked_template is None or not locked_template.storage_key:
        job.status = "failed"
        raise RuntimeError("Locked template source is missing")
    section_plan = _template_section_plan(db, locked_template.id, job.stage)
    template_record = db.get(Template, job.template_id)
    if template_record is None:
        job.status = "failed"
        raise RuntimeError("Locked template metadata is missing")
    template_sections = {
        item.key: item
        for item in db.scalars(
            select(TemplateSection).where(TemplateSection.template_version_id == locked_template.id)
        )
    }
    steps = {
        step.step_key: step
        for step in db.scalars(select(GenerationJobStep).where(GenerationJobStep.generation_job_id == job.id))
    }
    selected_keys = {
        item.key
        for item in section_plan
        if steps.get(item.key) is not None and steps[item.key].status != "skipped"
    }
    if not selected_keys:
        job.status = "failed"
        raise RuntimeError("Generation job has no selected sections")
    generation_plan = [item for item in section_plan if item.key in selected_keys]
    current_template_sha = hashlib.sha256(get_storage().get(locked_template.storage_key)).hexdigest()
    if current_template_sha != job.template_sha256:
        job.status = "stale"
        raise RuntimeError("Locked template changed after job creation")
    job.status = "running"
    job.attempt += 1
    for step_key in selected_keys:
        step = steps.get(step_key)
        if step is None:
            continue
        cached_draft = (step.output or {}).get("section_draft") if step.status == "succeeded" else None
        if step.status == "succeeded" and isinstance(cached_draft, dict):
            continue
        step.status = "pending"
        step.error = None
    db.add(
        GenerationEvent(
            organization_id=project.organization_id,
            generation_job_id=job.id,
            sequence=2,
            event_type="running",
            payload={"attempt": job.attempt, "selected_section_count": len(selected_keys)},
            created_by=job.created_by,
            updated_by=job.updated_by,
        )
    )
    # Commit before the first LLM call so polling clients see running/pending steps.
    db.commit()
    provider = get_provider()
    procurement_snapshot = job.procurement_snapshot or {}
    procurement_group = _dict_value(procurement_snapshot.get("document_group"))
    procurement_packages = [_dict_value(item) for item in _list_value(procurement_snapshot.get("packages"))]
    procurement_evidence_ids = [str(item) for item in _list_value(procurement_snapshot.get("evidence_ids"))]
    source_context = (
        [
            str(procurement_snapshot.get("scope", "")),
            str(procurement_group.get("rationale", "")),
        ]
        if job.procurement_snapshot
        else _source_context(db, job)
    )
    document_outline = [
        {
            "key": item.key,
            "title": item.title,
            "level": item.level,
            "parent_key": item.parent_key,
            "has_children": item.has_children,
        }
        for item in section_plan
    ]
    draft_sections: list[SectionDraft] = []
    for item in generation_plan:
        step = steps.get(item.key)
        if step is None:
            raise RuntimeError(f"Generation step missing for section '{item.key}'")
        cached = (step.output or {}).get("section_draft") if step.status == "succeeded" else None
        if isinstance(cached, dict):
            try:
                draft_sections.append(SectionDraft.model_validate(cached))
                continue
            except (TypeError, ValueError):
                step.status = "pending"
                step.error = None
        step.status = "running"
        step.error = None
        db.commit()
        partial = provider.generate(
            ProviderContext(
                stage=job.stage,
                project_name=project.name,
                fields=values,
                section_plan=[item],
                source_context=source_context,
                document_outline=document_outline,
            )
        )
        section_draft = next((section for section in partial.sections if section.key == item.key), None)
        if section_draft is None and len(partial.sections) == 1:
            section_draft = partial.sections[0]
        if section_draft is None:
            step.status = "failed"
            step.error = f"Provider did not return section '{item.key}'"
            job.status = "failed"
            job.error = step.error
            db.commit()
            raise RuntimeError(step.error)
        section_draft = section_draft.model_copy(
            update={
                "key": item.key,
                "title": item.title,
                "level": item.level,
                "parent_key": item.parent_key,
            }
        )
        draft_sections.append(section_draft)
        step.status = "succeeded"
        step.output = {
            "section_draft": section_draft.model_dump(),
            "generated": True,
        }
        step.error = None
        db.commit()
    draft = DraftResponse(sections=draft_sections)
    draft_by_key = {section.key: section for section in draft.sections if section.key in selected_keys}
    missing_drafts = sorted(selected_keys - set(draft_by_key))
    if missing_drafts:
        job.status = "failed"
        raise RuntimeError(f"Provider did not return selected sections: {', '.join(missing_drafts)}")
    candidate_documents = list(
        db.scalars(select(Document).where(Document.project_id == project.id, Document.stage == job.stage))
    )
    snapshot_package_ids = sorted(str(item) for item in _list_value(procurement_snapshot.get("package_ids")))
    document = next(
        (
            item
            for item in candidate_documents
            if item.procurement_document_group_id == job.procurement_document_group_id
            and sorted(item.procurement_package_ids or []) == snapshot_package_ids
        ),
        None,
    )
    contract_package_names = "、".join(str(item.get("name")) for item in procurement_packages)
    document_title = (
        str(procurement_group.get("name"))
        if job.stage == "tender" and job.procurement_snapshot
        else (
            f"{project.name}{contract_package_names}合同草稿"
            if job.stage == "contract" and job.procurement_snapshot
            else f"{project.name} {stage_label(job.stage)}"
        )
    )
    if document is None:
        document = Document(
            organization_id=project.organization_id,
            project_id=project.id,
            stage=job.stage,
            title=document_title,
            status="draft",
            current_version=1,
            procurement_plan_id=job.procurement_plan_id,
            procurement_document_group_id=job.procurement_document_group_id,
            procurement_package_ids=snapshot_package_ids,
            created_by=job.created_by,
            updated_by=job.updated_by,
        )
        db.add(document)
        db.flush()
        version_number = 1
        parent_id = None
        parent_blocks_by_key: dict[str, list[DocumentContentBlock]] = {}
    else:
        version_number = document.current_version + 1
        parent = db.scalar(
            select(DocumentVersion).where(
                DocumentVersion.document_id == document.id,
                DocumentVersion.version == document.current_version,
            )
        )
        parent_id = parent.id if parent else None
        parent_blocks_by_key = {}
        if parent is not None:
            parent_sections = list(
                db.scalars(
                    select(DocumentSection)
                    .where(DocumentSection.document_version_id == parent.id)
                    .order_by(DocumentSection.sequence)
                )
            )
            for parent_section in parent_sections:
                parent_blocks_by_key[parent_section.key] = list(
                    db.scalars(
                        select(DocumentContentBlock)
                        .where(DocumentContentBlock.document_section_id == parent_section.id)
                        .order_by(DocumentContentBlock.sequence)
                    )
                )
        document.current_version = version_number
    version = DocumentVersion(
        organization_id=project.organization_id,
        document_id=document.id,
        version=version_number,
        status="draft",
        immutable=False,
        parent_version_id=parent_id,
        provenance={
            "generation_job_id": job.id,
            "field_snapshot_id": snapshot.id,
            "field_snapshot_sha256": snapshot_sha256,
            "field_snapshot_mode": snapshot_mode,
            "source_kind": job.source_kind,
            "source_version_id": job.source_version_id,
            "source_version": job.source_file_version,
            "source_sha256": job.source_sha256,
            "template_id": job.template_id,
            "template_version": job.template_version,
            "template_sha256": job.template_sha256,
            "template_name": template_record.name,
            "template_source_kind": template_record.source_kind,
            "template_issuing_authority": template_record.issuing_authority,
            "template_document_number": template_record.document_number,
            "template_applicability": template_record.applicability,
            "template_strict_compliance": bool(
                template_record.source_kind in {"national_official_text", "other_official_template"}
                and locked_template.format_profile.get("standard") == "customer_template"
            ),
            "template_applicability_confirmed": job.template_applicability_confirmed,
            "format_profile": locked_template.format_profile,
            "prompt_version": job.prompt_version,
            "generation_provider": job.generation_provider,
            "generation_model": job.generation_model,
            "selected_section_keys": [item.key for item in section_plan if item.key in selected_keys],
            "outline_complete": True,
            "procurement_plan_id": job.procurement_plan_id,
            "procurement_document_group_id": job.procurement_document_group_id,
            "procurement_package_ids": snapshot_package_ids,
            "procurement_snapshot": job.procurement_snapshot,
        },
        created_by=job.created_by,
        updated_by=job.updated_by,
    )
    db.add(version)
    db.flush()
    key_to_section_id: dict[str, str] = {}
    retained_keys: list[str] = []
    for sequence, plan_item in enumerate(section_plan, 1):
        section_draft = draft_by_key.get(plan_item.key)
        parent_key = section_draft.parent_key if section_draft else plan_item.parent_key
        if parent_key is None:
            parent_key = plan_item.parent_key
        section_title = section_draft.title if section_draft else plan_item.title
        if job.stage == "tender" and plan_item.key in {"announcement", "procurement_announcement"}:
            section_title = tender_notice_title(values.get("tender_method"))
            if plan_item.key == "procurement_announcement" and section_title == "招标公告":
                section_title = "采购公告"
        section = DocumentSection(
            organization_id=project.organization_id,
            document_version_id=version.id,
            sequence=sequence,
            key=plan_item.key,
            title=section_title,
            parent_id=key_to_section_id.get(parent_key) if parent_key else None,
            level=max(
                1,
                min(3, int(section_draft.level if section_draft else plan_item.level)),
            ),
            created_by=job.created_by,
            updated_by=job.updated_by,
        )
        db.add(section)
        db.flush()
        key_to_section_id[section.key] = section.id
        if section_draft is not None:
            template_section = template_sections.get(plan_item.key)
            block_specs: list[TenderBlockSpec]
            if (
                template_section is not None
                and template_section.section_type == "fixed_template"
                and template_section.content
            ):
                block_specs = [
                    TenderBlockSpec(
                        block_type="fixed_template",
                        content={"text": template_section.content},
                        source_kind="fixed_template",
                        reviewed=True,
                    )
                ]
            elif job.stage == "tender":
                block_specs = tender_blocks_for_section(
                    plan_item.key,
                    values,
                    source_context=(
                        [
                            str(procurement_snapshot.get("scope", "")),
                            str(procurement_group.get("rationale", "")),
                        ]
                        if job.procurement_snapshot
                        else _source_context(db, job)
                    ),
                )
            else:
                block_specs = [
                    TenderBlockSpec(
                        block_type="paragraph",
                        content={"text": paragraph},
                        source_kind="ai_generated",
                        field_refs=tuple(section_draft.field_refs),
                    )
                    for paragraph in section_draft.paragraphs
                ]
            for block_sequence, block_spec in enumerate(block_specs, 1):
                db.add(
                    DocumentContentBlock(
                        organization_id=project.organization_id,
                        document_section_id=section.id,
                        sequence=block_sequence,
                        block_type=block_spec.block_type,
                        content=block_spec.content,
                        source_kind=block_spec.source_kind,
                        field_refs=list(block_spec.field_refs),
                        evidence_refs=procurement_evidence_ids,
                        reviewed=block_spec.reviewed,
                        created_by=job.created_by,
                        updated_by=job.updated_by,
                    )
                )
        else:
            previous_blocks = parent_blocks_by_key.get(plan_item.key, [])
            if previous_blocks:
                retained_keys.append(plan_item.key)
            for previous in previous_blocks:
                db.add(
                    DocumentContentBlock(
                        organization_id=project.organization_id,
                        document_section_id=section.id,
                        sequence=previous.sequence,
                        block_type=previous.block_type,
                        content=previous.content,
                        source_kind=previous.source_kind,
                        field_refs=previous.field_refs,
                        evidence_refs=previous.evidence_refs,
                        reviewed=previous.reviewed,
                        created_by=job.created_by,
                        updated_by=job.updated_by,
                    )
                )
        step = steps.get(plan_item.key)
        if step is not None:
            if section_draft is not None:
                step.status = "succeeded"
            step.output = {
                "document_section_id": section.id,
                "generated": section_draft is not None,
                "retained": plan_item.key in retained_keys,
            }
    job.status = "succeeded"
    db.add(
        GenerationEvent(
            organization_id=project.organization_id,
            generation_job_id=job.id,
            sequence=3,
            event_type="succeeded",
            payload={
                "document_version_id": version.id,
                "generated_section_keys": [item.key for item in section_plan if item.key in selected_keys],
                "retained_section_keys": retained_keys,
            },
            created_by=job.created_by,
            updated_by=job.updated_by,
        )
    )
    return version


def stage_label(stage: str) -> str:
    return {
        "requirement": "项目建议书",
        "feasibility": "可行性研究报告",
        "tender": "招标文件",
        "contract": "合同",
    }[stage]
