import { describe, expect, it } from "vitest";
import type { FieldDefinition, FieldValue, ProcurementPlan } from "../api/client";
import {
  allPendingDocumentsConfirmed,
  buildDraftSeed,
  buildFieldSavePlan,
  canSeedDocumentDraft,
  countScopedRequiredProgress,
  durationInputMode,
  firstIncompletePendingDocumentId,
  formatFieldValueForInput,
  isCleanDurationValue,
  listPendingDocuments,
  pendingDocumentStatus,
  pickPreferredProcurementPlan,
  PACKAGE_SCOPED_FIELD_KEYS,
  resolveFieldDisplayState,
  resolveGroupFieldValue,
  scopedFieldKey,
  seedDraftForPendingDocument,
  SHARED_FIELD_KEYS,
  sortApplicableFields,
} from "./tenderWorkflow";

const definitions = [
  {
    id: "d1",
    field_key: "project_name",
    field_label: "项目名称",
    required: true,
  },
  {
    id: "d2",
    field_key: "procurement_scope",
    field_label: "采购范围",
    required: true,
  },
] as FieldDefinition[];

function planWithGroups(): ProcurementPlan {
  return {
    id: "plan-1",
    status: "recommended",
    is_recommended: true,
    document_groups: [
      {
        id: "g1",
        code: "DOC-01",
        name: "软件招标文件",
        status: "active",
        procurement_method: "public_tender",
        scope: "软件范围",
        package_ids: [],
        template_id: null,
        template_version: null,
      },
      {
        id: "g2",
        code: "DOC-02",
        name: "设备招标文件",
        status: "active",
        procurement_method: "public_tender",
        scope: "设备范围",
        package_ids: [],
        template_id: null,
        template_version: null,
      },
    ],
  } as unknown as ProcurementPlan;
}

function materialCandidate(overrides: Partial<FieldValue> = {}): FieldValue {
  return {
    id: "fv-material",
    project_id: "p1",
    stage: "tender",
    field_key: "procurement_scope",
    field_label: "采购范围",
    data_type: "text",
    value: "软件实施范围",
    normalized_value: "软件实施范围",
    unit: null,
    criticality: "P0",
    status: "extracted",
    source_type: "extracted",
    confidence: 0.9,
    revision: 1,
    evidence: [
      {
        id: "ev1",
        source_file_id: "file-1",
        source_file_version_id: "ver-1",
        document_block_id: "block-1",
        page_number: 3,
        section_path: "采购范围",
        excerpt: "软件实施范围包括…",
        extraction_method: "rule_based",
        confidence: 0.9,
      },
    ],
    ...overrides,
  } as FieldValue;
}

