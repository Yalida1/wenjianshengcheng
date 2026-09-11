"""Shared procurement analysis candidate schemas (rule + LLM + fusion)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field


class ContentCandidate(BaseModel):
    key: str
    name: str
    description: str | None = None
    scope_status: Literal["in_scope", "excluded", "already_procured", "future", "other_method", "unknown"]
    procurement_method: str | None = None
    deliverables: list[str] = []
    phase: str | None = None
    evidence_block_ids: list[str] = []
    source_channel: str | None = None  # rule | llm | fused | human


class PackageCandidate(BaseModel):
    code: str
    name: str
    procurement_category: str = "other"
    business_subcategory: str | None = None
    procurement_method: str = "public_tender"
    scope: str
    exclusions: str | None = None
    deliverables: list[str] = []
    implementation_period: str | None = None
    estimated_amount: Decimal | None = None
    confirmed_budget: Decimal | None = None
    maximum_price: Decimal | None = None
    currency: str = "CNY"
    original_unit: str | None = None
    tax_included: bool | None = None
    budget_period: str | None = None
    budget_basis: str | None = None
    content_keys: list[str] = []
    evidence_block_ids: list[str] = []
    source_channel: str | None = None
    support_level: str | None = None  # dual_channel | rule_only | llm_only | human
    original_code: str | None = None  # raw code from source; None if system-assigned
    scheme_key: str | None = None
    phase: str | None = None
    candidate_status: str | None = None  # explicit | provisional | derived | proposed | missing | conflict


class GroupCandidate(BaseModel):
    code: str
    name: str
    procurement_category: str = "other"
    business_subcategory: str | None = None
    procurement_method: str = "public_tender"
    organization_method: str | None = None
    scope: str
    exclusions: str | None = None
    deliverables: list[str] = []
    implementation_period: str | None = None
    rationale: str
    package_codes: list[str]
    evidence_block_ids: list[str] = []
    source_channel: str | None = None
    support_level: str | None = None
    document_kind: str | None = None  # tender | other_procurement | prequalification | unclassified
    scheme_key: str | None = None
    phase: str | None = None


class BudgetCandidate(BaseModel):
    key: str
    name: str
    cost_type: str = "unclassified"
    amount: Decimal | None = None
    currency: str = "CNY"
    original_value: str | None = None
    original_unit: str | None = None
    tax_included: bool | None = None
    budget_period: str | None = None
    evidence_block_ids: list[str] = []
    source_channel: str | None = None


class PlanCandidate(BaseModel):
    option_key: str = "recommended"
    name: str = "推荐采购方案"
    is_recommended: bool = True
    summary: str
    contents: list[ContentCandidate]
    packages: list[PackageCandidate]
    groups: list[GroupCandidate]
    budget_items: list[BudgetCandidate] = []
    unresolved: list[dict[str, str]] = []
    count_summary: dict[str, Any] = {}
    proposals: list[dict[str, Any]] = []  # non-factual suggestions
    field_support: list[dict[str, Any]] = []  # explainability: dual/rule/llm


class ProcurementAnalysisCandidate(BaseModel):
    plans: list[PlanCandidate] = Field(min_length=1, max_length=3)


class ProcurementFacts(BaseModel):
    explicit_arrangements: list[dict[str, Any]] = []
    construction_items: list[dict[str, Any]] = []
    cost_items: list[dict[str, Any]] = []
    exclusions: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
