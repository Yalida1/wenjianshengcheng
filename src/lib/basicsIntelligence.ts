import type { FieldDefinition, FieldValue } from "../api/client";
import {
  fieldHasEvidence,
  formatFieldValueForInput,
  parseScopedFieldKey,
  parseStructuredAmountValue,
  pendingDocumentStatus,
  resolveFieldDisplayState,
  resolveGroupFieldValue,
  type ApplicableFieldLike,
  type PendingDocument,
} from "./tenderWorkflow";

export type FieldConflictRecord = {
  id: string;
  field_key: string;
  candidate_field_value_ids: string[];
  status: string;
  resolution?: string | null;
  revision: number;
};

export type BasicsFocusTarget = {
  groupId: string;
  fieldKey: string;
};

export type BasicsIssueItem = {
  id: string;
  groupId: string;
  fieldKey: string;
  fieldLabel: string;
  documentName: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  kind:
    | "conflict"
    | "missing"
    | "invalid"
    | "ai_candidate"
    | "compliance"
    | "amount_guard"
    | "upstream_quality";
};

export type BasicsOverview = {
  conflictCount: number;
  missingBlockingCount: number;
  aiCandidateCount: number;
  confirmedRequiredCount: number;
  requiredCount: number;
  pendingDocumentCount: number;
  completedDocumentCount: number;
  openConflictRecords: number;
  upstreamQualityCount: number;
};

export type BasicsIntelligenceResult = {
  overview: BasicsOverview;
  conflicts: BasicsIssueItem[];
  completeness: BasicsIssueItem[];
  compliance: BasicsIssueItem[];
  candidates: BasicsIssueItem[];
  upstreamQuality: BasicsIssueItem[];
  firstFocus: BasicsFocusTarget | null;
};

function baseFieldKey(fieldKey: string): string {
  return parseScopedFieldKey(fieldKey)?.fieldKey ?? fieldKey;
}

function numericAmount(value: unknown): number | null {
  const structured = parseStructuredAmountValue(value);
  if (structured && Number.isFinite(Number(structured.amount))) {
    return Number(structured.amount);
  }
  const text = formatFieldValueForInput(value).trim().replace(/,/g, "");
  if (!text) return null;
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const amount = Number(matched[0]);
  return Number.isFinite(amount) ? amount : null;
}

function isConfirmed(field: FieldValue | undefined): boolean {
  return field?.status === "user_confirmed" || field?.status === "system_confirmed";
}

function isBlockingCriticality(criticality: string | undefined): boolean {
  return criticality === "P0" || criticality === "P1" || !criticality;
}

function fieldLabelOf(definition: FieldDefinition | ApplicableFieldLike, fieldKey: string): string {
  if ("field_label" in definition && definition.field_label) return String(definition.field_label);
  if ("label" in definition && definition.label) return String(definition.label);
  return fieldKey;
}

