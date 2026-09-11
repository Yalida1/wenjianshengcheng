import type { FieldDefinition, FieldValue, ProcurementPlan } from "../api/client";

const TENDER_METHODS = new Set(["public_tender", "invited_tender", "tender"]);
const SCOPED_FIELD_RE = /^doc::([^:]+)::(.+)$/;

/** Explicitly shared across document groups; safe to resolve unscoped stage values. */
export const SHARED_FIELD_KEYS = new Set([
  "project_name",
  "project_owner",
  "project_location",
  "tenderer",
  "tender_agency",
  "tender_method",
  "announcement_media",
  "contact_information",
  "party_a",
]);

/** Must not fall back to stage-level values (prevents cross-package contamination). */
export const PACKAGE_SCOPED_FIELD_KEYS = new Set([
  "package_number",
  "procurement_scope",
  "procurement_budget",
  "maximum_price",
  "delivery_period",
  "delivery_location",
  "acceptance_criteria",
  "procurement_list",
  "technical_specifications",
  "installation_requirements",
  "training_requirements",
  "data_security_requirements",
  "interface_requirements",
  "operations_requirements",
  "warranty_requirements",
  "payment_terms",
  "bid_bond",
  "contract_scope",
  "final_contract_amount",
  "contract_duration",
  "estimated_amount",
]);

export type PendingDocumentStatus = "待确认" | "确认中" | "已完成";

export type PendingDocument = {
  id: string;
  code: string;
  name: string;
  scope: string;
  procurement_method: string;
  package_ids: string[];
  template_id: string | null;
  template_version: number | null;
  procurement_category?: string | null;
  business_subcategory?: string | null;
};

/** Applicable field shape from resolver API (subset used by completion/seed). */
export type ApplicableFieldLike = {
  field_key: string;
  label?: string;
  field_label?: string;
  data_type?: string;
  unit?: string | null;
  level?: string;
  criticality?: string;
  required: boolean;
  blocking?: boolean;
  empty_reason_code?: string | null;
  empty_reason_message?: string | null;
  display_order?: number;
  source?: string;
  source_stage?: string;
  required_for_phase?: string;
  input_role?: string;
};

export type ApplicableGroupMeta = {
  document_group_id: string;
  setup_incomplete?: boolean;
  setup_incomplete_reason?: string | null;
  template_config_errors?: Array<{ variable_key: string; message: string }>;
  fields?: ApplicableFieldLike[];
};

export function scopedFieldKey(groupId: string, fieldKey: string): string {
  return `doc::${groupId}::${fieldKey}`;
}

export function parseScopedFieldKey(
  fieldKey: string,
): { groupId: string; fieldKey: string } | null {
  const match = SCOPED_FIELD_RE.exec(fieldKey);
  if (!match) return null;
  return { groupId: match[1], fieldKey: match[2] };
}

export function isScopedFieldKey(fieldKey: string): boolean {
  return SCOPED_FIELD_RE.test(fieldKey);
}

export function isTenderProcurementMethod(method: string): boolean {
  return TENDER_METHODS.has(method);
}

export function pickPreferredProcurementPlan(
  plans: ProcurementPlan[] | undefined | null,
): ProcurementPlan | null {
  if (!plans?.length) return null;
  const tenderGroupCount = (plan: ProcurementPlan) =>
    plan.document_groups.filter(
      (item) => item.status === "active" && isTenderProcurementMethod(item.procurement_method),
    ).length;
  const withGroups = (items: ProcurementPlan[]) =>
    items.filter((item) => tenderGroupCount(item) > 0);

  const confirmedRecommended = withGroups(
    plans.filter((item) => item.status === "confirmed" && item.is_recommended),
  );
  if (confirmedRecommended[0]) return confirmedRecommended[0];

  const anyConfirmed = withGroups(plans.filter((item) => item.status === "confirmed"));
  if (anyConfirmed[0]) return anyConfirmed[0];

  const recommendedWithGroups = withGroups(plans.filter((item) => item.is_recommended));
  if (recommendedWithGroups[0]) return recommendedWithGroups[0];

  // 推荐方案若无待编制主文件，改选有清单的备选，避免页面误判“尚未识别”。
  const anyWithGroups = withGroups(plans);
  if (anyWithGroups[0]) return anyWithGroups[0];

  const recommended = plans.find((item) => item.is_recommended);
  return recommended ?? plans[0] ?? null;
}

