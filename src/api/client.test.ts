import { describe, expect, it } from "vitest";
import { apiError, isRevisionConflict } from "./client";

describe("API error normalization", () => {
  it("preserves structured error details and request status", () => {
    const error = apiError(
      {
        error: {
          code: "revision_conflict",
          message: "内容已被修改",
          details: { expected: 1, actual: 2 },
        },
      },
      new Response(null, { status: 409 }),
    );

    expect(error.status).toBe(409);
    expect(error.message).toBe("内容已被修改");
    expect(error.details).toEqual({ expected: 1, actual: 2 });
    expect(isRevisionConflict(error)).toBe(true);
  });

  it("uses a safe fallback for an unknown server body", () => {
    const error = apiError(null);
    expect(error.status).toBe(500);
    expect(error.code).toBe("request_failed");
  });
});
