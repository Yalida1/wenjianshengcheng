import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, apiError, createRequestId, isRevisionConflict } from "../api/client";
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
  content: { text?: string } | string;
  source_kind: string;
  reviewed: boolean;
  revision: number;
};
type DocumentSection = {
  id: string;
  key: string;
  title: string;
  sequence: number;
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
  }>;
};
type ExportResult = {
  id: string;
  status: string;
  output_format: string;
  sha256?: string | null;
};

export function DocumentPage() {
  const { projectId = "", documentId = "" } = useParams();
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
    onSuccess: setValidation,
  });
  const finalize = useMutation({
    mutationFn: async () => {
      if (!version.data) throw new Error("文档版本尚未加载");
      const result = await api.POST("/api/v1/documents/versions/{version_id}/finalize", {
        params: { path: { version_id: currentVersionId } },
        body: { revision: version.data.revision, declaration },
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
  const compareMode = location.pathname.endsWith("/compare");
  const validationMode = location.pathname.endsWith("/validation");
  return (
    <>
      <PageHeader
        title={document.data?.title ?? "文档工作台"}
        description={`当前阶段 ${document.data?.stage} · 文档版本独立保存，定稿版本不可覆盖。`}
        actions={
          <Link className="secondary-button" to={`/projects/${projectId}`}>
            返回项目
          </Link>
        }
      />
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
      {version.isLoading && <FullPageMessage title="正在加载文档版本" />}
      {version.error && <ErrorNotice error={version.error} />}
      {version.data && compareMode && (
        <CompareView versions={document.data?.versions ?? []} current={version.data} />
      )}
      {version.data && validationMode && (
        <ValidationView
          version={version.data}
          validation={validation}
          validateMutation={validateMutation}
          finalize={finalize}
          declaration={declaration}
          setDeclaration={setDeclaration}
        />
      )}
      {version.data && !compareMode && !validationMode && (
        <WorkspaceView
          version={version.data}
          documentId={documentId}
          queryClient={queryClient}
          newRevision={newRevision}
          exportMutation={exportMutation}
          exports={exports}
        />
      )}
    </>
  );
}

function WorkspaceView({
  version,
  documentId,
  queryClient,
  newRevision,
  exportMutation,
  exports,
}: {
  version: VersionDetail;
  documentId: string;
  queryClient: ReturnType<typeof useQueryClient>;
  newRevision: ReturnType<typeof useMutation<any, Error, void>>;
  exportMutation: ReturnType<typeof useMutation<ExportResult, Error, "docx" | "pdf" | "xlsx">>;
  exports: ExportResult[];
}) {
  const saveBlock = useMutation({
    mutationFn: async ({ block, text }: { block: ContentBlock; text: string }) => {
      const result = await api.PATCH("/api/v1/documents/blocks/{block_id}", {
        params: { path: { block_id: block.id } },
        body: { content: { text }, reviewed: true, revision: block.revision },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["document-version", version.id],
      }),
  });
  return (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
      <Card className="self-start">
        <h3 className="section-title">章节目录</h3>
        <nav className="mt-4 space-y-1">
          {version.sections.map((section) => (
            <a
              key={section.id}
              href={`#section-${section.id}`}
              className="block rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              {section.sequence}. {section.title}
            </a>
          ))}
        </nav>
      </Card>
      <div className="space-y-5">
        {version.sections.map((section) => (
          <Card key={section.id}>
            <h3 id={`section-${section.id}`} className="mb-4 text-lg font-semibold text-slate-900">
              {section.sequence}. {section.title}
            </h3>
            <div className="space-y-4">
              {section.blocks.map((block) => (
                <EditableBlock
                  key={block.id}
                  block={block}
                  immutable={version.immutable}
                  onSave={(text) => saveBlock.mutate({ block, text })}
                  saving={saveBlock.isPending}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div className="space-y-5">
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
            <Info label="提示词版本" value={String(version.provenance.prompt_version ?? "-")} />
            <Info label="字段快照" value={String(version.provenance.field_snapshot_id ?? "-")} />
          </dl>
          {version.immutable && (
            <button className="primary-button mt-5 w-full" onClick={() => newRevision.mutate()}>
              创建新修订草稿
            </button>
          )}
        </Card>
        <Card>
          <h3 className="section-title">导出</h3>
          <p className="section-description">导出任务保留格式、版本和 SHA256。</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(["docx", "pdf", "xlsx"] as const).map((format) => (
              <button
                key={format}
                className="secondary-button px-2"
                disabled={exportMutation.isPending}
                onClick={() => exportMutation.mutate(format)}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          {exportMutation.error && (
            <div className="mt-3">
              <ErrorNotice error={exportMutation.error} />
            </div>
          )}
          {exports.map((job) => (
            <ExportJobLink key={job.id} initial={job} />
          ))}
        </Card>
      </div>
    </div>
  );
}

function ExportJobLink({ initial }: { initial: ExportResult }) {
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
  if (job.error) return <ErrorNotice error={job.error} />;
  if (job.data.status !== "succeeded") {
    return (
      <div className="mt-3 text-sm text-slate-500">
        {job.data.output_format.toUpperCase()} · {job.data.status}
      </div>
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

function EditableBlock({
  block,
  immutable,
  onSave,
  saving,
}: {
  block: ContentBlock;
  immutable: boolean;
  onSave: (text: string) => void;
  saving: boolean;
}) {
  const original = typeof block.content === "string" ? block.content : (block.content.text ?? "");
  const [text, setText] = useState(original);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {block.source_kind} · R{block.revision}
        </span>
        <span className={`text-xs ${block.reviewed ? "text-emerald-700" : "text-amber-700"}`}>
          {block.reviewed ? "已审阅" : "待人工审阅"}
        </span>
      </div>
      <textarea
        className="form-input min-h-32 leading-7"
        value={text}
        readOnly={immutable}
        onChange={(event) => setText(event.target.value)}
      />
      {!immutable && (
        <div className="mt-3 flex justify-end">
          <button
            className="primary-button"
            disabled={saving || (text === original && block.reviewed)}
            onClick={() => onSave(text)}
          >
            {block.reviewed ? "保存修改" : "确认内容并标记已审阅"}
          </button>
        </div>
      )}
    </div>
  );
}

function ValidationView({
  version,
  validation,
  validateMutation,
  finalize,
  declaration,
  setDeclaration,
}: {
  version: VersionDetail;
  validation: ValidationResult | null;
  validateMutation: ReturnType<typeof useMutation<ValidationResult, Error, void>>;
  finalize: ReturnType<typeof useMutation<any, Error, void>>;
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
            运行校验
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
            version.immutable || !current || current.issue_counts.P0 > 0 || finalize.isPending
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
          {versions.map((version) => (
            <div
              key={version.id}
              className={`rounded-lg border p-3 ${
                version.id === current.id ? "border-blue-300 bg-blue-50" : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">V{version.version}</span>
                <StatusBadge status={version.status} />
              </div>
              <div className="mt-2 break-all text-xs text-slate-500">
                父版本 {version.parent_version_id ?? "首版"}
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
