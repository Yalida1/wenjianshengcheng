from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select

from backend.app.config import get_settings
from backend.app.db import SessionLocal
from backend.app.models import (
    DocumentFormatProfile,
    FieldDefinition,
    Organization,
    Permission,
    Role,
    RolePermission,
    Template,
    TemplateSection,
    TemplateVariable,
    TemplateVersion,
    User,
    UserRole,
)
from backend.app.security import hash_password, verify_password
from backend.app.services.providers import SECTION_PLANS
from backend.app.services.storage import get_storage, sha256_bytes
from backend.app.services.templates import DEMO_TEMPLATE_CONTENT_TYPE, build_demo_template

PERMISSIONS = {
    "system.admin": "系统管理",
    "project.create": "创建项目",
    "project.read": "查看项目",
    "project.write": "编辑项目",
    "template.manage": "管理模板",
    "template.publish": "发布模板",
    "document.edit": "编辑文档",
    "document.finalize": "定稿文档",
    "export.create": "导出文档",
    "audit.read": "查看审计日志",
    "user.manage": "管理用户",
}
ROLE_PERMISSIONS = {
    "system_admin": set(PERMISSIONS),
    "template_admin": {"project.read", "template.manage", "template.publish", "export.create"},
    "project_editor": {
        "project.create",
        "project.read",
        "project.write",
        "document.edit",
        "export.create",
    },
    "reviewer": {"project.read", "document.edit", "document.finalize", "export.create"},
    "viewer": {"project.read"},
}
ROLE_NAMES = {
    "system_admin": "系统管理员",
    "template_admin": "模板管理员",
    "project_editor": "项目编制人员",
    "reviewer": "审核人员",
    "viewer": "只读人员",
}
DEMO_TEMPLATES = {
    "requirement": "Demo 项目建议书通用模板",
    "feasibility": "Demo 可行性研究报告通用模板",
    "tender": "Demo 招标文件通用模板",
    "contract": "Demo 合同通用模板",
}
FIELD_DEFINITIONS = {
    "requirement": [
        ("project_name", "项目名称", "string", None, "P0", True),
        ("project_owner", "项目单位", "string", None, "P0", True),
        ("construction_scope", "建设范围", "text", None, "P0", True),
        ("project_period", "项目总建设周期", "duration", "月", "P0", True),
    ],
    "feasibility": [
        ("project_name", "项目名称", "string", None, "P0", True),
        ("total_investment", "可研总投资", "money", "元", "P0", True),
        ("construction_scope", "项目全部建设范围", "text", None, "P0", True),
        ("project_period", "项目总建设周期", "duration", "月", "P0", True),
    ],
    "tender": [
        ("project_name", "项目名称", "string", None, "P0", True),
        ("procurement_budget", "招标预算", "money", "元", "P0", True),
        ("maximum_price", "最高限价", "money", "元", "P0", True),
        ("procurement_scope", "采购范围", "text", None, "P0", True),
    ],
    "contract": [
        ("party_a", "甲方完整主体", "string", None, "P0", True),
        ("party_b", "乙方完整主体", "string", None, "P0", True),
        ("contract_subject", "合同标的", "text", None, "P0", True),
        ("contract_scope", "本合同范围", "text", None, "P0", True),
        ("final_contract_amount", "最终合同金额", "money", "元", "P0", True),
        ("tax_rate", "税率", "percentage", "%", "P0", True),
        ("tax_inclusion", "含税方式", "string", None, "P0", True),
        ("contract_duration", "履行期限", "duration", None, "P0", True),
        ("delivery_location", "交付地点", "string", None, "P0", True),
        ("payment_plan", "付款计划", "payment_plan", None, "P0", True),
        ("acceptance", "验收约定", "text", None, "P0", True),
        ("warranty", "质保约定", "text", None, "P0", True),
        ("breach", "违约责任", "text", None, "P0", True),
        ("effective_conditions", "生效条件", "text", None, "P0", True),
    ],
}