describe("tenderWorkflow pending documents", () => {
  it("lists active tender document groups", () => {
    const pending = listPendingDocuments(planWithGroups());
    expect(pending.map((item) => item.name)).toEqual(["软件招标文件", "设备招标文件"]);
  });

  it("prefers a non-empty alternative over an empty recommended plan", () => {
    const emptyRecommended = {
      id: "rec",
      status: "draft",
      is_recommended: true,
      document_groups: [],
    } as unknown as ProcurementPlan;
    const alternative = {
      id: "alt",
      status: "draft",
      is_recommended: false,
      document_groups: [
        {
          id: "g1",
          code: "DOC-01",
          name: "软件招标文件",
          status: "active",
          procurement_method: "public_tender",
          scope: "软件范围",
          package_ids: [],
          template_id: null,
          template_version: null,
        },
      ],
    } as unknown as ProcurementPlan;
    expect(pickPreferredProcurementPlan([emptyRecommended, alternative])?.id).toBe("alt");
  });

  it("tracks per-document confirmation status independently", () => {
    const values = [
      {
        field_key: scopedFieldKey("g1", "project_name"),
        value: "A",
        status: "user_confirmed",
      },
      {
        field_key: scopedFieldKey("g1", "procurement_scope"),
        value: "软件",
        status: "user_confirmed",
      },
      {
        field_key: scopedFieldKey("g2", "project_name"),
        value: "A",
        status: "missing",
      },
    ] as FieldValue[];

    expect(pendingDocumentStatus({ groupId: "g1", definitions, values })).toBe("已完成");
    expect(pendingDocumentStatus({ groupId: "g2", definitions, values })).toBe("确认中");
    expect(
      allPendingDocumentsConfirmed({
        documents: listPendingDocuments(planWithGroups()),
        definitions,
        values,
      }),
    ).toBe(false);
    expect(
      firstIncompletePendingDocumentId(listPendingDocuments(planWithGroups()), definitions, values),
    ).toBe("g2");
  });

  it("counts only applicable required fields for completion", () => {
    const applicableA = [
      { field_key: "project_name", required: true },
      { field_key: "procurement_scope", required: true },
    ];
    const applicableB = [
      { field_key: "project_name", required: true },
      { field_key: "procurement_list", required: true },
      { field_key: "bid_bond", required: false },
    ];
    const values = [
      {
        field_key: scopedFieldKey("g1", "project_name"),
        value: "A",
        status: "user_confirmed",
      },
      {
        field_key: scopedFieldKey("g1", "procurement_scope"),
        value: "软件",
        status: "user_confirmed",
      },
      {
        field_key: scopedFieldKey("g2", "project_name"),
        value: "A",
        status: "user_confirmed",
      },
      {
        field_key: scopedFieldKey("g2", "procurement_list"),
        value: "清单",
        status: "user_confirmed",
      },
      {
        field_key: scopedFieldKey("g1", "bid_deadline"),
        value: null,
        status: "missing",
      },
    ] as FieldValue[];

    expect(pendingDocumentStatus({ groupId: "g1", definitions: applicableA, values })).toBe(
      "已完成",
    );
    expect(pendingDocumentStatus({ groupId: "g2", definitions: applicableB, values })).toBe(
      "已完成",
    );
    expect(
      allPendingDocumentsConfirmed({
        documents: listPendingDocuments(planWithGroups()),
        definitionsByGroup: { g1: applicableA, g2: applicableB },
        values,
      }),
    ).toBe(true);
  });

  it("ignores optional empty fields when judging completed", () => {
    const defs = [
      { field_key: "project_name", required: true },
      { field_key: "bid_bond", required: false },
    ];
    const values = [
      {
        field_key: scopedFieldKey("g1", "project_name"),
        value: "A",
        status: "user_confirmed",
      },
    ] as FieldValue[];
    expect(pendingDocumentStatus({ groupId: "g1", definitions: defs, values })).toBe("已完成");
  });

  it("seeds drafts only for applicable fields", () => {
    const document = listPendingDocuments(planWithGroups())[0];
    const drafts = seedDraftForPendingDocument({
      document: { ...document, package_ids: ["p1"], scope: "文件范围" },
      definitions: [{ field_key: "project_name" }, { field_key: "procurement_scope" }],
      values: [
        {
          field_key: "project_name",
          value: "共享候选名",
          status: "extracted",
        } as FieldValue,
      ],
      packages: [
        {
          id: "p1",
          confirmed_budget: 100,
          maximum_price: 120,
          scope: "包范围",
        },
      ],
    });
    expect(drafts.project_name).toBe("共享候选名");
    expect(drafts.procurement_scope).toBe("文件范围");
    expect(drafts.procurement_budget).toBeUndefined();
    expect(drafts.maximum_price).toBeUndefined();
  });

  it("does not seed procurement_budget from estimated_amount", () => {
    const document = listPendingDocuments(planWithGroups())[0];
    const drafts = seedDraftForPendingDocument({
      document: { ...document, package_ids: ["p1"], scope: "文件范围" },
      definitions: [
        { field_key: "procurement_budget" },
        { field_key: "maximum_price" },
        { field_key: "procurement_scope" },
      ],
      values: [],
      packages: [
        {
          id: "p1",
          estimated_amount: 2_180_000,
          confirmed_budget: null,
          maximum_price: null,
          scope: "平台建设",
        },
      ],
    });
    expect(drafts.procurement_budget).toBeUndefined();
    expect(drafts.maximum_price).toBeUndefined();
    expect(drafts.procurement_scope).toBe("文件范围");
  });

  it("seeds confirmed_budget only as draft candidate for same package", () => {
    const document = listPendingDocuments(planWithGroups())[0];
    const drafts = seedDraftForPendingDocument({
      document: { ...document, package_ids: ["p1"], scope: "文件范围" },
      definitions: [{ field_key: "procurement_budget" }],
      values: [],
      packages: [
        {
          id: "p1",
          confirmed_budget: 1_000_000,
          estimated_amount: 2_180_000,
        },
      ],
    });
    expect(drafts.procurement_budget).toBe("1000000");
  });

  it("does not fall back stage values for package-scoped fields", () => {
    const values = [
      {
        field_key: "procurement_budget",
        value: 2_180_000,
        status: "extracted",
      },
      {
        field_key: "project_name",
        value: "共享项目",
        status: "extracted",
      },
      {
        field_key: scopedFieldKey("g1", "procurement_scope"),
        value: "P01范围",
        status: "extracted",
      },
    ] as FieldValue[];
    expect(SHARED_FIELD_KEYS.has("project_name")).toBe(true);
    expect(PACKAGE_SCOPED_FIELD_KEYS.has("procurement_budget")).toBe(true);
    expect(resolveGroupFieldValue(values, "g1", "project_name")?.value).toBe("共享项目");
    expect(resolveGroupFieldValue(values, "g1", "procurement_budget")).toBeUndefined();
    expect(resolveGroupFieldValue(values, "g1", "procurement_scope")?.value).toBe("P01范围");
    expect(resolveGroupFieldValue(values, "g2", "procurement_scope")).toBeUndefined();
  });

  it("keeps shared candidates as drafts without auto-confirming", () => {
    const values = [
      {
        field_key: "project_name",
        value: "共享项目",
        status: "extracted",
      },
    ] as FieldValue[];
    for (const groupId of ["g1", "g2"]) {
      expect(
        pendingDocumentStatus({
          groupId,
          definitions: [{ field_key: "project_name", required: true }],
          values,
        }),
      ).toBe("待确认");
    }
    const seeded = seedDraftForPendingDocument({
      document: listPendingDocuments(planWithGroups())[0],
      definitions: [{ field_key: "project_name" }],
      values,
    });
    expect(seeded.project_name).toBe("共享项目");
  });

  it("sorts applicable fields by FIELD_ORDER then display_order", () => {
    const sorted = sortApplicableFields(
      [
        { field_key: "bid_bond", display_order: 10 },
        { field_key: "maximum_price", display_order: 30 },
        { field_key: "project_name", display_order: 99 },
        { field_key: "zzz_custom", display_order: 5 },
      ],
      ["project_name", "procurement_scope", "procurement_budget", "maximum_price"],
    );
    expect(sorted.map((item) => item.field_key)).toEqual([
      "project_name",
      "maximum_price",
      "zzz_custom",
      "bid_bond",
    ]);
  });
});

