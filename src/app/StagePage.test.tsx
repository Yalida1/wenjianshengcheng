import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaymentPlanEditor } from "./StagePage";

const validPlan = JSON.stringify([
  { label: "预付款", ratio: 30, amount: 300, trigger: "合同生效" },
  { label: "初验款", ratio: 40, amount: 400, trigger: "完成初验" },
  { label: "终验款", ratio: 30, amount: 300, trigger: "完成终验" },
]);

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
