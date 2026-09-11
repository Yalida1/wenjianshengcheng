import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, apiError, createRequestId, isRevisionConflict } from "../api/client";
import { TaskProgressPanel } from "../components/TaskProgressPanel";
import { ErrorNotice, FullPageMessage } from "./Auth";
import { Card, PageHeader, StatusBadge } from "./Shell";

type DocumentSummary = {
  id: string;
  project_id: string;
  stage: string;
  title: string;
  status: string;
  current_version: number;
  versions: VersionSummary[];
};
type VersionSummary = {
  id: string;
  version: number;
  status: string;
  immutable: boolean;
  parent_version_id: string | null;
  provenance: Record<string, unknown>;
  revision: number;
};
type ContentBlock = {
  id: string;
  sequence: number;
  block_type: string;
  content: BlockContent;
  source_kind: string;
  reviewed: boolean;
  revision: number;
};
type DocumentSection = {
  id: string;
  key: string;
  title: string;
  sequence: number;
  parent_id?: string | null;
  level?: number;
  blocks: ContentBlock[];
};
type VersionDetail = VersionSummary & {
  document_id: string;
  sections: DocumentSection[];
};
type ValidationResult = {
  id: string;
  status: string;
  issue_counts: Record<string, number>;
  issues: Array<{
    id: string;
    severity: string;
    message: string;
    rule_key: string;
    status: string;
    location: Record<string, unknown>;
  }>;
};
type ExportResult = {
  id: string;
  status: string;
  output_format: string;
  sha256?: string | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  version?: number;
  version_revision?: number;
};

type TableContent = {
  caption?: string;
  headers?: string[];
  rows?: string[][];
  column_widths?: number[];
};

type BlockContent = { text?: string } | TableContent | string;

type AIOptimizeResult = {
  optimized_prompt: string;
  suggestion: string;
  provider: string;
  model: string;
  prompt_version: string;
};

type TextSelection = {
  blockId: string;
  sectionId: string;
  start: number;
  end: number;
  text: string;
};

type DocumentPageProps = {
  embeddedDocumentId?: string;
  embeddedProjectId?: string;
};

type BlockDraft = {
  text: string;
  content: BlockContent;
  blockType: string;
  revision: number;
  dirty: boolean;
  reviewed: boolean;
  sourceKind: string;
  sectionId: string;
};

type PendingHit = {
  id: string;
  blockId: string;
  sectionId: string;
  sectionTitle: string;
  label: string;
};

const PENDING_RE = /【待确认[^】]*】/g;

function outlineLabels(sections: DocumentSection[]): Record<string, string> {
  const counters: number[] = [];
  const labels: Record<string, string> = {};
  for (const section of sections) {
    const level = Math.max(1, Math.min(3, section.level ?? 1));
    while (counters.length < level) counters.push(0);
    counters.length = level;
    counters[level - 1] += 1;
    labels[section.id] = counters.slice(0, level).join(".");
  }
  return labels;
}