export function listPendingDocuments(plan: ProcurementPlan | null): PendingDocument[] {
  if (!plan) return [];
  return plan.document_groups
    .filter(
      (item) => item.status === "active" && isTenderProcurementMethod(item.procurement_method),
    )
    .map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      scope: item.scope,
      procurement_method: item.procurement_method,
      package_ids: item.package_ids,
      template_id: item.template_id,
      template_version: item.template_version,
      procurement_category: item.procurement_category,
      business_subcategory: item.business_subcategory ?? null,
    }));
}

/** Structured duration/money-like payloads from extraction. */
export type StructuredAmountValue = {
  amount: number | string;
  unit?: string | null;
  raw?: string | null;
  qualifiers?: string[] | null;
};

export type FieldDisplayStateKind =
  | "material_candidate"
  | "package_candidate"
  | "manual_draft"
  | "saved_unconfirmed"
  | "confirmed"
  | "decision_required"
  | "compliance_blocked"
  | "no_reliable_source"
  | "extraction_pending"
  | "conflict"
  | "not_applicable"
  | "needs_verification";

export type FieldDisplayState = {
  kind: FieldDisplayStateKind;
  label: string;
  /** Hint under the badge; empty when none. */
  detail: string;
  tone: "emerald" | "blue" | "amber" | "slate" | "red";
};

export type DraftFieldOriginKind =
  | "scoped_value"
  | "shared_candidate"
  | "package_budget"
  | "package_scope"
  | "package_maximum"
  | "empty";

export type DraftFieldOrigin = {
  kind: DraftFieldOriginKind;
  /** Backend FieldValue.id when origin is an existing candidate/value. */
  candidateId?: string;
  hasEvidence: boolean;
  needsVerification: boolean;
};

export type DraftSeedResult = {
  values: Record<string, string>;
  origins: Record<string, DraftFieldOrigin>;
};

export type DocumentDraftState = {
  values: Record<string, string>;
  origins: Record<string, DraftFieldOrigin>;
  /** True after a successful seed with loaded data; never re-seed over this. */
  seeded: boolean;
  /** Field keys the user edited locally after seed. */
  dirtyKeys: string[];
};

const FIELD_DISPLAY_LABELS: Record<FieldDisplayStateKind, string> = {
  material_candidate: "材料候选（有证据）",
  package_candidate: "包级候选（有来源）",
  manual_draft: "人工草稿（未保存）",
  saved_unconfirmed: "已保存未确认",
  confirmed: "已确认",
  decision_required: "待采购决策",
  compliance_blocked: "合规不自动映射",
  no_reliable_source: "未发现可靠依据",
  extraction_pending: "提取异常/尚未提取",
  conflict: "冲突待核查",
  not_applicable: "不适用",
  needs_verification: "待核验",
};

export function isStructuredAmountValue(value: unknown): value is StructuredAmountValue {
  return value != null && typeof value === "object" && !Array.isArray(value) && "amount" in value;
}

export function parseStructuredAmountValue(value: unknown): StructuredAmountValue | null {
  if (isStructuredAmountValue(value)) {
    return {
      amount: value.amount,
      unit: value.unit ?? null,
      raw: value.raw ?? null,
      qualifiers: Array.isArray(value.qualifiers) ? value.qualifiers.map(String) : [],
    };
  }
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseStructuredAmountValue(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

/** Clean numeric duration: amount+unit and no qualifier / free-form raw mismatch. */
export function isCleanDurationValue(value: unknown, fallbackUnit?: string | null): boolean {
  const structured = parseStructuredAmountValue(value);
  if (structured) {
    const qualifiers = structured.qualifiers ?? [];
    if (qualifiers.length > 0) return false;
    const amount = Number(structured.amount);
    if (!Number.isFinite(amount)) return false;
    const unit = String(structured.unit ?? fallbackUnit ?? "").trim();
    if (!unit) return false;
    const raw = String(structured.raw ?? "").trim();
    if (raw) {
      const compactRaw = raw.replace(/\s/g, "");
      const expected = `${amount}${unit}`.replace(/\s/g, "");
      // Allow raw that is just "8个月" / "8 个月" style.
      if (compactRaw !== expected && !compactRaw.startsWith(expected)) {
        // Qualifier-like wording in raw.
        if (/建议|约|预计|不超过|不少于|左右|内完成|完成实施/.test(raw)) return false;
      }
    }
    return true;
  }
  if (typeof value === "number" && Number.isFinite(value)) return Boolean(fallbackUnit);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/建议|约|预计|不超过|不少于|左右|内/.test(trimmed) && /[月天年]/.test(trimmed)) {
      return false;
    }
    return /^-?\d+(\.\d+)?$/.test(trimmed) && Boolean(fallbackUnit);
  }
  return false;
}

