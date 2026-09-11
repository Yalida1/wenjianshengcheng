import { describe, expect, it } from "vitest";
import {
  buildBasicsIntelligence,
  generationSoftGateMessage,
} from "./basicsIntelligence";
import type { FieldValue } from "../api/client";

function field(partial: Partial<FieldValue> & Pick<FieldValue, "id" | "field_key" | "status">): FieldValue {
  return {
    project_id: "p1",
    stage: "tender",
    field_label: partial.field_key,
    data_type: "text",
    value: partial.value ?? null,
    normalized_value: partial.normalized_value ?? partial.value ?? null,
    unit: null,
    criticality: "P0",
    source_type: "extracted",
    confidence: null,
    revision: 1,
    evidence: partial.evidence ?? [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  } as FieldValue;
}

describe("buildBasicsIntelligence", () => {
  const document = {
    id: "g1",
    code: "DOC-1",
    name: "招标文件-A包",
    scope: "设备采购",
    procurement_method: "public_tender",
    package_ids: ["pkg1"],
    template_id: "t1",
    template_version: 1,
  };

  it("aggregates conflicts, candidates and amount guardrails", () => {
    const result = buildBasicsIntelligence({
      documents: [document],
      definitionsByGroup: {
        g1: [
          {
            field_key: "procurement_budget",
            field_label: "招标预算",
            required: true,
            criticality: "P0",
          },
          {
            field_key: "maximum_price",
            field_label: "最高限价",
            required: true,
            criticality: "P0",
          },
          {
            field_key: "procurement_scope",
            field_label: "采购范围",
            required: true,
            criticality: "P0",
            empty_reason_code: "COMPLIANCE_NOT_AUTO_MAPPED",
            empty_reason_message: "建设范围不能自动映射为采购范围",
          },
        ],
      },
      values: [
        field({
          id: "v1",
          field_key: "doc::g1::procurement_budget",
          status: "conflict",
          value: "100",
        }),
        field({
          id: "v2",
          field_key: "doc::g1::maximum_price",
          status: "extracted",
          value: "120",
          evidence: [{ excerpt: "最高限价120万", source_file_id: "f1" } as never],
        }),
        field({
          id: "v3",
          field_key: "doc::g1::procurement_scope",
          status: "ai_suggested",
          value: "候选范围",
          evidence: [{ excerpt: "范围摘录", source_file_id: "f1" } as never],
        }),
      ],
      referenceValues: [
        field({
          id: "ref1",
          field_key: "total_investment",
          status: "user_confirmed",
          value: "100",
          stage: "feasibility",
        }),
      ],
      conflictRecords: [
        {
          id: "c1",
          field_key: "doc::g1::procurement_budget",
          candidate_field_value_ids: ["v1"],
          status: "open",
          revision: 1,
        },
      ],
    });

    expect(result.overview.conflictCount).toBeGreaterThan(0);
    expect(result.overview.openConflictRecords).toBe(1);
    expect(result.conflicts.some((item) => item.fieldKey === "procurement_budget")).toBe(true);
    expect(result.candidates.some((item) => item.fieldKey === "procurement_scope")).toBe(true);
    expect(result.compliance.some((item) => item.kind === "amount_guard")).toBe(true);
    expect(result.compliance.some((item) => item.id.includes("max_gt_budget"))).toBe(true);
    expect(result.firstFocus?.fieldKey).toBe("procurement_budget");
  });

  it("merges upstream quality issues into overview", () => {
    const result = buildBasicsIntelligence({
      documents: [document],
      definitionsByGroup: {
        g1: [
          {
            field_key: "project_name",
            field_label: "项目名称",
            required: true,
            criticality: "P0",
          },
        ],
      },
      values: [],
      upstreamQualityIssues: [
        {
          id: "q1",
          severity: "critical",
          title: "项目名称冲突",
          detail: "多源不一致",
          tenderFieldKey: "project_name",
        },
      ],
    });
    expect(result.overview.upstreamQualityCount).toBe(1);
    expect(result.upstreamQuality[0]?.fieldKey).toBe("project_name");
  });

  it("reports soft gate messages by overview state", () => {
    expect(
      generationSoftGateMessage({
        conflictCount: 0,
        missingBlockingCount: 0,
        aiCandidateCount: 0,
        confirmedRequiredCount: 0,
        requiredCount: 0,
        pendingDocumentCount: 0,
        completedDocumentCount: 0,
        openConflictRecords: 0,
        upstreamQualityCount: 0,
      }).allowPrimaryGeneration,
    ).toBe(false);

    expect(
      generationSoftGateMessage({
        conflictCount: 1,
        missingBlockingCount: 0,
        aiCandidateCount: 0,
        confirmedRequiredCount: 1,
        requiredCount: 2,
        pendingDocumentCount: 1,
        completedDocumentCount: 0,
        openConflictRecords: 1,
        upstreamQualityCount: 0,
      }).tone,
    ).toBe("red");

    expect(
      generationSoftGateMessage({
        conflictCount: 0,
        missingBlockingCount: 0,
        aiCandidateCount: 0,
        confirmedRequiredCount: 3,
        requiredCount: 3,
        pendingDocumentCount: 1,
        completedDocumentCount: 1,
        openConflictRecords: 0,
        upstreamQualityCount: 0,
      }).tone,
    ).toBe("emerald");
  });
});
