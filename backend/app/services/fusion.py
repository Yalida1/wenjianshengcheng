"""Field-level fusion of rule channel and LLM channel candidates.

Fusion never lets the model silently override explicit rule extractions facts,
and never treats dual-channel agreement as a substitute for evidence checks.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from .procurement_candidates import (
    BudgetCandidate,
    ContentCandidate,
    GroupCandidate,
    PackageCandidate,
    PlanCandidate,
    ProcurementAnalysisCandidate,
)

FUSION_VERSION = "fusion-v1"
TENDER_METHODS = {"public_tender", "invited_tender", "tender"}


def _norm_name(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()


def _package_key(package: PackageCandidate) -> str:
    code = (package.original_code or package.code or "").strip()
    if code and not code.startswith("SYS-"):
        return f"code:{_norm_name(code)}"
    return f"name:{_norm_name(package.name)}|scope:{_norm_name(package.scope)[:40]}"


def _evidence_supported(
    block_ids: list[str],
    valid_ids: set[str],
    block_texts: dict[str, str],
    needle: str | None,
) -> bool:
    if not block_ids:
        return False
    if any(block_id not in valid_ids for block_id in block_ids):
        return False
    if not needle:
        return True
    needle_n = _norm_name(needle)[:20]
    if not needle_n:
        return True
    for block_id in block_ids:
        if needle_n and needle_n in _norm_name(block_texts.get(block_id, "")):
            return True
    # Evidence exists but does not contain the claimed value → weak
    return False


def _merge_evidence(*lists: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for items in lists:
        for item in items:
            if item not in seen:
                seen.add(item)
                out.append(item)
    return out


def _group_identity(group: GroupCandidate) -> str:
    """Stable business identity for dual-channel group alignment (not zip-by-index)."""
    codes = tuple(sorted(_norm_name(c) for c in group.package_codes if c))
    if codes:
        return f"pkg:{'|'.join(codes)}"
    name = _norm_name(group.name)
    if name:
        return f"name:{name}"
    evid = tuple(sorted(group.evidence_block_ids))
    if evid:
        return f"evid:{'|'.join(evid)}"
    return f"anon:{id(group)}"


def _align_dual_channel_groups(
    rule_groups: list[GroupCandidate],
    llm_groups: list[GroupCandidate],
    package_codes: set[str],
    *,
    valid_block_ids: set[str],
    unresolved: list[dict[str, Any]],
    proposals: list[dict[str, Any]],
) -> list[GroupCandidate]:
    """Match groups by package codes / normalized names / evidence overlap."""
    fused: list[GroupCandidate] = []
    used_llm: set[int] = set()

    for rule_g in rule_groups:
        match_idx: int | None = None
        rule_id = _group_identity(rule_g)
        rule_codes = {_norm_name(c) for c in rule_g.package_codes if c}
        rule_evid = set(rule_g.evidence_block_ids)

        for idx, llm_g in enumerate(llm_groups):
            if idx in used_llm:
                continue
            if _group_identity(llm_g) == rule_id:
                match_idx = idx
                break

        if match_idx is None and rule_codes:
            best_idx: int | None = None
            best_score = 0
            for idx, llm_g in enumerate(llm_groups):
                if idx in used_llm:
                    continue
                overlap = len(rule_codes & {_norm_name(c) for c in llm_g.package_codes if c})
                if overlap > best_score:
                    best_score = overlap
                    best_idx = idx
            if best_idx is not None and best_score > 0:
                match_idx = best_idx

        if match_idx is None and rule_evid:
            for idx, llm_g in enumerate(llm_groups):
                if idx in used_llm:
                    continue
                if rule_evid & set(llm_g.evidence_block_ids):
                    match_idx = idx
                    break

        if match_idx is not None:
            used_llm.add(match_idx)
            llm_g = llm_groups[match_idx]
            codes = [c for c in rule_g.package_codes if c in package_codes] or [
                c for c in llm_g.package_codes if c in package_codes
            ]
            fused.append(
                rule_g.model_copy(
                    update={
                        "package_codes": codes,
                        "evidence_block_ids": _merge_evidence(
                            rule_g.evidence_block_ids, llm_g.evidence_block_ids
                        ),
                        "source_channel": "fused",
                        "support_level": "dual_channel",
                    }
                )
            )
        else:
            codes = [c for c in rule_g.package_codes if c in package_codes]
            if not codes and rule_g.package_codes:
                codes = list(package_codes) if len(rule_groups) == 1 else []
            fused.append(
                rule_g.model_copy(
                    update={
                        "package_codes": codes or list(rule_g.package_codes),
                        "source_channel": "rule",
                        "support_level": "rule_only",
                    }
                )
            )

    for idx, llm_g in enumerate(llm_groups):
        if idx in used_llm:
            continue
        if any(eid not in valid_block_ids for eid in llm_g.evidence_block_ids):
            proposals.append(
                {
                    "type": "group",
                    "llm": llm_g.model_dump(mode="json"),
                    "reason": "invalid_evidence",
                }
            )
            continue
        codes = [c for c in llm_g.package_codes if c in package_codes]
        fused.append(
            llm_g.model_copy(
                update={
                    "package_codes": codes or list(llm_g.package_codes),
                    "source_channel": "llm",
                    "support_level": "llm_only",
                }
            )
        )
        unresolved.append(
            {
                "code": "fusion.llm_only_group",
                "severity": "P1",
                "title": f"仅AI提出的文件组：{llm_g.name}",
                "detail": "规则通道未建立对应文件组织关系；请确认后使用。",
                "impact": "主文件套数需人工确认。",
            }
        )
    return fused


def _amounts_compatible(a: Decimal | None, b: Decimal | None) -> bool:
    if a is None or b is None:
        return True
    if a == b:
        return True
    # Allow 万元 vs 元 style off-by-10000 if one is 10000x
    ratio = (a / b) if b != 0 else Decimal("0")
    return ratio in {Decimal("10000"), Decimal("0.0001"), Decimal("100000000"), Decimal("0.00000001")}


def fuse_analysis_results(
    *,
    rule_result: ProcurementAnalysisCandidate | None,
    llm_result: ProcurementAnalysisCandidate | None,
    valid_block_ids: set[str],
    block_texts: dict[str, str],
    rule_meta: dict[str, Any] | None = None,
    llm_meta: dict[str, Any] | None = None,
    project_name: str = "",
) -> tuple[ProcurementAnalysisCandidate, dict[str, Any]]:
    rule_meta = rule_meta or {}
    llm_meta = llm_meta or {}
    rule_plan = rule_result.plans[0] if rule_result and rule_result.plans else None
    llm_plan = llm_result.plans[0] if llm_result and llm_result.plans else None

    field_support: list[dict[str, Any]] = []
    unresolved: list[dict[str, str]] = []
    proposals: list[dict[str, Any]] = []

    # --- Packages ---
    fused_packages: list[PackageCandidate] = []
    rule_packages = { _package_key(p): p for p in (rule_plan.packages if rule_plan else []) }
    llm_packages = { _package_key(p): p for p in (llm_plan.packages if llm_plan else []) }
    all_keys = list(dict.fromkeys([*rule_packages.keys(), *llm_packages.keys()]))

    for key in all_keys:
        rule_pkg = rule_packages.get(key)
        llm_pkg = llm_packages.get(key)
        if rule_pkg and llm_pkg:
            # Verify LLM evidence actually supports claimed fields
            llm_ok = _evidence_supported(
                llm_pkg.evidence_block_ids, valid_block_ids, block_texts, llm_pkg.name
            )
            rule_ok = _evidence_supported(
                rule_pkg.evidence_block_ids, valid_block_ids, block_texts, rule_pkg.name
            )
            if rule_ok and llm_ok:
                method = rule_pkg.procurement_method
                if (
                    rule_pkg.procurement_method != llm_pkg.procurement_method
                    and rule_pkg.procurement_method != "unknown"
                    and llm_pkg.procurement_method != "unknown"
                ):
                    unresolved.append(
                        {
                            "code": "fusion.method_conflict",
                            "severity": "P1",
                            "title": f"采购方式冲突：{rule_pkg.name}",
                            "detail": (
                                f"规则通道={rule_pkg.procurement_method}，"
                                f"AI通道={llm_pkg.procurement_method}，已保留冲突。"
                            ),
                            "impact": "确认前文件类型可能不准。",
                        }
                    )
                    method = "unknown"
                elif rule_pkg.procurement_method == "unknown" and llm_pkg.procurement_method != "unknown":
                    method = llm_pkg.procurement_method
                amount = rule_pkg.estimated_amount
                if amount is None:
                    amount = llm_pkg.estimated_amount
                elif llm_pkg.estimated_amount is not None and not _amounts_compatible(
                    amount, llm_pkg.estimated_amount
                ):
                    unresolved.append(
                        {
                            "code": "fusion.amount_conflict",
                            "severity": "P1",
                            "title": f"金额冲突：{rule_pkg.name}",
                            "detail": f"规则={amount}，AI={llm_pkg.estimated_amount}",
                            "impact": "需人工确认金额口径。",
                        }
                    )
                merged = rule_pkg.model_copy(
                    update={
                        "procurement_method": method,
                        "estimated_amount": amount,
                        "evidence_block_ids": _merge_evidence(
                            rule_pkg.evidence_block_ids, llm_pkg.evidence_block_ids
                        ),
                        "source_channel": "fused",
                        "support_level": "dual_channel",
                        "scope": rule_pkg.scope or llm_pkg.scope,
                    }
                )
                fused_packages.append(merged)
                field_support.append(
                    {
                        "entity": "package",
                        "key": merged.code,
                        "support_level": "dual_channel",
                        "evidence_ids": merged.evidence_block_ids,
                    }
                )
            elif rule_ok:
                fused_packages.append(
                    rule_pkg.model_copy(update={"source_channel": "rule", "support_level": "rule_only"})
                )
                field_support.append(
                    {
                        "entity": "package",
                        "key": rule_pkg.code,
                        "support_level": "rule_only",
                        "note": "AI证据未通过核验或未覆盖",
                    }
                )
            elif llm_ok:
                # LLM-only with verifiable evidence
                fused_packages.append(
                    llm_pkg.model_copy(update={"source_channel": "llm", "support_level": "llm_only"})
                )
                field_support.append(
                    {
                        "entity": "package",
                        "key": llm_pkg.code,
                        "support_level": "llm_only",
                        "note": "规则未命中；证据已核验",
                    }
                )
            else:
                proposals.append(
                    {
                        "type": "package",
                        "rule": rule_pkg.model_dump(mode="json") if rule_pkg else None,
                        "llm": llm_pkg.model_dump(mode="json") if llm_pkg else None,
                        "reason": "双方均无足够原文证据，不计入正式采购包",
                    }
                )
        elif rule_pkg:
            if _evidence_supported(rule_pkg.evidence_block_ids, valid_block_ids, block_texts, rule_pkg.name):
                fused_packages.append(
                    rule_pkg.model_copy(update={"source_channel": "rule", "support_level": "rule_only"})
                )
                field_support.append(
                    {"entity": "package", "key": rule_pkg.code, "support_level": "rule_only"}
                )
            else:
                unresolved.append(
                    {
                        "code": "fusion.rule_evidence_weak",
                        "severity": "P1",
                        "title": f"规则候选证据不足：{rule_pkg.name}",
                        "detail": "规则命中但证据块无法核验，已降为待确认。",
                        "impact": "未计入正式采购包数量。",
                    }
                )
        elif llm_pkg:
            # Reject forged block ids
            if any(eid not in valid_block_ids for eid in llm_pkg.evidence_block_ids):
                unresolved.append(
                    {
                        "code": "fusion.llm_forged_evidence",
                        "severity": "P0",
                        "title": f"AI候选引用了无效证据块：{llm_pkg.name}",
                        "detail": "服务端拒绝无来源或伪造 block_id 的采购包。",
                        "impact": "该候选不计入正式结果。",
                    }
                )
                proposals.append(
                    {
                        "type": "package",
                        "llm": llm_pkg.model_dump(mode="json"),
                        "reason": "invalid_or_forged_block_id",
                    }
                )
            elif _evidence_supported(llm_pkg.evidence_block_ids, valid_block_ids, block_texts, llm_pkg.name):
                # Machine-verifiable explicit value can be accepted as llm_only pending review
                fused_packages.append(
                    llm_pkg.model_copy(
                        update={
                            "source_channel": "llm",
                            "support_level": "llm_only",
                            "candidate_status": "provisional",
                        }
                    )
                )
                field_support.append(
                    {
                        "entity": "package",
                        "key": llm_pkg.code,
                        "support_level": "llm_only",
                        "note": "单通道AI，待确认",
                    }
                )
                unresolved.append(
                    {
                        "code": "fusion.llm_only_package",
                        "severity": "P1",
                        "title": f"仅AI识别到的采购包：{llm_pkg.name}",
                        "detail": "规则通道未命中；证据已定位，请人工确认后纳入生成。",
                        "impact": "默认计入已识别明细，确认前谨慎生成。",
                    }
                )
            else:
                proposals.append(
                    {
                        "type": "package",
                        "llm": llm_pkg.model_dump(mode="json"),
                        "reason": "citation_does_not_support_claim",
                    }
                )

    # --- Groups ---
    fused_groups: list[GroupCandidate] = []
    rule_groups = list(rule_plan.groups if rule_plan else [])
    llm_groups = list(llm_plan.groups if llm_plan else [])
    package_codes = {p.code for p in fused_packages}
    explicit_file_org = rule_meta.get("file_organization") in {"separate", "shared"}

    if rule_groups and llm_groups:
        fused_groups = _align_dual_channel_groups(
            rule_groups,
            llm_groups,
            package_codes,
            valid_block_ids=valid_block_ids,
            unresolved=unresolved,
            proposals=proposals,
        )
    elif rule_groups:
        for rule_g in rule_groups:
            codes = [c for c in rule_g.package_codes if c in package_codes]
            if not codes and rule_g.package_codes:
                # Keep group even if codes remapped — attach all if single group
                codes = list(package_codes) if len(rule_groups) == 1 else []
            fused_groups.append(
                rule_g.model_copy(
                    update={
                        "package_codes": codes or list(rule_g.package_codes),
                        "source_channel": "rule",
                        "support_level": "rule_only",
                    }
                )
            )
    elif llm_groups:
        for llm_g in llm_groups:
            if any(eid not in valid_block_ids for eid in llm_g.evidence_block_ids):
                proposals.append(
                    {
                        "type": "group",
                        "llm": llm_g.model_dump(mode="json"),
                        "reason": "invalid_evidence",
                    }
                )
                continue
            codes = [c for c in llm_g.package_codes if c in package_codes]
            fused_groups.append(
                llm_g.model_copy(
                    update={
                        "package_codes": codes or list(llm_g.package_codes),
                        "source_channel": "llm",
                        "support_level": "llm_only",
                    }
                )
            )
            unresolved.append(
                {
                    "code": "fusion.llm_only_group",
                    "severity": "P1",
                    "title": f"仅AI提出的文件组：{llm_g.name}",
                    "detail": "规则通道未建立文件组织关系；请确认后使用。",
                    "impact": "主文件套数需人工确认。",
                }
            )
    elif fused_packages and not explicit_file_org:
        # Packages exist but neither channel established confirmed organization.
        # Leave groups empty — UI shows packages and asks for light confirmation.
        pass

    # Remap LLM package codes that don't match fused codes into groups
    fused_code_set = {p.code for p in fused_packages}
    for group in fused_groups:
        group.package_codes = [c for c in group.package_codes if c in fused_code_set] or group.package_codes

    # --- Contents & budgets ---
    contents: list[ContentCandidate] = []
    seen_content: set[str] = set()
    for plan in (rule_plan, llm_plan):
        if not plan:
            continue
        channel = "rule" if plan is rule_plan else "llm"
        for content in plan.contents:
            key = _norm_name(content.name)
            if key in seen_content:
                continue
            seen_content.add(key)
            if content.evidence_block_ids and any(
                e not in valid_block_ids for e in content.evidence_block_ids
            ):
                continue
            contents.append(content.model_copy(update={"source_channel": channel}))

    budgets: list[BudgetCandidate] = []
    budget_keys: set[str] = set()
    for plan in (rule_plan, llm_plan):
        if not plan:
            continue
        for budget in plan.budget_items:
            if budget.key in budget_keys:
                continue
            if budget.evidence_block_ids and any(e not in valid_block_ids for e in budget.evidence_block_ids):
                continue
            budget_keys.add(budget.key)
            budgets.append(budget)

    # Merge unresolved from channels
    for plan in (rule_plan, llm_plan):
        if not plan:
            continue
        for item in plan.unresolved:
            code = item.get("code")
            if code and any(
                u.get("code") == code and u.get("detail") == item.get("detail")
                for u in unresolved
            ):
                continue
            # Drop "no arrangement" if we now have packages
            if code == "analysis.no_explicit_arrangement" and fused_packages:
                continue
            # Never treat silent platform-default grouping as a success signal.
            if code == "analysis.grouping_platform_default":
                continue
            # Deduplicate soft grouping confirmation by code alone.
            if code == "analysis.grouping_needs_confirmation" and any(
                u.get("code") == code for u in unresolved
            ):
                continue
            unresolved.append(item)

    if (
        fused_packages
        and not fused_groups
        and not explicit_file_org
        and not any(u.get("code") == "analysis.grouping_needs_confirmation" for u in unresolved)
    ):
        unresolved.append(
            {
                "code": "analysis.grouping_needs_confirmation",
                "severity": "P1",
                "title": "主文件组织方式需确认",
                "detail": (
                    f"已识别 {len(fused_packages)} 个采购包，两通道均未给出可确认的文件组织关系；"
                    "不能默认「一包一套」或「全部共用一套」。请轻量确认待编制文件清单。"
                ),
                "impact": "采购包数量可展示；主文件套数保持待确定，确认前谨慎生成。",
            }
        )

    # Count summary — never coerce unknown to 0; unconfirmed grouping is incomplete.
    rule_count = (rule_plan.count_summary if rule_plan else None) or rule_meta.get("count_summary") or {}
    suggestion_levels = {"suggestion_needs_confirmation", "platform_default", "platform_suggestion"}
    confirmed_groups = [
        g
        for g in fused_groups
        if g.support_level not in suggestion_levels
        and g.source_channel not in {"platform_suggestion", "platform_default"}
        and (
            g.support_level in {"dual_channel", "rule_only", "llm_only", "human"}
            or g.source_channel in {"fused", "rule", "llm", "human"}
        )
    ]
    suggestion_only = bool(fused_groups) and (
        not confirmed_groups
        or all(g.support_level in suggestion_levels for g in fused_groups)
    )
    organization_complete = bool(confirmed_groups) and not suggestion_only and (
        any(g.support_level == "dual_channel" for g in confirmed_groups)
        or bool(rule_count.get("document_group_complete"))
        or explicit_file_org
        or all(g.support_level in {"rule_only", "dual_channel", "human"} for g in confirmed_groups)
    )
    tender_groups = [g for g in confirmed_groups if g.procurement_method in TENDER_METHODS]
    other_groups = [g for g in confirmed_groups if g.procurement_method not in TENDER_METHODS]
    group_total: int | None
    if suggestion_only or (fused_packages and not fused_groups):
        group_total = None
        organization_complete = False
    elif fused_groups:
        if organization_complete or rule_count.get("document_group_complete"):
            group_total = len(fused_groups)
            organization_complete = True
        elif rule_count.get("document_group_count_total") is not None and explicit_file_org:
            group_total = int(rule_count["document_group_count_total"])
            organization_complete = True
        else:
            group_total = len(fused_groups) if explicit_file_org else None
            organization_complete = group_total is not None
    else:
        group_total = 0 if (rule_result is not None and not fused_packages) else None
        organization_complete = group_total == 0

    count_summary: dict[str, Any] = {
        "package_count_identified": len(fused_packages),
        "package_count_total": rule_count.get("package_count_total"),
        "package_count_complete": bool(rule_count.get("package_count_complete")) and bool(fused_packages),
        "document_group_count_identified": len(fused_groups) if fused_groups else 0,
        "document_group_count_total": group_total,
        "document_group_complete": bool(organization_complete),
        "tender_document_count": len(tender_groups) if group_total is not None else None,
        "other_procurement_document_count": len(other_groups) if group_total is not None else None,
        "unclassified_document_groups": sum(1 for g in fused_groups if g.procurement_method == "unknown"),
        "packages_without_group": sum(
            1
            for p in fused_packages
            if not any(p.code in g.package_codes for g in fused_groups)
        ),
        "basis": "fusion",
        "scope": "uploaded_feasibility",
    }

    if not fused_packages and not fused_groups:
        if not any(u.get("code") == "analysis.no_explicit_arrangement" for u in unresolved):
            unresolved.append(
                {
                    "code": "analysis.no_explicit_arrangement",
                    "severity": "P0",
                    "title": "缺少可核对的采购划分",
                    "detail": "融合后仍无具备原文证据的采购包或主文件组。",
                    "impact": "不能输出确定的招标文件份数。",
                }
            )

    rule_status = rule_meta.get("status", "skipped" if rule_result is None else "succeeded")
    llm_status = llm_meta.get("status", "skipped" if llm_result is None else "succeeded")

    summary_bits = [
        f"已识别采购包 {len(fused_packages)} 个",
        (
            f"主文件 {group_total} 套"
            if group_total is not None
            else f"已识别文件组 {len(fused_groups)} 个，总数待确定"
            if fused_groups
            else "主文件套数待确定"
        ),
        f"规则通道={rule_status}",
        f"AI通道={llm_status}",
    ]

    plan = PlanCandidate(
        option_key="recommended",
        name="推荐采购方案（双通道融合）",
        is_recommended=True,
        summary="；".join(summary_bits),
        contents=contents
        or [
            ContentCandidate(
                key="CONTENT-UNKNOWN",
                name="待识别建设内容",
                description="融合后仍缺少可归属内容",
                scope_status="unknown",
                evidence_block_ids=[],
            )
        ],
        packages=fused_packages,
        groups=fused_groups,
        budget_items=budgets,
        unresolved=unresolved,
        count_summary=count_summary,
        proposals=proposals,
        field_support=field_support,
    )

    fusion_meta = {
        "version": FUSION_VERSION,
        "rule_status": rule_status,
        "llm_status": llm_status,
        "dual_channel_complete": rule_status == "succeeded"
        and llm_status in {"succeeded", "succeeded_demo"},
        "rule_only_fallback": rule_status == "succeeded"
        and llm_status not in {"succeeded", "succeeded_demo"},
        "package_count": len(fused_packages),
        "group_count": len(fused_groups),
        "proposal_count": len(proposals),
        "field_support_count": len(field_support),
        "count_summary": count_summary,
    }
    return ProcurementAnalysisCandidate(plans=[plan]), fusion_meta
