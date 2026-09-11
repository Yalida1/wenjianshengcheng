import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskProgressPanel } from "./TaskProgressPanel";

describe("TaskProgressPanel", () => {
  it("shows exact backend work counts without inventing a percentage label", () => {
    render(
      <TaskProgressPanel
        title="正在通读可研"
        description="按正文分块分析"
        stages={[
          { key: "parse", label: "结构解析", status: "done" },
          { key: "analyze", label: "全文分析", status: "active" },
        ]}
        completed={3}
        total={8}
        progressLabel="全文分块"
        facts={[{ label: "分析模型", value: "demo-model" }]}
        outcome="完成后形成待编制清单"
      />,
    );

    expect(screen.getByText("全文分块 3/8")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "全文分块" })).toHaveAttribute(
      "aria-valuetext",
      "全文分块 3/8",
    );
    expect(screen.getByText("完成后形成待编制清单")).toBeInTheDocument();
  });

  it("uses the real active stage as indeterminate progress text", () => {
    render(
      <TaskProgressPanel
        compact
        title="正在导出 PDF"
        description="生成并校验文件"
        stages={[{ key: "export", label: "生成交付文件", status: "active" }]}
        outcome="完成后提供校验值"
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "生成交付文件");
    expect(screen.getByText("实时处理中")).toBeInTheDocument();
  });
});
