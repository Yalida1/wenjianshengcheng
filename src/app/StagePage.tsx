import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  api,
  apiError,
  createRequestId,
  type FieldDefinition,
  type FieldValue,
  type FileRecord,
  type Stage,
  type StageSourceOption,
  type Template,
} from "../api/client";
import { ErrorNotice, FullPageMessage } from "./Auth";
import { Card, PageHeader, StatusBadge } from "./Shell";

const STAGE_NAMES: Record<string, string> = {
  requirement: "项目建议书",
  feasibility: "可行性研究报告",
  tender: "招标文件",
  contract: "合同",
};
const TABS = [
  ["source", "来源选择"],
  ["files", "文件材料"],
  ["fields", "字段确认"],
  ["templates", "模板选择"],
  ["generation", "文档生成"],
] as const;

export function StagePage() {
  const { projectId = "", stage = "requirement" } = useParams();
  const location = useLocation();
  const activeTab = location.pathname.split("/").at(-1) ?? "source";
  const stages = useQuery({
    queryKey: ["stages", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/stages", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const stageRecord = stages.data?.find((item: Stage) => item.stage === stage);
  if (stages.isLoading) return <FullPageMessage title="正在加载阶段" />;
  if (stages.error) return <ErrorNotice error={stages.error} />;
  if (!stageRecord) return <FullPageMessage title="阶段不存在" detail="请返回项目空间重新选择" />;
  return (
    <>
      <PageHeader
        title={STAGE_NAMES[stage] ?? stage}
        description="来源、字段、模板和生成记录都按版本留痕。"
        actions={
          <Link className="secondary-button" to={`/projects/${projectId}`}>
            返回项目
          </Link>
        }
      />
      <Card className="mb-5 p-0">
        <div className="flex gap-1 overflow-x-auto p-2" role="tablist">
          {TABS.map(([key, label]) => (
            <Link
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium ${
                activeTab === key ? "bg-[#12345B] text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              to={`/projects/${projectId}/stages/${stage}/${key}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </Card>
      {activeTab === "source" && (
        <SourcePanel projectId={projectId} stage={stage} record={stageRecord} />
      )}
      {activeTab === "files" && <FilesPanel projectId={projectId} stage={stage} />}
      {activeTab === "fields" && <FieldsPanel projectId={projectId} stage={stage} />}
      {activeTab === "templates" && <TemplatesPanel stage={stage} />}
      {activeTab === "generation" && <GenerationPanel projectId={projectId} stage={stage} />}
    </>
  );
}

function SourcePanel({
  projectId,
  stage,
  record,
}: {
  projectId: string;
  stage: string;
  record: Stage;
}) {
  const [sourceType, setSourceType] = useState<"upstream_final" | "uploaded_file">("uploaded_file");
  const [sourceId, setSourceId] = useState("");
  const queryClient = useQueryClient();
  const sources = useQuery({
    queryKey: ["stage-sources", projectId, stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/stages/{stage}/sources", {
        params: { path: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const result = await api.PUT("/api/v1/projects/{project_id}/stages/{stage}/source", {
        params: { path: { project_id: projectId, stage } },
        body: {
          source_type: sourceType,
          source_file_version_id: sourceId,
          revision: record.revision,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["stages", projectId] }),
  });
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="section-title">确定本阶段来源</h3>
          <p className="section-description">
            选择上一阶段已定稿版本，或选择本项目已经上传的用户文件。
          </p>
        </div>
        <StatusBadge status={record.status} />
      </div>
      {record.source_file_version_id && (
        <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          当前来源：{record.source_type} · {record.source_file_version_id}
        </div>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label
          className={`selection-card ${
            sourceType === "upstream_final" ? "selection-card-active" : ""
          }`}
        >
          <input
            type="radio"
            checked={sourceType === "upstream_final"}
            onChange={() => {
              setSourceType("upstream_final");
              setSourceId("");
            }}
            disabled={stage === "requirement"}
          />
          <span>
            <strong>使用上一阶段定稿文件</strong>
            <small>仅接受同一项目的相邻上游不可变正式版本</small>
          </span>
        </label>
        <label
          className={`selection-card ${
            sourceType === "uploaded_file" ? "selection-card-active" : ""
          }`}
        >
          <input
            type="radio"
            checked={sourceType === "uploaded_file"}
            onChange={() => {
              setSourceType("uploaded_file");
              setSourceId("");
            }}
          />
          <span>
            <strong>使用用户已有文件</strong>
            <small>先在文件材料页上传并完成解析</small>
          </span>
        </label>
      </div>
      <label className="form-label mt-5 block">
        可用来源版本
        <select
          className="form-input mt-2"
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
        >
          <option value="">请选择来源</option>
          {sources.data
            ?.filter((item: StageSourceOption) => item.source_type === sourceType)
            .map((item: StageSourceOption) => (
              <option key={item.id} value={item.id}>
                {item.label} · SHA {item.sha256.slice(0, 10)}…
              </option>
            ))}
        </select>
      </label>
      {sources.data?.filter((item: StageSourceOption) => item.source_type === sourceType).length ===
        0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          当前没有可用来源。上传文件并等待解析完成，或先定稿相邻上游阶段。
        </div>
      )}
      {sources.error && <ErrorNotice error={sources.error} />}
      {save.error && (
        <div className="mt-4">
          <ErrorNotice error={save.error} />
        </div>
      )}
      <div className="mt-5 flex gap-2">
        <button
          className="primary-button"
          disabled={!sourceId || save.isPending}
          onClick={() => save.mutate()}
        >
          保存来源
        </button>
        <Link className="secondary-button" to={`/projects/${projectId}/stages/${stage}/files`}>
          管理上传文件
        </Link>
      </div>
    </Card>
  );
}

function FilesPanel({ projectId, stage }: { projectId: string; stage: string }) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const files = useQuery({
    queryKey: ["files", projectId, stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/files", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("请选择文件");
      const result = await api.POST("/api/v1/files", {
        params: { query: { project_id: projectId, stage } },
        body: { upload: selectedFile as unknown as string },
        bodySerializer() {
          const data = new FormData();
          data.set("upload", selectedFile);
          return data;
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      setSelectedFile(null);
      void queryClient.invalidateQueries({
        queryKey: ["files", projectId, stage],
      });
    },
  });
  return (
    <div className="space-y-5">
      <Card>
        <h3 className="section-title">上传来源文件</h3>
        <p className="section-description">
          支持 DOCX、PDF、XLSX、PNG、JPG、JPEG，服务端校验扩展名、MIME、文件签名、大小和 SHA256。
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            className="form-input"
            type="file"
            accept=".docx,.pdf,.xlsx,.png,.jpg,.jpeg"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
          <button
            className="primary-button shrink-0"
            onClick={() => upload.mutate()}
            disabled={!selectedFile || upload.isPending}
          >
            {upload.isPending ? "上传中" : "上传并解析"}
          </button>
        </div>
        {upload.error && (
          <div className="mt-4">
            <ErrorNotice error={upload.error} />
          </div>
        )}
      </Card>
      <Card>
        <h3 className="section-title">文件记录</h3>
        {files.isLoading && <div className="mt-4 text-sm text-slate-500">正在加载</div>}
        {files.error && (
          <div className="mt-4">
            <ErrorNotice error={files.error} />
          </div>
        )}
        <div className="mt-4 divide-y divide-slate-100">
          {files.data?.map((file: FileRecord) => (
            <div
              key={file.id}
              className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-medium text-slate-900">{file.original_name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {file.mime_type} · {(file.size_bytes / 1024).toFixed(1)} KB · 文件 ID {file.id}
                </div>
              </div>
              <StatusBadge status={file.status} />
            </div>
          ))}
          {files.data?.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">暂无文件</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function FieldsPanel({ projectId, stage }: { projectId: string; stage: string }) {
  const queryClient = useQueryClient();
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const definitions = useQuery({
    queryKey: ["field-definitions", stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-definitions", {
        params: { query: { stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const values = useQuery({
    queryKey: ["field-values", projectId, stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-values", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const byKey = useMemo(
    () => new Map(values.data?.map((item: FieldValue) => [item.field_key, item]) ?? []),
    [values.data],
  );
  const save = useMutation({
    mutationFn: async (definition: FieldDefinition) => {
      const existing = byKey.get(definition.field_key);
      const raw = draftValues[definition.field_key] ?? "";
      if (!raw.trim()) throw new Error("请输入字段值");
      const value =
        definition.data_type === "payment_plan"
          ? JSON.parse(raw)
          : definition.data_type === "money" ||
              (definition.data_type === "duration" && Boolean(definition.unit)) ||
              definition.data_type === "percentage"
            ? Number(raw)
            : raw;
      if (!existing) {
        const result = await api.POST("/api/v1/field-values", {
          params: { query: { project_id: projectId, stage } },
          body: {
            field_key: definition.field_key,
            field_label: definition.field_label,
            data_type: definition.data_type,
            value,
            normalized_value: value,
            unit: definition.unit,
            criticality: definition.criticality as "P0" | "P1" | "P2",
            status: "missing",
            source_type: "user_input",
            confidence: null,
            evidence: null,
          },
        });
        if (result.error) throw apiError(result.error, result.response);
        return result.data;
      }
      const result = await api.PATCH("/api/v1/field-values/{field_value_id}", {
        params: { path: { field_value_id: existing.id } },
        body: {
          value,
          normalized_value: value,
          unit: definition.unit,
          status: "missing",
          source_type: "user_input",
          revision: existing.revision,
          evidence: null,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["field-values", projectId, stage],
      }),
  });
  const confirm = useMutation({
    mutationFn: async (field: FieldValue) => {
      const result = await api.POST("/api/v1/field-values/{field_value_id}/confirm", {
        params: { path: { field_value_id: field.id } },
        body: {
          revision: field.revision,
          evidence_acknowledged: field.source_type === "extracted",
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["field-values", projectId, stage],
      }),
  });
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="section-title">字段确认</h3>
          <p className="section-description">
            P0 字段必须具有来源证据或人工确认。保存和确认是两个独立动作。
          </p>
        </div>
        <div className="text-xs text-slate-500">P0 阻断 · P1 重要 · P2 描述</div>
      </div>
      {(definitions.error || values.error) && (
        <div className="mt-4">
          <ErrorNotice error={definitions.error || values.error} />
        </div>
      )}
      <div className="mt-5 divide-y divide-slate-100">
        {definitions.data?.map((definition: FieldDefinition) => {
          const existing = byKey.get(definition.field_key);
          const currentValue = existing?.normalized_value ?? existing?.value ?? "";
          const inputValue =
            draftValues[definition.field_key] ??
            (typeof currentValue === "object"
              ? JSON.stringify(currentValue)
              : String(currentValue));
          return (
            <div key={definition.id} className="grid gap-3 py-5 lg:grid-cols-[220px_1fr_auto]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">{definition.field_label}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      definition.criticality === "P0"
                        ? "bg-red-50 text-red-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {definition.criticality}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-400">{definition.field_key}</div>
              </div>
              <div>
                {definition.data_type === "payment_plan" ? (
                  <PaymentPlanEditor
                    value={inputValue}
                    onChange={(value) =>
                      setDraftValues((current) => ({
                        ...current,
                        [definition.field_key]: value,
                      }))
                    }
                  />
                ) : (
                  <input
                    className="form-input"
                    value={inputValue}
                    onChange={(event) =>
                      setDraftValues((current) => ({
                        ...current,
                        [definition.field_key]: event.target.value,
                      }))
                    }
                  />
                )}
                <div className="mt-1 text-xs text-slate-500">
                  {definition.unit ? `单位 ${definition.unit} · ` : ""}状态{" "}
                  {existing?.status ?? "尚未建立"} · 来源 {existing?.source_type ?? "-"}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <button className="secondary-button" onClick={() => save.mutate(definition)}>
                  保存
                </button>
                <button
                  className="primary-button"
                  disabled={!existing || existing.status === "user_confirmed"}
                  onClick={() => existing && confirm.mutate(existing)}
                >
                  {existing?.status === "user_confirmed" ? "已确认" : "确认"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {(save.error || confirm.error) && <ErrorNotice error={save.error || confirm.error} />}
    </Card>
  );
}

type PaymentRow = {
  label: string;
  ratio: number;
  amount: number;
  trigger: string;
};

export function PaymentPlanEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  let rows: PaymentRow[];
  try {
    const parsed = JSON.parse(value || "[]") as PaymentRow[];
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    rows = [];
  }
  if (rows.length === 0) {
    rows = [{ label: "", ratio: 0, amount: 0, trigger: "" }];
  }
  const update = (index: number, patch: Partial<PaymentRow>) => {
    const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
    onChange(JSON.stringify(next));
  };
  const ratioTotal = rows.reduce((total, row) => total + Number(row.ratio || 0), 0);
  const amountTotal = rows.reduce((total, row) => total + Number(row.amount || 0), 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200" data-testid="payment-plan">
      <table className="min-w-[760px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2">节点</th>
            <th className="px-3 py-2">比例（%）</th>
            <th className="px-3 py-2">金额（元）</th>
            <th className="px-3 py-2">触发条件</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${row.label}`} className="border-t border-slate-100">
              <td className="p-2">
                <input
                  aria-label={`付款节点 ${index + 1}`}
                  className="form-input"
                  value={row.label}
                  onChange={(event) => update(index, { label: event.target.value })}
                />
              </td>
              <td className="p-2">
                <input
                  aria-label={`付款比例 ${index + 1}`}
                  className="form-input"
                  type="number"
                  value={row.ratio}
                  onChange={(event) => update(index, { ratio: Number(event.target.value) })}
                />
              </td>
              <td className="p-2">
                <input
                  aria-label={`付款金额 ${index + 1}`}
                  className="form-input"
                  type="number"
                  value={row.amount}
                  onChange={(event) => update(index, { amount: Number(event.target.value) })}
                />
              </td>
              <td className="p-2">
                <input
                  aria-label={`付款触发条件 ${index + 1}`}
                  className="form-input"
                  value={row.trigger}
                  onChange={(event) => update(index, { trigger: event.target.value })}
                />
              </td>
              <td className="p-2">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={rows.length === 1}
                  onClick={() => onChange(JSON.stringify(rows.filter((_, item) => item !== index)))}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-slate-50 font-medium">
          <tr>
            <td className="px-3 py-2">合计</td>
            <td className={`px-3 py-2 ${ratioTotal === 100 ? "text-emerald-700" : "text-red-700"}`}>
              {ratioTotal}%
            </td>
            <td className="px-3 py-2">{amountTotal.toLocaleString("zh-CN")}</td>
            <td colSpan={2} className="px-3 py-2 text-xs text-slate-500">
              定稿前还会校验比例、金额与触发条件。
            </td>
          </tr>
        </tfoot>
      </table>
      <button
        className="secondary-button m-3"
        type="button"
        onClick={() =>
          onChange(JSON.stringify([...rows, { label: "", ratio: 0, amount: 0, trigger: "" }]))
        }
      >
        添加付款节点
      </button>
    </div>
  );
}

function TemplatesPanel({ stage }: { stage: string }) {
  const templates = useQuery({
    queryKey: ["templates", stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/templates", {
        params: { query: { stage, current_only: true } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  return (
    <Card>
      <h3 className="section-title">可用模板</h3>
      <p className="section-description">
        客户正式模板优先。Demo 模板仅用于平台功能验证，不代表客户内部格式标准。
      </p>
      {templates.error && (
        <div className="mt-4">
          <ErrorNotice error={templates.error} />
        </div>
      )}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {templates.data?.map((template: Template) => (
          <div key={template.id} className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-slate-900">{template.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  版本 {template.current_version} · {template.source_kind}
                </div>
              </div>
              <StatusBadge status={template.status} />
            </div>
            <div className="mt-4 text-xs text-slate-400">模板 ID {template.id}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function GenerationPanel({ projectId, stage }: { projectId: string; stage: string }) {
  const [templateId, setTemplateId] = useState("");
  const [templateVersion, setTemplateVersion] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const templates = useQuery({
    queryKey: ["templates", stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/templates", {
        params: { query: { stage, current_only: true } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const start = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/generation-jobs", {
        params: { query: { project_id: projectId, stage } },
        body: {
          template_id: templateId,
          template_version: templateVersion,
          idempotency_key: `web-${projectId}-${stage}-${createRequestId()}`,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (job) => setJobId(job.id),
  });
  const job = useQuery({
    queryKey: ["generation-job", jobId],
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      ["queued", "running", "retrying"].includes(query.state.data?.status ?? "") ? 1500 : false,
    queryFn: async () => {
      const result = await api.GET("/api/v1/generation-jobs/{job_id}", {
        params: { path: { job_id: jobId ?? "" } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const documents = useQuery({
    queryKey: ["documents", projectId],
    enabled: job.data?.status === "succeeded" || start.data?.status === "succeeded",
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents", {
        params: { query: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as Array<{ id: string; stage: string }>;
    },
  });
  const selected = templates.data?.find((item: Template) => item.id === templateId);
  const effectiveJob = job.data ?? start.data;
  return (
    <Card>
      <h3 className="section-title">开始文档生成</h3>
      <p className="section-description">
        任务按章节执行，支持状态查询、重试、取消和幂等。默认 Demo Provider 不调用付费模型。
      </p>
      <label className="form-label mt-5 block">
        已发布模板
        <select
          className="form-input mt-2"
          value={templateId}
          onChange={(event) => {
            const id = event.target.value;
            const template = templates.data?.find((item: Template) => item.id === id);
            setTemplateId(id);
            setTemplateVersion(template?.current_version ?? 1);
          }}
        >
          <option value="">请选择模板</option>
          {templates.data?.map((template: Template) => (
            <option value={template.id} key={template.id}>
              {template.name} · V{template.current_version}
            </option>
          ))}
        </select>
      </label>
      {selected?.source_kind === "demo_general" && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          这是 Demo 通用模板，仅用于验证平台能力。
        </div>
      )}
      <div className="mt-5 flex items-center gap-3">
        <button
          className="primary-button"
          disabled={!templateId || start.isPending}
          onClick={() => start.mutate()}
        >
          创建生成任务
        </button>
        {effectiveJob && <StatusBadge status={effectiveJob.status} />}
      </div>
      {(start.error || job.error) && (
        <div className="mt-4">
          <ErrorNotice error={start.error || job.error} />
        </div>
      )}
      {effectiveJob && (
        <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm">
          <div>任务 ID：{effectiveJob.id}</div>
          <div className="mt-1">
            Provider：{effectiveJob.generation_provider} / {effectiveJob.generation_model}
          </div>
          <div className="mt-1">字段快照：{effectiveJob.field_snapshot_id}</div>
        </div>
      )}
      {effectiveJob?.status === "succeeded" &&
        documents.data
          ?.filter((document) => document.stage === stage)
          .map((document) => (
            <Link
              key={document.id}
              className="primary-button mt-5 inline-flex"
              to={`/projects/${projectId}/documents/${document.id}`}
            >
              打开文档工作台
            </Link>
          ))}
    </Card>
  );
}
