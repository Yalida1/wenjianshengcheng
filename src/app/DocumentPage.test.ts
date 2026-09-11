import { describe, expect, it } from "vitest";
import { documentVersionHasBody } from "./DocumentPage";

describe("documentVersionHasBody", () => {
  it("does not treat an empty outline as generated body", () => {
    expect(
      documentVersionHasBody({
        sections: [
          {
            id: "s1",
            key: "chapter-1",
            title: "第一章",
            sequence: 1,
            blocks: [],
          },
        ],
      }),
    ).toBe(false);
  });

  it("recognizes meaningful generated text", () => {
    expect(
      documentVersionHasBody({
        sections: [
          {
            id: "s1",
            key: "chapter-1-1",
            title: "第一节",
            sequence: 1,
            blocks: [
              {
                id: "b1",
                sequence: 1,
                block_type: "paragraph",
                content: { text: "已生成正文" },
                source_kind: "ai_generated",
                reviewed: false,
                revision: 1,
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});
