export type GenerationOutlineRequest = {
  id: string;
  version: number;
};

export type GenerationWorkspaceDraft = {
  templateId: string;
  templateVersion: number;
  outlineRequest: GenerationOutlineRequest | null;
  selectedSectionKeys: string[];
  templateApplicabilityConfirmed: boolean;
  jobId: string | null;
  selectedTenderDocumentId?: string;
};

const DRAFT_PREFIX = "wenshen:generation-draft";

function draftKey(projectId: string, stage: string): string {
  return `${DRAFT_PREFIX}:${projectId}:${stage}`;
}

function isOutlineRequest(value: unknown): value is GenerationOutlineRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.version === "number";
}

function parseDraft(raw: string): GenerationWorkspaceDraft | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.templateId !== "string" || !parsed.templateId) return null;
    if (typeof parsed.templateVersion !== "number") return null;
    const outlineRequest = parsed.outlineRequest;
    if (outlineRequest !== null && !isOutlineRequest(outlineRequest)) return null;
    if (!Array.isArray(parsed.selectedSectionKeys)) return null;
    if (!parsed.selectedSectionKeys.every((item) => typeof item === "string")) return null;
    if (typeof parsed.templateApplicabilityConfirmed !== "boolean") return null;
    if (parsed.jobId !== null && typeof parsed.jobId !== "string") return null;
    return {
      templateId: parsed.templateId,
      templateVersion: parsed.templateVersion,
      outlineRequest: outlineRequest as GenerationOutlineRequest | null,
      selectedSectionKeys: parsed.selectedSectionKeys as string[],
      templateApplicabilityConfirmed: parsed.templateApplicabilityConfirmed,
      jobId: parsed.jobId as string | null,
      ...(typeof parsed.selectedTenderDocumentId === "string"
        ? { selectedTenderDocumentId: parsed.selectedTenderDocumentId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function readGenerationDraft(
  projectId: string,
  stage: string,
): GenerationWorkspaceDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(projectId, stage));
    if (!raw) return null;
    return parseDraft(raw);
  } catch {
    return null;
  }
}

export function writeGenerationDraft(
  projectId: string,
  stage: string,
  draft: GenerationWorkspaceDraft,
): void {
  try {
    sessionStorage.setItem(draftKey(projectId, stage), JSON.stringify(draft));
  } catch {
    // Private mode / quota — ignore; UI state remains in memory for this mount.
  }
}

export function clearGenerationDraft(projectId: string, stage: string): void {
  try {
    sessionStorage.removeItem(draftKey(projectId, stage));
  } catch {
    // ignore
  }
}
