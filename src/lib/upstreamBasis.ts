import type { FieldValue, FileRecord, Stage } from "../api/client";
import { fieldHasEvidence, formatFieldValueForInput, valuesRoughlyEqual } from "./tenderWorkflow";

export type BasisStageKey = "demand" | "requirement" | "feasibility";

export const BASIS_STAGE_DEFS: Array<{
  stage: BasisStageKey;
  name: string;
  hint: string;
}> = [
  {
    stage: "demand",
    name: "项目需求",
    hint: "需求说明等材料解析结果，可供招标引用。",
  },
  {
    stage: "requirement",
    name: "建议书",
    hint: "建设目标与范围等解析结果，可供招标引用。",
  },
  {
    stage: "feasibility",
    name: "可行性研究报告",
    hint: "方案、投资与边界解析结果；部分字段禁止直映招标决策值。",
  },
];

/** Upstream fields that may be adopted into same-key tender fields when evidence exists. */
export const DIRECT_REFERENCE_FIELDS: Array<{
  fieldKey: string;
  label: string;
  stages: BasisStageKey[];
}> = [
  { fieldKey: "project_name", label: "项目名称", stages: ["demand", "requirement", "feasibility"] },
  { fieldKey: "project_owner", label: "项目业主", stages: ["demand", "requirement"] },
  { fieldKey: "project_location", label: "项目地点", stages: ["demand", "feasibility"] },
];

/**
 * Forbidden auto-mappings (mirrors backend FORBIDDEN_FIELD_MAPPINGS for tender).
 * Shown as reference-only rows; never auto-write.
 */
export const FORBIDDEN_REFERENCE_PAIRS: Array<{
  sourceStage: BasisStageKey;
  sourceFieldKey: string;
  sourceLabel: string;
  tenderFieldKey: string;
  tenderLabel: string;
  reason: string;
}> = [
  {
    sourceStage: "feasibility",
    sourceFieldKey: "total_investment",
    sourceLabel: "可研总投资",
    tenderFieldKey: "procurement_budget",
    tenderLabel: "招标预算",
    reason: "可研总投资不等于招标预算，禁止自动映射。",
  },
  {
    sourceStage: "feasibility",
    sourceFieldKey: "total_investment",
    sourceLabel: "可研总投资",
    tenderFieldKey: "maximum_price",
    tenderLabel: "最高限价",
    reason: "可研总投资不等于最高限价，禁止自动映射。",
  },
  {
    sourceStage: "feasibility",
    sourceFieldKey: "construction_scope",
    sourceLabel: "建设范围",
    tenderFieldKey: "procurement_scope",
    tenderLabel: "采购范围",
    reason: "项目全部建设范围不等于单份采购范围，禁止自动映射。",
  },
  {
    sourceStage: "feasibility",
    sourceFieldKey: "project_period",
    sourceLabel: "建设周期",
    tenderFieldKey: "delivery_period",
    tenderLabel: "交货/服务期限",
    reason: "项目总建设周期不等于单份合同履行期限，禁止自动映射。",
  },
  {
    sourceStage: "requirement",
    sourceFieldKey: "project_period",
    sourceLabel: "建设周期",
    tenderFieldKey: "delivery_period",
    tenderLabel: "交货/服务期限",
    reason: "建议书建设周期不得直接写成交货期限。",
  },
];

export type BasisCardStatus =
  | "not_started"
  | "uploaded"
  | "has_candidates"
  | "finalized"
  | "stale";

export type UpstreamBasisCard = {
  stage: BasisStageKey;
  name: string;
  hint: string;
  status: BasisCardStatus;
  statusLabel: string;
  fileCount: number;
  parsedFileCount: number;
  fieldCount: number;
  missingCriticalHint: string | null;
  staleReason: string | null;
  href: string;
};

export type UpstreamReferenceAction = "adopt_candidate" | "manual_decision" | "forbidden_map";

export type UpstreamReferenceRow = {
  id: string;
  group: "direct" | "forbidden";
  sourceStage: BasisStageKey;
  sourceStageName: string;
  sourceFieldKey: string;
  sourceLabel: string;
  valueText: string;
  hasEvidence: boolean;
  hasValue: boolean;
  tenderFieldKey: string;
  tenderLabel: string;
  action: UpstreamReferenceAction;
  actionLabel: string;
  detail: string;
};

export type UpstreamQualityKind =
  | "basis_missing"
  | "cross_conflict"
  | "weak_evidence"
  | "compliance_block"
  | "stale_risk";

export type UpstreamQualityIssue = {
  id: string;
  kind: UpstreamQualityKind;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  /** Jump to basis stage files/fields when set. */
  basisHref?: string;
  /** Focus a tender field when set. */
  tenderFieldKey?: string;
  sourceStage?: BasisStageKey;
};

export type UpstreamAnalysisSummary = {
  readyStageCount: number;
  totalStageCount: number;
  directReferenceCount: number;
  forbiddenReferenceCount: number;
  qualityIssueCount: number;
  criticalQualityCount: number;
  headline: string;
  body: string;
};

