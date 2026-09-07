import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type ApiSchemas = components["schemas"];
export type Project = ApiSchemas["ProjectView"];
export type Stage = ApiSchemas["StageView"];
export type StageSourceOption = ApiSchemas["StageSourceOption"];
export type FieldValue = ApiSchemas["FieldValueView"];
export type FieldDefinition = ApiSchemas["FieldDefinitionView"];
export type Template = ApiSchemas["TemplateView"];
export type TemplateExtractionJob = ApiSchemas["TemplateExtractionJobView"];
export type FileRecord = ApiSchemas["FileView"];
export type User = ApiSchemas["UserView"];

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function cookie(name: string): string | undefined {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function createRequestId(): string {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const api = createClient<paths>({
  credentials: "include",
});

api.use({
  async onRequest({ request }) {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const csrf = cookie("docchain_csrf");
      if (csrf) request.headers.set("X-CSRF-Token", decodeURIComponent(csrf));
    }
    request.headers.set("X-Request-ID", createRequestId());
    return request;
  },
});

export function apiError(error: unknown, response?: Response): ApiClientError {
  const body = error as {
    error?: { code?: string; message?: string; details?: unknown };
  };
  return new ApiClientError(
    response?.status ?? 500,
    body?.error?.code ?? "request_failed",
    body?.error?.message ?? "请求失败，请稍后重试",
    body?.error?.details,
  );
}

export function isRevisionConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "revision_conflict";
}
