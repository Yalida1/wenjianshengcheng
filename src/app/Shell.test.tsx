import { describe, expect, it } from "vitest";
import { statusLabel } from "./Shell";

describe("statusLabel", () => {
  it("translates project and stage statuses into Chinese", () => {
    expect(statusLabel("active")).toBe("进行中");
    expect(statusLabel("finalized")).toBe("已定稿");
  });

  it("preserves an unknown status for diagnostics", () => {
    expect(statusLabel("custom_status")).toBe("custom_status");
  });
});
