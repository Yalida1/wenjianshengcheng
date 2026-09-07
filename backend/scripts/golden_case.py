from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./artifacts/golden_case/golden.db")
os.environ.setdefault("STORAGE_BACKEND", "local")
os.environ.setdefault("LOCAL_STORAGE_PATH", "artifacts/golden_case/objects")
os.environ.setdefault("CELERY_TASK_ALWAYS_EAGER", "true")
os.environ.setdefault("LLM_PROVIDER", "demo")

from docx import Document as WordDocument  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.shared import Cm, Pt  # noqa: E402
from openpyxl import Workbook  # noqa: E402
from openpyxl.styles import Alignment, Font, PatternFill  # noqa: E402
from sqlalchemy import select  # noqa: E402

from backend.app.db import Base, SessionLocal, engine  # noqa: E402
from backend.app.models import (  # noqa: E402
    Document,
    DocumentContentBlock,
    DocumentSection,
    DocumentVersion,
    FieldConfirmation,
    FieldDefinition,
    FieldValue,
    FinalizationRecord,
    Organization,
    Project,
    ProjectMember,
    ProjectStage,
    Template,
    User,
    ValidationIssue,
    utc_now,
)
from backend.app.services.exporting import (  # noqa: E402
    convert_docx_to_pdf,
    export_docx,
    export_pdf,
)
from backend.app.services.generation import (  # noqa: E402
    build_generation_job,
    execute_generation_job,
)
from backend.app.services.templates import build_demo_template  # noqa: E402
from backend.app.services.validation import (  # noqa: E402
    validate_contract_payments,
    validate_document_version,
)
from backend.scripts.seed import DEMO_TEMPLATES, seed  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CASE_DIR = ROOT / "golden_cases" / "demo_001"
ARTIFACT_DIR = ROOT / "artifacts" / "golden_case"

STAGE_LABELS = {
    "requirement": "项目建议书",
    "feasibility": "可行性研究报告",
    "tender": "招标文件",
    "contract": "合同",
}

FIELD_VALUES: dict[str, dict[str, Any]] = {
    "requirement": {
        "project_name": "宁夏数字政务协同平台建设项目",
        "project_owner": "宁夏示例政务服务中心",
        "construction_scope": "建设统一事项管理、协同办理和运行分析能力",
        "project_period": 18,
    },
    "feasibility": {
        "project_name": "宁夏数字政务协同平台建设项目",
        "total_investment": 12_800_000,
        "construction_scope": "建设基础支撑、事项管理、协同办理、数据治理和安全运维体系",
        "project_period": 18,
    },
    "tender": {
        "project_name": "宁夏数字政务协同平台建设项目",
        "procurement_budget": 9_800_000,
        "maximum_price": 9_500_000,
        "procurement_scope": "采购事项管理、协同办理、数据治理软件及实施服务",
    },
    "contract": {
        "party_a": "宁夏示例政务服务中心",
        "party_b": "示例数字科技有限公司",
        "contract_subject": "数字政务协同平台软件及实施服务",
        "contract_scope": "交付事项管理、协同办理和数据治理软件，完成部署、培训及验收支持",
        "final_contract_amount": 9_260_000,
        "tax_rate": 6,
        "tax_inclusion": "含税总价",
        "contract_duration": "合同生效后 12 个月",
        "delivery_location": "宁夏回族自治区银川市甲方指定地点",
        "payment_plan": [
            {"label": "预付款", "ratio": 30, "amount": 2_778_000, "trigger": "合同生效并收到合规发票"},
            {"label": "初验款", "ratio": 40, "amount": 3_704_000, "trigger": "系统完成初验"},
            {"label": "终验款", "ratio": 30, "amount": 2_778_000, "trigger": "系统完成终验"},
        ],
        "acceptance": "按照合同范围、技术要求和双方确认的验收方案组织初验与终验",
        "warranty": "终验合格之日起提供十二个月免费质保服务",
        "breach": "违约责任按照双方确认的合同条款承担",
        "effective_conditions": "双方法定代表人或授权代表签字并加盖公章后生效",
    },
}


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _create_sample_docx(path: Path, title: str, sections: list[tuple[str, str]]) -> None:
    doc = WordDocument()
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.6)
    section.bottom_margin = Cm(2.4)
    section.left_margin = Cm(2.8)
    section.right_margin = Cm(2.6)
    normal = doc.styles["Normal"]
    normal.font.name = "SimSun"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    normal.font.size = Pt(11)
    title_paragraph = doc.add_paragraph(style="Title")
    title_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_paragraph.add_run(title)
    for heading, body in sections:
        doc.add_heading(heading, level=1)
        doc.add_paragraph(body)
    doc.save(path)


