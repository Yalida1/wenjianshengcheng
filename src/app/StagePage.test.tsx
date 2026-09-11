import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  NO_BID_BOND_VALUE,
  PaymentPlanEditor,
  SourceFileDropZone,
  bidBondEvidenceError,
  fieldDraftGuidance,
  normalizeBidBondValue,
  sourceFileSelectionError,
  toggleGenerationSectionSelection,
  uploadSourceFileBatch,
} from "./StagePage";

const validPlan = JSON.stringify([
  { label: "预付款", ratio: 30, amount: 300, trigger: "合同生效" },
  { label: "初验款", ratio: 40, amount: 400, trigger: "完成初验" },
  { label: "终验款", ratio: 30, amount: 300, trigger: "完成终验" },
]);

const generationOutline = [
  {
    id: "root-1",
    key: "chapter-1",
    title: "第一章",
    sequence: 1,
    parent_id: null,
    level: 1,
    required: true,
  },
  {
    id: "child-1",
    key: "chapter-1-1",
    title: "第一节",
    sequence: 2,
    parent_id: "root-1",
    level: 2,
    required: true,
  },
  {
    id: "child-2",
    key: "chapter-1-2",
    title: "第二节",
    sequence: 3,
    parent_id: "root-1",
    level: 2,
    required: true,
  },
  {
    id: "root-2",
    key: "chapter-2",
    title: "第二章",
    sequence: 4,
    parent_id: null,
    level: 1,
    required: true,
  },
];

describe("generation chapter selection", () => {
  it("allows a small chapter to be selected independently", () => {
    expect(toggleGenerationSectionSelection([], generationOutline, "chapter-1-1")).toEqual([
      "chapter-1-1",
    ]);
  });

  it("selects and clears the full subtree when a parent chapter is toggled", () => {
    const selected = toggleGenerationSectionSelection([], generationOutline, "chapter-1");
    expect(selected).toEqual(["chapter-1", "chapter-1-1", "chapter-1-2"]);
    expect(toggleGenerationSectionSelection(selected, generationOutline, "chapter-1")).toEqual([]);
  });

  it("allows a child to be excluded after selecting its parent", () => {
    const selected = toggleGenerationSectionSelection([], generationOutline, "chapter-1");
    expect(toggleGenerationSectionSelection(selected, generationOutline, "chapter-1-2")).toEqual([
      "chapter-1",
      "chapter-1-1",
    ]);
  });
});

describe("fieldDraftGuidance", () => {
  it("asks to regenerate after fields are confirmed when a draft already exists", () => {
    const guidance = fieldDraftGuidance({
      projectId: "p1",
      stage: "tender",
      documentId: "d1",
      documentVersion: 2,
      confirmedCount: 2,
      completedRequiredCount: 2,
      requiredCount: 4,
      pendingDocumentCount: 1,
      allPendingConfirmed: true,
    });
    expect(guidance.kind).toBe("needs_regen");
    expect(guidance.primaryLabel).toBe("基于已确认字段重新生成");
    expect(guidance.primaryTo).toContain("/generation?from=basics");
    expect(guidance.body).toContain("不会自动改写");
  });

  it("keeps current draft openable before any confirmation", () => {
    const guidance = fieldDraftGuidance({
      projectId: "p1",
      stage: "feasibility",
      documentId: "d1",
      documentVersion: 2,
      confirmedCount: 0,
      completedRequiredCount: 0,
      requiredCount: 4,
    });
    expect(guidance.kind).toBe("candidate_draft");
    expect(guidance.primaryTo).toContain("/documents/d1");
    expect(guidance.secondaryTo).toContain("/generation?from=fields");
  });

  it("sends tender users back to files when pending documents are missing", () => {
    const guidance = fieldDraftGuidance({
      projectId: "p1",
      stage: "tender",
      documentId: "d1",
      documentVersion: 1,
      confirmedCount: 0,
      completedRequiredCount: 0,
      requiredCount: 4,
      pendingDocumentCount: 0,
    });
    expect(guidance.kind).toBe("no_draft");
    expect(guidance.primaryTo).toContain("/stages/tender/files");
    expect(guidance.secondaryTo).toContain("/documents/d1");
    expect(guidance.body).toContain("待编制清单");
  });

  it("points tender empty draft flow to procurement source upload", () => {
    const guidance = fieldDraftGuidance({
      projectId: "p1",
      stage: "tender",
      confirmedCount: 0,
      completedRequiredCount: 0,
      requiredCount: 4,
    });
    expect(guidance.kind).toBe("no_draft");
    expect(guidance.primaryTo).toContain("/stages/tender/files");
    expect(guidance.body).toContain("上传并解析");
    expect(guidance.body).not.toContain("上传可研后");
  });

  it("allows a controlled draft before all pending tender documents are confirmed", () => {
    const guidance = fieldDraftGuidance({
      projectId: "p1",
      stage: "tender",
      confirmedCount: 2,
      completedRequiredCount: 2,
      requiredCount: 4,
      pendingDocumentCount: 2,
      allPendingConfirmed: false,
    });
    expect(guidance.primaryTo).toContain("/stages/tender/generation?from=basics");
    expect(guidance.secondaryTo).toContain("/stages/tender/basics");
    expect(guidance.body).toContain("2 份招标文件");
    expect(guidance.body).toContain("【待确认】");
    expect(guidance.body).toContain("阻止定稿");
  });

  it("allows a controlled draft when no tender fields have been confirmed", () => {
    const guidance = fieldDraftGuidance({
      projectId: "p1",
      stage: "tender",
      confirmedCount: 0,
      completedRequiredCount: 0,
      requiredCount: 4,
      pendingDocumentCount: 1,
      allPendingConfirmed: false,
    });
    expect(guidance.primaryLabel).toBe("生成受控草稿");
    expect(guidance.primaryTo).toContain("/stages/tender/generation?from=basics");
  });
});