export type UpstreamBasisReport = {
  basisCards: UpstreamBasisCard[];
  referenceRows: UpstreamReferenceRow[];
  qualityIssues: UpstreamQualityIssue[];
  analysisSummary: UpstreamAnalysisSummary;
};

function stageName(stage: BasisStageKey): string {
  return BASIS_STAGE_DEFS.find((item) => item.stage === stage)?.name ?? stage;
}

function fieldPayload(field: FieldValue | undefined): unknown {
  if (!field) return null;
  return field.normalized_value ?? field.value ?? null;
}

function fieldText(field: FieldValue | undefined): string {
  const payload = fieldPayload(field);
  if (payload == null || payload === "") return "";
  return formatFieldValueForInput(payload, field?.data_type).trim();
}

function pickField(values: FieldValue[] | undefined, fieldKey: string): FieldValue | undefined {
  return (values ?? []).find((item) => item.field_key === fieldKey);
}

function stageRecord(stages: Stage[] | undefined, stage: BasisStageKey): Stage | undefined {
  return (stages ?? []).find((item) => item.stage === stage);
}

function cardStatus(args: {
  stage: Stage | undefined;
  files: FileRecord[];
  values: FieldValue[];
}): BasisCardStatus {
  if (args.stage?.stale_reason) return "stale";
  if (args.stage?.status === "finalized") return "finalized";
  const withValue = args.values.filter((item) => fieldText(item) !== "");
  if (withValue.length > 0) return "has_candidates";
  if (args.files.length > 0 || (args.stage && args.stage.status !== "not_started")) return "uploaded";
  return "not_started";
}

function cardStatusLabel(status: BasisCardStatus): string {
  switch (status) {
    case "finalized":
      return "已定稿可引用";
    case "has_candidates":
      return "有字段候选";
    case "uploaded":
      return "已上传/解析中";
    case "stale":
      return "上游已过期";
    default:
      return "未开始";
  }
}