export function durationInputMode(
  value: unknown,
  fallbackUnit?: string | null,
): "number_unit" | "text" {
  return isCleanDurationValue(value, fallbackUnit) ? "number_unit" : "text";
}

export function formatFieldValueForInput(value: unknown, dataType?: string): string {
  if (value == null) return "";
  const structured = parseStructuredAmountValue(value);
  if (structured) {
    if (dataType === "duration" || structured.unit) {
      if (isCleanDurationValue(structured)) {
        return String(structured.amount);
      }
      return String(structured.raw ?? `${structured.amount}${structured.unit ?? ""}`);
    }
    return String(structured.amount);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function fieldValueText(field: FieldValue | undefined): string {
  if (!field) return "";
  const raw = field.normalized_value ?? field.value ?? "";
  return formatFieldValueForInput(raw, field.data_type);
}

export function fieldHasEvidence(field: FieldValue | undefined): boolean {
  return Boolean(field?.evidence?.some((item) => item.excerpt || item.source_file_id || item.document_block_id));
}

export function valuesRoughlyEqual(left: unknown, right: unknown): boolean {
  const leftText = formatFieldValueForInput(left).trim();
  const rightText = formatFieldValueForInput(right).trim();
  if (leftText === rightText) return true;
  const leftNum = Number(leftText);
  const rightNum = Number(rightText);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftText !== "" && rightText !== "") {
    return leftNum === rightNum;
  }
  return false;
}

/** Copy backend evidence refs for adopt/save — never invent excerpts. */
export function evidencePayloadFromField(
  field: FieldValue | undefined,
  extraMetadata?: Record<string, unknown>,
): Record<string, unknown> | null {
  const evidence = field?.evidence?.[0];
  if (!evidence) return null;
  const payload: Record<string, unknown> = {
    source_file_id: evidence.source_file_id,
    source_file_version_id: evidence.source_file_version_id,
    document_block_id: evidence.document_block_id,
    page_number: evidence.page_number,
    section_path: evidence.section_path,
    excerpt: evidence.excerpt,
    extraction_method: evidence.extraction_method,
    confidence: evidence.confidence,
  };
  if (extraMetadata) {
    Object.assign(payload, extraMetadata);
  }
  if (!payload.source_file_version_id && !payload.document_block_id && !payload.excerpt) {
    return null;
  }
  return payload;
}

export type FieldSavePlan = {
  mode: "adopt_candidate" | "manual_edit" | "manual_create";
  value: unknown;
  normalized_value: unknown;
  unit: string | null;
  status: "extracted" | "missing" | "ai_suggested" | "conflict" | "invalid" | "reference_only";
  source_type: string;
  evidence: Record<string, unknown> | null;
  confidence: number | null;
};

export function buildFieldSavePlan(args: {
  definition: Pick<FieldDefinition, "field_key" | "data_type" | "unit">;
  draftText: string;
  /** Preferred material/shared candidate used for provenance (may be unscoped). */
  candidate: FieldValue | undefined;
  scopedExisting: FieldValue | undefined;
  manualEvidence?: string | null;
  origin?: DraftFieldOrigin | null;
}): FieldSavePlan {
  const { definition, draftText, candidate, scopedExisting, origin } = args;
  const manualEvidence = args.manualEvidence?.trim() ?? "";
  const trimmed = draftText.trim();
  const parsedDuration = parseStructuredAmountValue(candidate?.normalized_value ?? candidate?.value);
  const valueFromDraft = (): { value: unknown; unit: string | null } => {
    if (definition.field_key === "bid_bond" || definition.field_key.endsWith("::bid_bond")) {
      return { value: trimmed, unit: definition.unit };
    }
    if (definition.data_type === "payment_plan") {
      return { value: JSON.parse(trimmed), unit: definition.unit };
    }
    if (definition.data_type === "duration") {
      if (durationInputMode(trimmed, definition.unit) === "text" || !isCleanDurationValue(trimmed, definition.unit)) {
        // Preserve unstructured / qualified duration as object when candidate had structure.
        if (parsedDuration && valuesRoughlyEqual(parsedDuration.raw ?? parsedDuration, trimmed)) {
          return { value: parsedDuration, unit: parsedDuration.unit ?? definition.unit };
        }
        if (/建议|约|预计|不超过|不少于|左右|内|[月天年]/.test(trimmed) && !/^-?\d+(\.\d+)?$/.test(trimmed)) {
          return {
            value: {
              amount: trimmed,
              unit: definition.unit,
              raw: trimmed,
              qualifiers: ["unstructured"],
            },
            unit: definition.unit,
          };
        }
      }
      const amount = Number(trimmed);
      const unit = definition.unit ?? parsedDuration?.unit ?? null;
      if (Number.isFinite(amount) && unit) {
        return {
          value: { amount, unit, raw: `${amount}${unit}`, qualifiers: [] },
          unit,
        };
      }
      return { value: trimmed, unit: definition.unit };
    }
    if (
      definition.data_type === "money" ||
      definition.data_type === "percentage" ||
      (definition.data_type === "duration" && Boolean(definition.unit))
    ) {
      return { value: Number(trimmed), unit: definition.unit };
    }
    return { value: trimmed, unit: definition.unit };
  };

  const { value, unit } = valueFromDraft();
  const candidateValue = candidate?.normalized_value ?? candidate?.value;
  const scopedValue = scopedExisting?.normalized_value ?? scopedExisting?.value;
  const adoptingCandidate =
    Boolean(candidate) &&
    valuesRoughlyEqual(candidateValue, value) &&
    valuesRoughlyEqual(candidateValue, trimmed);
  const adoptingScoped =
    Boolean(scopedExisting) &&
    valuesRoughlyEqual(scopedValue, value) &&
    (scopedExisting?.source_type === "extracted" || scopedExisting?.status === "extracted");

  const bidBondManual =
    (definition.field_key === "bid_bond" || definition.field_key.endsWith("::bid_bond")) &&
    manualEvidence
      ? {
          excerpt: manualEvidence,
          extraction_method: "manual",
          section_path: "投标保证金确认依据",
        }
      : null;

  if ((adoptingCandidate || adoptingScoped) && (fieldHasEvidence(candidate) || fieldHasEvidence(scopedExisting))) {
    const source = fieldHasEvidence(scopedExisting) ? scopedExisting : candidate;
    const evidence =
      bidBondManual ??
      evidencePayloadFromField(source, {
        source_field_key: source?.field_key,
        adopted_from_field_value_id: source?.id,
      });
    return {
      mode: "adopt_candidate",
      value: source?.normalized_value ?? source?.value ?? value,
      normalized_value: source?.normalized_value ?? source?.value ?? value,
      unit: source?.unit ?? unit,
      status:
        source?.status === "ai_suggested"
          ? "ai_suggested"
          : source?.status === "conflict"
            ? "conflict"
            : "extracted",
      source_type: source?.source_type === "ai_suggested" ? "ai_suggested" : "extracted",
      evidence,
      confidence: source?.confidence ?? null,
    };
  }

  // Manual change: keep reference to candidate evidence when available (not invented).
  const referenceEvidence =
    evidencePayloadFromField(candidate ?? scopedExisting, {
      source_field_key: (candidate ?? scopedExisting)?.field_key,
      source_field_value_id: (candidate ?? scopedExisting)?.id,
      edit_trail: "manual_override",
    }) ?? bidBondManual;

  if (scopedExisting || candidate) {
    return {
      mode: "manual_edit",
      value,
      normalized_value: value,
      unit,
      status: "missing",
      source_type: "user_input",
      evidence: bidBondManual ?? referenceEvidence,
      confidence: null,
    };
  }

  // Package seed / blank create — never invent material evidence.
  return {
    mode: "manual_create",
    value,
    normalized_value: value,
    unit,
    status: "missing",
    source_type: "user_input",
    evidence: bidBondManual,
    confidence: null,
  };
}

export function resolveFieldDisplayState(args: {
  fieldKey: string;
  required?: boolean;
  emptyReasonCode?: string | null;
  emptyReasonMessage?: string | null;
  scopedValue?: FieldValue;
  candidateValue?: FieldValue;
  draftText?: string;
  draftDirty?: boolean;
  origin?: DraftFieldOrigin | null;
  extractionLoaded?: boolean;
}): FieldDisplayState {
  const emptyCode = args.emptyReasonCode ?? null;
  const detail = args.emptyReasonMessage?.trim() ?? "";

  if (args.scopedValue?.status === "not_applicable" || emptyCode === "NOT_APPLICABLE") {
    return {
      kind: "not_applicable",
      label: FIELD_DISPLAY_LABELS.not_applicable,
      detail,
      tone: "slate",
    };
  }

  if (
    args.scopedValue?.status === "user_confirmed" ||
    args.scopedValue?.status === "system_confirmed"
  ) {
    return {
      kind: "confirmed",
      label: FIELD_DISPLAY_LABELS.confirmed,
      detail: "",
      tone: "emerald",
    };
  }

  if (args.scopedValue?.status === "conflict" || args.candidateValue?.status === "conflict") {
    return {
      kind: "conflict",
      label: FIELD_DISPLAY_LABELS.conflict,
      detail: detail || "存在冲突候选，请核查后保存并确认。",
      tone: "red",
    };
  }

  if (args.draftDirty) {
    return {
      kind: "manual_draft",
      label: FIELD_DISPLAY_LABELS.manual_draft,
      detail: "本地已修改，尚未保存到当前文件作用域。",
      tone: "amber",
    };
  }

  if (
    args.scopedValue &&
    args.scopedValue.value != null &&
    String(formatFieldValueForInput(args.scopedValue.value)).trim() !== "" &&
    args.scopedValue.status !== "extracted" &&
    args.scopedValue.status !== "ai_suggested"
  ) {
    return {
      kind: "saved_unconfirmed",
      label: FIELD_DISPLAY_LABELS.saved_unconfirmed,
      detail: "",
      tone: "amber",
    };
  }

  const material =
    (args.scopedValue &&
      (args.scopedValue.status === "extracted" || args.scopedValue.status === "ai_suggested") &&
      fieldHasEvidence(args.scopedValue) &&
      args.scopedValue) ||
    (args.candidateValue &&
      (args.candidateValue.status === "extracted" ||
        args.candidateValue.status === "ai_suggested") &&
      fieldHasEvidence(args.candidateValue) &&
      args.candidateValue);

  if (material) {
    return {
      kind: "material_candidate",
      label: FIELD_DISPLAY_LABELS.material_candidate,
      detail: "材料提取候选，确认前不等于正式值。",
      tone: "blue",
    };
  }

  // Scoped/shared extracted without evidence — historical seed → 待核验
  const extractedNoEvidence =
    (args.scopedValue?.status === "extracted" && !fieldHasEvidence(args.scopedValue)
      ? args.scopedValue
      : null) ||
    (args.candidateValue?.status === "extracted" && !fieldHasEvidence(args.candidateValue)
      ? args.candidateValue
      : null);

  if (
    args.origin?.kind === "package_budget" ||
    args.origin?.kind === "package_maximum" ||
    args.origin?.kind === "package_scope"
  ) {
    return {
      kind: "package_candidate",
      label: FIELD_DISPLAY_LABELS.package_candidate,
      detail: "来自采购包/文件组织信息，不是材料原文摘录。",
      tone: "blue",
    };
  }

  if (extractedNoEvidence || args.origin?.needsVerification) {
    return {
      kind: "needs_verification",
      label: FIELD_DISPLAY_LABELS.needs_verification,
      detail: "历史候选缺少可核验证据，请人工核对后保存确认。",
      tone: "amber",
    };
  }

  // Draft text alone must NOT be treated as material-sourced.
  if (emptyCode === "DECISION_REQUIRED") {
    return {
      kind: "decision_required",
      label: FIELD_DISPLAY_LABELS.decision_required,
      detail: detail || "该字段属于采购/招标阶段决策事项。",
      tone: "amber",
    };
  }
  if (emptyCode === "COMPLIANCE_NOT_AUTO_MAPPED") {
    return {
      kind: "compliance_blocked",
      label: FIELD_DISPLAY_LABELS.compliance_blocked,
      detail: detail || "合规规则禁止自动代入，需人工确认。",
      tone: "amber",
    };
  }

  if (args.scopedValue?.status === "missing" || args.scopedValue?.status === "invalid") {
    return {
      kind: "saved_unconfirmed",
      label:
        args.scopedValue.status === "invalid"
          ? "格式有误"
          : FIELD_DISPLAY_LABELS.saved_unconfirmed,
      detail: detail,
      tone: "amber",
    };
  }

  if (args.extractionLoaded === false) {
    return {
      kind: "extraction_pending",
      label: FIELD_DISPLAY_LABELS.extraction_pending,
      detail: "字段候选尚未加载完成。",
      tone: "slate",
    };
  }

  if (emptyCode === "MATERIAL_NOT_FOUND" || !args.draftText?.trim()) {
    return {
      kind: "no_reliable_source",
      label: FIELD_DISPLAY_LABELS.no_reliable_source,
      detail: detail || "原文未发现可可靠提取的信息。",
      tone: "slate",
    };
  }

  // Has draft text from seed without classified origin — still 待核验, not material.
  if (args.draftText?.trim()) {
    return {
      kind: "needs_verification",
      label: FIELD_DISPLAY_LABELS.needs_verification,
      detail: "当前输入来自本地草稿，尚未建立带证据的正式候选。",
      tone: "amber",
    };
  }

  return {
    kind: "extraction_pending",
    label: FIELD_DISPLAY_LABELS.extraction_pending,
    detail: "",
    tone: "slate",
  };
}

export function resolveGroupFieldValue(
  values: FieldValue[] | undefined,
  groupId: string,
  fieldKey: string,
): FieldValue | undefined {
  const scoped = values?.find((item) => item.field_key === scopedFieldKey(groupId, fieldKey));
  if (scoped) return scoped;
  // Package-scoped commercial fields must never fall back to stage shared values.
  if (PACKAGE_SCOPED_FIELD_KEYS.has(fieldKey)) {
    return undefined;
  }
  if (!SHARED_FIELD_KEYS.has(fieldKey)) {
    return undefined;
  }
  return values?.find((item) => item.field_key === fieldKey && !isScopedFieldKey(item.field_key));
}

export function sortApplicableFields<T extends { field_key: string; display_order?: number }>(
  fields: T[],
  fieldOrder: string[],
): T[] {
  return [...fields].sort((left, right) => {
    const leftOrder = fieldOrder.indexOf(left.field_key);
    const rightOrder = fieldOrder.indexOf(right.field_key);
    const leftRank = leftOrder < 0 ? 10_000 + (left.display_order ?? 999) : leftOrder;
    const rightRank = rightOrder < 0 ? 10_000 + (right.display_order ?? 999) : rightOrder;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.field_key.localeCompare(right.field_key);
  });
}

export function applicableToFieldDefinition(
  field: ApplicableFieldLike,
  fallback?: FieldDefinition,
): FieldDefinition {
  return {
    id: fallback?.id ?? `applicable:${field.field_key}`,
    stage: fallback?.stage ?? "tender",
    field_key: field.field_key,
    field_label: field.label ?? field.field_label ?? fallback?.field_label ?? field.field_key,
    data_type: field.data_type ?? fallback?.data_type ?? "string",
    unit: field.unit ?? fallback?.unit ?? null,
    criticality: (field.level ??
      field.criticality ??
      fallback?.criticality ??
      "P2") as FieldDefinition["criticality"],
    required: field.required,
    is_base: fallback?.is_base ?? false,
    is_active: true,
    rules: fallback?.rules ?? {},
    revision: fallback?.revision ?? 1,
  };
}

export function pendingDocumentStatus(args: {
  groupId: string;
  definitions: Array<Pick<FieldDefinition, "field_key" | "required"> | ApplicableFieldLike>;
  values: FieldValue[] | undefined;
  setupIncomplete?: boolean;
}): PendingDocumentStatus {
  if (args.setupIncomplete) {
    const scopedForGroup = (args.values ?? []).filter(
      (item) => parseScopedFieldKey(item.field_key)?.groupId === args.groupId,
    );
    return scopedForGroup.length > 0 ? "确认中" : "待确认";
  }
  const required = args.definitions.filter((item) => item.required);
  const scopedForGroup = (args.values ?? []).filter(
    (item) => parseScopedFieldKey(item.field_key)?.groupId === args.groupId,
  );
  if (required.length === 0) {
    return scopedForGroup.length > 0 ? "确认中" : "待确认";
  }
  let confirmed = 0;
  let touched = 0;
  for (const definition of required) {
    const scopedOnly = args.values?.find(
      (item) => item.field_key === scopedFieldKey(args.groupId, definition.field_key),
    );
    if (scopedOnly) touched += 1;
    // 仅统计本文件作用域下已确认字段，避免共享候选值让多份文件同时“已完成”
    if (
      scopedOnly?.value != null &&
      formatFieldValueForInput(scopedOnly.value).trim() !== "" &&
      (scopedOnly.status === "user_confirmed" || scopedOnly.status === "system_confirmed")
    ) {
      confirmed += 1;
    }
  }
  if (confirmed >= required.length) return "已完成";
  if (touched > 0 || confirmed > 0) return "确认中";
  return "待确认";
}

export function allPendingDocumentsConfirmed(args: {
  documents: PendingDocument[];
  /** Per-group applicable definitions. Falls back to shared definitions when map missing. */
  definitionsByGroup?: Record<
    string,
    Array<Pick<FieldDefinition, "field_key" | "required"> | ApplicableFieldLike>
  >;
  definitions?: Array<Pick<FieldDefinition, "field_key" | "required"> | ApplicableFieldLike>;
  values: FieldValue[] | undefined;
  setupIncompleteByGroup?: Record<string, boolean>;
}): boolean {
  if (args.documents.length === 0) return false;
  return args.documents.every((document) => {
    if (args.setupIncompleteByGroup?.[document.id]) return false;
    const definitions = args.definitionsByGroup?.[document.id] ?? args.definitions ?? [];
    return (
      pendingDocumentStatus({
        groupId: document.id,
        definitions,
        values: args.values,
        setupIncomplete: args.setupIncompleteByGroup?.[document.id],
      }) === "已完成"
    );
  });
}

export function firstIncompletePendingDocumentId(
  documents: PendingDocument[],
  definitionsOrByGroup:
    | Array<Pick<FieldDefinition, "field_key" | "required"> | ApplicableFieldLike>
    | Record<string, Array<Pick<FieldDefinition, "field_key" | "required"> | ApplicableFieldLike>>,
  values: FieldValue[] | undefined,
): string {
  const isMap = !Array.isArray(definitionsOrByGroup);
  const incomplete = documents.find((document) => {
    const definitions = isMap ? (definitionsOrByGroup[document.id] ?? []) : definitionsOrByGroup;
    return (
      pendingDocumentStatus({
        groupId: document.id,
        definitions,
        values,
      }) !== "已完成"
    );
  });
  return incomplete?.id ?? documents[0]?.id ?? "";
}

export function buildDraftSeed(args: {
  document: PendingDocument;
  definitions: Array<Pick<FieldDefinition, "field_key"> | ApplicableFieldLike>;
  values: FieldValue[] | undefined;
  packages?: Array<{
    id: string;
    confirmed_budget?: string | number | null;
    estimated_amount?: string | number | null;
    maximum_price?: string | number | null;
    scope?: string | null;
  }>;
}): DraftSeedResult {
  const linkedPackages = (args.packages ?? []).filter((item) =>
    args.document.package_ids.includes(item.id),
  );
  // Only same-package confirmed_budget may seed a draft candidate (never estimated_amount).
  const budget =
    linkedPackages.map((item) => item.confirmed_budget).find((item) => item != null && item !== "") ??
    null;
  const maximum = linkedPackages.map((item) => item.maximum_price).find(Boolean) ?? null;
  const packageScope = linkedPackages.map((item) => item.scope).find((item) => item?.trim()) ?? "";
  const scopeSeed = args.document.scope || packageScope || "";
  const scopeKind: DraftFieldOriginKind = args.document.scope
    ? "package_scope"
    : packageScope
      ? "package_scope"
      : "empty";

  const packageSeeds: Record<string, { value: string; kind: DraftFieldOriginKind }> = {};
  if (scopeSeed) {
    packageSeeds.procurement_scope = { value: scopeSeed, kind: scopeKind };
  }
  if (budget != null && budget !== "") {
    packageSeeds.procurement_budget = { value: String(budget), kind: "package_budget" };
  }
  if (maximum != null && maximum !== "") {
    packageSeeds.maximum_price = { value: String(maximum), kind: "package_maximum" };
  }

  const applicableKeys = new Set(args.definitions.map((item) => item.field_key));
  const drafts: Record<string, string> = {};
  const origins: Record<string, DraftFieldOrigin> = {};
  for (const definition of args.definitions) {
    const scoped = args.values?.find(
      (item) => item.field_key === scopedFieldKey(args.document.id, definition.field_key),
    );
    const existing = resolveGroupFieldValue(args.values, args.document.id, definition.field_key);
    if (scoped) {
      drafts[definition.field_key] = fieldValueText(scoped);
      origins[definition.field_key] = {
        kind: "scoped_value",
        candidateId: scoped.id,
        hasEvidence: fieldHasEvidence(scoped),
        needsVerification: scoped.status === "extracted" && !fieldHasEvidence(scoped),
      };
      continue;
    }
    if (existing) {
      drafts[definition.field_key] = fieldValueText(existing);
      origins[definition.field_key] = {
        kind: "shared_candidate",
        candidateId: existing.id,
        hasEvidence: fieldHasEvidence(existing),
        needsVerification: existing.status === "extracted" && !fieldHasEvidence(existing),
      };
      continue;
    }
    const packageSeed = packageSeeds[definition.field_key];
    if (packageSeed && applicableKeys.has(definition.field_key)) {
      drafts[definition.field_key] = packageSeed.value;
      origins[definition.field_key] = {
        kind: packageSeed.kind,
        hasEvidence: false,
        needsVerification: true,
      };
      continue;
    }
    origins[definition.field_key] = {
      kind: "empty",
      hasEvidence: false,
      needsVerification: false,
    };
  }
  return { values: drafts, origins };
}

export function seedDraftForPendingDocument(args: {
  document: PendingDocument;
  definitions: Array<Pick<FieldDefinition, "field_key"> | ApplicableFieldLike>;
  values: FieldValue[] | undefined;
  packages?: Array<{
    id: string;
    confirmed_budget?: string | number | null;
    estimated_amount?: string | number | null;
    maximum_price?: string | number | null;
    scope?: string | null;
  }>;
}): Record<string, string> {
  return buildDraftSeed(args).values;
}

/** Whether FieldsPanel may run the one-shot seed for a document. */
export function canSeedDocumentDraft(args: {
  alreadySeeded: boolean;
  valuesLoaded: boolean;
  applicableLoaded: boolean;
}): boolean {
  if (args.alreadySeeded) return false;
  return args.valuesLoaded && args.applicableLoaded;
}

export function countScopedRequiredProgress(args: {
  groupId: string;
  definitions: Array<Pick<FieldDefinition, "field_key" | "required"> | ApplicableFieldLike>;
  values: FieldValue[] | undefined;
}): { required: number; confirmed: number; materialCandidates: number } {
  const requiredDefs = args.definitions.filter((item) => item.required);
  let confirmed = 0;
  let materialCandidates = 0;
  for (const definition of requiredDefs) {
    const scoped = args.values?.find(
      (item) => item.field_key === scopedFieldKey(args.groupId, definition.field_key),
    );
    if (
      scoped?.value != null &&
      String(formatFieldValueForInput(scoped.value)).trim() !== "" &&
      (scoped.status === "user_confirmed" || scoped.status === "system_confirmed")
    ) {
      confirmed += 1;
    }
  }
  for (const definition of args.definitions) {
    const scoped = args.values?.find(
      (item) => item.field_key === scopedFieldKey(args.groupId, definition.field_key),
    );
    const shared =
      !PACKAGE_SCOPED_FIELD_KEYS.has(definition.field_key) && SHARED_FIELD_KEYS.has(definition.field_key)
        ? args.values?.find(
            (item) => item.field_key === definition.field_key && !isScopedFieldKey(item.field_key),
          )
        : undefined;
    const candidate = scoped ?? shared;
    if (
      candidate &&
      (candidate.status === "extracted" || candidate.status === "ai_suggested") &&
      fieldHasEvidence(candidate)
    ) {
      materialCandidates += 1;
    }
  }
  return {
    required: requiredDefs.length,
    confirmed,
    materialCandidates,
  };
}

export function hasProtectedFieldConfirmations(values: FieldValue[] | undefined): boolean {
  return (values ?? []).some(
    (item) =>
      item.status === "user_confirmed" ||
      item.status === "system_confirmed" ||
      (isScopedFieldKey(item.field_key) && Boolean(fieldValueText(item).trim())),
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