describe("unified field display state", () => {
  it("does not disguise package seed text as material-sourced", () => {
    const state = resolveFieldDisplayState({
      fieldKey: "procurement_scope",
      emptyReasonCode: "MATERIAL_NOT_FOUND",
      emptyReasonMessage: "原文未发现可可靠提取的信息，需人工补充或确认。",
      draftText: "软件范围",
      draftDirty: false,
      origin: {
        kind: "package_scope",
        hasEvidence: false,
        needsVerification: true,
      },
      extractionLoaded: true,
    });
    expect(state.kind).toBe("package_candidate");
    expect(state.label).toContain("包级候选");
  });

  it("marks historical extracted values without evidence as needs verification", () => {
    const state = resolveFieldDisplayState({
      fieldKey: "project_name",
      candidateValue: {
        id: "fv1",
        status: "extracted",
        source_type: "extracted",
        value: "历史项目",
        evidence: [],
      } as unknown as FieldValue,
      draftText: "历史项目",
      extractionLoaded: true,
    });
    expect(state.kind).toBe("needs_verification");
  });

  it("shows material candidate only when evidence exists", () => {
    const state = resolveFieldDisplayState({
      fieldKey: "procurement_scope",
      candidateValue: materialCandidate(),
      draftText: "软件实施范围",
      extractionLoaded: true,
    });
    expect(state.kind).toBe("material_candidate");
  });

  it("prefers compliance / decision empty reasons when no candidate text origin", () => {
    expect(
      resolveFieldDisplayState({
        fieldKey: "procurement_budget",
        emptyReasonCode: "COMPLIANCE_NOT_AUTO_MAPPED",
        extractionLoaded: true,
      }).kind,
    ).toBe("compliance_blocked");
    expect(
      resolveFieldDisplayState({
        fieldKey: "bid_bond",
        emptyReasonCode: "DECISION_REQUIRED",
        extractionLoaded: true,
      }).kind,
    ).toBe("decision_required");
  });

  it("tracks dirty draft separately from saved confirmation", () => {
    expect(
      resolveFieldDisplayState({
        fieldKey: "project_name",
        scopedValue: {
          id: "s1",
          status: "missing",
          source_type: "user_input",
          value: "A",
          evidence: [],
        } as unknown as FieldValue,
        draftText: "B",
        draftDirty: true,
        extractionLoaded: true,
      }).kind,
    ).toBe("manual_draft");
  });
});

