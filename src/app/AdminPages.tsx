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
import { TaskProgressPanel, type TaskProgressStage } from "../components/TaskProgressPanel";
import { BrandingSettingsPage } from "./BrandingSettingsPage";
import { ModelSettingsPage } from "./ModelSettingsPage";
import { ErrorNotice } from "./Auth";
import { Card, PageHeader, StatusBadge } from "./Shell";

const STAGE_NAMES: Record<string, string> = {
  demand: "项目需求",
  requirement: "建议书",
  feasibility: "可行性研究报告",
  tender: "招投标",
  contract: "合同",
};

/** 模板中心列表与成品提取展示全部主链路阶段；与项目概览可见阶段一致。 */
const VISIBLE_TEMPLATE_STAGES = ["requirement", "feasibility", "tender", "contract"] as const;

const EXTRACTION_STATUS_NAMES: Record<string, string> = {
  queued: "等待处理",
  running: "正在解析",
  retrying: "正在重试",
  review_required: "质量合格，待确认发布",
  quality_rejected: "质量不合格",
  confirmed: "已发布模板",
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
  const [sourceFiles, setSourceFiles] = useState<Record<string, File | undefined>>({});
  const [extractionFile, setExtractionFile] = useState<File>();
  const [extractionStage, setExtractionStage] = useState<string>("tender");
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
    (job) =>
      job.id === reviewJobId &&
      (job.status === "review_required" || job.status === "quality_rejected"),
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
  const activeExtractionJob = extractions.data?.find((job) =>
    ["queued", "running", "retrying"].includes(job.status),
  );
  const extractionInProgress = createExtraction.isPending || Boolean(activeExtractionJob);
  const extractionStages: TaskProgressStage[] = [
    {
      key: "upload",
      label: "安全接收文件",
      detail: "保存原始 DOCX 并锁定文件版本",
      status: createExtraction.isPending ? "active" : activeExtractionJob ? "done" : "waiting",
    },
    {
      key: "structure",
      label: "解析结构与版式",
      detail: "识别标题层级、表格、页眉页脚和样式",
      status: activeExtractionJob ? "active" : "waiting",
    },
    {
      key: "candidates",
      label: "识别章节与变量",
      detail: "模型仅提供候选，不会直接发布",
      status: "waiting",
    },
    {
      key: "quality",
      label: "执行质量门禁",
      detail: "检查结构、变量和模板可用性",
      status: "waiting",
    },
  ];
  return (
    <>
      <PageHeader
        title="模板中心"
        description="按权威来源分级管理模板。官方原文用于核对，只有明确标记“可用于生成”的模板才能进入生成流程。"
      />
      <Card className="mb-5 border-blue-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="section-title">从成品文件提取模板</h3>
            <p className="section-description">
              上传已完成的
              DOCX，程序保留版式并解析结构，模型只提出章节和变量候选；解析完成后先做正式模板质量判定：不合格不会进入下方模板列表，合格经人工确认后直接发布。
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
            程序解析 + 质量门禁 + 确认发布
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
            {VISIBLE_TEMPLATE_STAGES.map((key) => (
              <option key={key} value={key}>
                {STAGE_NAMES[key]}
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
        {extractionInProgress && (
          <TaskProgressPanel
            className="mt-5"
            title={
              createExtraction.isPending
                ? "正在安全上传成品文件"
                : activeExtractionJob?.status === "retrying"
                  ? "正在从上次中断处重新提取"
                  : "正在提取可复用模板"
            }
            description="系统正在保留原文件版式并识别可编辑结构；解析结果会先经过质量门禁，再交由人工确认发布。"
            stages={extractionStages}
            startedAt={activeExtractionJob?.started_at}
            facts={[
              ...(activeExtractionJob?.model_name
                ? [{ label: "识别模型", value: activeExtractionJob.model_name }]
                : []),
              ...(activeExtractionJob
                ? [
                    {
                      label: "任务",
                      value: `${activeExtractionJob.id.slice(0, 8)} · 第 ${activeExtractionJob.attempt} 次尝试`,
                    },
                  ]
                : []),
            ]}
            outcome="完成后可核对章节、变量和质量报告，不会未经确认直接进入正式模板库"
          />
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
                        确认并发布
                      </button>
                    )}
                    {job.status === "quality_rejected" && (
                      <button className="text-button" onClick={() => openExtractionReview(job)}>
                        查看不合格原因
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
                  {job.status === "quality_rejected" &&
                    !!job.result_json?.quality?.reasons?.length && (
                      <div className="w-full text-xs leading-5 text-amber-800">
                        {job.result_json.quality.reasons.map((reason) => (
                          <div key={reason}>• {reason}</div>
                        ))}
                      </div>
                    )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeReview?.result_json && (
          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-slate-900">
                  {activeReview.status === "quality_rejected"
                    ? "质量门禁未通过"
                    : "确认提取结果并发布模板"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  共识别 {activeReview.result_json.summary.block_count} 个内容块、
                  {activeReview.result_json.sections.length} 个章节候选、
                  {activeReview.result_json.variables.length} 个变量候选。
                  {activeReview.status === "review_required"
                    ? "取消勾选即可排除不应进入模板的内容；确认后将直接发布到下方模板列表。"
                    : "该文件未达到正式模板质量要求，不会进入下方模板列表。"}
                </div>
              </div>
              <span className="text-xs text-slate-500">
                {activeReview.result_json.summary.provider} /{" "}
                {activeReview.result_json.summary.model}
              </span>
            </div>
            {activeReview.result_json.quality && (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${
                  activeReview.result_json.quality.passed
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <div className="font-medium">
                  质量判定：
                  {activeReview.result_json.quality.passed ? "合格，可发布" : "不合格，已拦截"}
                  （得分 {Math.round(activeReview.result_json.quality.score * 100)}%）
                </div>
                {activeReview.result_json.quality.reasons.map((reason) => (
                  <div key={reason}>• {reason}</div>
                ))}
              </div>
            )}
            {!!activeReview.result_json.warnings.length && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {activeReview.result_json.warnings.map((warning) => (
                  <div key={warning}>• {warning}</div>
                ))}
              </div>
            )}
            {activeReview.status === "review_required" && (
              <>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="text-sm font-medium text-slate-800">
                      章节结构（至少选择一项）
                    </div>
                    <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                      {activeReview.result_json.sections.map((section) => {
                        const level = Math.max(1, Math.min(3, Number(section.level ?? 1)));
                        return (
                          <label
                            key={section.id}
                            className="flex items-start gap-2 text-sm"
                            style={{ paddingLeft: `${(level - 1) * 0.75}rem` }}
                          >
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
                                L{level} · 置信度 {Math.round(section.confidence * 100)}%
                              </span>
                            </span>
                          </label>
                        );
                      })}
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
                    {confirmExtraction.isPending ? "正在发布…" : "确认并发布模板"}
                  </button>
                </div>
                {confirmExtraction.error && (
                  <div className="mt-4">
                    <ErrorNotice error={confirmExtraction.error} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {extractions.error && (
          <div className="mt-4">
            <ErrorNotice error={extractions.error} />
          </div>
        )}
      </Card>
      <div className="space-y-5">
        {TEMPLATE_CATEGORIES.map((category) => {
          const items = (templates.data ?? []).filter(
            (template: Template) =>
              template.source_kind === category.key &&
              (VISIBLE_TEMPLATE_STAGES as readonly string[]).includes(template.stage),
          );
          const stageGroups = VISIBLE_TEMPLATE_STAGES.map((stage) => ({
            stage,
            items: items
              .filter((template) => template.stage === stage)
              .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
          })).filter((group) => group.items.length > 0);
          if (items.length === 0) return null;
          return (
            <Card key={category.key}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="section-title">{category.label}</h3>
                  <p className="section-description">{category.description}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  {items.length} 份
                </span>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>模板名称</th>
                      <th>来源依据</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  {stageGroups.map((group) => (
                    <tbody key={group.stage}>
                      <tr className="bg-slate-50/80">
                        <td colSpan={4} className="!py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-700">
                              {STAGE_NAMES[group.stage]}
                            </span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                              {group.items.length} 份
                            </span>
                          </div>
                        </td>
                      </tr>
                      {group.items.map((template) => (
                        <tr key={template.id}>
                          <td>
                            <div className="font-medium text-slate-900">{template.name}</div>
                            {template.applicability && (
                              <div className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
                                {template.applicability}
                              </div>
                            )}
                          </td>
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
                          <td>
                            <StatusBadge status={template.status} />
                            <div className="mt-1 text-xs text-slate-500">
                              {template.generation_enabled ? "可用于生成" : "仅供查阅核对"}
                            </div>
                          </td>
                          <td>
                            {template.status !== "published" ? (
                              <div className="flex min-w-80 items-center gap-2">
                                {!template.has_docx_source && (
                                  <>
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
                                      className="text-button disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                                      disabled={!sourceFiles[template.id] || uploadSource.isPending}
                                      title={
                                        sourceFiles[template.id]
                                          ? "上传 DOCX 并预检"
                                          : "请先选择 DOCX 文件"
                                      }
                                      onClick={() => {
                                        const file = sourceFiles[template.id];
                                        if (file) uploadSource.mutate({ template, file });
                                      }}
                                    >
                                      上传并预检
                                    </button>
                                  </>
                                )}
                                {template.has_docx_source && (
                                  <span className="text-xs text-slate-500">DOCX 源已就绪</span>
                                )}
                                <button
                                  className="text-button"
                                  disabled={publish.isPending || !template.has_docx_source}
                                  title={
                                    template.has_docx_source
                                      ? "发布模板"
                                      : "请先上传并通过预检的 DOCX 源"
                                  }
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
                    </tbody>
                  ))}
                  {!items.length && (
                    <tbody>
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-sm text-slate-400">
                          暂无此类模板
                        </td>
                      </tr>
                    </tbody>
                  )}
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

type FieldFormState = {
  field_key: string;
  field_label: string;
  data_type: string;
  unit: string;
  criticality: "P0" | "P1" | "P2";
  required: boolean;
  aliasesText: string;
};

const EMPTY_FIELD_FORM: FieldFormState = {
  field_key: "",
  field_label: "",
  data_type: "string",
  unit: "",
  criticality: "P2",
  required: false,
  aliasesText: "",
};

const DATA_TYPE_OPTIONS = [
  { value: "string", label: "字符串" },
  { value: "text", label: "文本" },
  { value: "money", label: "金额" },
  { value: "duration", label: "期限" },
  { value: "percentage", label: "百分比" },
  { value: "payment_plan", label: "付款计划" },
] as const;

const DATA_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DATA_TYPE_OPTIONS.map((option) => [option.value, option.label]),
);

const CRITICALITY_LABELS: Record<"P0" | "P1" | "P2", string> = {
  P0: "P0 阻断级",
  P1: "P1 重要级",
  P2: "P2 说明级",
};

/** Known extraction aliases mirrored from backend field_catalog (candidates only). */
const KNOWN_FIELD_ALIASES: Record<string, string[]> = {
  project_name: ["项目名称"],
  total_investment: ["可研总投资", "项目总投资", "总投资", "建设投资"],
  procurement_budget: ["招标预算", "采购预算"],
  maximum_price: ["最高限价", "招标最高限价"],
  final_contract_amount: ["最终合同金额", "合同总金额", "合同金额"],
  project_owner: ["项目单位", "建设单位"],
  construction_scope: ["项目全部建设范围", "建设范围", "建设内容"],
  procurement_scope: ["本次采购范围", "招标范围", "采购范围"],
  party_a: ["甲方完整主体", "甲方"],
  party_b: ["乙方完整主体", "乙方"],
  contract_subject: ["合同标的"],
  contract_scope: ["本合同范围", "合同范围"],
  tax_inclusion: ["含税方式", "是否含税"],
  delivery_location: ["交付地点", "履行地点"],
  acceptance: ["验收约定", "验收标准"],
  warranty: ["质保约定", "质保期"],
  breach: ["违约责任"],
  effective_conditions: ["生效条件"],
  project_period: ["项目总建设周期", "建设周期", "建设期"],
  contract_duration: ["合同履行期限", "履行期限"],
  delivery_period: ["交付周期", "交货期", "供货周期"],
  project_location: ["建设地点", "项目地点", "项目所在地"],
  tax_rate: ["税率"],
  payment_plan: ["付款计划", "付款安排", "支付条款"],
};

function deriveCriticality(dataType: string, required: boolean): "P0" | "P1" | "P2" {
  if (required) return "P0";
  if (dataType === "money" || dataType === "percentage" || dataType === "payment_plan") return "P1";
  if (dataType === "duration" || dataType === "text") return "P1";
  return "P2";
}

function generateFieldKey(label: string): string {
  const ascii = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  if (ascii && /^[a-z]/.test(ascii)) return ascii;
  return `custom_${Date.now().toString(36)}`;
}

function aliasesFromRules(rules: FieldDefinition["rules"] | undefined): string {
  const aliases =
    rules && typeof rules === "object" ? (rules as { aliases?: unknown }).aliases : undefined;
  if (!Array.isArray(aliases)) return "";
  return aliases.map(String).filter(Boolean).join("、");
}

function parseAliases(text: string, fieldLabel: string): string[] {
  const parts = text
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (fieldLabel && !parts.includes(fieldLabel)) {
    parts.unshift(fieldLabel);
  }
  return [...new Set(parts)];
}

function suggestAliases(fieldLabel: string, dataType: string, fieldKey?: string): string {
  const label = fieldLabel.trim();
  const known = fieldKey ? KNOWN_FIELD_ALIASES[fieldKey] : undefined;
  if (known?.length) {
    const merged = label && !known.includes(label) ? [label, ...known] : [...known];
    return [...new Set(merged)].join("、");
  }

  const extras: string[] = [];
  switch (dataType) {
    case "money":
      extras.push("金额", "总金额", "价款");
      if (label.includes("投资")) extras.push("总投资", "建设投资", "项目总投资");
      if (label.includes("预算")) extras.push("采购预算", "招标预算");
      if (label.includes("合同")) extras.push("合同金额", "合同总金额", "最终合同金额");
      if (label.includes("限价")) extras.push("最高限价", "招标最高限价");
      break;
    case "duration":
      extras.push("期限", "周期", "工期");
      if (label.includes("履行") || label.includes("合同")) extras.push("履行期限", "合同履行期限");
      if (label.includes("建设") || label.includes("项目"))
        extras.push("建设周期", "建设期", "项目总建设周期");
      if (label.includes("交付") || label.includes("交货"))
        extras.push("交货期", "供货周期", "交付周期");
      break;
    case "text":
      extras.push("内容", "说明", "约定");
      if (label.includes("范围")) extras.push("建设范围", "建设内容", "采购范围", "合同范围");
      break;
    case "percentage":
      extras.push("税率", "比例", "费率");
      break;
    case "payment_plan":
      extras.push("付款计划", "付款安排", "支付条款", "付款方式");
      break;
    case "string":
      extras.push("名称", "全称");
      if (label.includes("单位") || label.includes("主体")) extras.push("建设单位", "项目单位");
      if (label.includes("甲方")) extras.push("甲方", "甲方完整主体");
      if (label.includes("乙方")) extras.push("乙方", "乙方完整主体");
      break;
    default:
      break;
  }

  return [...new Set([label, ...extras].filter(Boolean))].join("、");
}

export function FieldDictionaryPage() {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<string>("requirement");
  const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState<"create" | FieldDefinition | null>(null);
  const [form, setForm] = useState<FieldFormState>(EMPTY_FIELD_FORM);
  const fields = useQuery({
    queryKey: ["field-definitions", stage, showInactive],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-definitions", {
        params: { query: { stage, include_inactive: showInactive } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["field-definitions"] });
  };

  const openCreate = () => {
    setForm({
      ...EMPTY_FIELD_FORM,
      aliasesText: "",
      criticality: deriveCriticality("string", false),
    });
    setEditor("create");
  };

  const openEdit = (field: FieldDefinition) => {
    setForm({
      field_key: field.field_key,
      field_label: field.field_label,
      data_type: field.data_type,
      unit: field.unit ?? "",
      criticality: deriveCriticality(field.data_type, field.required),
      required: field.required,
      aliasesText: aliasesFromRules(field.rules),
    });
    setEditor(field);
  };

  const updateForm = (patch: Partial<FieldFormState>) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (patch.data_type !== undefined || patch.required !== undefined) {
        next.criticality = deriveCriticality(next.data_type, next.required);
      }
      return next;
    });
  };

  const criticalityHint = form.required
    ? "已勾选「必需字段」，级别固定为 P0；取消勾选后才会随数据类型变化"
    : form.criticality === "P1"
      ? "未必需时：金额 / 百分比 / 付款计划 / 期限 / 文本 → P1"
      : "未必需时：字符串等其余类型 → P2";

  const saveMutation = useMutation({
    mutationFn: async () => {
      const aliases = parseAliases(form.aliasesText, form.field_label);
      const rules = { aliases, extract_mode: "label_value" };
      const criticality = deriveCriticality(form.data_type, form.required);
      if (editor === "create") {
        const fieldKey = generateFieldKey(form.field_label);
        const result = await api.POST("/api/v1/field-definitions", {
          body: {
            stage: stage as "demand" | "requirement" | "feasibility" | "tender" | "contract",
            field_key: fieldKey,
            field_label: form.field_label.trim(),
            data_type: form.data_type,
            unit: form.unit.trim() || null,
            criticality,
            required: form.required,
            rules,
          },
        });
        if (result.error) throw apiError(result.error, result.response);
        return result.data;
      }
      if (!editor) throw new Error("missing editor target");
      const result = await api.PATCH("/api/v1/field-definitions/{definition_id}", {
        params: { path: { definition_id: editor.id } },
        body: {
          field_label: form.field_label.trim(),
          data_type: form.data_type,
          unit: form.unit.trim() || null,
          criticality,
          required: form.required,
          rules,
          revision: editor.revision,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      setEditor(null);
      invalidate();
    },
  });

  const applyAliasSuggestion = () => {
    const fieldKey = editor === "create" ? undefined : editor?.field_key;
    const suggestion = suggestAliases(form.field_label, form.data_type, fieldKey);
    updateForm({ aliasesText: suggestion });
  };

  const toggleActive = useMutation({
    mutationFn: async (field: FieldDefinition) => {
      const path = field.is_active
        ? "/api/v1/field-definitions/{definition_id}/deactivate"
        : "/api/v1/field-definitions/{definition_id}/activate";
      const result = await api.POST(path, {
        params: { path: { definition_id: field.id } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: invalidate,
  });

  const restoreBase = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/field-definitions/restore-base", {
        params: {
          query: { stage: stage as "demand" | "requirement" | "feasibility" | "tender" | "contract" },
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: invalidate,
  });

  return (
    <>
      <PageHeader
        title="动态字段提取"
        description="维护各阶段基础字段与自定义字段。启用中的字段会参与解析、字段确认和定稿门禁；停用后不再解析。"
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
              />
              显示已停用
            </label>
            <button
              className="secondary-button"
              disabled={restoreBase.isPending}
              onClick={() => restoreBase.mutate()}
            >
              {restoreBase.isPending ? "恢复中…" : "恢复本阶段基础字段"}
            </button>
            <button className="primary-button" onClick={openCreate}>
              新建字段
            </button>
          </div>
        }
      />
      <Card>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>字段名称</th>
                <th>数据类型</th>
                <th>单位</th>
                <th>级别</th>
                <th>必需</th>
                <th>类型</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {fields.data?.map((field: FieldDefinition) => (
                <tr
                  key={field.id}
                  className={field.is_active ? undefined : "bg-slate-50 text-slate-400"}
                >
                  <td>{field.field_label}</td>
                  <td>{DATA_TYPE_LABELS[field.data_type] ?? field.data_type}</td>
                  <td>{field.unit ?? "-"}</td>
                  <td>
                    <span className={field.criticality === "P0" ? "font-medium text-red-700" : ""}>
                      {CRITICALITY_LABELS[(field.criticality as "P0" | "P1" | "P2") || "P2"] ??
                        field.criticality}
                    </span>
                  </td>
                  <td>{field.required ? "是" : "否"}</td>
                  <td>{field.is_base ? "基础" : "自定义"}</td>
                  <td>{field.is_active ? "启用" : "已停用"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button className="text-sm text-[#2E5495]" onClick={() => openEdit(field)}>
                        编辑
                      </button>
                      <button
                        className="text-sm text-[#2E5495]"
                        disabled={toggleActive.isPending}
                        onClick={() => toggleActive.mutate(field)}
                      >
                        {field.is_active ? "停用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {fields.error && <ErrorNotice error={fields.error} />}
        {(saveMutation.error || toggleActive.error || restoreBase.error) && (
          <div className="mt-4">
            <ErrorNotice error={saveMutation.error || toggleActive.error || restoreBase.error} />
          </div>
        )}
      </Card>

      {editor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
            <h3 className="text-lg font-semibold text-slate-900">
              {editor === "create" ? "新建字段" : "编辑字段"}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              解析别名用于从正文识别该字段；多个别名用顿号或逗号分隔。级别由字段属性自动确定，无需手工选择。
            </p>
            <div className="mt-4 grid gap-3">
              <label className="text-sm font-medium text-slate-700">
                字段名称
                <input
                  className="form-input mt-1"
                  value={form.field_label}
                  onChange={(event) => updateForm({ field_label: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-slate-700">
                  数据类型
                  <select
                    className="form-input mt-1"
                    value={form.data_type}
                    onChange={(event) => updateForm({ data_type: event.target.value })}
                  >
                    {DATA_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  单位
                  <input
                    className="form-input mt-1"
                    value={form.unit}
                    onChange={(event) => updateForm({ unit: event.target.value })}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-sm font-medium text-slate-700">
                  级别
                  <div
                    className={`form-input mt-1 flex items-center bg-slate-50 ${
                      form.criticality === "P0" ? "font-medium text-red-700" : "text-slate-700"
                    }`}
                  >
                    {CRITICALITY_LABELS[form.criticality]}
                  </div>
                  <p className="mt-1 text-xs font-normal text-slate-500">{criticalityHint}</p>
                </div>
                <label className="mt-7 flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.required}
                    onChange={(event) => updateForm({ required: event.target.checked })}
                  />
                  必需字段
                </label>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="field-aliases">
                    解析别名
                  </label>
                  <button
                    type="button"
                    className="text-button text-sm"
                    disabled={!form.field_label.trim()}
                    onClick={applyAliasSuggestion}
                  >
                    AI 建议
                  </button>
                </div>
                <textarea
                  id="field-aliases"
                  className="form-input mt-1 min-h-20 resize-y"
                  value={form.aliasesText}
                  placeholder="不确定时点「AI 建议」，再按材料用语微调"
                  onChange={(event) => updateForm({ aliasesText: event.target.value })}
                />
                <p className="mt-1 text-xs text-slate-500">
                  AI 建议仅为候选，按字段名称与数据类型生成，保存前请人工确认。
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="secondary-button" onClick={() => setEditor(null)}>
                取消
              </button>
              <button
                className="primary-button"
                disabled={saveMutation.isPending || !form.field_label.trim()}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
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
      <PageHeader
        title="系统管理"
        description="用户、角色、审计日志、品牌与模型配置均受组织边界和权限控制。"
      />
      <Card className="mb-5 p-0">
        <div className="flex flex-wrap gap-1 p-2">
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
          <Link
            className={`tab-button ${tab === "branding" ? "tab-button-active" : ""}`}
            to="/admin/branding"
          >
            品牌设置
          </Link>
          <Link
            className={`tab-button ${tab === "models" ? "tab-button-active" : ""}`}
            to="/admin/models"
          >
            模型配置
          </Link>
        </div>
      </Card>
      {tab === "branding" ? (
        <BrandingSettingsPage />
      ) : tab === "models" ? (
        <ModelSettingsPage />
      ) : (
        <>
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
      )}
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
