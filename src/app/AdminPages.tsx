import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  api,
  apiError,
  type FieldDefinition,
  type Template,
  type TemplateExtractionJob,
  type User,
} from "../api/client";
import { ErrorNotice } from "./Auth";
import { Card, PageHeader, StatusBadge } from "./Shell";

const STAGE_NAMES: Record<string, string> = {
  requirement: "项目建议书",
  feasibility: "可研报告",
  tender: "招标文件",
  contract: "合同",
};

const EXTRACTION_STATUS_NAMES: Record<string, string> = {
  queued: "等待处理",
  running: "正在解析",
  retrying: "正在重试",
  review_required: "等待人工确认",
  confirmed: "已生成模板草稿",
  failed: "处理失败",
};

const TEMPLATE_CATEGORIES = [
  {
    key: "national_official_text",
    label: "国家正式文本",
    description: "主管部门发布的原文索引，仅供查阅核对，不直接参与生成。",
  },
  {
    key: "adapted_from_official_outline",
    label: "依据正式大纲适配",
    description: "依据官方大纲或示范文本结构制作，可用于生成初稿，但不等同官方原文。",
  },
  {
    key: "platform_reference_template",
    label: "平台参考模板",
    description: "平台提供的通用编制结构，适用于没有指定正式模板的场景。",
  },
  {
    key: "other_official_template",
    label: "其他正式模板",
    description: "客户、行业或地区确认使用的正式模板，需保留来源依据。",
  },
] as const;