describe("seed readiness and provenance", () => {
  it("seeds only once after values and applicable fields are ready", () => {
    expect(
      canSeedDocumentDraft({ alreadySeeded: false, valuesLoaded: false, applicableLoaded: true }),
    ).toBe(false);
    expect(
      canSeedDocumentDraft({ alreadySeeded: false, valuesLoaded: true, applicableLoaded: true }),
    ).toBe(true);
    expect(
      canSeedDocumentDraft({ alreadySeeded: true, valuesLoaded: true, applicableLoaded: true }),
    ).toBe(false);
  });

  it("records package seed origins for verification", () => {
    const document = listPendingDocuments(planWithGroups())[0];
    const seeded = buildDraftSeed({
      document: { ...document, package_ids: ["p1"], scope: "文件范围" },
      definitions: [{ field_key: "procurement_scope" }, { field_key: "procurement_budget" }],
      values: [],
      packages: [{ id: "p1", confirmed_budget: 100 }],
    });
    expect(seeded.origins.procurement_scope.kind).toBe("package_scope");
    expect(seeded.origins.procurement_scope.needsVerification).toBe(true);
    expect(seeded.origins.procurement_budget.kind).toBe("package_budget");
  });

  it("adopts material candidate with evidence chain and keeps manual edits as user_input", () => {
    const candidate = materialCandidate();
    const adopted = buildFieldSavePlan({
      definition: {
        field_key: "procurement_scope",
        data_type: "text",
        unit: null,
      },
      draftText: "软件实施范围",
      candidate,
      scopedExisting: undefined,
    });
    expect(adopted.mode).toBe("adopt_candidate");
    expect(adopted.status).toBe("extracted");
    expect(adopted.source_type).toBe("extracted");
    expect(adopted.evidence?.excerpt).toBe("软件实施范围包括…");
    expect(adopted.evidence?.adopted_from_field_value_id).toBe("fv-material");

    const edited = buildFieldSavePlan({
      definition: {
        field_key: "procurement_scope",
        data_type: "text",
        unit: null,
      },
      draftText: "人工改写后的范围",
      candidate,
      scopedExisting: undefined,
    });
    expect(edited.mode).toBe("manual_edit");
    expect(edited.status).toBe("missing");
    expect(edited.source_type).toBe("user_input");
    expect(edited.evidence?.edit_trail).toBe("manual_override");
    expect(edited.evidence?.excerpt).toBe("软件实施范围包括…");
  });

  it("aligns scoped required progress with pendingDocumentStatus", () => {
    const defs = [
      { field_key: "project_name", required: true },
      { field_key: "procurement_scope", required: true },
    ];
    const values = [
      {
        field_key: scopedFieldKey("g1", "project_name"),
        value: "A",
        status: "user_confirmed",
      },
      {
        field_key: "procurement_scope",
        value: "共享候选",
        status: "extracted",
        evidence: [
          {
            excerpt: "x",
            extraction_method: "rule",
            id: "e",
            confidence: null,
            document_block_id: null,
            page_number: null,
            section_path: null,
            source_file_id: "f",
            source_file_version_id: null,
          },
        ],
      },
    ] as FieldValue[];
    const progress = countScopedRequiredProgress({
      groupId: "g1",
      definitions: defs,
      values,
    });
    expect(progress.required).toBe(2);
    expect(progress.confirmed).toBe(1);
    expect(pendingDocumentStatus({ groupId: "g1", definitions: defs, values })).toBe("确认中");
  });
});

describe("duration input modes", () => {
  it("uses number+unit for clean durations and text for qualified raw", () => {
    expect(
      isCleanDurationValue({ amount: 8, unit: "个月", raw: "8个月", qualifiers: [] }),
    ).toBe(true);
    expect(durationInputMode({ amount: 8, unit: "个月", qualifiers: [] }, "个月")).toBe(
      "number_unit",
    );
    expect(
      durationInputMode(
        { amount: 8, unit: "个月", raw: "建议8个月内完成实施", qualifiers: ["建议", "内"] },
        "个月",
      ),
    ).toBe("text");
    expect(formatFieldValueForInput({ amount: 8, unit: "个月", qualifiers: [] }, "duration")).toBe(
      "8",
    );
    expect(
      formatFieldValueForInput(
        { amount: 8, unit: "个月", raw: "建议8个月内完成实施", qualifiers: ["建议"] },
        "duration",
      ),
    ).toContain("建议");
  });

  it("saves clean duration as structured amount object", () => {
    const plan = buildFieldSavePlan({
      definition: { field_key: "delivery_period", data_type: "duration", unit: "个月" },
      draftText: "8",
      candidate: undefined,
      scopedExisting: undefined,
    });
    expect(plan.value).toEqual({ amount: 8, unit: "个月", raw: "8个月", qualifiers: [] });
  });
});