export function buildUpstreamBasisReport(args: {
  projectId: string;
  stages: Stage[] | undefined;
  valuesByStage: Partial<Record<BasisStageKey, FieldValue[] | undefined>>;
  filesByStage: Partial<Record<BasisStageKey, FileRecord[] | undefined>>;
  /** Optional tender-stage values for stale / decision context. */
  tenderStage?: Stage | undefined;
}): UpstreamBasisReport {
  const basisCards: UpstreamBasisCard[] = BASIS_STAGE_DEFS.map((def) => {
    const stage = stageRecord(args.stages, def.stage);
    const files = args.filesByStage[def.stage] ?? [];
    const values = args.valuesByStage[def.stage] ?? [];
    const status = cardStatus({ stage, files, values });
    const fieldCount = values.filter((item) => fieldText(item) !== "").length;
    const parsedFileCount = files.filter((item) => item.status === "parsed").length;
    let missingCriticalHint: string | null = null;
    if (status === "not_started") {
      missingCriticalHint = "尚未上传材料";
    } else if (fieldCount === 0) {
      missingCriticalHint = "尚无可用解析字段";
    }
    return {
      stage: def.stage,
      name: def.name,
      hint: def.hint,
      status,
      statusLabel: cardStatusLabel(status),
      fileCount: files.length,
      parsedFileCount,
      fieldCount,
      missingCriticalHint,
      staleReason: stage?.stale_reason ?? null,
      href: `/projects/${args.projectId}/stages/${def.stage}/files`,
    };
  });

  const referenceRows: UpstreamReferenceRow[] = [];

  for (const def of DIRECT_REFERENCE_FIELDS) {
    for (const sourceStage of def.stages) {
      const field = pickField(args.valuesByStage[sourceStage], def.fieldKey);
      const text = fieldText(field);
      if (!text) continue;
      const hasEvidence = fieldHasEvidence(field);
      referenceRows.push({
        id: `direct:${sourceStage}:${def.fieldKey}`,
        group: "direct",
        sourceStage,
        sourceStageName: stageName(sourceStage),
        sourceFieldKey: def.fieldKey,
        sourceLabel: def.label,
        valueText: text,
        hasEvidence,
        hasValue: true,
        tenderFieldKey: def.fieldKey,
        tenderLabel: def.label,
        action: hasEvidence ? "adopt_candidate" : "manual_decision",
        actionLabel: hasEvidence ? "可作为候选采纳" : "需人工核对后填写",
        detail: hasEvidence
          ? "同名字段且有证据，可写入招标候选后人工确认。"
          : "有值但缺少证据，请人工核对来源后再填写招标字段。",
      });
    }
  }

  for (const pair of FORBIDDEN_REFERENCE_PAIRS) {
    const field = pickField(args.valuesByStage[pair.sourceStage], pair.sourceFieldKey);
    const text = fieldText(field);
    if (!text) continue;
    referenceRows.push({
      id: `forbidden:${pair.sourceStage}:${pair.sourceFieldKey}->${pair.tenderFieldKey}`,
      group: "forbidden",
      sourceStage: pair.sourceStage,
      sourceStageName: stageName(pair.sourceStage),
      sourceFieldKey: pair.sourceFieldKey,
      sourceLabel: pair.sourceLabel,
      valueText: text,
      hasEvidence: fieldHasEvidence(field),
      hasValue: true,
      tenderFieldKey: pair.tenderFieldKey,
      tenderLabel: pair.tenderLabel,
      action: "forbidden_map",
      actionLabel: "禁止直映 · 仅供参考",
      detail: pair.reason,
    });
  }

  const qualityIssues: UpstreamQualityIssue[] = [];

  for (const card of basisCards) {
    if (card.status === "not_started" || card.fieldCount === 0) {
      qualityIssues.push({
        id: `missing:${card.stage}`,
        kind: "basis_missing",
        severity: card.stage === "feasibility" ? "warning" : "info",
        title: `${card.name}依据不足`,
        detail: card.missingCriticalHint ?? "请上传并解析材料后回到本页汇入。",
        basisHref: card.href,
        sourceStage: card.stage,
      });
    }
    if (card.staleReason) {
      qualityIssues.push({
        id: `stale:${card.stage}`,
        kind: "stale_risk",
        severity: "warning",
        title: `${card.name}已标记过期`,
        detail: card.staleReason,
        basisHref: card.href,
        sourceStage: card.stage,
      });
    }
  }

  if (args.tenderStage?.stale_reason) {
    qualityIssues.push({
      id: "stale:tender",
      kind: "stale_risk",
      severity: "critical",
      title: "招标阶段受上游变化影响",
      detail: args.tenderStage.stale_reason,
      tenderFieldKey: undefined,
    });
  }

  for (const def of DIRECT_REFERENCE_FIELDS) {
    const present = def.stages
      .map((sourceStage) => ({
        sourceStage,
        field: pickField(args.valuesByStage[sourceStage], def.fieldKey),
      }))
      .filter((item) => fieldText(item.field) !== "");
    if (present.length < 2) continue;
    const first = present[0];
    const conflict = present.some(
      (item) => !valuesRoughlyEqual(fieldPayload(first.field), fieldPayload(item.field)),
    );
    if (!conflict) continue;
    qualityIssues.push({
      id: `cross:${def.fieldKey}`,
      kind: "cross_conflict",
      severity: "critical",
      title: `${def.label}在多源不一致`,
      detail: present
        .map((item) => `${stageName(item.sourceStage)}：${fieldText(item.field)}`)
        .join("；"),
      tenderFieldKey: def.fieldKey,
    });
  }

  for (const row of referenceRows) {
    if (row.group !== "direct" || !row.hasValue || row.hasEvidence) continue;
    qualityIssues.push({
      id: `weak:${row.id}`,
      kind: "weak_evidence",
      severity: "warning",
      title: `${row.sourceLabel}缺少可核验证据`,
      detail: `来自${row.sourceStageName}的值缺少原文摘录或来源文件，请人工核对。`,
      basisHref: `/projects/${args.projectId}/stages/${row.sourceStage}/fields`,
      tenderFieldKey: row.tenderFieldKey,
      sourceStage: row.sourceStage,
    });
  }

  for (const row of referenceRows.filter((item) => item.group === "forbidden")) {
    qualityIssues.push({
      id: `compliance:${row.id}`,
      kind: "compliance_block",
      severity: "warning",
      title: `${row.sourceLabel}不可直映为${row.tenderLabel}`,
      detail: row.detail,
      tenderFieldKey: row.tenderFieldKey,
      sourceStage: row.sourceStage,
      basisHref: `/projects/${args.projectId}/stages/${row.sourceStage}/fields`,
    });
  }

  const readyStageCount = basisCards.filter(
    (card) => card.status === "has_candidates" || card.status === "finalized",
  ).length;
  const criticalQualityCount = qualityIssues.filter((item) => item.severity === "critical").length;
  const directReferenceCount = referenceRows.filter((item) => item.group === "direct").length;
  const forbiddenReferenceCount = referenceRows.filter((item) => item.group === "forbidden").length;

  let headline = "上游依据待汇入";
  let body = "请先完成项目需求、建议书或可研的材料上传与解析，再回到本页核对基础数据。";
  if (readyStageCount > 0 && criticalQualityCount === 0) {
    headline = "上游依据可引用";
    body = `已有 ${readyStageCount}/${basisCards.length} 个依据阶段提供候选；禁止映射项仅作参考，须人工决策招标字段。`;
  } else if (readyStageCount > 0) {
    headline = "上游依据已汇入，存在质检问题";
    body = `发现 ${qualityIssues.length} 项分析/质检提示（含 ${criticalQualityCount} 项严重），请先处理冲突或补齐依据。`;
  }

  return {
    basisCards,
    referenceRows,
    qualityIssues,
    analysisSummary: {
      readyStageCount,
      totalStageCount: basisCards.length,
      directReferenceCount,
      forbiddenReferenceCount,
      qualityIssueCount: qualityIssues.length,
      criticalQualityCount,
      headline,
      body,
    },
  };
}