export function TemplateAdminPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    stage: "requirement",
    source_kind: "other_official_template",
    issuing_authority: "",
    document_number: "",
    publish_year: "",
    source_url: "",
    applicability: "",
  });
  const [sourceFiles, setSourceFiles] = useState<Record<string, File | undefined>>({});
  const [extractionFile, setExtractionFile] = useState<File>();
  const [extractionStage, setExtractionStage] = useState("feasibility");
  const [externalProcessingAuthorized, setExternalProcessingAuthorized] = useState(false);
  const [reviewJobId, setReviewJobId] = useState<string>();
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [selectedVariables, setSelectedVariables] = useState<Set<string>>(new Set());
  const [reviewForm, setReviewForm] = useState({
    template_name: "",
    source_kind: "platform_reference_template",
    issuing_authority: "",
    document_number: "",
    publish_year: "",
    source_url: "",
    applicability: "",
  });
  const templates = useQuery({
    queryKey: ["templates", "all"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/templates", {
        params: { query: { current_only: false } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const extractions = useQuery({
    queryKey: ["template-extractions"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/template-extractions");
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    refetchInterval: (query) =>
      query.state.data?.some((job) => ["queued", "running", "retrying"].includes(job.status))
        ? 2_000
        : false,
  });
  const activeReview = extractions.data?.find(
    (job) => job.id === reviewJobId && job.status === "review_required",
  );
  const openExtractionReview = (job: TemplateExtractionJob) => {
    setReviewJobId(job.id);
    setSelectedSections(
      new Set(job.result_json?.sections.filter((item) => item.selected).map((item) => item.id)),
    );
    setSelectedVariables(
      new Set(job.result_json?.variables.filter((item) => item.selected).map((item) => item.id)),
    );
    const baseName = job.result_json?.summary.filename.replace(/\.docx$/i, "") ?? "提取模板";
    setReviewForm((current) => ({ ...current, template_name: `${baseName}模板` }));
  };
  useEffect(() => {
    const currentJob = extractions.data?.find(
      (job) => job.id === reviewJobId && job.status === "review_required",
    );
    if (currentJob) return;
    const nextJob = extractions.data?.find((job) => job.status === "review_required");
    if (!nextJob) return;
    openExtractionReview(nextJob);
  }, [extractions.data, reviewJobId]);
  const createExtraction = useMutation({
    mutationFn: async () => {
      if (!extractionFile) throw new Error("请选择一份成品 DOCX");
      if (!externalProcessingAuthorized) throw new Error("请先确认文件处理授权");
      const result = await api.POST("/api/v1/template-extractions", {
        params: {
          query: {
            stage: extractionStage as "requirement" | "feasibility" | "tender" | "contract",
            authorized_external_processing: true,
          },
        },
        body: { upload: extractionFile as unknown as string },
        bodySerializer() {
          const body = new FormData();
          body.set("upload", extractionFile);
          return body;
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      setExtractionFile(undefined);
      setExternalProcessingAuthorized(false);
      void queryClient.invalidateQueries({ queryKey: ["template-extractions"] });
    },
  });
  const retryExtraction = useMutation({
    mutationFn: async (jobId: string) => {
      const result = await api.POST("/api/v1/template-extractions/{extraction_job_id}/retry", {
        params: { path: { extraction_job_id: jobId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["template-extractions"] }),
  });
  const confirmExtraction = useMutation({
    mutationFn: async (job: TemplateExtractionJob) => {
      const result = await api.POST("/api/v1/template-extractions/{extraction_job_id}/confirm", {
        params: { path: { extraction_job_id: job.id } },
        body: {
          revision: job.revision,
          template_name: reviewForm.template_name,
          source_kind: reviewForm.source_kind as
            | "adapted_from_official_outline"
            | "platform_reference_template"
            | "other_official_template",
          issuing_authority: reviewForm.issuing_authority || null,
          document_number: reviewForm.document_number || null,
          publish_year: reviewForm.publish_year ? Number(reviewForm.publish_year) : null,
          source_url: reviewForm.source_url || null,
          applicability: reviewForm.applicability || null,
          selected_section_ids: [...selectedSections],
          selected_variable_ids: [...selectedVariables],
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      setReviewJobId(undefined);
      void queryClient.invalidateQueries({ queryKey: ["template-extractions"] });
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      if (form.name.trim().length < 2) throw new Error("请输入模板名称");
      const result = await api.POST("/api/v1/templates", {
        body: {
          name: form.name,
          stage: form.stage as "requirement" | "feasibility" | "tender" | "contract",
          source_kind: form.source_kind as
            | "adapted_from_official_outline"
            | "platform_reference_template"
            | "other_official_template",
          specialty: null,
          procurement_type: null,
          contract_type: null,
          issuing_authority: form.issuing_authority || null,
          document_number: form.document_number || null,
          publish_year: form.publish_year ? Number(form.publish_year) : null,
          source_url: form.source_url || null,
          applicability: form.applicability || null,
          format_profile: { page_size: "A4", standard: "customer_template" },
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      setForm((current) => ({
        ...current,
        name: "",
        issuing_authority: "",
        document_number: "",
        publish_year: "",
        source_url: "",
        applicability: "",
      }));
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });
  const publish = useMutation({
    mutationFn: async (templateId: string) => {
      const result = await api.POST("/api/v1/templates/{template_id}/publish", {
        params: { path: { template_id: templateId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["templates"] }),
  });
  const uploadSource = useMutation({
    mutationFn: async ({ template, file }: { template: Template; file: File }) => {
      const result = await api.POST(
        "/api/v1/templates/{template_id}/versions/{version_number}/source",
        {
          params: {
            path: {
              template_id: template.id,
              version_number: template.current_version,
            },
          },
          body: { upload: file as unknown as string },
          bodySerializer() {
            const body = new FormData();
            body.set("upload", file);
            return body;
          },
        },
      );
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (_version, variables) => {
      setSourceFiles((current) => ({ ...current, [variables.template.id]: undefined }));
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });
  return (
    <>
      <PageHeader
        title="模板中心"
        description="按权威来源分级管理模板。官方原文用于核对，只有明确标记“可用于生成”的模板才能进入生成流程。"
      />
      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TEMPLATE_CATEGORIES.map((category) => (
          <div key={category.key} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="font-medium text-slate-900">{category.label}</div>
            <div className="mt-2 text-xs leading-5 text-slate-500">{category.description}</div>
          </div>
        ))}
      </div>
      <Card className="mb-5 border-blue-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="section-title">从成品文件提取模板</h3>
            <p className="section-description">
              上传已完成的
              DOCX，程序保留版式并解析结构，模型只提出章节和变量候选；人工确认后建立模板草稿，不会自动发布。
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
            程序解析 + 小模型理解 + 人工确认
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <input
            aria-label="选择成品 DOCX"
            className="form-input py-2"
            type="file"
            accept=".docx"
            onChange={(event) => setExtractionFile(event.target.files?.[0])}
          />
          <select
            aria-label="成品文件所属阶段"
            className="form-input"
            value={extractionStage}
            onChange={(event) => setExtractionStage(event.target.value)}
          >
            {Object.entries(STAGE_NAMES).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
          <button
            className="primary-button"
            disabled={
              !extractionFile || !externalProcessingAuthorized || createExtraction.isPending
            }
            onClick={() => createExtraction.mutate()}
          >
            {createExtraction.isPending ? "正在上传…" : "上传并智能提取"}
          </button>
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-600">
          <input
            className="mt-1"
            type="checkbox"
            checked={externalProcessingAuthorized}
            onChange={(event) => setExternalProcessingAuthorized(event.target.checked)}
          />
          <span>
            我确认该文件已获授权处理，并同意将抽取后的文本块发送至当前配置的模型服务。原 DOCX
            文件保存在平台私有对象存储中，不会作为模型指令执行。
          </span>
        </label>
        {createExtraction.error && (
          <div className="mt-4">
            <ErrorNotice error={createExtraction.error} />
          </div>
        )}

        {!!extractions.data?.length && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="text-sm font-medium text-slate-900">最近提取任务</div>
            <div className="mt-3 grid gap-2">
              {extractions.data.slice(0, 5).map((job) => (
                <div
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800">
                      {job.result_json?.summary.filename ?? `${STAGE_NAMES[job.stage]}成品文件`}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {STAGE_NAMES[job.stage]} · {job.model_name ?? "等待分配模型"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={job.status} />
                    <span className="text-xs text-slate-500">
                      {EXTRACTION_STATUS_NAMES[job.status] ?? job.status}
                    </span>
                    {job.status === "review_required" && (
                      <button className="text-button" onClick={() => openExtractionReview(job)}>
                        人工确认
                      </button>
                    )}
                    {job.status === "failed" && job.attempt < job.max_attempts && (
                      <button
                        className="text-button"
                        disabled={retryExtraction.isPending}
                        onClick={() => retryExtraction.mutate(job.id)}
                      >
                        重试
                      </button>
                    )}
                    {job.status === "confirmed" && job.confirmed_template_id && (
                      <a
                        className="text-button"
                        href={`/api/v1/templates/${job.confirmed_template_id}/versions/1/source`}
                      >
                        下载模板源
                      </a>
                    )}
                  </div>
                  {job.error && <div className="w-full text-xs text-red-600">{job.error}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeReview?.result_json && (
          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900">人工确认提取结果</div>
                <div className="mt-1 text-xs text-slate-500">
                  共识别 {activeReview.result_json.summary.block_count} 个内容块、
                  {activeReview.result_json.sections.length} 个章节候选、
                  {activeReview.result_json.variables.length}{" "}
                  个变量候选。取消勾选即可排除不应进入模板的内容。
                </div>
              </div>
              <span className="text-xs text-slate-500">
                {activeReview.result_json.summary.provider} /{" "}
                {activeReview.result_json.summary.model}
              </span>
            </div>
            {!!activeReview.result_json.warnings.length && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {activeReview.result_json.warnings.map((warning) => (
                  <div key={warning}>• {warning}</div>
                ))}
              </div>
            )}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="text-sm font-medium text-slate-800">章节结构（至少选择一项）</div>
                <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                  {activeReview.result_json.sections.map((section) => (
                    <label key={section.id} className="flex items-start gap-2 text-sm">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={selectedSections.has(section.id)}
                        onChange={() =>
                          setSelectedSections((current) => {
                            const next = new Set(current);
                            if (next.has(section.id)) next.delete(section.id);
                            else next.add(section.id);
                            return next;
                          })
                        }
                      />
                      <span>
                        <span className="text-slate-800">{section.title}</span>
                        <span className="ml-2 text-xs text-slate-400">
                          置信度 {Math.round(section.confidence * 100)}%
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-slate-800">变量候选（可不选择）</div>
                <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                  {activeReview.result_json.variables.map((variable) => (
                    <label key={variable.id} className="flex items-start gap-2 text-sm">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={selectedVariables.has(variable.id)}
                        onChange={() =>
                          setSelectedVariables((current) => {
                            const next = new Set(current);
                            if (next.has(variable.id)) next.delete(variable.id);
                            else next.add(variable.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-slate-800">{variable.label}</span>
                        <span className="ml-2 font-mono text-xs text-blue-700">
                          {`{{${variable.variable_key}}}`}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          原文：{variable.exact_text}
                        </span>
                      </span>
                    </label>
                  ))}
                  {!activeReview.result_json.variables.length && (
                    <div className="text-xs text-slate-400">未发现有可靠原文定位的变量候选</div>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <input
                className="form-input"
                value={reviewForm.template_name}
                onChange={(event) =>
                  setReviewForm({ ...reviewForm, template_name: event.target.value })
                }
                placeholder="模板名称（必填）"
              />
              <select
                className="form-input"
                value={reviewForm.source_kind}
                onChange={(event) =>
                  setReviewForm({ ...reviewForm, source_kind: event.target.value })
                }
              >
                <option value="platform_reference_template">平台参考模板</option>
                <option value="adapted_from_official_outline">依据正式大纲适配</option>
                <option value="other_official_template">其他正式模板</option>
              </select>
              <input
                className="form-input"
                value={reviewForm.issuing_authority}
                onChange={(event) =>
                  setReviewForm({ ...reviewForm, issuing_authority: event.target.value })
                }
                placeholder="发布机关或确认单位"
              />
              <input
                className="form-input"
                value={reviewForm.document_number}
                onChange={(event) =>
                  setReviewForm({ ...reviewForm, document_number: event.target.value })
                }
                placeholder="文号（如适用）"
              />
              <input
                className="form-input"
                type="number"
                min="1949"
                max="2100"
                value={reviewForm.publish_year}
                onChange={(event) =>
                  setReviewForm({ ...reviewForm, publish_year: event.target.value })
                }
                placeholder="发布年份"
              />
              <input
                className="form-input"
                value={reviewForm.source_url}
                onChange={(event) =>
                  setReviewForm({ ...reviewForm, source_url: event.target.value })
                }
                placeholder="官方来源链接（大纲适配必填）"
              />
              <input
                className="form-input md:col-span-2"
                value={reviewForm.applicability}
                onChange={(event) =>
                  setReviewForm({ ...reviewForm, applicability: event.target.value })
                }
                placeholder="适用范围说明"
              />
              <button
                className="primary-button"
                disabled={
                  reviewForm.template_name.trim().length < 2 ||
                  selectedSections.size === 0 ||
                  confirmExtraction.isPending
                }
                onClick={() => confirmExtraction.mutate(activeReview)}
              >
                {confirmExtraction.isPending ? "正在建立…" : "确认并建立模板草稿"}
              </button>
            </div>
            {confirmExtraction.error && (
              <div className="mt-4">
                <ErrorNotice error={confirmExtraction.error} />
              </div>
            )}
          </div>
        )}
        {extractions.error && (
          <div className="mt-4">
            <ErrorNotice error={extractions.error} />
          </div>
        )}
      </Card>
      <Card className="mb-5">
        <h3 className="section-title">手工新增模板</h3>
        <p className="section-description">
          国家正式文本由平台统一维护；新增项可登记为大纲适配、平台参考或经确认的其他正式模板。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            className="form-input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="模板名称"
          />
          <select
            className="form-input"
            value={form.stage}
            onChange={(event) => setForm({ ...form, stage: event.target.value })}
          >
            {Object.entries(STAGE_NAMES).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
          <select
            className="form-input"
            value={form.source_kind}
            onChange={(event) => setForm({ ...form, source_kind: event.target.value })}
          >
            <option value="other_official_template">其他正式模板</option>
            <option value="adapted_from_official_outline">依据正式大纲适配</option>
            <option value="platform_reference_template">平台参考模板</option>
          </select>
          <input
            className="form-input"
            value={form.issuing_authority}
            onChange={(event) => setForm({ ...form, issuing_authority: event.target.value })}
            placeholder="发布机关或确认单位"
          />
          <input
            className="form-input"
            value={form.document_number}
            onChange={(event) => setForm({ ...form, document_number: event.target.value })}
            placeholder="文号（如适用）"
          />
          <input
            className="form-input"
            type="number"
            min="1949"
            max="2100"
            value={form.publish_year}
            onChange={(event) => setForm({ ...form, publish_year: event.target.value })}
            placeholder="发布年份"
          />
          <input
            className="form-input"
            value={form.source_url}
            onChange={(event) => setForm({ ...form, source_url: event.target.value })}
            placeholder="官方来源链接（大纲适配必填）"
          />
          <input
            className="form-input"
            value={form.applicability}
            onChange={(event) => setForm({ ...form, applicability: event.target.value })}
            placeholder="适用范围说明"
          />
          <button className="primary-button" onClick={() => create.mutate()}>
            建立草稿
          </button>
        </div>
        {create.error && (
          <div className="mt-4">
            <ErrorNotice error={create.error} />
          </div>
        )}
      </Card>
      <div className="space-y-5">
        {TEMPLATE_CATEGORIES.map((category) => {
          const items = templates.data?.filter(
            (template: Template) => template.source_kind === category.key,
          );
          return (
            <Card key={category.key}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="section-title">{category.label}</h3>
                  <p className="section-description">{category.description}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  {items?.length ?? 0} 份
                </span>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>模板名称</th>
                      <th>阶段</th>
                      <th>来源依据</th>
                      <th>版本</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items?.map((template: Template) => (
                      <tr key={template.id}>
                        <td>
                          <div className="font-medium text-slate-900">{template.name}</div>
                          {template.applicability && (
                            <div className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
                              {template.applicability}
                            </div>
                          )}
                        </td>
                        <td>{STAGE_NAMES[template.stage] ?? template.stage}</td>
                        <td>
                          <div>
                            {template.issuing_authority ||
                              (template.source_kind === "platform_reference_template"
                                ? "平台编制"
                                : "来源待登记")}
                          </div>
                          {(template.document_number || template.publish_year) && (
                            <div className="mt-1 text-xs text-slate-500">
                              {[template.document_number, template.publish_year]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          )}
                        </td>
                        <td>V{template.current_version}</td>
                        <td>
                          <StatusBadge status={template.status} />
                          <div className="mt-1 text-xs text-slate-500">
                            {template.generation_enabled ? "可用于生成" : "仅供查阅核对"}
                          </div>
                        </td>
                        <td>
                          {template.status !== "published" ? (
                            <div className="flex min-w-80 items-center gap-2">
                              <input
                                aria-label={`${template.name} DOCX 源`}
                                className="block w-44 text-xs"
                                type="file"
                                accept=".docx"
                                onChange={(event) =>
                                  setSourceFiles((current) => ({
                                    ...current,
                                    [template.id]: event.target.files?.[0],
                                  }))
                                }
                              />
                              <button
                                className="text-button"
                                disabled={!sourceFiles[template.id] || uploadSource.isPending}
                                onClick={() => {
                                  const file = sourceFiles[template.id];
                                  if (file) uploadSource.mutate({ template, file });
                                }}
                              >
                                上传并预检
                              </button>
                              <button
                                className="text-button"
                                disabled={publish.isPending}
                                onClick={() => publish.mutate(template.id)}
                              >
                                发布
                              </button>
                            </div>
                          ) : (
                            <div className="flex min-w-28 flex-col items-start gap-1">
                              {template.source_url && (
                                <a
                                  className="text-button"
                                  href={template.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  查阅来源
                                </a>
                              )}
                              <span className="text-xs text-slate-400">
                                {template.is_builtin ? "内置目录" : "当前有效"}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!items?.length && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                          暂无此类模板
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
      {templates.error && <ErrorNotice error={templates.error} />}
      {(uploadSource.error || publish.error) && (
        <ErrorNotice error={uploadSource.error || publish.error} />
      )}
    </>
  );
}

export function FieldDictionaryPage() {
  const [stage, setStage] = useState<string>("requirement");
  const fields = useQuery({
    queryKey: ["field-definitions", stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-definitions", {
        params: { query: { stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  return (
    <>
      <PageHeader
        title="字段字典"
        description="字段定义控制数据类型、级别、单位和发布门禁。"
        actions={
          <select
            className="form-input w-48"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            {Object.entries(STAGE_NAMES).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        }
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>字段键</th>
                <th>字段名称</th>
                <th>数据类型</th>
                <th>单位</th>
                <th>级别</th>
                <th>必需</th>
              </tr>
            </thead>
            <tbody>
              {fields.data?.map((field: FieldDefinition) => (
                <tr key={field.id}>
                  <td className="font-mono text-xs">{field.field_key}</td>
                  <td>{field.field_label}</td>
                  <td>{field.data_type}</td>
                  <td>{field.unit ?? "-"}</td>
                  <td>
                    <span className={field.criticality === "P0" ? "font-medium text-red-700" : ""}>
                      {field.criticality}
                    </span>
                  </td>
                  <td>{field.required ? "是" : "否"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {fields.error && <ErrorNotice error={fields.error} />}
      </Card>
    </>
  );
}

export function SystemPage() {
  const location = useLocation();
  const tab = location.pathname.split("/").at(-1) ?? "users";
  const users = useQuery({
    queryKey: ["users"],
    enabled: tab === "users",
    queryFn: async () => {
      const result = await api.GET("/api/v1/users", {
        params: { query: { page: 1, page_size: 100 } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data.items as User[];
    },
  });
  const roles = useQuery({
    queryKey: ["roles"],
    enabled: tab === "roles",
    queryFn: async () => {
      const result = await api.GET("/api/v1/roles");
      if (result.error) throw apiError(result.error, result.response);
      return result.data as Array<{ id: string; key: string; name: string }>;
    },
  });
  const logs = useQuery({
    queryKey: ["audit-logs"],
    enabled: tab === "audit-logs",
    queryFn: async () => {
      const result = await api.GET("/api/v1/audit-logs", {
        params: { query: { page: 1, page_size: 100 } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data.items as Array<Record<string, string>>;
    },
  });
  const error = users.error || roles.error || logs.error;
  return (
    <>
      <PageHeader title="系统管理" description="用户、角色与审计日志均受组织边界和权限控制。" />
      <Card className="mb-5 p-0">
        <div className="flex gap-1 p-2">
          <Link
            className={`tab-button ${tab === "users" ? "tab-button-active" : ""}`}
            to="/admin/users"
          >
            用户
          </Link>
          <Link
            className={`tab-button ${tab === "roles" ? "tab-button-active" : ""}`}
            to="/admin/roles"
          >
            角色
          </Link>
          <Link
            className={`tab-button ${tab === "audit-logs" ? "tab-button-active" : ""}`}
            to="/admin/audit-logs"
          >
            审计日志
          </Link>
        </div>
      </Card>
      {error && <ErrorNotice error={error} />}
      <Card>
        {tab === "users" && (
          <SimpleTable
            headers={["姓名", "邮箱", "状态", "修订"]}
            rows={
              users.data?.map((user) => [
                user.display_name,
                user.email,
                user.is_active ? "启用" : "停用",
                `R${user.revision}`,
              ]) ?? []
            }
          />
        )}
        {tab === "roles" && (
          <SimpleTable
            headers={["角色名称", "角色键", "角色 ID"]}
            rows={roles.data?.map((role) => [role.name, role.key, role.id]) ?? []}
          />
        )}
        {tab === "audit-logs" && (
          <SimpleTable
            headers={["时间", "动作", "对象", "请求 ID"]}
            rows={
              logs.data?.map((log) => [
                log.created_at,
                log.action,
                `${log.object_type} ${log.object_id ?? ""}`,
                log.request_id,
              ]) ?? []
            }
          />
        )}
      </Card>
    </>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="py-10 text-center text-sm text-slate-500">暂无数据</div>
      )}
    </div>
  );
}
