import { describe, expect, it } from "vitest";
import type { FieldValue, FileRecord, Stage } from "../api/client";
import { buildUpstreamBasisReport } from "./upstreamBasis";

function field(
  partial: Partial<FieldValue> & Pick<FieldValue, "id" | "field_key" | "stage" | "status">,
): FieldValue {
  return {
    project_id: "p1",
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

function stage(partial: Partial<Stage> & Pick<Stage, "stage" | "status">): Stage {
  return {
    id: `${partial.stage}-id`,
    project_id: "p1",
    revision: 1,
    stale_reason: null,
    finalized_document_version_id: null,
    source_file_version_id: null,
    source_type: null,
    ...partial,
  } as Stage;
}

function file(partial: Partial<FileRecord> & Pick<FileRecord, "id" | "status">): FileRecord {
  return {
    project_id: "p1",
    stage: "demand",
    original_name: "a.pdf",
    size_bytes: 10,
    content_type: "application/pdf",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  } as FileRecord;
}

describe("buildUpstreamBasisReport", () => {
  it("reports empty basis when no upstream data", () => {
    const report = buildUpstreamBasisReport({
      projectId: "p1",
      stages: [
        stage({ stage: "demand", status: "not_started" }),
        stage({ stage: "requirement", status: "not_started" }),
        stage({ stage: "feasibility", status: "not_started" }),
      ],
      valuesByStage: {},
      filesByStage: {},
    });
    expect(report.analysisSummary.readyStageCount).toBe(0);
    expect(report.qualityIssues.some((item) => item.kind === "basis_missing")).toBe(true);
    expect(report.referenceRows).toEqual([]);
  });

  it("flags forbidden mapping when feasibility has total_investment", () => {
    const report = buildUpstreamBasisReport({
      projectId: "p1",
      stages: [
        stage({ stage: "demand", status: "finalized" }),
        stage({ stage: "requirement", status: "finalized" }),
        stage({ stage: "feasibility", status: "finalized" }),
      ],
      valuesByStage: {
        feasibility: [
          field({
            id: "v1",
            stage: "feasibility",
            field_key: "total_investment",
            status: "user_confirmed",
            value: "1000",
            evidence: [{ excerpt: "总投资1000万", source_file_id: "f1" } as never],
          }),
          field({
            id: "v2",
            stage: "feasibility",
            field_key: "construction_scope",
            status: "extracted",
            value: "全厂建设",
            evidence: [{ excerpt: "建设范围", source_file_id: "f1" } as never],
          }),
        ],
        demand: [
          field({
            id: "v3",
            stage: "demand",
            field_key: "project_name",
            status: "extracted",
            value: "示范项目",
            evidence: [{ excerpt: "项目名称", source_file_id: "f2" } as never],
          }),
        ],
      },
      filesByStage: {
        feasibility: [file({ id: "f1", status: "parsed", stage: "feasibility" })],
        demand: [file({ id: "f2", status: "parsed", stage: "demand" })],
      },
    });

    expect(report.analysisSummary.readyStageCount).toBeGreaterThan(0);
    expect(report.referenceRows.some((row) => row.group === "forbidden")).toBe(true);
    expect(
      report.referenceRows.some(
        (row) =>
          row.sourceFieldKey === "total_investment" && row.tenderFieldKey === "procurement_budget",
      ),
    ).toBe(true);
    expect(report.qualityIssues.some((item) => item.kind === "compliance_block")).toBe(true);
    expect(report.referenceRows.some((row) => row.group === "direct")).toBe(true);
  });

  it("detects cross-source project_name conflict", () => {
    const report = buildUpstreamBasisReport({
      projectId: "p1",
      stages: [
        stage({ stage: "demand", status: "in_progress" }),
        stage({ stage: "requirement", status: "in_progress" }),
        stage({ stage: "feasibility", status: "not_started" }),
      ],
      valuesByStage: {
        demand: [
          field({
            id: "a",
            stage: "demand",
            field_key: "project_name",
            status: "extracted",
            value: "名称A",
            evidence: [{ excerpt: "A", source_file_id: "f1" } as never],
          }),
        ],
        requirement: [
          field({
            id: "b",
            stage: "requirement",
            field_key: "project_name",
            status: "extracted",
            value: "名称B",
            evidence: [{ excerpt: "B", source_file_id: "f2" } as never],
          }),
        ],
      },
      filesByStage: {
        demand: [file({ id: "f1", status: "parsed" })],
        requirement: [file({ id: "f2", status: "parsed", stage: "requirement" })],
      },
    });

    expect(report.qualityIssues.some((item) => item.kind === "cross_conflict")).toBe(true);
    expect(report.analysisSummary.criticalQualityCount).toBeGreaterThan(0);
  });
});