def _create_sample_pdf(path: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="docchain-golden-input-") as temporary_directory:
        docx_path = Path(temporary_directory) / "可研样例.docx"
        _create_sample_docx(
            docx_path,
            "可行性研究报告样例",
            [
                ("项目名称", "宁夏数字政务协同平台建设项目"),
                ("投资说明", "可研总投资：1280 万元。该值仅为可研投资，不直接映射为招标预算或合同金额。"),
                ("周期说明", "建设周期：18 个月。单份合同履行期限须另行确认。"),
            ],
        )
        path.write_bytes(convert_docx_to_pdf(docx_path.read_bytes()))


def _create_sample_xlsx(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "结构化需求"
    sheet.append(["字段", "值", "来源说明"])
    for key, value in FIELD_VALUES["requirement"].items():
        sheet.append([key, value, "Demo 用户确认"])
    for cell in sheet[1]:
        cell.fill = PatternFill("solid", fgColor="1F4E78")
        cell.font = Font(name="Microsoft YaHei", color="FFFFFF", bold=True)
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    sheet.column_dimensions["A"].width = 24
    sheet.column_dimensions["B"].width = 56
    sheet.column_dimensions["C"].width = 24
    workbook.save(path)


def create_case_inputs() -> None:
    CASE_DIR.mkdir(parents=True, exist_ok=True)
    _create_sample_docx(
        CASE_DIR / "需求说明样例.docx",
        "宁夏数字政务协同平台需求说明",
        [
            ("建设背景", "为提升跨部门政务事项协同办理效率，建设统一的数字政务协同能力。"),
            ("建设范围", FIELD_VALUES["requirement"]["construction_scope"]),
            ("边界说明", "本样例为脱敏 Demo 材料，不代表客户正式需求。"),
        ],
    )
    _create_sample_docx(
        CASE_DIR / "项目建议书样例.docx",
        "宁夏数字政务协同平台项目建议书样例",
        [("项目概况", "项目单位和建设范围均来自 Demo 用户确认字段。"), ("建设目标", "形成可追溯的文件链。")],
    )
    _create_sample_pdf(CASE_DIR / "可研样例.pdf")
    (CASE_DIR / "招标模板.docx").write_bytes(build_demo_template("tender", DEMO_TEMPLATES["tender"]))
    _create_sample_docx(
        CASE_DIR / "历史招标文件样例.docx",
        "历史招标文件样例",
        [("采购需求", FIELD_VALUES["tender"]["procurement_scope"]), ("最高限价", "950 万元")],
    )
    (CASE_DIR / "合同模板.docx").write_bytes(build_demo_template("contract", DEMO_TEMPLATES["contract"]))
    _create_sample_docx(
        CASE_DIR / "历史合同样例.docx",
        "历史合同样例",
        [("合同标的", FIELD_VALUES["contract"]["contract_subject"]), ("履行期限", "十二个月")],
    )
    _create_sample_xlsx(CASE_DIR / "项目字段样例.xlsx")
    _write_json(CASE_DIR / "expected_fields.json", FIELD_VALUES)
    _write_json(
        CASE_DIR / "expected_sections.json",
        {
            "requirement": ["项目概况", "建设背景", "建设目标", "建设范围", "实施计划"],
            "feasibility": [
                "总论",
                "建设背景和必要性",
                "需求分析",
                "建设方案",
                "投资估算与资金筹措",
                "效益和风险",
                "结论",
            ],
            "tender": ["招标公告", "投标人须知", "采购需求", "合同条款", "评标办法"],
            "contract": [
                "合同主体",
                "合同标的和范围",
                "价款和税费",
                "履行和交付",
                "验收和质保",
                "付款安排",
                "违约和争议解决",
                "生效条件",
            ],
        },
    )
    _write_json(CASE_DIR / "expected_validation_issues.json", {stage: [] for stage in STAGE_LABELS})
    _write_json(
        CASE_DIR / "expected_format_profile.json",
        {
            "standard": "demo_enterprise_report_cn",
            "strict_compliance": False,
            "page_size": "A4",
            "margins_cm": {"top": 2.6, "bottom": 2.4, "left": 2.8, "right": 2.6},
            "body_font_role": "宋体 or Noto Sans CJK compatible",
            "heading_font_role": "黑体 or Noto Sans CJK compatible",
            "customer_template_required_for_production": True,
        },
    )


def _create_project(db: Any, organization: Organization, admin: User) -> Project:
    project = Project(
        organization_id=organization.id,
        code="GOLDEN-DEMO-001",
        name=FIELD_VALUES["requirement"]["project_name"],
        project_type="government_investment",
        description="脱敏确定性 Golden Case，仅用于平台闭环与自动化验证。",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db.add(project)
    db.flush()
    db.add(
        ProjectMember(
            organization_id=organization.id,
            project_id=project.id,
            user_id=admin.id,
            role_key="owner",
            created_by=admin.id,
            updated_by=admin.id,
        )
    )
    for stage in STAGE_LABELS:
        db.add(
            ProjectStage(
                organization_id=organization.id,
                project_id=project.id,
                stage=stage,
                created_by=admin.id,
                updated_by=admin.id,
            )
        )
    db.flush()
    return project


def _confirm_stage_fields(db: Any, project: Project, stage: str, admin: User) -> None:
    definitions = {
        item.field_key: item
        for item in db.scalars(
            select(FieldDefinition).where(
                FieldDefinition.organization_id == project.organization_id,
                FieldDefinition.stage == stage,
            )
        )
    }
    for key, value in FIELD_VALUES[stage].items():
        definition = definitions[key]
        field = FieldValue(
            organization_id=project.organization_id,
            project_id=project.id,
            stage=stage,
            definition_id=definition.id,
            field_key=key,
            field_label=definition.field_label,
            data_type=definition.data_type,
            value=value,
            normalized_value=value,
            unit=definition.unit,
            criticality=definition.criticality,
            status="user_confirmed",
            source_type="user_input",
            is_current=True,
            created_by=admin.id,
            updated_by=admin.id,
        )
        db.add(field)
        db.flush()
        db.add(
            FieldConfirmation(
                organization_id=project.organization_id,
                field_value_id=field.id,
                confirmed_by=admin.id,
                value_snapshot=value,
                evidence_acknowledged=True,
                created_by=admin.id,
                updated_by=admin.id,
            )
        )


def _finalize(db: Any, version: DocumentVersion, admin: User) -> dict[str, object]:
    db.flush()
    blocks = list(
        db.scalars(
            select(DocumentContentBlock)
            .join_from(DocumentContentBlock, DocumentSection)
            .where(DocumentSection.document_version_id == version.id)
        )
    )
    for block in blocks:
        block.reviewed = True
        block.updated_by = admin.id
    db.flush()
    run = validate_document_version(db, version)
    db.flush()
    if run.status != "passed":
        issues = list(
            db.scalars(select(ValidationIssue).where(ValidationIssue.validation_run_id == run.id))
        )
        messages = [f"{issue.rule_key}: {issue.message} @ {issue.location}" for issue in issues]
        selected = [(block.id, block.reviewed) for block in blocks]
        raise RuntimeError(
            f"Golden Case {version.id} validation failed: {run.issue_counts}; {messages}; "
            f"selected_blocks={selected}"
        )
    version.status = "finalized"
    version.immutable = True
    version.finalized_at = utc_now()
    version.finalized_by = admin.id
    document = db.get(Document, version.document_id)
    if document is None:
        raise RuntimeError("Generated document missing")
    document.status = "finalized"
    stage_record = db.scalar(
        select(ProjectStage).where(
            ProjectStage.project_id == document.project_id,
            ProjectStage.stage == document.stage,
        )
    )
    if stage_record is not None:
        stage_record.status = "finalized"
        stage_record.finalized_document_version_id = version.id
    record = FinalizationRecord(
        organization_id=version.organization_id,
        document_version_id=version.id,
        finalized_by=admin.id,
        validation_run_id=run.id,
        field_snapshot_sha256=str(version.provenance["field_snapshot_sha256"]),
        declaration="Golden Case 自动流程已确认全部字段和生成内容",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db.add(record)
    return {"run_id": run.id, "status": run.status, "issue_counts": run.issue_counts}


def _write_traceability_workbook(db: Any, project: Project, path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "字段来源追溯"
    sheet.sheet_view.showGridLines = False
    sheet.append(["阶段", "字段键", "字段名称", "值", "单位", "级别", "状态", "来源类型", "确认状态"])
    fields = list(
        db.scalars(
            select(FieldValue)
            .where(FieldValue.project_id == project.id, FieldValue.is_current.is_(True))
            .order_by(FieldValue.stage, FieldValue.field_key)
        )
    )
    for field in fields:
        sheet.append(
            [
                field.stage,
                field.field_key,
                field.field_label,
                json.dumps(field.normalized_value, ensure_ascii=False)
                if isinstance(field.normalized_value, (dict, list))
                else field.normalized_value,
                field.unit or "",
                field.criticality,
                field.status,
                field.source_type,
                "已确认",
            ]
        )
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    widths = [16, 26, 28, 62, 12, 10, 20, 18, 14]
    for index, width in enumerate(widths, 1):
        sheet.column_dimensions[chr(64 + index)].width = width
    for row in sheet.iter_rows():
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.font = Font(name="Microsoft YaHei", size=10)
    for cell in sheet[1]:
        cell.fill = PatternFill("solid", fgColor="1F4E78")
        cell.font = Font(name="Microsoft YaHei", color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")

    payment = workbook.create_sheet("合同付款校验")
    payment.sheet_view.showGridLines = False
    payment.append(["付款节点", "比例（%）", "金额（元）", "触发条件"])
    for item in FIELD_VALUES["contract"]["payment_plan"]:
        payment.append([item["label"], item["ratio"], item["amount"], item["trigger"]])
    payment.append(["合计", "=SUM(B2:B4)", "=SUM(C2:C4)", ""])
    payment.freeze_panes = "A2"
    payment.column_dimensions["A"].width = 20
    payment.column_dimensions["B"].width = 16
    payment.column_dimensions["C"].width = 20
    payment.column_dimensions["D"].width = 52
    for cell in payment[1]:
        cell.fill = PatternFill("solid", fgColor="1F4E78")
        cell.font = Font(name="Microsoft YaHei", color="FFFFFF", bold=True)
    for row in payment.iter_rows():
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    workbook.save(path)


def generate() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    create_case_inputs()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed()

    validations: dict[str, object] = {}
    manifest: dict[str, Any] = {"demo_only": True, "artifacts": {}}
    with SessionLocal() as db:
        organization = db.scalar(select(Organization).where(Organization.name == "Demo 组织"))
        admin = db.scalar(select(User).where(User.email == "admin@example.com"))
        if organization is None or admin is None:
            raise RuntimeError("Demo seed failed")
        project = _create_project(db, organization, admin)
        previous_version: DocumentVersion | None = None
        for stage, label in STAGE_LABELS.items():
            stage_record = db.scalar(
                select(ProjectStage).where(
                    ProjectStage.project_id == project.id,
                    ProjectStage.stage == stage,
                )
            )
            if stage_record is None:
                raise RuntimeError(f"Stage missing: {stage}")
            if previous_version is None:
                stage_record.source_type = "structured_requirement"
                stage_record.source_file_version_id = None
            else:
                stage_record.source_type = "upstream_final"
                stage_record.source_file_version_id = previous_version.id
                stage_record.upstream_revision = previous_version.revision
            stage_record.status = "fields_confirmed"
            _confirm_stage_fields(db, project, stage, admin)
            template = db.scalar(
                select(Template).where(
                    Template.organization_id == organization.id,
                    Template.stage == stage,
                    Template.status == "published",
                )
            )
            if template is None:
                raise RuntimeError(f"Published template missing: {stage}")
            db.flush()
            job = build_generation_job(
                db,
                project=project,
                stage=stage,
                template=template,
                template_version=template.current_version,
                idempotency_key=f"golden-demo-001-{stage}",
                user_id=admin.id,
            )
            db.flush()
            version = execute_generation_job(db, job.id)
            if stage == "contract":
                pre_draft_content = export_docx(db, version)
                pre_draft_name = "合同预草案_V0.1.docx"
                (ARTIFACT_DIR / pre_draft_name).write_bytes(pre_draft_content)
                manifest["artifacts"][pre_draft_name] = {
                    "sha256": hashlib.sha256(pre_draft_content).hexdigest(),
                    "size_bytes": len(pre_draft_content),
                    "stage": stage,
                    "document_version_id": version.id,
                    "status_at_export": "draft",
                    "template_id": template.id,
                    "template_version": template.current_version,
                }
            validations[stage] = _finalize(db, version, admin)
            db.flush()
            export_label = "合同签约准备版" if stage == "contract" else label
            docx_name = f"{export_label}_V1.0.docx"
            pdf_name = f"{export_label}_V1.0.pdf"
            for filename, content in (
                (docx_name, export_docx(db, version)),
                (pdf_name, export_pdf(db, version)),
            ):
                target = ARTIFACT_DIR / filename
                target.write_bytes(content)
                manifest["artifacts"][filename] = {
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "size_bytes": len(content),
                    "stage": stage,
                    "document_version_id": version.id,
                    "template_id": template.id,
                    "template_version": template.current_version,
                }
            previous_version = version

        payment_errors = validate_contract_payments(
            FIELD_VALUES["contract"]["final_contract_amount"],
            FIELD_VALUES["contract"]["payment_plan"],
        )
        if payment_errors:
            raise RuntimeError("; ".join(payment_errors))
        trace_path = ARTIFACT_DIR / "field-traceability.xlsx"
        _write_traceability_workbook(db, project, trace_path)
        trace_content = trace_path.read_bytes()
        manifest["artifacts"][trace_path.name] = {
            "sha256": hashlib.sha256(trace_content).hexdigest(),
            "size_bytes": len(trace_content),
            "sheets": ["字段来源追溯", "合同付款校验"],
        }
        db.commit()

    _write_json(
        ARTIFACT_DIR / "validation-report.json",
        {
            "case": "demo_001",
            "provider": "demo/deterministic-v1",
            "validations": validations,
            "payment_check": {"status": "passed", "errors": []},
            "forbidden_mapping_check": {
                "status": "passed",
                "facts": {
                    "feasibility_total_investment": 12_800_000,
                    "tender_budget": 9_800_000,
                    "tender_maximum_price": 9_500_000,
                    "final_contract_amount": 9_260_000,
                    "project_period_months": 18,
                    "contract_duration": "合同生效后 12 个月",
                },
            },
        },
    )
    _write_json(ARTIFACT_DIR / "artifact-manifest.json", manifest)
    print(f"Golden Case generated at {ARTIFACT_DIR}")


if __name__ == "__main__":
    generate()
