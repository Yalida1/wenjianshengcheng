"""Allocate and preview organization-scoped project codes."""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.errors import APIError
from backend.app.models import Project, ProjectCodeRule, new_id, utc_now

DEFAULT_PATTERN = "{project_type}_{date}_{seq}"
DEFAULT_DATE_FORMAT = "YYYYMMDD"
DEFAULT_SEQ_WIDTH = 4
DEFAULT_RESET_SCOPE = "type_day"

ALLOWED_TOKENS = ("project_type", "date", "seq")
DATE_FORMAT_MAP = {
    "YYYYMMDD": "%Y%m%d",
    "YYYYMM": "%Y%m",
    "YYMMDD": "%y%m%d",
    "YYYY-MM-DD": "%Y-%m-%d",
}
TOKEN_RE = re.compile(r"\{([a-z_]+)\}")
LITERAL_SAFE_RE = re.compile(r"^[A-Za-z0-9_\-{}]+$")


def validate_code_rule(
    *,
    pattern: str,
    date_format: str,
    seq_width: int,
    reset_scope: str,
) -> None:
    if date_format not in DATE_FORMAT_MAP:
        raise APIError(422, "invalid_date_format", "不支持的日期格式")
    if reset_scope not in {"type_day", "day", "organization"}:
        raise APIError(422, "invalid_reset_scope", "不支持的流水重置范围")
    if not 1 <= seq_width <= 8:
        raise APIError(422, "invalid_seq_width", "序号位数须在 1–8 之间")
    if not LITERAL_SAFE_RE.fullmatch(pattern):
        raise APIError(422, "invalid_pattern", "编号规则仅允许字母、数字、下划线、连字符与占位符")
    tokens = TOKEN_RE.findall(pattern)
    if "seq" not in tokens:
        raise APIError(422, "invalid_pattern", "编号规则必须包含 {seq}")
    unknown = sorted(set(tokens) - set(ALLOWED_TOKENS))
    if unknown:
        raise APIError(422, "invalid_pattern", f"不支持的占位符：{', '.join(unknown)}")
    if tokens.count("seq") != 1:
        raise APIError(422, "invalid_pattern", "{seq} 只能出现一次")


def format_rule_date(date_format: str, when: date | None = None) -> str:
    stamp = when or date.today()
    return stamp.strftime(DATE_FORMAT_MAP.get(date_format, "%Y%m%d"))


def render_project_code(
    *,
    pattern: str,
    project_type: str,
    date_value: str,
    seq: int,
    seq_width: int,
) -> str:
    return (
        pattern.replace("{project_type}", project_type)
        .replace("{date}", date_value)
        .replace("{seq}", str(seq).zfill(seq_width))
    )


def preview_project_code(
    *,
    pattern: str,
    date_format: str,
    seq_width: int,
    project_type: str = "government_investment",
    seq: int = 1,
    when: date | None = None,
) -> str:
    return render_project_code(
        pattern=pattern,
        project_type=project_type,
        date_value=format_rule_date(date_format, when),
        seq=seq,
        seq_width=seq_width,
    )


def ensure_project_code_rule(
    db: Session,
    organization_id: str,
    *,
    actor_id: str | None = None,
) -> ProjectCodeRule:
    rule = db.scalar(
        select(ProjectCodeRule).where(ProjectCodeRule.organization_id == organization_id)
    )
    if rule is not None:
        return rule
    rule = ProjectCodeRule(
        id=new_id(),
        organization_id=organization_id,
        pattern=DEFAULT_PATTERN,
        date_format=DEFAULT_DATE_FORMAT,
        seq_width=DEFAULT_SEQ_WIDTH,
        reset_scope=DEFAULT_RESET_SCOPE,
        created_by=actor_id,
        updated_by=actor_id,
        created_at=utc_now(),
        updated_at=utc_now(),
        revision=1,
    )
    db.add(rule)
    db.flush()
    return rule


def _match_regex_for_scope(
    rule: ProjectCodeRule,
    *,
    project_type: str,
    date_value: str,
) -> re.Pattern[str]:
    parts: list[str] = []
    index = 0
    for match in TOKEN_RE.finditer(rule.pattern):
        parts.append(re.escape(rule.pattern[index : match.start()]))
        token = match.group(1)
        if token == "seq":
            parts.append(r"(\d+)")
        elif token == "project_type":
            if rule.reset_scope == "type_day":
                parts.append(re.escape(project_type))
            else:
                parts.append(r"[A-Za-z0-9_]+")
        elif token == "date":
            if rule.reset_scope == "organization":
                parts.append(r"[0-9\-]+")
            else:
                parts.append(re.escape(date_value))
        index = match.end()
    parts.append(re.escape(rule.pattern[index:]))
    return re.compile("^" + "".join(parts) + "$")


def next_sequence(
    db: Session,
    *,
    organization_id: str,
    rule: ProjectCodeRule,
    project_type: str,
    date_value: str,
) -> int:
    matcher = _match_regex_for_scope(rule, project_type=project_type, date_value=date_value)
    codes = db.scalars(
        select(Project.code).where(Project.organization_id == organization_id)
    ).all()
    highest = 0
    for code in codes:
        matched = matcher.fullmatch(code)
        if not matched:
            continue
        try:
            highest = max(highest, int(matched.group(1)))
        except (TypeError, ValueError):
            continue
    return highest + 1


def allocate_project_code(
    db: Session,
    *,
    organization_id: str,
    project_type: str,
    preferred: str | None = None,
    actor_id: str | None = None,
    when: date | None = None,
) -> str:
    """Allocate a unique project code; preferred wins when free."""
    candidates: list[str] = []
    if preferred and preferred.strip():
        candidates.append(preferred.strip())

    rule = ensure_project_code_rule(db, organization_id, actor_id=actor_id)
    date_value = format_rule_date(rule.date_format, when)
    start_seq = next_sequence(
        db,
        organization_id=organization_id,
        rule=rule,
        project_type=project_type,
        date_value=date_value,
    )
    for offset in range(0, 32):
        candidates.append(
            render_project_code(
                pattern=rule.pattern,
                project_type=project_type,
                date_value=date_value,
                seq=start_seq + offset,
                seq_width=rule.seq_width,
            )
        )

    for code in candidates:
        if len(code) > 80:
            continue
        exists = db.scalar(
            select(Project.id).where(
                Project.organization_id == organization_id,
                Project.code == code,
            )
        )
        if exists is None:
            return code
    raise APIError(409, "project_code_conflict", "无法分配唯一项目编号，请稍后重试")
