import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  displayCount,
  ProcurementAnalysisProgress,
  ProcurementBatchProgress,
} from "./ProcurementPlanPage";

describe("procurement document count display", () => {
  it("does not present an unknown recommendation as zero", () => {
    expect(displayCount(null)).toBe("暂不能可靠判断");
  });

  it("uses independent main tender document count", () => {
    expect(displayCount(1)).toBe("1 份");
    expect(displayCount(3)).toBe("3 份");
  });
});

describe("procurement progress feedback", () => {
  it("shows actual analysis chunk progress", () => {
    render(
      <ProcurementAnalysisProgress
        run={{
          status: "running",
          coverage_json: { completed_chunk_count: 2, chunk_count: 5 },
          started_at: null,
        }}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "全文分块" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "5");
  });

  it("does not display the previous completion when submitting a new analysis", () => {
    render(
      <ProcurementAnalysisProgress
        submitting
        run={{
          status: "succeeded",
          coverage_json: { completed_chunk_count: 5, chunk_count: 5 },
          started_at: null,
        }}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "提交分析任务");
    expect(screen.queryByText("处理完成")).not.toBeInTheDocument();
  });

  it("keeps successful counts and recovery guidance for a partially failed batch", () => {
    render(
      <ProcurementBatchProgress
        batch={{ status: "partial_failed", succeeded_count: 1, failed_count: 1, total_count: 2 }}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "成功生成" })).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    expect(screen.getByText(/成功文件已保留/)).toBeVisible();
    expect(screen.getByText("需要处理")).toBeVisible();
  });
});