export function buildBasicsIntelligence(args: {
  documents: PendingDocument[];
  definitionsByGroup: Record<string, Array<FieldDefinition | ApplicableFieldLike>>;
  values: FieldValue[] | undefined;
  conflictRecords?: FieldConflictRecord[];
  /** Stage-level reference values (e.g. feasibility total_investment) for guardrails. */
  referenceValues?: FieldValue[];
  /** Upstream basis quality issues merged into overview / compliance view. */
  upstreamQualityIssues?: Array<{
    id: string;
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
    tenderFieldKey?: string;
  }>;
}): BasicsIntelligenceResult {
  const values = args.values ?? [];
  const conflicts: BasicsIssueItem[] = [];
  const completeness: BasicsIssueItem[] = [];
  const compliance: BasicsIssueItem[] = [];
  const candidates: BasicsIssueItem[] = [];
  let confirmedRequiredCount = 0;
  let requiredCount = 0;

  const openConflictRecords = (args.conflictRecords ?? []).filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status === "open" || status === "pending" || status === "unresolved" || !item.resolution;
  }).length;

  const investment = numericAmount(
    (args.referenceValues ?? []).find((item) => baseFieldKey(item.field_key) === "total_investment")
      ?.normalized_value ??
      (args.referenceValues ?? []).find((item) => baseFieldKey(item.field_key) === "total_investment")
        ?.value,
  );

  for (const document of args.documents) {
    const definitions = args.definitionsByGroup[document.id] ?? [];

    const budget = numericAmount(
      resolveGroupFieldValue(values, document.id, "procurement_budget")?.normalized_value ??
        resolveGroupFieldValue(values, document.id, "procurement_budget")?.value,
    );
    const maximum = numericAmount(
      resolveGroupFieldValue(values, document.id, "maximum_price")?.normalized_value ??
        resolveGroupFieldValue(values, document.id, "maximum_price")?.value,
    );

    if (budget != null && investment != null && budget === investment) {
      compliance.push({
        id: `amount:budget_eq_investment:${document.id}`,
        groupId: document.id,
        fieldKey: "procurement_budget",
        fieldLabel: "招标预算",
        documentName: document.name,
        severity: "warning",
        title: "招标预算与可研总投资相同",
        detail: "可研总投资不等于招标预算，请人工确认本次采购预算是否确需等于总投资。",
        kind: "amount_guard",
      });
    }

    if (budget != null && maximum != null && maximum > budget) {
      compliance.push({
        id: `amount:max_gt_budget:${document.id}`,
        groupId: document.id,
        fieldKey: "maximum_price",
        fieldLabel: "最高限价",
        documentName: document.name,
        severity: "critical",
        title: "最高限价高于招标预算",
        detail: "最高限价通常不应高于招标预算，请核查后修正。",
        kind: "amount_guard",
      });
    }

    for (const definition of definitions) {
      const fieldKey = definition.field_key;
      const fieldLabel = fieldLabelOf(definition, fieldKey);
      const criticality =
        ("criticality" in definition && definition.criticality) ||
        ("level" in definition && definition.level) ||
        undefined;
      const required = Boolean(definition.required);
      const scoped = values.find((item) => item.field_key === `doc::${document.id}::${fieldKey}`);
      const candidate = resolveGroupFieldValue(values, document.id, fieldKey);
      const emptyReasonCode =
        "empty_reason_code" in definition ? definition.empty_reason_code : null;
      const emptyReasonMessage =
        "empty_reason_message" in definition ? definition.empty_reason_message : null;
      const display = resolveFieldDisplayState({
        fieldKey,
        required,
        emptyReasonCode,
        emptyReasonMessage,
        scopedValue: scoped,
        candidateValue: candidate,
        extractionLoaded: true,
      });

      if (display.kind === "not_applicable") continue;

      if (required) {
        requiredCount += 1;
        if (isConfirmed(scoped)) confirmedRequiredCount += 1;
      }

      if (
        display.kind === "conflict" ||
        scoped?.status === "conflict" ||
        candidate?.status === "conflict"
      ) {
        conflicts.push({
          id: `conflict:${document.id}:${fieldKey}`,
          groupId: document.id,
          fieldKey,
          fieldLabel,
          documentName: document.name,
          severity: "critical",
          title: `${fieldLabel} 存在冲突`,
          detail: display.detail || "多个候选值不一致，请择一确认或手工修正。",
          kind: "conflict",
        });
      }

      if (
        required &&
        isBlockingCriticality(criticality ? String(criticality) : "P0") &&
        (display.kind === "no_reliable_source" ||
          display.kind === "decision_required" ||
          scoped?.status === "missing" ||
          scoped?.status === "invalid" ||
          (!isConfirmed(scoped) && !candidate && display.kind !== "material_candidate"))
      ) {
        const alreadyCandidate =
          candidate &&
          (candidate.status === "extracted" || candidate.status === "ai_suggested") &&
          fieldHasEvidence(candidate);
        if (!alreadyCandidate || scoped?.status === "missing" || scoped?.status === "invalid") {
          completeness.push({
            id: `missing:${document.id}:${fieldKey}`,
            groupId: document.id,
            fieldKey,
            fieldLabel,
            documentName: document.name,
            severity: "warning",
            title: `${fieldLabel} 尚不完整`,
            detail:
              scoped?.status === "invalid"
                ? "格式有误，请修正后确认。"
                : display.detail || "缺少可靠来源或尚未确认，可补录后进入草稿，但会阻止定稿。",
            kind: scoped?.status === "invalid" ? "invalid" : "missing",
          });
        }
      }

      if (display.kind === "compliance_blocked") {
        compliance.push({
          id: `compliance:${document.id}:${fieldKey}`,
          groupId: document.id,
          fieldKey,
          fieldLabel,
          documentName: document.name,
          severity: "warning",
          title: `${fieldLabel} 不可自动映射`,
          detail: display.detail || "合规规则禁止自动代入，需人工确认。",
          kind: "compliance",
        });
      }

      const adoptTarget = scoped ?? candidate;
      if (
        adoptTarget &&
        (adoptTarget.status === "extracted" || adoptTarget.status === "ai_suggested") &&
        fieldHasEvidence(adoptTarget) &&
        !isConfirmed(scoped)
      ) {
        candidates.push({
          id: `candidate:${document.id}:${fieldKey}:${adoptTarget.id}`,
          groupId: document.id,
          fieldKey,
          fieldLabel,
          documentName: document.name,
          severity: adoptTarget.status === "ai_suggested" ? "warning" : "info",
          title: `${fieldLabel} 待采纳候选`,
          detail:
            adoptTarget.status === "ai_suggested"
              ? "AI 建议仅是候选，确认前不会写入正式值。"
              : "材料提取候选，请核对证据后采纳确认。",
          kind: "ai_candidate",
        });
      }
    }
  }

  const uniqueCompliance = Array.from(new Map(compliance.map((item) => [item.id, item])).values());
  const completedDocumentCount = args.documents.filter(
    (document) =>
      pendingDocumentStatus({
        groupId: document.id,
        definitions: args.definitionsByGroup[document.id] ?? [],
        values,
      }) === "已完成",
  ).length;

  const upstreamQuality: BasicsIssueItem[] = (args.upstreamQualityIssues ?? []).map((item) => ({
    id: item.id,
    groupId: args.documents[0]?.id ?? "",
    fieldKey: item.tenderFieldKey ?? "",
    fieldLabel: item.tenderFieldKey || "上游依据",
    documentName: "上游依据",
    severity: item.severity,
    title: item.title,
    detail: item.detail,
    kind: "upstream_quality" as const,
  }));

  const overview: BasicsOverview = {
    conflictCount: conflicts.length,
    missingBlockingCount: completeness.length,
    aiCandidateCount: candidates.length,
    confirmedRequiredCount,
    requiredCount,
    pendingDocumentCount: args.documents.length,
    completedDocumentCount,
    openConflictRecords,
    upstreamQualityCount: upstreamQuality.length,
  };

  const firstFocus =
    conflicts[0] ??
    completeness[0] ??
    uniqueCompliance[0] ??
    upstreamQuality.find((item) => item.fieldKey) ??
    candidates[0] ??
    null;

  return {
    overview,
    conflicts,
    completeness,
    compliance: uniqueCompliance,
    candidates,
    upstreamQuality,
    firstFocus: firstFocus
      ? { groupId: firstFocus.groupId || args.documents[0]?.id || "", fieldKey: firstFocus.fieldKey }
      : null,
  };
}