describe("bid bond confirmation", () => {
  it("normalizes a no-bond statement and requires a retained basis", () => {
    expect(normalizeBidBondValue("本项目不收取投标保证金")).toBe(NO_BID_BOND_VALUE);
    expect(normalizeBidBondValue("本项目无需缴纳投标保证金")).toBe(NO_BID_BOND_VALUE);
    expect(bidBondEvidenceError(NO_BID_BOND_VALUE, "")).toBe("请填写不收取投标保证金的确认依据");
    expect(bidBondEvidenceError(NO_BID_BOND_VALUE, "采购审批意见第 6 条")).toBeNull();
  });
});

describe("FieldsPanel field display contracts", () => {
  it("keeps package-seeded draft text from being labeled as material missing", async () => {
    const { resolveFieldDisplayState } = await import("../lib/tenderWorkflow");
    const state = resolveFieldDisplayState({
      fieldKey: "procurement_scope",
      emptyReasonCode: "MATERIAL_NOT_FOUND",
      draftText: "文件组织范围",
      origin: { kind: "package_scope", hasEvidence: false, needsVerification: true },
      extractionLoaded: true,
    });
    expect(state.kind).not.toBe("no_reliable_source");
    expect(state.kind).toBe("package_candidate");
  });

  it("switches duration controls between number+unit and text confirmation", async () => {
    const { durationInputMode } = await import("../lib/tenderWorkflow");
    expect(durationInputMode({ amount: 12, unit: "个月", qualifiers: [] }, "个月")).toBe(
      "number_unit",
    );
    expect(
      durationInputMode(
        { amount: 8, unit: "个月", raw: "建议8个月内完成", qualifiers: ["建议"] },
        "个月",
      ),
    ).toBe("text");
  });
});

describe("PaymentPlanEditor", () => {
  it("shows payment ratio and amount totals", () => {
    render(<PaymentPlanEditor value={validPlan} onChange={vi.fn()} />);
    expect(screen.getByText("100%")).toHaveClass("text-emerald-700");
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });

  it("emits a structured payment plan after editing", () => {
    const changed = vi.fn();
    render(<PaymentPlanEditor value={validPlan} onChange={changed} />);
    const input = screen.getByLabelText("付款比例 1");
    fireEvent.change(input, { target: { value: "20" } });

    const latest = changed.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(latest)[0].ratio).toBe(20);
  });
});

describe("SourceFileDropZone", () => {
  it("accepts a supported file dropped onto the upload area", () => {
    const selected = vi.fn();
    const onError = vi.fn();
    const file = new File(["demo"], "可行性研究报告.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    render(
      <SourceFileDropZone
        selectedFiles={[]}
        disabled={false}
        onSelect={selected}
        onError={onError}
      />,
    );

    fireEvent.drop(screen.getByRole("button", { name: "选择或拖拽上传来源文件" }), {
      dataTransfer: { files: [file] },
    });

    expect(onError).toHaveBeenLastCalledWith(null);
    expect(selected).toHaveBeenCalledWith([file]);
  });

  it("accepts multiple supported files selected in one batch", () => {
    const selected = vi.fn();
    const files = [new File(["x"], "一.pdf"), new File(["y"], "二.pdf")];
    render(
      <SourceFileDropZone
        selectedFiles={[]}
        disabled={false}
        onSelect={selected}
        onError={vi.fn()}
      />,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute("multiple");
    fireEvent.change(input, { target: { files } });

    expect(selected).toHaveBeenCalledWith(files);
    expect(sourceFileSelectionError(files)).toBeNull();
  });

  it("rejects an unsupported file anywhere in a batch", () => {
    expect(
      sourceFileSelectionError([new File(["x"], "说明.pdf"), new File(["y"], "附件.txt")]),
    ).toBe("附件.txt：仅支持 DOCX、PDF、XLSX、PNG、JPG、JPEG 文件");
  });

  it("uploads every selected file and reports partial failures", async () => {
    const files = [new File(["x"], "一.pdf"), new File(["y"], "二.pdf")];
    const uploadFile = vi.fn(async (file: File) => {
      if (file.name === "二.pdf") throw new Error("服务暂不可用");
      return file.name;
    });

    const result = await uploadSourceFileBatch(files, uploadFile);

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(result.uploaded).toEqual(["一.pdf"]);
    expect(result.failed).toEqual([{ file: files[1], message: "服务暂不可用" }]);
  });
});