function blockText(block: ContentBlock): string {
  if (typeof block.content === "string") return block.content;
  if ("text" in block.content) return block.content.text ?? "";
  if ("caption" in block.content || "headers" in block.content || "rows" in block.content) {
    return [
      block.content.caption ?? "",
      ...(block.content.headers ?? []),
      ...(block.content.rows ?? []).flat(),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function sectionHasBody(section: DocumentSection): boolean {
  return section.blocks.some((block) => blockText(block).trim().length > 0);
}

export function documentVersionHasBody(version: Pick<VersionDetail, "sections">): boolean {
  return version.sections.some(sectionHasBody);
}

function isTableContent(content: BlockContent): content is TableContent {
  return typeof content === "object" && content !== null && !("text" in content);
}

function DocumentTable({
  content,
  locked,
  onChange,
}: {
  content: TableContent;
  locked: boolean;
  onChange: (content: TableContent) => void;
}) {
  const headers = content.headers ?? [];
  const rows = content.rows ?? [];
  const updateHeader = (index: number, value: string) => {
    const next = [...headers];
    next[index] = value;
    onChange({ ...content, headers: next });
  };
  const updateCell = (rowIndex: number, cellIndex: number, value: string) => {
    const nextRows = rows.map((row) => [...row]);
    nextRows[rowIndex][cellIndex] = value;
    onChange({ ...content, rows: nextRows });
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
      {content.caption && (
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-800">
          {highlightPending(content.caption)}
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        {headers.length > 0 && (
          <thead>
            <tr className="bg-slate-100">
              {headers.map((header, index) => (
                <th
                  key={`${index}-${header}`}
                  className="border border-slate-300 p-2 text-center font-semibold text-slate-800"
                >
                  {locked ? (
                    highlightPending(header)
                  ) : (
                    <input
                      aria-label={`表头 ${index + 1}`}
                      className="w-full bg-transparent text-center outline-none focus:ring-2 focus:ring-blue-200"
                      value={header}
                      onChange={(event) => updateHeader(index, event.target.value)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="even:bg-slate-50/60">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="min-w-28 border border-slate-300 p-2 align-top leading-6 text-slate-700"
                >
                  {locked ? (
                    highlightPending(cell)
                  ) : (
                    <textarea
                      aria-label={`第 ${rowIndex + 1} 行第 ${cellIndex + 1} 列`}
                      className="min-h-10 w-full resize-y bg-transparent outline-none focus:ring-2 focus:ring-blue-200"
                      value={cell}
                      onChange={(event) => updateCell(rowIndex, cellIndex, event.target.value)}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function draftsFromVersion(version: VersionDetail): Record<string, BlockDraft> {
  const next: Record<string, BlockDraft> = {};
  for (const section of version.sections) {
    for (const block of section.blocks) {
      next[block.id] = {
        text: blockText(block),
        content: block.content,
        blockType: block.block_type,
        revision: block.revision,
        dirty: false,
        reviewed: block.reviewed,
        sourceKind: block.source_kind,
        sectionId: section.id,
      };
    }
  }
  return next;
}

function highlightPending(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(PENDING_RE.source, "g");
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <mark key={`${match.index}-${match[0]}`} className="pending-mark">
        {match[0]}
      </mark>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : text;
}

function countPendingInText(text: string): number {
  return (text.match(new RegExp(PENDING_RE.source, "g")) ?? []).length;
}

export function DocumentPage({ embeddedDocumentId, embeddedProjectId }: DocumentPageProps = {}) {
  const params = useParams();
  const projectId = embeddedProjectId ?? params.projectId ?? "";
  const documentId = embeddedDocumentId ?? params.documentId ?? "";
  const embedded = Boolean(embeddedDocumentId);
  const location = useLocation();
  const queryClient = useQueryClient();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [exports, setExports] = useState<ExportResult[]>([]);
  const [declaration, setDeclaration] = useState("关键字段和文档内容已完成人工复核");

  const document = useQuery({
    queryKey: ["document", documentId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents/{document_id}", {
        params: { path: { document_id: documentId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as DocumentSummary;
    },
  });
  const currentVersionId = selectedVersionId ?? document.data?.versions[0]?.id ?? "";
  const version = useQuery({
    queryKey: ["document-version", currentVersionId],
    enabled: Boolean(currentVersionId),
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents/versions/{version_id}", {
        params: { path: { version_id: currentVersionId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as VersionDetail;
    },
  });
  const validateMutation = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/documents/versions/{version_id}/validate", {
        params: { path: { version_id: currentVersionId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ValidationResult;
    },
    onSuccess: (result) => {
      setValidation(result);
      void queryClient.invalidateQueries({ queryKey: ["document-version", currentVersionId] });
      void queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    },
  });
  const finalize = useMutation({
    mutationFn: async () => {
      const latest =
        queryClient.getQueryData<VersionDetail>(["document-version", currentVersionId]) ??
        version.data;
      if (!latest) throw new Error("文档版本尚未加载");
      const result = await api.POST("/api/v1/documents/versions/{version_id}/finalize", {
        params: { path: { version_id: currentVersionId } },
        body: { revision: latest.revision, declaration },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      void queryClient.invalidateQueries({
        queryKey: ["document-version", currentVersionId],
      });
    },
  });
  const newRevision = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/documents/versions/{version_id}/revisions", {
        params: { path: { version_id: currentVersionId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as { id: string };
    },
    onSuccess: (created) => {
      setSelectedVersionId(created.id);
      void queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    },
  });
  const exportMutation = useMutation({
    mutationFn: async (outputFormat: "docx" | "pdf" | "xlsx") => {
      const result = await api.POST("/api/v1/exports", {
        params: { query: { version_id: currentVersionId } },
        body: {
          output_format: outputFormat,
          idempotency_key: `web-export-${currentVersionId}-${outputFormat}-${createRequestId()}`,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ExportResult;
    },
    onSuccess: (job) => setExports((current) => [job, ...current]),
  });

  if (document.isLoading) return <FullPageMessage title="正在加载文档" />;
  if (document.error) return <ErrorNotice error={document.error} />;
  const compareMode = !embedded && location.pathname.endsWith("/compare");
  const validationMode = !embedded && location.pathname.endsWith("/validation");
  return (
    <>
      {!embedded && (
        <PageHeader
          title={document.data?.title ?? "文档工作台"}
          description={`当前阶段 ${document.data?.stage} · 文档版本独立保存，定稿版本不可覆盖。`}
          actions={
            <Link className="secondary-button" to={`/projects/${projectId}`}>
              返回项目
            </Link>
          }
        />
      )}
      {!embedded && (
        <Card className="mb-5 p-0">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <Link
              className={`tab-button ${!compareMode && !validationMode ? "tab-button-active" : ""}`}
              to={`/projects/${projectId}/documents/${documentId}`}
            >
              文档编辑
            </Link>
            <Link
              className={`tab-button ${validationMode ? "tab-button-active" : ""}`}
              to={`/projects/${projectId}/documents/${documentId}/validation`}
            >
              校验中心
            </Link>
            <Link
              className={`tab-button ${compareMode ? "tab-button-active" : ""}`}
              to={`/projects/${projectId}/documents/${documentId}/compare`}
            >
              版本对比
            </Link>
            <select
              aria-label="文档版本"
              className="form-input ml-auto max-w-56"
              value={currentVersionId}
              onChange={(event) => setSelectedVersionId(event.target.value)}
            >
              {document.data?.versions.map((item) => (
                <option key={item.id} value={item.id}>
                  V{item.version} · {item.status}
                </option>
              ))}
            </select>
          </div>
        </Card>
      )}
      {version.isLoading && <FullPageMessage title="正在加载文档版本" />}
      {version.error && <ErrorNotice error={version.error} />}
      {version.data && compareMode && (
        <CompareView versions={document.data?.versions ?? []} current={version.data} />
      )}
      {version.data && validationMode && document.data && (
        <ValidationView
          projectId={projectId}
          stage={document.data.stage}
          version={version.data}
          validation={validation}
          validateMutation={validateMutation}
          finalize={finalize}
          declaration={declaration}
          setDeclaration={setDeclaration}
        />
      )}
      {version.data && embedded && !documentVersionHasBody(version.data) && (
        <Card>
          <h3 className="section-title">尚无已生成正文</h3>
          <p className="section-description">
            当前版本只有章节目录，没有任何已生成内容。请返回“文档生成”，勾选需要的章节并完成生成后再确认。
          </p>
          <Link
            className="primary-button mt-5 inline-flex"
            to={`/projects/${projectId}/stages/${document.data?.stage ?? "tender"}/generation`}
          >
            返回文档生成
          </Link>
        </Card>
      )}
      {version.data &&
        (!embedded || documentVersionHasBody(version.data)) &&
        !compareMode &&
        !validationMode && (
          <WorkspaceView
            embedded={embedded}
            projectId={projectId}
            stage={document.data?.stage ?? "tender"}
            version={version.data}
            queryClient={queryClient}
            newRevision={newRevision}
            exportMutation={exportMutation}
            exports={exports}
            validation={validation}
            validateMutation={validateMutation}
            finalize={finalize}
          />
        )}
    </>
  );
}

function WorkspaceView({
  embedded,
  projectId,
  stage,
  version,
  queryClient,
  newRevision,
  exportMutation,
  exports,
  validation,
  validateMutation,
  finalize,
}: {
  embedded: boolean;
  projectId: string;
  stage: string;
  version: VersionDetail;
  queryClient: ReturnType<typeof useQueryClient>;
  newRevision: ReturnType<typeof useMutation<{ id: string }, Error, void>>;
  exportMutation: ReturnType<typeof useMutation<ExportResult, Error, "docx" | "pdf" | "xlsx">>;
  exports: ExportResult[];
  validation: ValidationResult | null;
  validateMutation: ReturnType<typeof useMutation<ValidationResult, Error, void>>;
  finalize: ReturnType<typeof useMutation<unknown, Error, void>>;
}) {
  const [drafts, setDrafts] = useState<Record<string, BlockDraft>>(() =>
    draftsFromVersion(version),
  );
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState(version.sections[0]?.id ?? "");
  const [saveError, setSaveError] = useState<unknown>(null);
  const [flushing, setFlushing] = useState(false);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiAction, setAiAction] = useState<"polish" | "rewrite" | "expand" | "simplify">("polish");
  const [aiResult, setAiResult] = useState<AIOptimizeResult | null>(null);
  const [aiApplyError, setAiApplyError] = useState<string | null>(null);
  const draftsRef = useRef(drafts);
  const versionBlocksRef = useRef<Map<string, ContentBlock>>(new Map());
  const debounceRef = useRef<number | null>(null);
  const skipNextSync = useRef(false);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    const map = new Map<string, ContentBlock>();
    for (const section of version.sections) {
      for (const block of section.blocks) map.set(block.id, block);
    }
    versionBlocksRef.current = map;
  }, [version]);

  useEffect(() => {
    setTextSelection(null);
    setAiResult(null);
    setAiApplyError(null);
  }, [version.id]);

  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      setDrafts((current) => {
        const next = { ...current };
        for (const section of version.sections) {
          for (const block of section.blocks) {
            const existing = next[block.id];
            if (!existing || existing.dirty) continue;
            next[block.id] = {
              text: blockText(block),
              content: block.content,
              blockType: block.block_type,
              revision: block.revision,
              dirty: false,
              reviewed: block.reviewed,
              sourceKind: block.source_kind,
              sectionId: section.id,
            };
          }
        }
        return next;
      });
      return;
    }
    const hasDirty = Object.values(draftsRef.current).some((item) => item.dirty);
    if (hasDirty) return;
    setDrafts(draftsFromVersion(version));
    setActiveSectionId((current) => current || version.sections[0]?.id || "");
  }, [version]);

  const readOnly = version.immutable;
  const dirtyCount = useMemo(
    () => Object.values(drafts).filter((item) => item.dirty).length,
    [drafts],
  );
  const unreviewedCount = useMemo(
    () => Object.values(drafts).filter((item) => !item.reviewed).length,
    [drafts],
  );
  const sectionLabels = useMemo(() => outlineLabels(version.sections), [version.sections]);

  const pendingHits = useMemo(() => {
    const hits: PendingHit[] = [];
    for (const section of version.sections) {
      for (const block of section.blocks) {
        const draft = drafts[block.id];
        if (!draft) continue;
        const matches = draft.text.match(new RegExp(PENDING_RE.source, "g")) ?? [];
        matches.forEach((label, index) => {
          hits.push({
            id: `${block.id}-${index}`,
            blockId: block.id,
            sectionId: section.id,
            sectionTitle: `${sectionLabels[section.id] ?? section.sequence}. ${section.title}`,
            label,
          });
        });
      }
    }
    return hits;
  }, [drafts, sectionLabels, version.sections]);

  const sectionPendingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const section of version.sections) {
      counts[section.id] = section.blocks.reduce((sum, block) => {
        const draft = drafts[block.id];
        return sum + (draft ? countPendingInText(draft.text) : 0);
      }, 0);
    }
    return counts;
  }, [drafts, version.sections]);

  const updateDraftText = useCallback((blockId: string, text: string) => {
    setDrafts((current) => {
      const existing = current[blockId];
      if (!existing) return current;
      return {
        ...current,
        [blockId]: {
          ...existing,
          text,
          dirty: true,
        },
      };
    });
  }, []);

  const updateDraftTable = useCallback((blockId: string, content: TableContent) => {
    setDrafts((current) => {
      const existing = current[blockId];
      if (!existing) return current;
      const text = [
        content.caption ?? "",
        ...(content.headers ?? []),
        ...(content.rows ?? []).flat(),
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ...current,
        [blockId]: { ...existing, content, text, dirty: true },
      };
    });
  }, []);

  const saveBlock = useCallback(async (blockId: string, options?: { forceReview?: boolean }) => {
    const draft = draftsRef.current[blockId];
    const serverBlock = versionBlocksRef.current.get(blockId);
    if (!draft || !serverBlock) return;
    if (draft.sourceKind === "fixed_template") return;
    if (!draft.dirty && !(options?.forceReview && !draft.reviewed)) return;
    const result = await api.PATCH("/api/v1/documents/blocks/{block_id}", {
      params: { path: { block_id: blockId } },
      body: {
        content: draft.blockType === "table" ? draft.content : { text: draft.text },
        reviewed: true,
        revision: draft.revision,
      },
    });
    if (result.error) throw apiError(result.error, result.response);
    const saved = result.data as {
      revision: number;
      reviewed: boolean;
      source_kind: string;
      content: BlockContent;
    };
    const savedText =
      typeof saved.content === "string"
        ? saved.content
        : "text" in saved.content
          ? (saved.content.text ?? draft.text)
          : "caption" in saved.content
            ? (saved.content.caption ?? draft.text)
            : draft.text;
    setDrafts((current) => ({
      ...current,
      [blockId]: {
        ...current[blockId],
        text: savedText,
        revision: saved.revision,
        dirty: false,
        reviewed: saved.reviewed,
        sourceKind: saved.source_kind,
        content: saved.content,
      },
    }));
    const mapped = versionBlocksRef.current.get(blockId);
    if (mapped) {
      mapped.revision = saved.revision;
      mapped.reviewed = saved.reviewed;
      mapped.source_kind = saved.source_kind;
      mapped.content = typeof saved.content === "string" ? { text: saved.content } : saved.content;
    }
  }, []);

  const optimizeSelection = useMutation<
    AIOptimizeResult,
    Error,
    { selection: TextSelection; prompt: string; action: typeof aiAction }
  >({
    mutationFn: async ({ selection, prompt, action }) => {
      const draft = draftsRef.current[selection.blockId];
      if (!draft) throw new Error("选取的段落已不存在，请重新选择");
      if (draft.text.slice(selection.start, selection.end) !== selection.text) {
        throw new Error("选取内容已发生变化，请重新选择");
      }
      if (draft.dirty) await saveBlock(selection.blockId);
      const result = await api.POST("/api/v1/documents/blocks/{block_id}/ai-optimize", {
        params: { path: { block_id: selection.blockId } },
        body: { selected_text: selection.text, prompt, action },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as AIOptimizeResult;
    },
    onSuccess: (result) => {
      setAiResult(result);
      setAiApplyError(null);
    },
  });

  const captureTextSelection = (
    blockId: string,
    sectionId: string,
    element: HTMLTextAreaElement,
  ) => {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (end <= start) return;
    const text = element.value.slice(start, end);
    if (!text.trim()) return;
    setTextSelection({ blockId, sectionId, start, end, text });
    setAiResult(null);
    setAiApplyError(null);
  };

  const applyAISuggestion = () => {
    if (!textSelection || !aiResult) return;
    const draft = draftsRef.current[textSelection.blockId];
    if (!draft || draft.text.slice(textSelection.start, textSelection.end) !== textSelection.text) {
      setAiApplyError("正文已发生变化，请重新选择需要优化的文字。");
      return;
    }
    updateDraftText(
      textSelection.blockId,
      `${draft.text.slice(0, textSelection.start)}${aiResult.suggestion}${draft.text.slice(textSelection.end)}`,
    );
    setTextSelection(null);
    setAiResult(null);
    setAiPrompt("");
    setAiApplyError(null);
  };

  const flushAll = useCallback(
    async (mode: "dirty" | "review-all") => {
      if (readOnly) return;
      setSaveError(null);
      setFlushing(true);
      try {
        const ids = Object.keys(draftsRef.current).filter((blockId) => {
          const draft = draftsRef.current[blockId];
          if (!draft || draft.sourceKind === "fixed_template") return false;
          if (mode === "dirty") return draft.dirty;
          return draft.dirty || !draft.reviewed;
        });
        for (const blockId of ids) {
          await saveBlock(blockId, { forceReview: mode === "review-all" });
        }
        skipNextSync.current = true;
        await queryClient.invalidateQueries({ queryKey: ["document-version", version.id] });
      } catch (error) {
        setSaveError(error);
        throw error;
      } finally {
        setFlushing(false);
      }
    },
    [queryClient, readOnly, saveBlock, version.id],
  );

  useEffect(() => {
    if (readOnly || dirtyCount === 0 || focusedBlockId) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void flushAll("dirty").catch(() => undefined);
    }, 1200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [dirtyCount, focusedBlockId, flushAll, readOnly]);

  const handleExport = async (format: "docx" | "pdf" | "xlsx") => {
    try {
      if (!readOnly && (dirtyCount > 0 || unreviewedCount > 0)) {
        await flushAll("review-all");
      } else if (!readOnly && dirtyCount > 0) {
        await flushAll("dirty");
      }
      exportMutation.mutate(format);
    } catch {
      /* saveError already set */
    }
  };

  const confirmFinalize = async () => {
    try {
      if (!readOnly && (dirtyCount > 0 || unreviewedCount > 0)) {
        await flushAll("review-all");
      } else if (!readOnly && dirtyCount > 0) {
        await flushAll("dirty");
      }
      const result = await validateMutation.mutateAsync();
      if ((result.issue_counts.P0 ?? 0) > 0 || (result.issue_counts.P1 ?? 0) > 0) return;
      await queryClient.invalidateQueries({ queryKey: ["document-version", version.id] });
      await finalize.mutateAsync();
    } catch {
      /* saveError / validateMutation.error / finalize.error already set */
    }
  };

  const scrollToSection = (sectionId: string) => {
    setActiveSectionId(sectionId);
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const scrollToBlock = (blockId: string, sectionId: string) => {
    setActiveSectionId(sectionId);
    document.getElementById(`block-${blockId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    if (!readOnly) setFocusedBlockId(blockId);
  };

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={version.status} />
          <div className="text-sm text-slate-600">
            {readOnly ? (
              <span>定稿版本只读，导出前无需保存。</span>
            ) : dirtyCount > 0 ? (
              <span className="text-amber-700">未保存 {dirtyCount} 处修改</span>
            ) : unreviewedCount > 0 ? (
              <span className="text-amber-700">还有 {unreviewedCount} 段待标记审阅</span>
            ) : (
              <span className="text-emerald-700">正文已保存并完成审阅</span>
            )}
            {pendingHits.length > 0 && (
              <span className="ml-3 text-red-600">文中待确认 {pendingHits.length} 处</span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!readOnly && (
              <button
                className="primary-button"
                disabled={flushing || (dirtyCount === 0 && unreviewedCount === 0)}
                onClick={() => void flushAll("review-all").catch(() => undefined)}
              >
                {flushing ? "正在保存…" : "保存全部并完成审阅"}
              </button>
            )}
            {embedded && (
              <>
                {!readOnly && <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />}
                <button
                  type="button"
                  className="primary-button px-3"
                  disabled={
                    readOnly || flushing || finalize.isPending || validateMutation.isPending
                  }
                  onClick={() => void confirmFinalize()}
                >
                  {readOnly
                    ? "已定稿"
                    : finalize.isPending || validateMutation.isPending
                      ? "正在定稿…"
                      : "确认定稿"}
                </button>
                {(["docx", "pdf", "xlsx"] as const).map((format) => (
                  <button
                    key={format}
                    className="secondary-button px-3"
                    disabled={exportMutation.isPending || flushing}
                    onClick={() => void handleExport(format)}
                  >
                    {format === "xlsx" ? "字段来源 XLSX" : format.toUpperCase()}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
        {saveError ? (
          <div className="mt-3">
            <ErrorNotice error={saveError} />
          </div>
        ) : null}
        {embedded && exportMutation.error ? (
          <div className="mt-3">
            <ErrorNotice error={exportMutation.error} />
          </div>
        ) : null}
        {embedded &&
          exports.map((job) => <ExportJobLink key={job.id} initial={job} autoDownload />)}
        {embedded && (validateMutation.error || finalize.error) ? (
          <div className="mt-3">
            <ErrorNotice error={validateMutation.error || finalize.error} />
          </div>
        ) : null}
        {embedded && validation && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-700">
                定稿校验：P0 {validation.issue_counts.P0 ?? 0} · P1{" "}
                {validation.issue_counts.P1 ?? 0} · P2 {validation.issue_counts.P2 ?? 0}
              </span>
              {validation.issues.length === 0 && (
                <span className="text-emerald-700">全部校验通过，可确认定稿</span>
              )}
            </div>
            {validation.issues.length > 0 && (
              <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-auto">
                {validation.issues.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    className="rounded-md border border-red-100 bg-white px-2.5 py-1.5 text-left text-xs text-red-700 hover:border-red-300"
                    onClick={() => {
                      const fieldKey = String(issue.location.field_key ?? "");
                      if (fieldKey) {
                        window.location.assign(
                          `/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stage)}/fields`,
                        );
                        return;
                      }
                      const blockId = String(issue.location.content_block_id ?? "");
                      const sectionId = blockId
                        ? (version.sections.find((section) =>
                            section.blocks.some((block) => block.id === blockId),
                          )?.id ?? "")
                        : String(issue.location.section_id ?? "");
                      if (blockId && sectionId) scrollToBlock(blockId, sectionId);
                      else if (sectionId) scrollToSection(sectionId);
                    }}
                  >
                    {issue.severity} · {issue.message}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <Card className="sticky top-20 z-[5] flex max-h-[calc(100dvh-6rem)] flex-col self-start overflow-hidden">
          <h3 className="section-title shrink-0">章节目录</h3>
          <nav
            className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1"
            aria-label="章节目录"
          >
            {version.sections.map((section) => {
              const pending = sectionPendingCounts[section.id] ?? 0;
              const active = activeSectionId === section.id;
              const level = Math.max(1, Math.min(3, section.level ?? 1));
              const label = sectionLabels[section.id] ?? String(section.sequence);
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  className={`flex w-full items-start justify-between gap-2 rounded-md py-2 text-left text-sm ${
                    active ? "bg-[#12345B] text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                  style={{
                    paddingLeft: `${0.75 + (level - 1) * 0.75}rem`,
                    paddingRight: "0.75rem",
                  }}
                >
                  <span>
                    {label} {section.title}
                  </span>
                  {pending > 0 && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        active ? "bg-red-200 text-red-800" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {pending}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </Card>

        <article className="document-paper">
          <header className="mb-8 border-b border-slate-200 pb-4">
            <p className="text-xs tracking-wide text-slate-400">正文审阅</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">版本 V{version.version}</h2>
            <p className="mt-2 text-sm text-slate-500">
              左侧点目录跳转，正文中【待确认】已标红；段落和表格均可修改。保存并完成审阅不等于正式定稿。
            </p>
          </header>
          <div className="space-y-10">
            {version.sections.map((section) => {
              const level = Math.max(1, Math.min(3, section.level ?? 1));
              const label = sectionLabels[section.id] ?? String(section.sequence);
              const headingClass =
                level === 1
                  ? "mb-4 text-lg font-semibold text-slate-900"
                  : level === 2
                    ? "mb-3 text-base font-semibold text-slate-800"
                    : "mb-2 text-sm font-semibold text-slate-700";
              return (
                <section key={section.id} id={`section-${section.id}`} className="scroll-mt-24">
                  <h3
                    className={headingClass}
                    style={{ paddingLeft: level > 1 ? `${(level - 1) * 0.75}rem` : undefined }}
                  >
                    {label} {section.title}
                  </h3>
                  <div
                    className="space-y-4"
                    style={{ paddingLeft: level > 1 ? `${(level - 1) * 0.75}rem` : undefined }}
                  >
                    {section.blocks.map((block) => {
                      const draft = drafts[block.id];
                      if (!draft) return null;
                      const locked = readOnly || draft.sourceKind === "fixed_template";
                      const focused = focusedBlockId === block.id;
                      return (
                        <div
                          key={block.id}
                          id={`block-${block.id}`}
                          className="scroll-mt-28"
                          onFocusCapture={() => setActiveSectionId(section.id)}
                        >
                          {draft.blockType === "table" && isTableContent(draft.content) ? (
                            <DocumentTable
                              content={draft.content}
                              locked={locked}
                              onChange={(content) => updateDraftTable(block.id, content)}
                            />
                          ) : focused && !locked ? (
                            <textarea
                              className="document-paragraph-editor"
                              value={draft.text}
                              autoFocus
                              rows={Math.max(3, Math.ceil(draft.text.length / 40))}
                              onChange={(event) => updateDraftText(block.id, event.target.value)}
                              onSelect={(event) =>
                                captureTextSelection(block.id, section.id, event.currentTarget)
                              }
                              onMouseUp={(event) =>
                                captureTextSelection(block.id, section.id, event.currentTarget)
                              }
                              onBlur={() => {
                                setFocusedBlockId(null);
                                if (draftsRef.current[block.id]?.dirty) {
                                  void saveBlock(block.id).catch((error) => setSaveError(error));
                                }
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={locked}
                              className={`document-paragraph ${locked ? "cursor-default" : "cursor-text hover:bg-slate-50"}`}
                              onClick={() => {
                                if (!locked) setFocusedBlockId(block.id);
                              }}
                            >
                              <span className="block whitespace-pre-wrap leading-7 text-slate-800">
                                {highlightPending(draft.text)}
                              </span>
                            </button>
                          )}
                          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
                            <span>
                              {draft.sourceKind}
                              {draft.dirty ? " · 未保存" : ""}
                            </span>
                            <span
                              className={draft.reviewed ? "text-emerald-600" : "text-amber-600"}
                            >
                              {draft.reviewed ? "已审阅" : "待审阅"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {section.blocks.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                        本章尚未生成。请返回“文档生成”，勾选对应章节后生成正文。
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </article>

        <div className="space-y-5">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h3 className="section-title">AI 问答优化</h3>
              <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700">
                自动优化提示词
              </span>
            </div>
            <p className="section-description">
              先在正文编辑框中选中文字，再说明想怎么改；AI 会先完善提示词，再给出可确认的修改建议。
            </p>
            <div className="mt-4 space-y-3">
              {textSelection ? (
                <div className="rounded-lg bg-slate-100 p-3 text-xs leading-5 text-slate-600">
                  <div className="mb-1 font-medium text-slate-700">已选内容</div>
                  <div className="max-h-28 overflow-auto whitespace-pre-wrap">
                    {textSelection.text}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs leading-5 text-slate-500">
                  点击正文段落进入编辑，再拖动选择需要优化的文字。
                </div>
              )}
              <div className="grid grid-cols-4 gap-1" aria-label="AI 优化方式">
                {(
                  [
                    ["polish", "润色"],
                    ["rewrite", "重写"],
                    ["expand", "扩写"],
                    ["simplify", "精简"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`rounded-md px-2 py-1.5 text-xs font-medium ${
                      aiAction === key
                        ? "bg-[#12345B] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                    onClick={() => {
                      setAiAction(key);
                      setAiResult(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="block text-xs font-medium text-slate-700">
                修改要求
                <textarea
                  className="form-input mt-2 min-h-24 resize-y text-sm"
                  placeholder="例如：语气更正式，压缩重复表述，保留所有数字和待确认标记"
                  value={aiPrompt}
                  onChange={(event) => {
                    setAiPrompt(event.target.value);
                    setAiResult(null);
                  }}
                />
              </label>
              <button
                type="button"
                className="primary-button w-full"
                disabled={!textSelection || optimizeSelection.isPending || readOnly}
                onClick={() => {
                  if (!textSelection) return;
                  optimizeSelection.mutate({
                    selection: textSelection,
                    prompt: aiPrompt,
                    action: aiAction,
                  });
                }}
              >
                {optimizeSelection.isPending ? "正在优化…" : "优化提示词并生成建议"}
              </button>
              {optimizeSelection.isPending && (
                <TaskProgressPanel
                  compact
                  title="正在生成文字优化建议"
                  description="系统会保留原文中的数字、来源边界与【待确认】标记，结果生成后仍由您决定是否应用。"
                  stages={[
                    { key: "selection", label: "锁定选中文字", status: "done" },
                    { key: "prompt", label: "优化修改要求", status: "active" },
                    { key: "suggestion", label: "生成候选建议", status: "waiting" },
                  ]}
                  status="active"
                  outcome="生成结果只作为候选，不会自动改写正文"
                />
              )}
              {optimizeSelection.error && <ErrorNotice error={optimizeSelection.error} />}
              {aiApplyError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {aiApplyError}
                </div>
              )}
              {aiResult && (
                <div className="space-y-3 border-t border-slate-200 pt-3">
                  <div className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                    <div className="mb-1 font-medium">AI 已优化提示词</div>
                    {aiResult.optimized_prompt}
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-slate-700">
                    <div className="mb-1 font-medium text-emerald-800">修改建议</div>
                    <div className="max-h-48 overflow-auto whitespace-pre-wrap">
                      {aiResult.suggestion}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="primary-button flex-1"
                      onClick={applyAISuggestion}
                    >
                      应用到原文
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setAiResult(null)}
                    >
                      放弃
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {aiResult.provider} / {aiResult.model} · 建议应用后仍需人工复核
                  </div>
                </div>
              )}
            </div>
          </Card>

          {!embedded && (
            <>
              <Card>
                <div className="flex items-center justify-between">
                  <h3 className="section-title">版本状态</h3>
                  <StatusBadge status={version.status} />
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <Info label="版本" value={`V${version.version}`} />
                  <Info
                    label="生成 Provider"
                    value={String(version.provenance.generation_provider ?? "-")}
                  />
                  <Info
                    label="提示词版本"
                    value={String(version.provenance.prompt_version ?? "-")}
                  />
                  <Info
                    label="字段快照"
                    value={String(version.provenance.field_snapshot_id ?? "-")}
                  />
                </dl>
                {version.immutable && (
                  <button
                    className="primary-button mt-5 w-full"
                    onClick={() => newRevision.mutate()}
                  >
                    创建新修订草稿
                  </button>
                )}
              </Card>

              <Card>
                <h3 className="section-title">待确认清单</h3>
                <p className="section-description">标红占位需人工改实或确认后来源后再定稿。</p>
                <div className="mt-4 max-h-64 space-y-2 overflow-auto">
                  {pendingHits.length === 0 ? (
                    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      无待确认项
                    </div>
                  ) : (
                    pendingHits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className="block w-full rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-left text-sm hover:border-red-200"
                        onClick={() => scrollToBlock(hit.blockId, hit.sectionId)}
                      >
                        <div className="font-medium text-red-700">{hit.label}</div>
                        <div className="mt-1 text-xs text-slate-500">{hit.sectionTitle}</div>
                      </button>
                    ))
                  )}
                </div>
              </Card>

              <Card>
                <h3 className="section-title">导出</h3>
                <p className="section-description">导出前自动保存正文修改并完成审阅标记。</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {(["docx", "pdf", "xlsx"] as const).map((format) => (
                    <button
                      key={format}
                      className="secondary-button px-2"
                      disabled={exportMutation.isPending || flushing}
                      onClick={() => void handleExport(format)}
                    >
                      {format === "xlsx" ? "字段来源" : format.toUpperCase()}
                    </button>
                  ))}
                </div>
                {exportMutation.error && (
                  <div className="mt-3">
                    <ErrorNotice error={exportMutation.error} />
                  </div>
                )}
                {exports.map((job) => (
                  <ExportJobLink key={job.id} initial={job} autoDownload />
                ))}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ExportJobLink({
  initial,
  autoDownload = false,
}: {
  initial: ExportResult;
  autoDownload?: boolean;
}) {
  const downloadedRef = useRef(false);
  const job = useQuery({
    queryKey: ["export-job", initial.id],
    initialData: initial,
    refetchInterval: (query) =>
      ["queued", "running", "retrying"].includes(query.state.data?.status ?? "") ? 1200 : false,
    queryFn: async () => {
      const result = await api.GET("/api/v1/exports/{job_id}", {
        params: { path: { job_id: initial.id } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ExportResult;
    },
  });

  useEffect(() => {
    if (!autoDownload || downloadedRef.current) return;
    if (job.data?.status !== "succeeded") return;
    downloadedRef.current = true;
    const link = document.createElement("a");
    link.href = `/api/v1/exports/${job.data.id}/download`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [autoDownload, job.data?.id, job.data?.status]);

  if (job.error) return <ErrorNotice error={job.error} />;
  if (job.data.status !== "succeeded") {
    return (
      <TaskProgressPanel
        compact
        className="mt-3"
        title={`${job.data.output_format.toUpperCase()} ${job.data.status === "failed" ? "导出失败" : "正在导出"}`}
        description={job.data.error || "正在装配文件、检查完整性并计算产物校验值。"}
        stages={[
          {
            key: "export",
            label: job.data.status === "failed" ? "导出未完成" : "生成交付文件",
            status: job.data.status === "failed" ? "failed" : "active",
          },
        ]}
        status={job.data.status === "failed" ? "failed" : "active"}
        startedAt={job.data.created_at}
        outcome="完成后自动下载文件，并提供 SHA-256 完整性标识"
      />
    );
  }
  return (
    <a
      className="mt-3 block text-sm text-blue-700 underline"
      href={`/api/v1/exports/${job.data.id}/download`}
    >
      下载 {job.data.output_format.toUpperCase()} · SHA {job.data.sha256?.slice(0, 10)}…
    </a>
  );
}

function ValidationView({
  projectId,
  stage,
  version,
  validation,
  validateMutation,
  finalize,
  declaration,
  setDeclaration,
}: {
  projectId: string;
  stage: string;
  version: VersionDetail;
  validation: ValidationResult | null;
  validateMutation: ReturnType<typeof useMutation<ValidationResult, Error, void>>;
  finalize: ReturnType<typeof useMutation<unknown, Error, void>>;
  declaration: string;
  setDeclaration: (value: string) => void;
}) {
  const current = validation;
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="section-title">校验结果</h3>
            <p className="section-description">
              检查必需章节、P0 字段、来源追溯、未替换变量和 AI 内容审阅状态。
            </p>
          </div>
          <button
            className="primary-button"
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending}
          >
            执行定稿校验
          </button>
        </div>
        {validateMutation.error && (
          <div className="mt-4">
            <ErrorNotice error={validateMutation.error} />
          </div>
        )}
        {current && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {["P0", "P1", "P2"].map((severity) => (
                <div key={severity} className="rounded-lg bg-slate-50 p-4 text-center">
                  <div className="text-xs text-slate-500">{severity}</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {current.issue_counts[severity] ?? 0}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 divide-y divide-slate-100">
              {current.issues.map((issue) => (
                <div key={issue.id} className="py-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">
                      {issue.severity}
                    </span>
                    <span className="text-xs text-slate-400">{issue.rule_key}</span>
                  </div>
                  <div className="mt-2 text-sm text-slate-800">{issue.message}</div>
                  {issue.rule_key === "field_snapshot_stale" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        className="primary-button"
                        to={`/projects/${projectId}/stages/${stage}/generation?from=fields`}
                      >
                        基于已确认字段重新生成
                      </Link>
                      <Link
                        className="secondary-button"
                        to={`/projects/${projectId}/stages/${stage}/fields`}
                      >
                        返回字段确认
                      </Link>
                    </div>
                  )}
                </div>
              ))}
              {current.issues.length === 0 && (
                <div className="py-10 text-center text-sm text-emerald-700">未发现阻断问题</div>
              )}
            </div>
          </>
        )}
      </Card>
      <Card className="self-start">
        <h3 className="section-title">申请定稿</h3>
        <p className="section-description">
          定稿将创建不可变正式版本。后续修改只能创建新修订草稿。
        </p>
        <textarea
          className="form-input mt-4 min-h-24"
          value={declaration}
          onChange={(event) => setDeclaration(event.target.value)}
        />
        <button
          className="primary-button mt-4 w-full"
          disabled={
            version.immutable ||
            !current ||
            current.issue_counts.P0 > 0 ||
            current.issue_counts.P1 > 0 ||
            version.status !== "ready_to_finalize" ||
            finalize.isPending
          }
          onClick={() => finalize.mutate()}
        >
          {version.immutable ? "已定稿" : "确认定稿"}
        </button>
        {finalize.error && (
          <div className="mt-4">
            <ErrorNotice error={finalize.error} />
          </div>
        )}
        {finalize.error && isRevisionConflict(finalize.error) && (
          <button className="secondary-button mt-2 w-full" onClick={() => location.reload()}>
            重新加载最新版本
          </button>
        )}
      </Card>
    </div>
  );
}

function CompareView({
  versions,
  current,
}: {
  versions: VersionSummary[];
  current: VersionDetail;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <Card>
        <h3 className="section-title">版本链</h3>
        <div className="mt-4 space-y-3">
          {versions.map((item) => (
            <div
              key={item.id}
              className={`rounded-lg border p-3 ${
                item.id === current.id ? "border-blue-300 bg-blue-50" : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">V{item.version}</span>
                <StatusBadge status={item.status} />
              </div>
              <div className="mt-2 break-all text-xs text-slate-500">
                父版本 {item.parent_version_id ?? "首版"}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="section-title">当前版本来源</h3>
        <p className="section-description">
          平台对比聚焦版本、章节、关键字段和生成来源；历史人工稿通过文件上传后形成独立对比记录。
        </p>
        <pre className="mt-5 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
          {JSON.stringify(current.provenance, null, 2)}
        </pre>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 break-all text-slate-700">{value}</dd>
    </div>
  );
}
