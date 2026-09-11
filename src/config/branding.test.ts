import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "./branding";

describe("branding defaults", () => {
  it("defaults to 智能招标管理 product identity", () => {
    expect(DEFAULT_BRANDING.name).toBe("智能招标管理");
    expect(DEFAULT_BRANDING.subtitle).toContain("定稿");
    expect(DEFAULT_BRANDING.logoUrl).toBe("/brand-logo.svg");
    expect(DEFAULT_BRANDING.documentTitle).toBe("智能招标管理");
  });
});