def seed() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        organization = db.scalar(select(Organization).where(Organization.name == "Demo 组织"))
        if organization is None:
            organization = Organization(name="Demo 组织")
            db.add(organization)
            db.flush()

        permission_rows: dict[str, Permission] = {}
        for code, name in PERMISSIONS.items():
            permission = db.scalar(select(Permission).where(Permission.code == code))
            if permission is None:
                permission = Permission(code=code, name=name)
                db.add(permission)
                db.flush()
            permission_rows[code] = permission

        roles: dict[str, Role] = {}
        for key, name in ROLE_NAMES.items():
            role = db.scalar(select(Role).where(Role.organization_id == organization.id, Role.key == key))
            if role is None:
                role = Role(
                    organization_id=organization.id,
                    key=key,
                    name=name,
                    is_system=True,
                )
                db.add(role)
                db.flush()
            roles[key] = role
            for code in ROLE_PERMISSIONS[key]:
                exists = db.scalar(
                    select(RolePermission).where(
                        RolePermission.role_id == role.id,
                        RolePermission.permission_id == permission_rows[code].id,
                    )
                )
                if exists is None:
                    db.add(
                        RolePermission(
                            organization_id=organization.id,
                            role_id=role.id,
                            permission_id=permission_rows[code].id,
                        )
                    )

        admin_account = settings.demo_admin_account.strip().lower()
        admin = db.scalar(select(User).where(func.lower(User.email) == admin_account))
        if admin is None and admin_account != "admin@example.com":
            admin = db.scalar(select(User).where(func.lower(User.email) == "admin@example.com"))
        if admin is None:
            admin = User(
                organization_id=organization.id,
                email=admin_account,
                display_name="Demo 管理员",
                password_hash=hash_password(settings.demo_admin_password, minimum_length=8),
            )
            db.add(admin)
            db.flush()
        else:
            credentials_changed = False
            if admin.email != admin_account:
                admin.email = admin_account
                credentials_changed = True
            if not verify_password(settings.demo_admin_password, admin.password_hash):
                admin.password_hash = hash_password(settings.demo_admin_password, minimum_length=8)
                credentials_changed = True
            if credentials_changed:
                admin.session_version += 1
        if (
            db.scalar(
                select(UserRole).where(
                    UserRole.user_id == admin.id, UserRole.role_id == roles["system_admin"].id
                )
            )
            is None
        ):
            db.add(
                UserRole(
                    organization_id=organization.id,
                    user_id=admin.id,
                    role_id=roles["system_admin"].id,
                )
            )

        for stage, name in DEMO_TEMPLATES.items():
            template = db.scalar(
                select(Template).where(
                    Template.organization_id == organization.id,
                    Template.stage == stage,
                    Template.source_kind == "demo_general",
                )
            )
            if template is None:
                template = Template(
                    organization_id=organization.id,
                    name=name,
                    stage=stage,
                    source_kind="demo_general",
                    scope="organization",
                    status="published",
                    current_version=1,
                )
                db.add(template)
                db.flush()
            template_version = db.scalar(
                select(TemplateVersion).where(
                    TemplateVersion.template_id == template.id,
                    TemplateVersion.version == 1,
                )
            )
            if template_version is None:
                template_version = TemplateVersion(
                    organization_id=organization.id,
                    template_id=template.id,
                    version=1,
                    status="published",
                    published_at=datetime.now(UTC),
                    format_profile={
                        "standard": "demo_enterprise_report_cn",
                        "page_size": "A4",
                        "cjk_font": "Noto Sans CJK SC or customer-authorized font",
                        "strict_compliance": False,
                    },
                )
                db.add(template_version)
                db.flush()
            template_content = build_demo_template(stage, name)
            template_key = f"{organization.id}/templates/{template.id}/v1/template.docx"
            storage = get_storage()
            if not storage.exists(template_key):
                storage.put(template_key, template_content, DEMO_TEMPLATE_CONTENT_TYPE)
            stored_template_content = storage.get(template_key)
            template_version.storage_key = template_key
            template_version.sha256 = sha256_bytes(stored_template_content)
            for sequence, (key, title) in enumerate(SECTION_PLANS[stage], 1):
                section = db.scalar(
                    select(TemplateSection).where(
                        TemplateSection.template_version_id == template_version.id,
                        TemplateSection.key == key,
                    )
                )
                if section is None:
                    db.add(
                        TemplateSection(
                            organization_id=organization.id,
                            template_version_id=template_version.id,
                            sequence=sequence,
                            key=key,
                            title=title,
                            section_type="editable",
                            required=True,
                            content=None,
                        )
                    )
            for key, _label, _data_type, _unit, _criticality, required in FIELD_DEFINITIONS[stage]:
                variable = db.scalar(
                    select(TemplateVariable).where(
                        TemplateVariable.template_version_id == template_version.id,
                        TemplateVariable.variable_key == key,
                    )
                )
                if variable is None:
                    db.add(
                        TemplateVariable(
                            organization_id=organization.id,
                            template_version_id=template_version.id,
                            variable_key=key,
                            field_key=key,
                            required=required,
                        )
                    )

        profile = db.scalar(
            select(DocumentFormatProfile).where(
                DocumentFormatProfile.organization_id == organization.id,
                DocumentFormatProfile.key == "demo_enterprise_report_cn",
                DocumentFormatProfile.version == 1,
            )
        )
        if profile is None:
            db.add(
                DocumentFormatProfile(
                    organization_id=organization.id,
                    key="demo_enterprise_report_cn",
                    name="Demo 中文企业报告格式",
                    version=1,
                    status="published",
                    rules={
                        "page_size": "A4",
                        "margins_cm": {"top": 2.6, "bottom": 2.4, "left": 2.8, "right": 2.6},
                        "body_font_role": "宋体兼容",
                        "heading_font_role": "黑体兼容",
                    },
                    required_fonts=["Noto Sans CJK SC or customer-authorized font"],
                    strict_compliance=False,
                )
            )

        for stage, definitions in FIELD_DEFINITIONS.items():
            for key, label, data_type, unit, criticality, required in definitions:
                exists = db.scalar(
                    select(FieldDefinition).where(
                        FieldDefinition.organization_id == organization.id,
                        FieldDefinition.stage == stage,
                        FieldDefinition.field_key == key,
                    )
                )
                if exists is None:
                    db.add(
                        FieldDefinition(
                            organization_id=organization.id,
                            stage=stage,
                            field_key=key,
                            field_label=label,
                            data_type=data_type,
                            unit=unit,
                            criticality=criticality,
                            required=required,
                        )
                    )
        db.commit()
        print(f"Seed complete: {admin_account} and Demo templates are ready")


if __name__ == "__main__":
    seed()