export function generationSoftGateMessage(overview: BasicsOverview): {
  tone: "emerald" | "amber" | "red";
  title: string;
  body: string;
  allowPrimaryGeneration: boolean;
} {
  if (overview.pendingDocumentCount === 0) {
    return {
      tone: "amber",
      title: "尚未识别待编制文件",
      body: "请先在文件材料页上传并解析，形成待编制清单后再确认基础数据。",
      allowPrimaryGeneration: false,
    };
  }
  if (overview.conflictCount > 0 || overview.openConflictRecords > 0) {
    return {
      tone: "red",
      title: "存在未处理冲突",
      body: "建议先完成冲突裁决再生成；未处理冲突仍可生成受控草稿，但会标记待确认并阻止定稿。",
      allowPrimaryGeneration: true,
    };
  }
  if (overview.upstreamQualityCount > 0 && overview.upstreamQualityCount >= 3) {
    return {
      tone: "amber",
      title: "上游依据质检有待处理项",
      body: "请先查看上游依据汇入区的分析与质量检查；禁止映射项不得自动写入招标正式值。",
      allowPrimaryGeneration: true,
    };
  }
  if (overview.missingBlockingCount > 0 || overview.aiCandidateCount > 0) {
    return {
      tone: "amber",
      title: "基础数据尚未全部确认",
      body: "未确认项可以带【待确认】进入草稿；P0/P1 问题仍会阻止定稿。",
      allowPrimaryGeneration: true,
    };
  }
  return {
    tone: "emerald",
    title: "基础数据已就绪",
    body: "关键字段已确认，可以进入文档生成。",
    allowPrimaryGeneration: true,
  };
}
