import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGenerationDraft,
  readGenerationDraft,
  writeGenerationDraft,
  type GenerationWorkspaceDraft,
} from "./stageWorkspaceDraft";

const sample: GenerationWorkspaceDraft = {
  templateId: "tpl-2",
  templateVersion: 3,
  outlineRequest: { id: "tpl-2", version: 3 },
  selectedSectionKeys: ["ch1", "ch2"],
  templateApplicabilityConfirmed: true,
  jobId: "job-9",
};

describe("stageWorkspaceDraft", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a generation workspace draft", () => {
    writeGenerationDraft("p1", "tender", sample);
    expect(readGenerationDraft("p1", "tender")).toEqual(sample);
  });

  it("scopes drafts by project and stage", () => {
    writeGenerationDraft("p1", "tender", sample);
    expect(readGenerationDraft("p1", "contract")).toBeNull();
    expect(readGenerationDraft("p2", "tender")).toBeNull();
  });

  it("ignores corrupt payloads", () => {
    sessionStorage.setItem("wenshen:generation-draft:p1:tender", "{not-json");
    expect(readGenerationDraft("p1", "tender")).toBeNull();
  });

  it("clears a draft", () => {
    writeGenerationDraft("p1", "tender", sample);
    clearGenerationDraft("p1", "tender");
    expect(readGenerationDraft("p1", "tender")).toBeNull();
  });
});
