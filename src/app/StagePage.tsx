import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  apiError,
  createRequestId,
  type FieldDefinition,
  type FieldValue,
  type FileRecord,
  type ProcurementPlan,
  type Stage,
  type StageSourceOption,
  type Template,
} from "../api/client";
import {
  readGenerationDraft,
  writeGenerationDraft,
  type GenerationWorkspaceDraft,
} from "../lib/stageWorkspaceDraft";
import {
  allPendingDocumentsConfirmed,
  applicableToFieldDefinition,
  buildDraftSeed,
  buildFieldSavePlan,
  canSeedDocumentDraft,
  countScopedRequiredProgress,
  durationInputMode,
  fieldHasEvidence,
  firstIncompletePendingDocumentId,
  formatFieldValueForInput,
  hasProtectedFieldConfirmations,
  listPendingDocuments,
  parseStructuredAmountValue,
  pendingDocumentStatus,
  pickPreferredProcurementPlan,
  resolveFieldDisplayState,
  resolveGroupFieldValue,
  scopedFieldKey,
  sleep,
  sortApplicableFields,
  type ApplicableFieldLike,
  type DocumentDraftState,
  type PendingDocument,
} from "../lib/tenderWorkflow";
import { TaskProgressPanel, type TaskProgressStage } from "../components/TaskProgressPanel";
import { ErrorNotice, FullPageMessage } from "./Auth";
import { BasicsDataPanel } from "./BasicsDataPanel";
import { DocumentPage } from "./DocumentPage";
import { ParseResultsPanel } from "./ParseResultsPanel";
import { Card, PageHeader, StatusBadge } from "./Shell";

function cookieValue(name: string): string | undefined {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** 用户显式确认文件组织策略后，才物化待编制主文件组。 */
async function ensureDefaultDocumentGrouping(
  planId: string,
  strategy: "one_package_one_document" | "shared_single_document",
): Promise<ProcurementPlan> {
  const csrf = cookieValue("docchain_csrf");
  const response = await fetch(`/api/v1/procurement-plans/${planId}/ensure-default-grouping`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
      "X-Request-ID": createRequestId(),
    },
    body: JSON.stringify({ strategy }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(body, response);
  return body as ProcurementPlan;
}

const STAGE_NAMES: Record<string, string> = {
  demand: "项目需求",
  requirement: "建议书",
  feasibility: "可行性研究报告",
  tender: "招标文件",
  contract: "合同",
};
const BASIS_MATERIAL_STAGES = new Set(["demand", "requirement", "feasibility"]);
const TABS = [
  ["source", "来源选择"],
  ["files", "文件材料"],
  ["fields", "字段确认"],
  ["generation", "文档生成"],
  ["confirmation", "文档确认"],
] as const;
/** 招标阶段：基础数据 → 文档生成 → 文档确认；材料上传仍可通过 /files 直达。 */
const TENDER_TABS = [
  ["basics", "基础数据"],
  ["generation", "文档生成"],
  ["confirmation", "文档确认"],
] as const;
const BASIS_TABS = [
  ["files", "文件材料"],
  ["fields", "解析结果"],
] as const;

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SUPPORTED_FILE_EXTENSIONS = new Set(["docx", "pdf", "xlsx", "png", "jpg", "jpeg"]);
const SOURCE_TYPE_LABELS: Record<string, string> = {
  extracted: "上传材料",
  user_input: "人工录入",
  system_authoritative: "权威业务系统",
  template_default: "模板默认值",
};
const FIELD_ORDER: Record<string, string[]> = {
  demand: ["project_name", "project_owner", "construction_scope", "project_period", "project_location"],
  requirement: ["project_name", "project_owner", "construction_scope", "project_period"],
  feasibility: ["project_name", "construction_scope", "project_period", "total_investment"],
  tender: ["project_name", "procurement_scope", "procurement_budget", "maximum_price"],
};
export const NO_BID_BOND_VALUE = "本项目不要求投标保证金";

export function normalizeBidBondValue(value: string): string {
  const trimmed = value.trim();
  const compact = trimmed.replace(/\s/g, "");
  if (
    compact.includes("投标保证金") &&
    ["不要求", "不收取", "不缴纳", "无需"].some((marker) => compact.includes(marker))
  ) {
    return NO_BID_BOND_VALUE;
  }
  return trimmed;
}

export function bidBondEvidenceError(value: string, evidence: string): string | null {
  if (normalizeBidBondValue(value) === NO_BID_BOND_VALUE && !evidence.trim()) {
    return "请填写不收取投标保证金的确认依据";
  }
  return null;
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024).toFixed(1)} KB`;
}

type PipelineFailureStage = "upload" | "parse" | "analyze" | "confirm" | "timeout";

type PipelineFailure = {
  stage: PipelineFailureStage;
  title: string;
  message: string;
};

const PIPELINE_FAILURE_TITLES: Record<PipelineFailureStage, string> = {
  upload: "上传失败",
  parse: "材料解析失败",
  analyze: "待编制文件识别失败",
  confirm: "待编制清单确认未完成",
  timeout: "分析仍在进行",
};

class PipelineError extends Error {
  stage: PipelineFailureStage;

  constructor(stage: PipelineFailureStage, message: string) {
    super(message);
    this.name = "PipelineError";
    this.stage = stage;
  }
}

function toPipelineFailure(
  error: unknown,
  fallbackStage: PipelineFailureStage = "upload",
): PipelineFailure {
  if (error instanceof PipelineError) {
    return {
      stage: error.stage,
      title: PIPELINE_FAILURE_TITLES[error.stage],
      message: error.message,
    };
  }
  return {
    stage: fallbackStage,
    title: PIPELINE_FAILURE_TITLES[fallbackStage],
    message: error instanceof Error ? error.message : "处理失败，请重试。",
  };
}

function pickLatestProcurementAnalysis<
  T extends { started_at?: string | null; finished_at?: string | null },
>(items: T[] | undefined): T | null {
  if (!items?.length) return null;
  return [...items].sort((left, right) => {
    const leftAt = Date.parse(left.started_at || left.finished_at || "") || 0;
    const rightAt = Date.parse(right.started_at || right.finished_at || "") || 0;
    return rightAt - leftAt;
  })[0];
}

export function sourceFileSelectionError(files: File[]): string | null {
  if (files.length === 0) return "未读取到文件，请重新选择";
  for (const file of files) {
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (!SUPPORTED_FILE_EXTENSIONS.has(extension)) {
      return `${file.name}：仅支持 DOCX、PDF、XLSX、PNG、JPG、JPEG 文件`;
    }
    if (file.size > MAX_UPLOAD_BYTES) return `${file.name}：单文件不能超过 50 MB`;
    if (file.size === 0) return `${file.name}：不能上传空文件`;
  }
  return null;
}

export async function uploadSourceFileBatch<T>(
  files: File[],
  uploadFile: (file: File) => Promise<T>,
): Promise<{ uploaded: T[]; failed: Array<{ file: File; message: string }> }> {
  const results = await Promise.allSettled(files.map((file) => uploadFile(file)));
  return results.reduce(
    (batch, result, index) => {
      if (result.status === "fulfilled") {
        batch.uploaded.push(result.value);
      } else {
        batch.failed.push({
          file: files[index],
          message: result.reason instanceof Error ? result.reason.message : "上传失败，请重试",
        });
      }
      return batch;
    },
    {
      uploaded: [] as T[],
      failed: [] as Array<{ file: File; message: string }>,
    },
  );
}

export type FieldDraftGuidance = {
  kind: "no_draft" | "candidate_draft" | "needs_regen";
  title: string;
  body: string;
  primaryLabel: string;
  primaryTo: string;
  secondaryLabel?: string;
  secondaryTo?: string;
  tone: "blue" | "amber" | "emerald";
};

/** 字段确认完成后须重新生成，新草稿才带上正式确认值。 */
export function fieldDraftGuidance(args: {
  projectId: string;
  stage: string;
  documentId?: string;
  documentVersion?: number;
  confirmedCount: number;
  completedRequiredCount: number;
  requiredCount: number;
  pendingDocumentCount?: number;
  allPendingConfirmed?: boolean;
}): FieldDraftGuidance {
  const {
    projectId,
    stage,
    documentId,
    documentVersion,
    confirmedCount,
    completedRequiredCount,
    requiredCount,
    pendingDocumentCount = 0,
    allPendingConfirmed = false,
  } = args;
  const stageName = STAGE_NAMES[stage] ?? "本阶段文档";
  const draftLabel = stage === "tender" ? "招采草稿" : "文档草稿";
  const generationTo = `/projects/${projectId}/stages/${stage}/generation?from=${stage === "tender" ? "basics" : "fields"}`;
  const filesTo = `/projects/${projectId}/stages/${stage}/files`;
  const basicsTo = `/projects/${projectId}/stages/tender/basics`;
  const documentTo = documentId ? `/projects/${projectId}/documents/${documentId}` : undefined;
  const requiredDone = requiredCount > 0 && completedRequiredCount >= requiredCount;

  if (stage === "tender" && pendingDocumentCount > 0 && !allPendingConfirmed) {
    return {
      kind: "needs_regen",
      title: documentId
        ? "关键字段尚未齐全，可重新生成受控草稿"
        : "关键字段尚未齐全，可先生成受控草稿",
      body: `本项目需编制 ${pendingDocumentCount} 份招标文件。未确认字段会以【待确认】写入草稿，草稿可审阅但不可用于发布；P0/P1 问题仍会阻止定稿。不得为生成草稿而编造金额、日期、地点或资格条件。`,
      primaryLabel: documentId ? "生成新草稿" : "生成受控草稿",
      primaryTo: generationTo,
      secondaryLabel: "继续确认基础数据",
      secondaryTo: basicsTo,
      tone: "amber",
    };
  }

  // 文件“解析完成”只代表材料正文已抽取；没有待编制清单时，本页不会出现按文件确认的字段行。
  if (stage === "tender" && pendingDocumentCount === 0) {
    return {
      kind: "no_draft",
      title: documentId ? `${draftLabel}已存在，但尚未识别待编制文件` : "请先识别待编制招标文件",
      body: documentId
        ? "当前草稿来自材料候选，不等于字段已确认。请返回文件材料页点击“上传并解析 / 重新解析”，完成采购方案分析并生成待编制清单后，本页才会按文件列出待确认字段。"
        : "在文件材料页点击“上传并解析”后，系统会完成材料解析、采购方案分析并生成待编制文件清单；随后再回到本页按文件确认字段。",
      primaryLabel: "返回文件材料",
      primaryTo: filesTo,
      secondaryLabel: documentId ? "打开当前草稿" : undefined,
      secondaryTo: documentTo,
      tone: "amber",
    };
  }

  if (!documentId) {
    if (confirmedCount > 0 || allPendingConfirmed) {
      return {
        kind: "needs_regen",
        title:
          stage === "tender" && allPendingConfirmed
            ? "全部待编制文件已确认，请生成正式草稿"
            : requiredDone
              ? "定稿必填已确认，请生成正式草稿"
              : "已有确认字段，请生成正式草稿",
        body: `字段确认不会自动生成正文。请前往文档生成，基于已确认字段创建${stageName}草稿；未确认的关键项仍会标为待确认。`,
        primaryLabel: "基于已确认字段生成",
        primaryTo: generationTo,
        secondaryLabel: stage === "tender" ? "返回文件材料" : undefined,
        secondaryTo: stage === "tender" ? filesTo : undefined,
        tone: "amber",
      };
    }
    return {
      kind: "no_draft",
      title: stage === "tender" ? "请先上传材料识别待编制文件" : "可先核对字段，再生成草稿",
      body:
        stage === "tender"
          ? "在文件材料页点击“上传并解析”后，系统会一次完成材料解析、采购方案分析和待编制文件识别。随后请在本页按文件分别确认关键字段。"
          : "材料提取值只是候选。核对并确认后，再到文档生成页创建草稿；正式确认值才会写入正文。",
      primaryLabel: stage === "tender" ? "前往上传并解析" : "前往文档生成",
      primaryTo: stage === "tender" ? filesTo : generationTo,
      tone: "blue",
    };
  }

  if (confirmedCount === 0 && !allPendingConfirmed) {
    return {
      kind: "candidate_draft",
      title: `${draftLabel} V${documentVersion ?? "?"} 已生成（候选字段）`,
      body: "当前草稿基于材料候选或待确认项，不会随字段确认自动更新。请在本页逐项确认后，再重新生成；新版本才会带上正式确认值。",
      primaryLabel: "打开当前草稿",
      primaryTo: documentTo!,
      secondaryLabel: "确认后去重新生成",
      secondaryTo: generationTo,
      tone: "emerald",
    };
  }

  return {
    kind: "needs_regen",
    title: requiredDone
      ? `定稿必填已齐 · 请重新生成写入正式值`
      : `已确认 ${confirmedCount} 个字段 · 现有草稿不会自动更新`,
    body: `字段确认填完后，已有 ${draftLabel} V${documentVersion ?? "?"} 不会自动改写。请基于已确认字段重新生成，新草稿才会带上正式确认值；旧版本仍保留作历史。`,
    primaryLabel: "基于已确认字段重新生成",
    primaryTo: generationTo,
    secondaryLabel: `打开现有 V${documentVersion ?? "?"}`,
    secondaryTo: documentTo,
    tone: "amber",
  };
}

const TEMPLATE_SOURCE_GROUPS = [
  ["national_official_text", "国家正式文本"],
  ["adapted_from_official_outline", "依据正式大纲适配"],
  ["platform_reference_template", "平台参考模板"],
  ["other_official_template", "其他正式模板"],
] as const;

function sourceKindLabel(sourceKind: string): string {
  return TEMPLATE_SOURCE_GROUPS.find(([kind]) => kind === sourceKind)?.[1] ?? sourceKind;
}

export function StagePage() {
  const { projectId = "", stage = "tender" } = useParams();
  const location = useLocation();
  const activeTab = location.pathname.split("/").at(-1) ?? "source";
  const isBasisMaterial = BASIS_MATERIAL_STAGES.has(stage);
  const isTender = stage === "tender";
  const stageTabs = isBasisMaterial ? BASIS_TABS : isTender ? TENDER_TABS : TABS;
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
  if (isBasisMaterial && !["files", "fields"].includes(activeTab)) {
    return <Navigate to={`/projects/${projectId}/stages/${stage}/files`} replace />;
  }
  if (isTender && activeTab === "fields") {
    return <Navigate to={`/projects/${projectId}/stages/tender/basics`} replace />;
  }
  if (isTender && ["source", "templates", "procurement"].includes(activeTab)) {
    return <Navigate to={`/projects/${projectId}/stages/tender/basics`} replace />;
  }
  if (activeTab === "templates") {
    return <Navigate to={`/projects/${projectId}/stages/${stage}/generation`} replace />;
  }
  if (activeTab === "procurement") {
    return <Navigate to={`/projects/${projectId}/stages/${stage}/files`} replace />;
  }
  return (
    <>
      <PageHeader
        title={STAGE_NAMES[stage] ?? stage}
        description={
          isBasisMaterial
            ? "上传本阶段对应材料，由大模型完成解析；此处不进入招标文件编写。"
            : isTender
              ? "先确认基础数据，再生成招标文件草稿并定稿。"
              : "来源、字段和生成记录都按版本留痕。"
        }
        actions={
          <Link className="secondary-button" to={`/projects/${projectId}`}>
            返回项目
          </Link>
        }
      />
      <Card className="mb-5 p-0">
        <div className="flex gap-1 overflow-x-auto p-2" role="tablist">
          {stageTabs.map(([key, label]) => (
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
      {activeTab === "basics" && stage === "tender" && (
        <BasicsDataPanel
          projectId={projectId}
          stage={stage}
          renderFields={(focusProps) => (
            <FieldsPanel projectId={projectId} stage={stage} embedded {...focusProps} />
          )}
        />
      )}
      {activeTab === "fields" &&
        (isBasisMaterial ? (
          <ParseResultsPanel projectId={projectId} stage={stage} />
        ) : (
          <FieldsPanel projectId={projectId} stage={stage} />
        ))}
      {activeTab === "generation" && <GenerationPanel projectId={projectId} stage={stage} />}
      {activeTab === "confirmation" && <ConfirmationPanel projectId={projectId} stage={stage} />}
    </>
  );
}
function ConfirmationPanel({ projectId, stage }: { projectId: string; stage: string }) {
  const [searchParams] = useSearchParams();
  const [selectedGroupId, setSelectedGroupId] = useState(
    () =>
      searchParams.get("documentGroup") ||
      readGenerationDraft(projectId, stage)?.selectedTenderDocumentId ||
      "",
  );
  const documents = useQuery({
    queryKey: ["documents", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents", {
        params: { query: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as GenerationDocument[];
    },
  });
  const plans = useQuery({
    queryKey: ["procurement-plans", projectId, "generation-gate"],
    enabled: stage === "tender",
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/procurement-plans", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementPlan[];
    },
  });
  const pendingDocuments =
    stage === "tender" ? listPendingDocuments(pickPreferredProcurementPlan(plans.data)) : [];
  const currentGroupId = pendingDocuments.some((item) => item.id === selectedGroupId)
    ? selectedGroupId
    : (pendingDocuments[0]?.id ?? "");
  if (documents.isLoading || (stage === "tender" && plans.isLoading)) {
    return <FullPageMessage title="正在加载文档确认" />;
  }
  if (documents.error || plans.error) return <ErrorNotice error={documents.error || plans.error} />;
  const document = documents.data?.find(
    (item) =>
      item.stage === stage &&
      (stage !== "tender" ||
        (Boolean(currentGroupId) && item.procurement_document_group_id === currentGroupId)),
  );
  return (
    <div className="space-y-4">
      {pendingDocuments.length > 1 && (
        <Card>
          <label className="form-label block max-w-lg">
            待确认招标文件
            <select
              className="form-input mt-2"
              value={currentGroupId}
              onChange={(event) => {
                const groupId = event.target.value;
                setSelectedGroupId(groupId);
                const draft = readGenerationDraft(projectId, stage);
                if (draft)
                  writeGenerationDraft(projectId, stage, {
                    ...draft,
                    selectedTenderDocumentId: groupId,
                  });
              }}
            >
              {pendingDocuments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
          </label>
        </Card>
      )}
      {document ? (
        <DocumentPage
          key={document.id}
          embeddedDocumentId={document.id}
          embeddedProjectId={projectId}
        />
      ) : (
        <Card>
          <h3 className="section-title">尚无可确认的文档</h3>
          <p className="section-description">
            请先在“文档生成”中生成目录并勾选至少一个章节。生成完成后，正文会统一汇总到这里进行修改和确认。
          </p>
          <Link
            className="primary-button mt-5 inline-flex"
            to={`/projects/${projectId}/stages/${stage}/generation`}
          >
            返回文档生成
          </Link>
        </Card>
      )}
    </div>
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
  const initialType =
    stage === "tender"
      ? record.source_type === "uploaded_file"
        ? "uploaded_file"
        : null
      : record.source_type === "upstream_final" || record.source_type === "uploaded_file"
        ? record.source_type
        : null;
  const [sourceType, setSourceType] = useState<"upstream_final" | "uploaded_file" | null>(
    initialType,
  );
  const [sourceId, setSourceId] = useState(record.source_file_version_id ?? "");
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
  const upstreamOptions =
    sources.data?.filter((item: StageSourceOption) => item.source_type === "upstream_final") ?? [];
  const uploadedOptions =
    sources.data?.filter((item: StageSourceOption) => item.source_type === "uploaded_file") ?? [];
  const boundSource =
    sources.data?.find((item: StageSourceOption) => item.id === sourceId) ??
    sources.data?.find((item: StageSourceOption) => item.id === record.source_file_version_id);
  const save = useMutation({
    mutationFn: async (payload: {
      source_type: "upstream_final" | "uploaded_file";
      source_file_version_id: string;
    }) => {
      const result = await api.PUT("/api/v1/projects/{project_id}/stages/{stage}/source", {
        params: { path: { project_id: projectId, stage } },
        body: {
          source_type: payload.source_type,
          source_file_version_id: payload.source_file_version_id,
          revision: record.revision,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (data) => {
      setSourceType(
        data.source_type === "upstream_final" || data.source_type === "uploaded_file"
          ? data.source_type
          : sourceType,
      );
      setSourceId(data.source_file_version_id ?? "");
      void queryClient.invalidateQueries({ queryKey: ["stages", projectId] });
    },
  });

  const applySource = (nextType: "upstream_final" | "uploaded_file") => {
    if (save.isPending || sources.isLoading) return;
    if (nextType === "upstream_final" && (stage === "requirement" || stage === "tender")) return;
    setSourceType(nextType);
    const latest = nextType === "upstream_final" ? upstreamOptions[0] : uploadedOptions[0];
    if (!latest) {
      setSourceId("");
      return;
    }
    setSourceId(latest.id);
    if (record.source_type === nextType && record.source_file_version_id === latest.id) {
      return;
    }
    save.mutate({
      source_type: nextType,
      source_file_version_id: latest.id,
    });
  };

  const allowUpstream = stage === "contract";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="section-title">确定本阶段来源</h3>
          <p className="section-description">
            {stage === "tender"
              ? "招标阶段汇入项目需求、建议书、可研等采购依据材料；上传或引用定稿后，系统自动绑定最新可用文件。"
              : "点击任一来源方式后，系统自动识别并绑定对应最新可用文件，无需再手动下拉选择。"}
          </p>
        </div>
        <StatusBadge status={record.status} />
      </div>
      <div className={`mt-6 grid gap-4 ${allowUpstream ? "md:grid-cols-2" : ""}`}>
        {allowUpstream && (
          <label
            className={`selection-card ${
              sourceType === "upstream_final" ? "selection-card-active" : ""
            }`}
          >
            <input
              type="radio"
              checked={sourceType === "upstream_final"}
              onChange={() => applySource("upstream_final")}
              onClick={() => {
                if (sourceType === "upstream_final") applySource("upstream_final");
              }}
              disabled={sources.isLoading || save.isPending}
            />
            <span>
              <strong>使用上一阶段定稿文件</strong>
              <small>点击后自动绑定招标阶段最新不可变正式版本</small>
            </span>
          </label>
        )}
        <label
          className={`selection-card ${
            sourceType === "uploaded_file" ? "selection-card-active" : ""
          }`}
        >
          <input
            type="radio"
            checked={sourceType === "uploaded_file"}
            onChange={() => applySource("uploaded_file")}
            onClick={() => {
              if (sourceType === "uploaded_file") applySource("uploaded_file");
            }}
            disabled={sources.isLoading || save.isPending}
          />
          <span>
            <strong>{stage === "tender" ? "使用采购依据材料" : "使用用户已有文件"}</strong>
            <small>
              {stage === "tender"
                ? "上传需求说明、建议书、可研等依据材料后自动绑定，作为招标编制与定稿核对来源"
                : "点击后自动绑定本项目最新已上传文件"}
            </small>
          </span>
        </label>
      </div>
      {allowUpstream && sourceType === "upstream_final" && (
        <div className="mt-5">
          {boundSource?.source_type === "upstream_final" ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              已绑定上一阶段定稿：{boundSource.label}
              <span className="ml-2 text-emerald-700">SHA {boundSource.sha256.slice(0, 10)}…</span>
            </div>
          ) : upstreamOptions.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              当前没有可用的招标定稿。请先完成招标文件定稿，或改用上传文件。
            </div>
          ) : null}
        </div>
      )}
      {sourceType === "uploaded_file" && (
        <div className="mt-5">
          {boundSource?.source_type === "uploaded_file" ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              已绑定上传文件：{boundSource.label}
              <span className="ml-2 text-emerald-700">SHA {boundSource.sha256.slice(0, 10)}…</span>
            </div>
          ) : uploadedOptions.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              当前没有可用上传文件。请先在文件材料页上传并等待解析完成。
            </div>
          ) : null}
        </div>
      )}
      {sources.error && <ErrorNotice error={sources.error} />}
      {save.error && (
        <div className="mt-4">
          <ErrorNotice error={save.error} />
        </div>
      )}
      <div className="mt-5 flex gap-2">
        <Link className="secondary-button" to={`/projects/${projectId}/stages/${stage}/files`}>
          管理上传文件
        </Link>
      </div>
    </Card>
  );
}

export function SourceFileDropZone({
  selectedFiles,
  disabled,
  onSelect,
  onError,
}: {
  selectedFiles: File[];
  disabled: boolean;
  onSelect: (files: File[]) => void;
  onError: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (selectedFiles.length === 0 && inputRef.current) inputRef.current.value = "";
  }, [selectedFiles.length]);

  const selectFiles = (files: File[]) => {
    const error = sourceFileSelectionError(files);
    onError(error);
    if (!error) onSelect(files);
  };

  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div>
      <input
        ref={inputRef}
        id="source-file-upload"
        className="sr-only"
        type="file"
        multiple
        accept=".docx,.pdf,.xlsx,.png,.jpg,.jpeg"
        disabled={disabled}
        onChange={(event) => selectFiles(Array.from(event.target.files ?? []))}
      />
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="选择或拖拽上传来源文件"
        className={`mt-5 flex min-h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-7 text-center outline-none transition ${
          dragging
            ? "border-blue-500 bg-blue-50 ring-4 ring-blue-100"
            : selectedFiles.length > 0
              ? "border-blue-300 bg-blue-50/60"
              : "border-slate-300 bg-slate-50/70 hover:border-blue-400 hover:bg-blue-50/40"
        } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer focus:ring-4 focus:ring-blue-100"}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          if (disabled) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!disabled) selectFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
            <path
              d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        {selectedFiles.length > 0 ? (
          <>
            <strong className="max-w-full truncate text-sm font-semibold text-slate-900">
              {selectedFiles.length === 1
                ? selectedFiles[0].name
                : `已选择 ${selectedFiles.length} 份文件`}
            </strong>
            <span className="mt-1 max-w-full text-xs leading-5 text-slate-500">
              {selectedFiles.length === 1
                ? formatFileSize(selectedFiles[0].size)
                : `${selectedFiles
                    .slice(0, 3)
                    .map((file) => file.name)
                    .join(
                      "、",
                    )}${selectedFiles.length > 3 ? ` 等 ${selectedFiles.length} 份` : ""} · 合计 ${formatFileSize(totalSize)}`}
            </span>
            <span className="mt-3 text-sm font-medium text-blue-700">点击可重新选择多份文件</span>
          </>
        ) : (
          <>
            <strong className="text-sm font-semibold text-slate-900">
              {dragging ? "松开即可添加多份文件" : "将文件拖到这里，或点击选择多份文件"}
            </strong>
            <span className="mt-2 text-xs leading-5 text-slate-500">
              支持同时上传多份 DOCX、PDF、XLSX、PNG、JPG、JPEG · 单文件不超过 50 MB
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function FilesPanel({ projectId, stage }: { projectId: string; stage: string }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pipelineFailure, setPipelineFailure] = useState<PipelineFailure | null>(null);
  const [pipelineStep, setPipelineStep] = useState<
    "idle" | "uploading" | "parsing" | "analyzing" | "confirming"
  >("idle");
  const [pendingDocumentCount, setPendingDocumentCount] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const isTender = stage === "tender";
  const files = useQuery({
    queryKey: ["files", projectId, stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/files", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    refetchInterval: (query) =>
      query.state.data?.some((file: FileRecord) =>
        ["uploaded", "queued", "running", "parsing", "retrying"].includes(file.status),
      ) || pipelineStep === "parsing"
        ? 1_500
        : false,
  });
  const fieldValues = useQuery({
    queryKey: ["field-values", projectId, stage],
    enabled: isTender,
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-values", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as FieldValue[];
    },
  });
  const plans = useQuery({
    queryKey: ["procurement-plans", projectId],
    enabled: isTender,
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/procurement-plans", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    refetchInterval: isTender && pipelineStep === "analyzing" ? 3_000 : false,
  });
  const analyses = useQuery({
    queryKey: ["procurement-analyses", projectId],
    enabled: isTender,
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/procurement-analyses", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    refetchInterval: (query) =>
      query.state.data?.some((item) => ["queued", "running", "retrying"].includes(item.status))
        ? 3_000
        : false,
  });

  const waitUntilParsed = async (fileIds: string[]) => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const result = await api.GET("/api/v1/files", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) {
        throw new PipelineError("parse", apiError(result.error, result.response).message);
      }
      const records = (result.data ?? []).filter((file) => fileIds.includes(file.id));
      if (records.length === fileIds.length) {
        const failed = records.filter((file) =>
          ["failed", "error", "scan_failed"].includes(file.status),
        );
        if (failed.length > 0) {
          throw new PipelineError(
            "parse",
            `文件解析失败：${failed.map((file) => file.original_name).join("、")}。请检查文件后重新解析。`,
          );
        }
        if (records.every((file) => file.status === "parsed")) return records;
      }
      await sleep(1_500);
    }
    throw new PipelineError("parse", "文件解析超时，请稍后点击“重新解析”重试。");
  };

  const runTenderAnalysis = async (primaryFileId: string) => {
    setPipelineStep("analyzing");
    setNotice(
      "材料已解析，正在进行采购方案分析以识别待编制文件（调用大模型通常需要数分钟，请耐心等待）…",
    );
    const versionsResult = await api.GET("/api/v1/files/{file_id}/versions", {
      params: { path: { file_id: primaryFileId } },
    });
    if (versionsResult.error) {
      throw new PipelineError(
        "analyze",
        apiError(versionsResult.error, versionsResult.response).message,
      );
    }
    const versionId = versionsResult.data?.[0]?.id;
    if (!versionId) {
      throw new PipelineError("analyze", "未找到已上传文件版本，无法绑定来源。");
    }

    const stagesResult = await api.GET("/api/v1/projects/{project_id}/stages", {
      params: { path: { project_id: projectId } },
    });
    if (stagesResult.error) {
      throw new PipelineError(
        "analyze",
        apiError(stagesResult.error, stagesResult.response).message,
      );
    }
    const stageRecord = stagesResult.data?.find((item) => item.stage === "tender");
    if (!stageRecord) throw new PipelineError("analyze", "招标阶段不存在。");

    if (
      stageRecord.source_type !== "uploaded_file" ||
      stageRecord.source_file_version_id !== versionId
    ) {
      const bind = await api.PUT("/api/v1/projects/{project_id}/stages/{stage}/source", {
        params: { path: { project_id: projectId, stage: "tender" } },
        body: {
          source_type: "uploaded_file",
          source_file_version_id: versionId,
          revision: stageRecord.revision,
        },
      });
      if (bind.error) {
        throw new PipelineError("analyze", apiError(bind.error, bind.response).message);
      }
      void queryClient.invalidateQueries({ queryKey: ["stages", projectId] });
    }

    const analysis = await api.POST("/api/v1/projects/{project_id}/procurement-analyses", {
      params: { path: { project_id: projectId } },
      body: {
        source_kind: "uploaded_file",
        source_version_id: versionId,
        include_alternative: false,
      },
    });
    if (analysis.error) {
      throw new PipelineError("analyze", apiError(analysis.error, analysis.response).message);
    }
    const runId = analysis.data?.id;
    if (!runId) throw new PipelineError("analyze", "采购方案分析任务创建失败。");

    // DeepSeek 全文分块分析常见耗时 5–10 分钟，前端最多等待 15 分钟。
    const startedAt = Date.now();
    const deadline = startedAt + 15 * 60_000;
    let analysisDone = false;
    let lastStatus = analysis.data?.status ?? "queued";
    while (Date.now() < deadline) {
      const run = await api.GET("/api/v1/procurement-analyses/{run_id}", {
        params: { path: { run_id: runId } },
      });
      if (run.error) {
        throw new PipelineError("analyze", apiError(run.error, run.response).message);
      }
      lastStatus = run.data?.status ?? "";
      if (lastStatus === "failed" || lastStatus === "stale") {
        throw new PipelineError("analyze", run.data?.error || "采购方案分析失败，请重新解析。");
      }
      if (lastStatus === "succeeded" || lastStatus === "succeeded_demo") {
        analysisDone = true;
        break;
      }
      const elapsedMin = Math.max(1, Math.floor((Date.now() - startedAt) / 60_000));
      setNotice(`材料已解析，正在识别待编制文件（大模型分析进行中，已等待约 ${elapsedMin} 分钟）…`);
      await sleep(2_000);
    }
    if (!analysisDone) {
      void queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["procurement-analyses", projectId] });
      throw new PipelineError(
        "timeout",
        `采购方案分析仍在后台进行（当前状态：${lastStatus || "running"}）。调用大模型通常需要 5–10 分钟；请稍后再点“重新解析并识别待编制文件”，或刷新本页查看是否已生成待编制清单。`,
      );
    }

    await queryClient.invalidateQueries({ queryKey: ["procurement-analyses", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
    const plansResult = await api.GET("/api/v1/projects/{project_id}/procurement-plans", {
      params: { path: { project_id: projectId } },
    });
    if (plansResult.error) {
      throw new PipelineError("analyze", apiError(plansResult.error, plansResult.response).message);
    }
    const plan = pickPreferredProcurementPlan(plansResult.data);
    let pending = listPendingDocuments(plan);
    setPendingDocumentCount(pending.length);

    // 不再静默一包一套 + 自动 confirm；有采购包但无主文件组时留给用户轻量确认。
    return pending.length;
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (selectedFiles.length === 0) throw new PipelineError("upload", "请选择文件");
      setPipelineFailure(null);
      setNotice(null);
      setPendingDocumentCount(null);
      setPipelineStep("uploading");
      const pendingFiles = [...selectedFiles];
      const batch = await uploadSourceFileBatch(pendingFiles, async (file) => {
        const result = await api.POST("/api/v1/files", {
          params: {
            query: {
              project_id: projectId,
              stage,
            },
          },
          body: { upload: file as unknown as string },
          bodySerializer() {
            const data = new FormData();
            data.set("upload", file);
            return data;
          },
        });
        if (result.error) throw apiError(result.error, result.response);
        return result.data;
      });
      if (batch.uploaded.length === 0) {
        return { batch, pendingCount: null as number | null };
      }
      setPipelineStep("parsing");
      const parsed = await waitUntilParsed(batch.uploaded.map((file) => file.id));
      void queryClient.invalidateQueries({ queryKey: ["files", projectId, stage] });
      void queryClient.invalidateQueries({ queryKey: ["field-values", projectId, stage] });

      if (!isTender) {
        return { batch, pendingCount: null as number | null };
      }
      const pendingCount = await runTenderAnalysis(parsed[0].id);
      return { batch, pendingCount };
    },
    onSuccess: ({ batch, pendingCount }) => {
      setSelectedFiles(batch.failed.map(({ file }) => file));
      setSelectionError(
        batch.failed.length > 0
          ? `${batch.failed.length} 份文件上传失败：${batch.failed
              .map(({ file, message }) => `${file.name}（${message}）`)
              .join("；")}`
          : null,
      );
      setPipelineStep("idle");
      setPipelineFailure(null);
      if (batch.uploaded.length === 0) {
        setNotice(null);
        return;
      }
      if (isTender && pendingCount != null) {
        setPendingDocumentCount(pendingCount);
        setNotice(
          pendingCount > 0
            ? `材料解析完成，已识别本项目需要编制 ${pendingCount} 份文件。请前往“字段确认”按文件核对关键字段。`
            : "材料解析完成，已识别采购包，但主文件组织方式仍待确认。请在下方确认待编制文件清单后再进入字段确认。",
        );
      } else {
        setNotice(
          `${batch.uploaded.length} 份文件已上传并完成解析，请前往「解析结果」查看提取正文。`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["files", projectId, stage] });
      void queryClient.invalidateQueries({ queryKey: ["field-values", projectId, stage] });
      void queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
    },
    onError: (error) => {
      setPipelineStep("idle");
      setNotice(null);
      setPipelineFailure(toPipelineFailure(error, "upload"));
    },
  });

  const reanalyze = useMutation({
    mutationFn: async () => {
      const parsedFiles = (files.data ?? []).filter((file) => file.status === "parsed");
      if (parsedFiles.length === 0) {
        throw new PipelineError("parse", "请先上传并成功解析至少一份材料。");
      }
      if (
        hasProtectedFieldConfirmations(fieldValues.data) ||
        plans.data?.some((plan) => plan.status === "confirmed")
      ) {
        const accepted = window.confirm(
          "重新解析将重新判断待编制文件清单，并可能影响已有字段确认结果。系统不会静默覆盖已确认值，但仍需您确认是否继续。",
        );
        if (!accepted) throw new Error("已取消重新解析。");
      }
      setPipelineFailure(null);
      setNotice(null);
      const pendingCount = await runTenderAnalysis(parsedFiles[0].id);
      return pendingCount;
    },
    onSuccess: (pendingCount) => {
      setPipelineStep("idle");
      setPipelineFailure(null);
      setPendingDocumentCount(pendingCount);
      setNotice(
        pendingCount > 0
          ? `材料解析完成，已识别本项目需要编制 ${pendingCount} 份文件。请前往“字段确认”按文件核对关键字段。`
          : "材料解析完成，已识别采购包，但主文件组织方式仍待确认。请在下方确认待编制文件清单后再进入字段确认。",
      );
      void queryClient.invalidateQueries({ queryKey: ["field-values", projectId, stage] });
      void queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
    },
    onError: (error) => {
      setPipelineStep("idle");
      if (error instanceof Error && error.message === "已取消重新解析。") {
        setPipelineFailure(null);
        return;
      }
      setNotice(null);
      setPipelineFailure(toPipelineFailure(error, "analyze"));
    },
  });

  const extract = useMutation({
    mutationFn: async (fileId: string) => {
      const result = await api.POST("/api/v1/files/{file_id}/field-candidates", {
        params: { path: { file_id: fileId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (result) => {
      // 招标阶段字段确认按「待编制文件」分列；仅刷新材料候选不等于本页可核对字段。
      if (isTender && listPendingDocuments(pickPreferredProcurementPlan(plans.data)).length === 0) {
        setNotice(
          result.created > 0
            ? `已写入 ${result.created} 个材料字段候选，但尚未识别待编制文件清单。请先点击「重新解析并识别待编制文件」，完成后再到字段确认页按文件核对。`
            : "材料字段候选无需更新，但字段确认页必须先有待编制文件清单。请先点击「重新解析并识别待编制文件」。",
        );
      } else {
        setNotice(
          result.created > 0
            ? `已新增 ${result.created} 个字段候选，请前往“字段确认”逐项核对。`
            : "字段候选已是最新状态，没有覆盖已录入或已确认的值。",
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["field-values", projectId, stage] });
    },
  });
  const autoDraft = useMutation({
    mutationFn: async (fileId: string) => {
      const result = await api.POST("/api/v1/files/{file_id}/auto-draft", {
        params: { path: { file_id: fileId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (job) => {
      setNotice(
        job.status === "succeeded"
          ? "招采草稿已经生成，可直接进入文档工作台审阅。"
          : "招采草稿生成任务已经启动，可在“文档生成”页查看进度。",
      );
      void queryClient.invalidateQueries({ queryKey: ["files", projectId, stage] });
      void queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
    },
  });

  const pipelineBusy = pipelineStep !== "idle" || upload.isPending || reanalyze.isPending;
  const pipelineLabel =
    pipelineStep === "uploading"
      ? "正在上传…"
      : pipelineStep === "parsing"
        ? "正在解析材料…"
        : pipelineStep === "analyzing"
          ? "正在识别待编制文件（大模型分析中，通常需数分钟）…"
          : pipelineStep === "confirming"
            ? "正在生成待编制清单…"
            : null;
  const preferredPlan = pickPreferredProcurementPlan(plans.data);
  const knownPending = listPendingDocuments(preferredPlan);
  const displayPendingCount = pendingDocumentCount ?? (knownPending.length || null);
  const analysisStillRunning = Boolean(
    analyses.data?.some((item) => ["queued", "running", "retrying"].includes(item.status)),
  );
  const latestAnalysis = pickLatestProcurementAnalysis(analyses.data);
  const analysisReady =
    !isTender ||
    knownPending.length > 0 ||
    latestAnalysis?.status === "succeeded" ||
    latestAnalysis?.status === "succeeded_demo";
  const pendingListReady = !isTender || knownPending.length > 0;
  const serverAnalysisFailure: PipelineFailure | null =
    isTender &&
    !pipelineBusy &&
    !analysisReady &&
    latestAnalysis &&
    (latestAnalysis.status === "failed" || latestAnalysis.status === "stale")
      ? {
          stage: "analyze",
          title: PIPELINE_FAILURE_TITLES.analyze,
          message: latestAnalysis.error || "采购方案分析失败，请重新解析。",
        }
      : null;
  const activeFailure = pipelineFailure ?? serverAnalysisFailure;
  const failureIsAmber =
    Boolean(activeFailure) && (activeFailure?.stage === "timeout" || analysisStillRunning);

  useEffect(() => {
    if (!isTender || pipelineBusy) return;
    const pending = listPendingDocuments(pickPreferredProcurementPlan(plans.data));
    if (pending.length === 0) return;
    setPendingDocumentCount(pending.length);
    if (pipelineFailure?.stage === "timeout") {
      setPipelineFailure(null);
      setNotice(
        `材料解析完成，已识别本项目需要编制 ${pending.length} 份文件。请前往“字段确认”按文件核对关键字段。`,
      );
    }
  }, [isTender, pipelineBusy, pipelineFailure, plans.data]);

  const needsGroupingConfirmation =
    isTender &&
    Boolean(preferredPlan) &&
    knownPending.length === 0 &&
    (preferredPlan?.procurement_package_count ?? preferredPlan?.packages?.length ?? 0) > 0;

  const confirmGrouping = useMutation({
    mutationFn: async (strategy: "one_package_one_document" | "shared_single_document") => {
      const plan = pickPreferredProcurementPlan(plans.data);
      if (!plan) throw new Error("尚未生成采购方案，请先解析材料。");
      setPipelineStep("confirming");
      setNotice(
        strategy === "shared_single_document"
          ? "正在按「多包共用一套」确认待编制文件清单…"
          : "正在按「一包一套」确认待编制文件清单…",
      );
      let current = await ensureDefaultDocumentGrouping(plan.id, strategy);
      if (current.status !== "confirmed" && listPendingDocuments(current).length > 0) {
        const confirm = await api.POST("/api/v1/procurement-plans/{plan_id}/confirm", {
          params: { path: { plan_id: current.id } },
          body: {
            revision: current.revision,
            decision_note:
              strategy === "shared_single_document"
                ? "用户确认：多个采购包共用一套主文件编制。"
                : "用户确认：按一包一套生成待编制文件清单。",
          },
        });
        if (!confirm.error && confirm.data) {
          current = confirm.data as ProcurementPlan;
        } else if (confirm.error) {
          console.warn("confirm after explicit grouping skipped", confirm.error);
        }
      }
      return current;
    },
    onSuccess: async (current) => {
      const count = listPendingDocuments(current).length;
      setPendingDocumentCount(count);
      setPipelineStep("idle");
      setNotice(
        count > 0
          ? `已确认 ${count} 份待编制文件。请前往“字段确认”按文件核对关键字段。`
          : "已提交文件组织确认，请刷新后查看待编制清单。",
      );
      await queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
    },
    onError: (error) => {
      setPipelineStep("idle");
      setNotice(null);
      setPipelineFailure({
        stage: "analyze",
        title: "确认待编制清单失败",
        message: error instanceof Error ? error.message : "请稍后重试。",
      });
    },
  });

  useEffect(() => {
    if (!activeFailure) return;
    setNotice(null);
  }, [activeFailure?.stage, activeFailure?.message]);

  useEffect(() => {
    if (!isTender || pendingListReady || !notice) return;
    // 清掉误导性成功提示：没有待编制清单时，字段确认页不会出现可核对字段行。
    if (
      notice.includes("字段候选已是最新") ||
      notice.includes("请前往“字段确认”") ||
      notice.includes("已新增")
    ) {
      setNotice(null);
    }
  }, [isTender, pendingListReady, notice]);

  const processingFiles = (files.data ?? []).filter((file) =>
    ["uploaded", "queued", "running", "parsing", "retrying"].includes(file.status),
  );
  const latestRunningAnalysis = analyses.data?.find((item) =>
    ["queued", "running", "retrying"].includes(item.status),
  );
  const visiblePipelineStep =
    pipelineStep !== "idle"
      ? pipelineStep
      : analysisStillRunning
        ? "analyzing"
        : processingFiles.length > 0
          ? "parsing"
          : "idle";
  const pipelineStageIndex = {
    uploading: 0,
    parsing: 1,
    analyzing: 2,
    confirming: 3,
  }[visiblePipelineStep as Exclude<typeof visiblePipelineStep, "idle">];
  const pipelineStageDefinitions = isTender
    ? [
        ["upload", "安全接收", "校验格式、大小与文件完整性"],
        ["parse", "文件读取", "恢复章节、表格结构并生成 DocumentIR"],
        ["analyze", "双通道分析", "规则与大模型并行识别采购包与文件组织"],
        ["list", "核验融合", "证据交叉核验后形成待编制清单"],
      ]
    : [
        ["upload", "安全接收", "校验格式、大小与文件完整性"],
        ["parse", "结构解析", "提取正文、表格和字段证据"],
      ];
  const pipelineStages: TaskProgressStage[] = pipelineStageDefinitions.map(
    ([key, label, detail], index) => ({
      key,
      label,
      detail,
      status:
        index < pipelineStageIndex ? "done" : index === pipelineStageIndex ? "active" : "waiting",
    }),
  );
  const dualChannel = (latestRunningAnalysis?.coverage_json?.dual_channel ??
    latestAnalysis?.coverage_json?.dual_channel) as
    | {
        rule?: { status?: string };
        llm?: { status?: string };
        fusion?: { dual_channel_complete?: boolean; rule_only_fallback?: boolean };
      }
    | undefined;
  const ruleChannelStatus = String(
    latestRunningAnalysis?.coverage_json?.rule_channel_status ??
      dualChannel?.rule?.status ??
      latestAnalysis?.coverage_json?.rule_channel_status ??
      "",
  );
  const llmChannelStatus = String(
    latestRunningAnalysis?.coverage_json?.llm_channel_status ??
      dualChannel?.llm?.status ??
      latestAnalysis?.coverage_json?.llm_channel_status ??
      "",
  );
  const countSummary = (latestRunningAnalysis?.coverage_json?.count_summary ??
    latestAnalysis?.coverage_json?.count_summary ??
    {}) as {
    package_count_identified?: number;
    document_group_count_total?: number | null;
    tender_document_count?: number | null;
  };
  const analysisCompletedChunks = Number(
    latestRunningAnalysis?.coverage_json.completed_chunk_count ?? 0,
  );
  const analysisTotalChunks = Number(latestRunningAnalysis?.coverage_json.chunk_count ?? 0);
  const pipelineCopy = {
    uploading: {
      title: `正在安全接收 ${selectedFiles.length || processingFiles.length || 1} 份材料`,
      description: "文件正在逐份上传并接受服务端安全校验；单份失败不会影响其余已成功文件。",
    },
    parsing: {
      title: "正在读取文档并恢复结构",
      description:
        "系统按文档顺序读取标题、正文与表格矩阵，生成可定位原文的中间表示；扫描页会单独标记。",
    },
    analyzing: {
      title: "规则分析与 AI 分析并行进行",
      description: [
        "规则通道与大模型通道读取同一文档快照，互不等待。",
        ruleChannelStatus ? `规则：${ruleChannelStatus}` : null,
        llmChannelStatus ? `AI：${llmChannelStatus}` : null,
        analysisTotalChunks > 0
          ? `模型分块 ${analysisCompletedChunks}/${analysisTotalChunks}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    confirming: {
      title: "正在核验证据并整理清单",
      description:
        "融合两通道候选，校验原文依据后生成采购包与待编制文件清单；不确定数量不会显示为 0。",
    },
  }[visiblePipelineStep as Exclude<typeof visiblePipelineStep, "idle">];

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="section-title">上传来源文件</h3>
            <p className="section-description">
              {isTender
                ? "点击“上传并解析”后，系统将一次完成文件校验、内容解析、采购方案分析，并生成待编制文件清单。"
                : stage === "demand"
                  ? "上传项目需求 / 需求说明等材料，系统校验后由大模型解析提取关键信息。本阶段不进入招标编写。"
                  : stage === "requirement"
                    ? "上传项目建议书材料，系统校验后由大模型解析建设目标、范围等信息。本阶段不进入招标编写。"
                    : stage === "feasibility"
                      ? "上传可行性研究报告材料，系统校验后由大模型解析方案、投资与边界。本阶段不进入招标编写。"
                      : "上传后自动校验、解析，并从原文中提取带定位证据的字段候选。"}
            </p>
          </div>
          <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            服务端安全校验
          </span>
        </div>
        <SourceFileDropZone
          selectedFiles={selectedFiles}
          disabled={pipelineBusy}
          onSelect={(nextFiles) => {
            setSelectedFiles(nextFiles);
            setNotice(null);
            setPipelineFailure(null);
          }}
          onError={setSelectionError}
        />
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button
            className="primary-button shrink-0"
            onClick={() => upload.mutate()}
            disabled={selectedFiles.length === 0 || pipelineBusy}
          >
            {pipelineBusy && selectedFiles.length > 0
              ? (pipelineLabel ?? "处理中…")
              : selectedFiles.length > 1
                ? `上传并解析 ${selectedFiles.length} 份文件`
                : "上传并解析"}
          </button>
          {isTender && (files.data?.some((file) => file.status === "parsed") ?? false) && (
            <button
              className="secondary-button shrink-0"
              onClick={() => reanalyze.mutate()}
              disabled={pipelineBusy}
            >
              {reanalyze.isPending ? (pipelineLabel ?? "重新解析中…") : "重新解析并识别待编制文件"}
            </button>
          )}
        </div>
        {visiblePipelineStep !== "idle" && pipelineCopy && (
          <TaskProgressPanel
            className="mt-5"
            title={pipelineCopy.title}
            description={pipelineCopy.description}
            stages={pipelineStages}
            completed={
              visiblePipelineStep === "analyzing" && analysisTotalChunks > 0
                ? analysisCompletedChunks
                : undefined
            }
            total={
              visiblePipelineStep === "analyzing" && analysisTotalChunks > 0
                ? analysisTotalChunks
                : undefined
            }
            progressLabel="全文分块"
            startedAt={latestRunningAnalysis?.started_at}
            facts={[
              ...(processingFiles.length > 0
                ? [{ label: "正在处理", value: `${processingFiles.length} 份文件` }]
                : []),
              ...(ruleChannelStatus ? [{ label: "规则通道", value: ruleChannelStatus }] : []),
              ...(llmChannelStatus ? [{ label: "AI通道", value: llmChannelStatus }] : []),
              ...(latestRunningAnalysis?.model_name
                ? [{ label: "分析模型", value: latestRunningAnalysis.model_name }]
                : []),
            ]}
            outcome={
              isTender
                ? "完成后将得到按文件划分的待编制清单，并进入关键字段确认"
                : "完成后可前往「解析结果」查看提取正文与表格"
            }
          />
        )}
        {isTender && preferredPlan && !pipelineBusy && (
          <div className="mt-5 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500">已识别采购包</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {preferredPlan.procurement_package_count ??
                  preferredPlan.packages?.length ??
                  countSummary.package_count_identified ??
                  "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">拟编制主文件</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {preferredPlan.recommended_document_count == null
                  ? knownPending.length > 0
                    ? `已识别 ${knownPending.length} 项，总数待确定`
                    : "待确定"
                  : preferredPlan.recommended_document_count}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">规则 / AI 通道</div>
              <div className="mt-1 text-sm font-medium text-slate-800">
                {String(
                  (latestAnalysis?.coverage_json?.rule_channel_status ?? ruleChannelStatus) || "—",
                )}
                {" / "}
                {String(
                  (latestAnalysis?.coverage_json?.llm_channel_status ?? llmChannelStatus) || "—",
                )}
              </div>
              {String(latestAnalysis?.coverage_json?.extract_mode || "").includes("partial") && (
                <div className="mt-1 text-xs text-amber-700">
                  规则结果可用；AI 通道未完成或未启用
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-500">待确认事项</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {preferredPlan.unresolved_items?.filter((item) => item.status === "open").length ??
                  0}
              </div>
            </div>
          </div>
        )}
        {selectionError && <div className="mt-3 text-sm text-red-700">{selectionError}</div>}
        {activeFailure && (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              failureIsAmber
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <div className="font-medium">
              {failureIsAmber ? PIPELINE_FAILURE_TITLES.timeout : activeFailure.title}
            </div>
            <p className="mt-1">{activeFailure.message}</p>
            <p className="mt-2 text-xs opacity-80">
              {analysisStillRunning || activeFailure.stage === "timeout"
                ? "后台 Worker 正在并行执行规则与模型分析，完成后本页会自动更新结果。"
                : activeFailure.stage === "analyze"
                  ? "材料解析可能已完成；请点击“重新解析并识别待编制文件”重试识别，或修正材料后重新上传。"
                  : "请修正材料后重新选择文件，或点击“重新解析并识别待编制文件”。"}
            </p>
          </div>
        )}
        {notice && !activeFailure && pendingListReady && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {notice}
            {isTender && displayPendingCount != null && displayPendingCount > 0 && (
              <div className="mt-3">
                <Link
                  className="primary-button inline-flex"
                  to={`/projects/${projectId}/stages/tender/basics`}
                >
                  前往基础数据确认
                </Link>
              </div>
            )}
          </div>
        )}
        {isTender &&
          !pipelineBusy &&
          !activeFailure &&
          !pendingListReady &&
          (files.data?.some((file) => file.status === "parsed") ?? false) && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <div className="font-medium">
                {(preferredPlan?.procurement_package_count ?? 0) > 0
                  ? "已识别采购包，主文件组织方式待确认"
                  : "尚未识别待编制文件，字段确认页不会出现字段"}
              </div>
              <p className="mt-1">
                {(preferredPlan?.procurement_package_count ?? 0) > 0
                  ? "原文未说明各包是分别编制还是共用一套主文件时，系统不会默认「一包一套」。请确认待编制文件清单后再进入字段确认。"
                  : "「解析完成」和「提取字段」只处理来源材料；招标字段确认必须先完成采购方案分析并生成待编制清单。请点击上方「重新解析并识别待编制文件」。"}
              </p>
              {preferredPlan?.unresolved_items && preferredPlan.unresolved_items.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {preferredPlan.unresolved_items
                    .filter((item) => item.status === "open")
                    .slice(0, 5)
                    .map((item) => (
                      <li key={item.id}>
                        {item.title}
                        {item.detail ? ` — ${item.detail}` : ""}
                      </li>
                    ))}
                </ul>
              )}
              {needsGroupingConfirmation && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={confirmGrouping.isPending}
                    onClick={() => confirmGrouping.mutate("one_package_one_document")}
                  >
                    {confirmGrouping.isPending ? "确认中…" : "确认待编制文件清单（一包一套）"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={confirmGrouping.isPending}
                    onClick={() => confirmGrouping.mutate("shared_single_document")}
                  >
                    合并为一套确认
                  </button>
                </div>
              )}
            </div>
          )}
        {isTender && knownPending.length > 0 && !notice && !activeFailure && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            当前待编制文件 {knownPending.length} 份
            {preferredPlan?.recommended_document_count == null ? "（总数待确定）" : ""}：
            {knownPending.map((item) => item.name).join("、")}
          </div>
        )}
        {(upload.error || extract.error || autoDraft.error) && !activeFailure && (
          <div className="mt-4">
            <ErrorNotice error={upload.error || extract.error || autoDraft.error} />
          </div>
        )}
      </Card>
      <Card>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="section-title">文件记录</h3>
            <p className="section-description">
              {isTender
                ? "解析会识别采购包；主文件组织方式需在上方确认后才生成待编制清单。也可手动刷新字段候选，不会覆盖人工录入或已确认值。"
                : "解析完成后可在「解析结果」查看正文；也可手动刷新字段候选，不会覆盖人工录入或已确认值。"}
            </p>
          </div>
          <span className="text-xs text-slate-500">共 {files.data?.length ?? 0} 份</span>
        </div>
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
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{file.original_name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatFileSize(file.size_bytes)} · 文件 ID {file.id}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex items-center gap-3">
                  <StatusBadge status={file.status} />
                  {file.status === "parsed" && (
                    <>
                      {!isTender && (
                        <Link
                          className="secondary-button"
                          to={`/projects/${projectId}/stages/${stage}/fields?fileId=${encodeURIComponent(file.id)}`}
                        >
                          查看解析结果
                        </Link>
                      )}
                      {(!isTender || pendingListReady) && (
                        <button
                          className="secondary-button"
                          disabled={extract.isPending || pipelineBusy}
                          onClick={() => extract.mutate(file.id)}
                        >
                          提取/刷新字段
                        </button>
                      )}
                      {stage === "tender" && !file.auto_generation_job_id && analysisReady && (
                        <button
                          className="primary-button"
                          disabled={autoDraft.isPending || pipelineBusy}
                          onClick={() => autoDraft.mutate(file.id)}
                        >
                          生成招采草稿
                        </button>
                      )}
                      {file.auto_generation_job_id && (
                        <Link
                          className={
                            analysisReady
                              ? "text-button"
                              : "text-sm font-medium text-slate-500 underline-offset-2 hover:underline"
                          }
                          to={`/projects/${projectId}/stages/${stage}/generation?job=${file.auto_generation_job_id}`}
                        >
                          查看自动草稿
                        </Link>
                      )}
                    </>
                  )}
                </div>
                {file.status === "parsed" && isTender && !pendingListReady && (
                  <p className="max-w-xs text-right text-xs text-amber-800">
                    已隐藏「提取/刷新字段」：请先识别待编制文件
                  </p>
                )}
                {file.status === "parsed" &&
                  file.auto_generation_job_id &&
                  isTender &&
                  !analysisReady &&
                  pendingListReady && (
                    <p className="max-w-xs text-right text-xs text-slate-500">
                      待编制文件识别尚未完成，草稿可能不完整
                    </p>
                  )}
              </div>
              {file.auto_generation_error && (
                <div className="text-xs text-red-700 sm:basis-full">
                  自动生成未启动：{file.auto_generation_error}
                </div>
              )}
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

function emptyDocumentDraft(): DocumentDraftState {
  return { values: {}, origins: {}, seeded: false, dirtyKeys: [] };
}

export type FieldsPanelProps = {
  projectId: string;
  stage: string;
  /** When true, title/copy assume BasicsDataPanel owns the overview CTA. */
  embedded?: boolean;
  focusGroupId?: string | null;
  focusFieldKey?: string | null;
  onFocusHandled?: () => void;
};

export function FieldsPanel({
  projectId,
  stage,
  embedded = false,
  focusGroupId = null,
  focusFieldKey = null,
  onFocusHandled,
}: FieldsPanelProps) {
  const queryClient = useQueryClient();
  const isTender = stage === "tender";
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [highlightFieldKey, setHighlightFieldKey] = useState<string | null>(null);
  const [draftByDocument, setDraftByDocument] = useState<Record<string, DocumentDraftState>>({});
  const [manualEvidenceDrafts, setManualEvidenceDrafts] = useState<Record<string, string>>({});
  const draftKey = isTender ? selectedDocumentId || "__shared__" : "__shared__";
  const draftState = draftByDocument[draftKey] ?? emptyDocumentDraft();
  const draftValues = draftState.values;
  const markDraftValue = (fieldKey: string, value: string) => {
    setDraftByDocument((current) => {
      const previous = current[draftKey] ?? emptyDocumentDraft();
      const dirtyKeys = previous.dirtyKeys.includes(fieldKey)
        ? previous.dirtyKeys
        : [...previous.dirtyKeys, fieldKey];
      return {
        ...current,
        [draftKey]: {
          ...previous,
          values: { ...previous.values, [fieldKey]: value },
          dirtyKeys,
        },
      };
    });
  };
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
  const documents = useQuery({
    queryKey: ["documents", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents", {
        params: { query: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as Array<{
        id: string;
        stage: string;
        status: string;
        current_version: number;
      }>;
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
  const plans = useQuery({
    queryKey: ["procurement-plans", projectId],
    enabled: isTender,
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/procurement-plans", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementPlan[];
    },
  });
  const preferredPlan = pickPreferredProcurementPlan(plans.data);
  const pendingDocuments = useMemo(
    () => (isTender ? listPendingDocuments(preferredPlan) : []),
    [isTender, preferredPlan],
  );
  const applicableFieldsQuery = useQuery({
    queryKey: [
      "applicable-fields",
      projectId,
      stage,
      preferredPlan?.id,
      preferredPlan?.revision,
      pendingDocuments.map((item) => item.id).join(","),
    ],
    enabled: isTender && pendingDocuments.length > 0,
    queryFn: async () => {
      const result = await api.GET(
        "/api/v1/projects/{project_id}/stages/{stage}/applicable-fields",
        {
          params: { path: { project_id: projectId, stage } },
        },
      );
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const catalogByKey = useMemo(() => {
    const map = new Map<string, FieldDefinition>();
    for (const item of definitions.data ?? []) {
      map.set(item.field_key, item);
    }
    return map;
  }, [definitions.data]);
  const applicableByGroup = useMemo(() => {
    const map: Record<string, ApplicableFieldLike[]> = {};
    for (const group of applicableFieldsQuery.data?.groups ?? []) {
      map[group.document_group_id] = group.fields as ApplicableFieldLike[];
    }
    return map;
  }, [applicableFieldsQuery.data]);
  const setupIncompleteByGroup = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const group of applicableFieldsQuery.data?.groups ?? []) {
      map[group.document_group_id] = Boolean(group.setup_incomplete);
    }
    return map;
  }, [applicableFieldsQuery.data]);
  const setupIncompleteReasonByGroup = useMemo(() => {
    const map: Record<string, string> = {};
    for (const group of applicableFieldsQuery.data?.groups ?? []) {
      const reason = group.setup_incomplete_reason;
      if (reason) map[group.document_group_id] = reason;
    }
    return map;
  }, [applicableFieldsQuery.data]);
  const templateConfigErrorsByGroup = useMemo(() => {
    const map: Record<string, Array<{ variable_key: string; message: string }>> = {};
    for (const group of applicableFieldsQuery.data?.groups ?? []) {
      const errors = group.template_config_errors ?? [];
      if (errors.length) map[group.document_group_id] = errors;
    }
    return map;
  }, [applicableFieldsQuery.data]);
  const definitionsByGroup = useMemo(() => {
    const map: Record<string, FieldDefinition[]> = {};
    for (const [groupId, fields] of Object.entries(applicableByGroup)) {
      map[groupId] = sortApplicableFields(fields, FIELD_ORDER.tender).map((field) =>
        applicableToFieldDefinition(field, catalogByKey.get(field.field_key)),
      );
    }
    return map;
  }, [applicableByGroup, catalogByKey]);
  const orderedDefinitions = useMemo(() => {
    if (isTender) {
      const selected = selectedDocumentId ? (definitionsByGroup[selectedDocumentId] ?? []) : [];
      return selected;
    }
    const order = FIELD_ORDER[stage] ?? [];
    return [...(definitions.data ?? [])].sort((left: FieldDefinition, right: FieldDefinition) => {
      const leftIndex = order.indexOf(left.field_key);
      const rightIndex = order.indexOf(right.field_key);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    });
  }, [definitions.data, definitionsByGroup, isTender, selectedDocumentId, stage]);
  const selectedApplicableMeta = useMemo(() => {
    if (!isTender || !selectedDocumentId) return new Map<string, ApplicableFieldLike>();
    return new Map(
      (applicableByGroup[selectedDocumentId] ?? []).map((item) => [item.field_key, item]),
    );
  }, [applicableByGroup, isTender, selectedDocumentId]);

  useEffect(() => {
    if (!isTender || pendingDocuments.length === 0) return;
    if (selectedDocumentId && pendingDocuments.some((item) => item.id === selectedDocumentId)) {
      return;
    }
    setSelectedDocumentId(
      firstIncompletePendingDocumentId(pendingDocuments, definitionsByGroup, values.data),
    );
  }, [definitionsByGroup, isTender, pendingDocuments, selectedDocumentId, values.data]);

  useEffect(() => {
    if (!focusFieldKey) return;
    if (focusGroupId && pendingDocuments.some((item) => item.id === focusGroupId)) {
      setSelectedDocumentId(focusGroupId);
    }
    setHighlightFieldKey(focusFieldKey);
    const timer = window.setTimeout(() => {
      const node = document.getElementById(`basics-field-${focusFieldKey}`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocusHandled?.();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusFieldKey, focusGroupId, onFocusHandled, pendingDocuments]);

  useEffect(() => {
    if (!isTender || !selectedDocumentId) return;
    const document = pendingDocuments.find((item) => item.id === selectedDocumentId);
    if (!document) return;
    const applicableDefs = definitionsByGroup[selectedDocumentId] ?? [];
    const valuesLoaded = !values.isLoading && values.isFetched;
    const applicableLoaded =
      !applicableFieldsQuery.isLoading &&
      (applicableFieldsQuery.isFetched || pendingDocuments.length === 0);
    setDraftByDocument((current) => {
      const previous = current[selectedDocumentId] ?? emptyDocumentDraft();
      if (
        !canSeedDocumentDraft({
          alreadySeeded: previous.seeded,
          valuesLoaded,
          applicableLoaded,
        })
      ) {
        return current;
      }
      // Avoid locking empty cache before applicable defs arrive.
      if (applicableDefs.length === 0 && !applicableFieldsQuery.isFetched) {
        return current;
      }
      const seeded = buildDraftSeed({
        document,
        definitions: applicableDefs,
        values: values.data,
        packages: preferredPlan?.packages,
      });
      return {
        ...current,
        [selectedDocumentId]: {
          values: seeded.values,
          origins: seeded.origins,
          seeded: true,
          dirtyKeys: [],
        },
      };
    });
  }, [
    applicableFieldsQuery.isFetched,
    applicableFieldsQuery.isLoading,
    definitionsByGroup,
    isTender,
    pendingDocuments,
    preferredPlan?.packages,
    selectedDocumentId,
    values.data,
    values.isFetched,
    values.isLoading,
  ]);

  const selectedDocument: PendingDocument | undefined = pendingDocuments.find(
    (item) => item.id === selectedDocumentId,
  );
  const fileNameById = useMemo(
    () => new Map(files.data?.map((file: FileRecord) => [file.id, file.original_name]) ?? []),
    [files.data],
  );
  const resolveExisting = (fieldKey: string): FieldValue | undefined => {
    if (isTender && selectedDocumentId) {
      return resolveGroupFieldValue(values.data, selectedDocumentId, fieldKey);
    }
    return values.data?.find((item) => item.field_key === fieldKey);
  };
  const resolveScopedOnly = (fieldKey: string): FieldValue | undefined => {
    if (!isTender || !selectedDocumentId) {
      return values.data?.find((item) => item.field_key === fieldKey);
    }
    return values.data?.find(
      (item) => item.field_key === scopedFieldKey(selectedDocumentId, fieldKey),
    );
  };
  const parsedFileCount =
    files.data?.filter((file: FileRecord) => file.status === "parsed").length ?? 0;
  const extractedCount =
    values.data?.filter(
      (field: FieldValue) =>
        (field.status === "extracted" || field.status === "ai_suggested") &&
        fieldHasEvidence(field),
    ).length ?? 0;
  const currentProgress = isTender
    ? countScopedRequiredProgress({
        groupId: selectedDocumentId,
        definitions: definitionsByGroup[selectedDocumentId] ?? [],
        values: values.data,
      })
    : {
        required: (definitions.data ?? []).filter((item) => item.required).length,
        confirmed: (values.data ?? []).filter((field) => field.status === "user_confirmed").length,
        materialCandidates: extractedCount,
      };
  const confirmedCount = currentProgress.confirmed;
  const requiredCount = currentProgress.required;
  const completedRequiredCount = confirmedCount;
  const allPendingConfirmed = isTender
    ? allPendingDocumentsConfirmed({
        documents: pendingDocuments,
        definitionsByGroup,
        values: values.data,
        setupIncompleteByGroup,
      })
    : requiredCount > 0 && completedRequiredCount >= requiredCount;
  const generatedDocument = documents.data?.find((document) => document.stage === stage);
  const draftGuidance = fieldDraftGuidance({
    projectId,
    stage,
    documentId: generatedDocument?.id,
    documentVersion: generatedDocument?.current_version,
    confirmedCount,
    completedRequiredCount,
    requiredCount: isTender
      ? pendingDocuments.reduce(
          (total, document) =>
            total + (definitionsByGroup[document.id] ?? []).filter((item) => item.required).length,
          0,
        )
      : requiredCount,
    pendingDocumentCount: pendingDocuments.length,
    allPendingConfirmed,
  });
  const save = useMutation({
    mutationFn: async (payload: {
      definition: FieldDefinition;
      groupId: string;
      draftText: string;
      manualEvidence: string;
      scopedExisting?: FieldValue;
      candidate?: FieldValue;
      origin?: DocumentDraftState["origins"][string];
    }) => {
      const {
        definition,
        groupId,
        draftText,
        manualEvidence,
        scopedExisting,
        candidate,
        origin,
      } = payload;
      if (!draftText.trim()) throw new Error("请输入字段值");
      const evidenceError =
        definition.field_key === "bid_bond"
          ? bidBondEvidenceError(draftText, manualEvidence)
          : null;
      if (evidenceError) throw new Error(evidenceError);
      const normalizedDraft =
        definition.field_key === "bid_bond" ? normalizeBidBondValue(draftText) : draftText;
      const plan = buildFieldSavePlan({
        definition,
        draftText: normalizedDraft,
        candidate,
        scopedExisting,
        manualEvidence,
        origin,
      });
      const targetKey =
        isTender && groupId ? scopedFieldKey(groupId, definition.field_key) : definition.field_key;
      // Capture revision at submit time from the payload, not from live selection.
      if (!scopedExisting) {
        const result = await api.POST("/api/v1/field-values", {
          params: { query: { project_id: projectId, stage } },
          body: {
            field_key: targetKey,
            field_label: definition.field_label,
            data_type: definition.data_type,
            value: plan.value,
            normalized_value: plan.normalized_value,
            unit: plan.unit,
            criticality: definition.criticality as "P0" | "P1" | "P2",
            status: plan.status,
            source_type: plan.source_type,
            confidence: plan.confidence,
            evidence: plan.evidence,
          },
        });
        if (result.error) throw apiError(result.error, result.response);
        return { data: result.data, fieldKey: definition.field_key, groupId };
      }
      const result = await api.PATCH("/api/v1/field-values/{field_value_id}", {
        params: { path: { field_value_id: scopedExisting.id } },
        body: {
          value: plan.value,
          normalized_value: plan.normalized_value,
          unit: plan.unit,
          status: plan.status,
          source_type: plan.source_type,
          revision: scopedExisting.revision,
          evidence: plan.evidence,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return { data: result.data, fieldKey: definition.field_key, groupId };
    },
    onSuccess: (result) => {
      const key = isTender ? result.groupId : "__shared__";
      setDraftByDocument((current) => {
        const previous = current[key] ?? emptyDocumentDraft();
        const values = { ...previous.values };
        delete values[result.fieldKey];
        return {
          ...current,
          [key]: {
            ...previous,
            values,
            dirtyKeys: previous.dirtyKeys.filter((item) => item !== result.fieldKey),
          },
        };
      });
      void queryClient.invalidateQueries({
        queryKey: ["field-values", projectId, stage],
      });
    },
  });
  const confirm = useMutation({
    mutationFn: async (payload: { field: FieldValue; groupId: string }) => {
      const { field } = payload;
      const confirmedValue = String(
        formatFieldValueForInput(field.normalized_value ?? field.value, field.data_type),
      );
      const isBidBondField =
        field.field_key === "bid_bond" || field.field_key.endsWith("::bid_bond");
      if (
        isBidBondField &&
        normalizeBidBondValue(confirmedValue) === NO_BID_BOND_VALUE &&
        field.evidence.length === 0
      ) {
        throw new Error("请先保存不收取投标保证金的确认依据");
      }
      // revision bound at click time via payload.field.revision
      const result = await api.POST("/api/v1/field-values/{field_value_id}/confirm", {
        params: { path: { field_value_id: field.id } },
        body: {
          revision: field.revision,
          evidence_acknowledged:
            field.source_type === "extracted" || fieldHasEvidence(field),
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
  const canEnterGeneration =
    !isTender ||
    Boolean(
      preferredPlan?.status === "confirmed" &&
      preferredPlan.draft_generation_allowed &&
      pendingDocuments.length > 0,
    );
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="section-title">{embedded ? "字段确认与修改" : "字段确认"}</h3>
          <p className="section-description">
            {isTender
              ? embedded
                ? "展示候选与证据，支持冲突择一、手工修改/补录后确认。AI 建议确认前不会成为正式值。"
                : "请按待编制文件分别确认关键字段。未确认项可以带【待确认】标记进入草稿，但 P0/P1 问题会阻止定稿；AI 提取值仍须人工核对后才能成为正式值。"
              : `这里确认的是将写入${STAGE_NAMES[stage] ? `《${STAGE_NAMES[stage]}》` : "本阶段文档"}的正式业务字段，不是确认整份来源文件。材料提取值只是候选，核对无误后才可确认；确认完成后请重新生成，新草稿才会带上正式确认值。`}
          </p>
        </div>
        <div className="whitespace-nowrap text-xs text-slate-500">P0/P1 阻止定稿 · 不阻止草稿</div>
      </div>
      {isTender && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label
            className="block text-sm font-medium text-slate-800"
            htmlFor="pending-document-select"
          >
            待编制文件
          </label>
          <p className="mt-1 text-xs text-slate-500">
            下拉选项来自“上传并解析”识别出的待编制文件清单；请逐份完成字段确认。
          </p>
          {pendingDocuments.length === 0 ? (
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <span>尚未识别待编制文件。请先在文件材料页上传并解析采购依据材料。</span>
              <Link
                className="secondary-button shrink-0"
                to={`/projects/${projectId}/stages/tender/files`}
              >
                返回文件材料
              </Link>
            </div>
          ) : (
            <select
              id="pending-document-select"
              className="form-input mt-3 max-w-xl"
              value={selectedDocumentId}
              onChange={(event) => setSelectedDocumentId(event.target.value)}
            >
              {pendingDocuments.map((document) => {
                const status = pendingDocumentStatus({
                  groupId: document.id,
                  definitions: definitionsByGroup[document.id] ?? [],
                  values: values.data,
                  setupIncomplete: setupIncompleteByGroup[document.id],
                });
                return (
                  <option key={document.id} value={document.id}>
                    {document.name}（{status}）
                  </option>
                );
              })}
            </select>
          )}
          {selectedDocument && (
            <div className="mt-3 text-xs leading-5 text-slate-600">
              当前文件：{selectedDocument.code} · {selectedDocument.name}
              {selectedDocument.scope ? ` · 范围：${selectedDocument.scope}` : ""}
              {isTender && orderedDefinitions.length > 0
                ? ` · 需要确认 ${orderedDefinitions.filter((item) => item.required).length} 项`
                : ""}
            </div>
          )}
          {isTender && selectedDocumentId && setupIncompleteByGroup[selectedDocumentId] && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              模板/招标配置未完成
              {setupIncompleteReasonByGroup[selectedDocumentId]
                ? `：${setupIncompleteReasonByGroup[selectedDocumentId]}`
                : "。"}
              当前仅展示最小材料采集字段，完成度不得按 100% 定稿。
              {(templateConfigErrorsByGroup[selectedDocumentId] ?? []).length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {(templateConfigErrorsByGroup[selectedDocumentId] ?? []).map((error) => (
                    <li key={`${error.variable_key}-${error.message}`}>{error.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      )}
      {!embedded && (
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {[
          ["已解析材料", parsedFileCount],
          ["待核对候选", isTender ? currentProgress.materialCandidates : extractedCount],
          [
            isTender ? "已确认" : "已确认字段",
            isTender ? `${confirmedCount}/${requiredCount || "—"}` : confirmedCount,
          ],
          [
            isTender ? "定稿字段完成" : "定稿必填",
            isTender
              ? `${
                  pendingDocuments.filter(
                    (document) =>
                      pendingDocumentStatus({
                        groupId: document.id,
                        definitions: definitionsByGroup[document.id] ?? [],
                        values: values.data,
                        setupIncomplete: setupIncompleteByGroup[document.id],
                      }) === "已完成",
                  ).length
                }/${pendingDocuments.length}`
              : `${completedRequiredCount}/${requiredCount}`,
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
          </div>
        ))}
      </div>
      )}
      {!embedded && (stage === "tender" || generatedDocument || confirmedCount > 0) ? (
        <div
          className={`mt-5 rounded-xl border p-4 text-sm leading-6 ${
            draftGuidance.tone === "amber"
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : draftGuidance.tone === "emerald"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <strong className="font-semibold">{draftGuidance.title}</strong>
              <p className="mt-1">{draftGuidance.body}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              {isTender && pendingDocuments.length === 0 ? (
                <Link className="primary-button" to={`/projects/${projectId}/stages/tender/files`}>
                  返回文件材料识别待编制文件
                </Link>
              ) : canEnterGeneration ||
                draftGuidance.primaryTo.includes("/files") ||
                draftGuidance.primaryTo.includes("/basics") ||
                draftGuidance.primaryTo.includes("/fields") ||
                draftGuidance.primaryTo.includes("/documents/") ? (
                <Link
                  className="primary-button"
                  to={
                    canEnterGeneration || !draftGuidance.primaryTo.includes("/generation")
                      ? draftGuidance.primaryTo
                      : `/projects/${projectId}/stages/${stage}/basics`
                  }
                >
                  {canEnterGeneration || !draftGuidance.primaryTo.includes("/generation")
                    ? draftGuidance.primaryLabel
                    : "继续确认字段"}
                </Link>
              ) : (
                <button className="primary-button" type="button" disabled>
                  请先完成全部待编制文件的字段确认
                </button>
              )}
              {draftGuidance.secondaryLabel && draftGuidance.secondaryTo && (
                <Link className="secondary-button" to={draftGuidance.secondaryTo}>
                  {draftGuidance.secondaryLabel}
                </Link>
              )}
            </div>
          </div>
          {stage === "tender" && (
            <div className="mt-3 border-t border-current/10 pt-3 text-xs leading-5 opacity-80">
              合规边界：依据材料中的总投资不会自动写成招标预算或最高限价，项目全部建设范围也不会直接变成本次采购范围；系统会保留原文上下文并明确标记待确认项。
            </div>
          )}
        </div>
      ) : null}
      {parsedFileCount > 0 && values.data?.length === 0 && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
          <span>
            材料已经解析，但尚未生成可用字段候选。可返回文件材料页执行一次“提取/刷新字段”。
          </span>
          <Link
            className="secondary-button shrink-0"
            to={`/projects/${projectId}/stages/${stage}/files`}
          >
            返回文件材料
          </Link>
        </div>
      )}
      {(definitions.error ||
        values.error ||
        files.error ||
        documents.error ||
        plans.error ||
        applicableFieldsQuery.error) && (
        <div className="mt-4">
          <ErrorNotice
            error={
              definitions.error ||
              values.error ||
              files.error ||
              documents.error ||
              plans.error ||
              applicableFieldsQuery.error
            }
          />
        </div>
      )}
      {(definitions.isLoading ||
        values.isLoading ||
        files.isLoading ||
        documents.isLoading ||
        (isTender && plans.isLoading) ||
        (isTender && applicableFieldsQuery.isLoading)) && (
        <div className="mt-5 text-sm text-slate-500">正在加载字段和来源信息…</div>
      )}
      {(!isTender || selectedDocument) && (
        <div className="mt-5 divide-y divide-slate-100">
          {isTender && orderedDefinitions.length === 0 && !applicableFieldsQuery.isLoading ? (
            <div className="py-8 text-center text-sm text-slate-500">
              当前文件暂无适用字段，请检查采购类别或模板绑定。
            </div>
          ) : null}
          {orderedDefinitions.map((definition: FieldDefinition) => {
            const existing = resolveExisting(definition.field_key);
            const scopedExisting = resolveScopedOnly(definition.field_key);
            const applicableMeta = selectedApplicableMeta.get(definition.field_key);
            const origin = draftState.origins[definition.field_key];
            const sourceValue = scopedExisting ?? existing;
            const currentValue = sourceValue?.normalized_value ?? sourceValue?.value ?? "";
            const draftDirty = draftState.dirtyKeys.includes(definition.field_key);
            const inputValue =
              draftValues[definition.field_key] ??
              formatFieldValueForInput(currentValue, definition.data_type);
            const hasUnsavedDraft =
              draftValues[definition.field_key] !== undefined &&
              (draftDirty ||
                formatFieldValueForInput(currentValue, definition.data_type) !==
                  draftValues[definition.field_key]);
            const evidence = (fieldHasEvidence(scopedExisting) ? scopedExisting : existing)
              ?.evidence?.[0];
            const manualEvidenceKey = `${draftKey}::${definition.field_key}`;
            const manualEvidenceValue = manualEvidenceDrafts[manualEvidenceKey] ?? "";
            const isNoBidBond =
              definition.field_key === "bid_bond" &&
              normalizeBidBondValue(inputValue) === NO_BID_BOND_VALUE;
            const sourceFileName = evidence?.source_file_id
              ? fileNameById.get(evidence.source_file_id)
              : undefined;
            const evidenceSourceLabel =
              sourceFileName ??
              (evidence?.extraction_method === "manual" ? "人工确认依据" : "上传材料");
            const displayState = resolveFieldDisplayState({
              fieldKey: definition.field_key,
              required: definition.required,
              emptyReasonCode: applicableMeta?.empty_reason_code,
              emptyReasonMessage: applicableMeta?.empty_reason_message,
              scopedValue: scopedExisting,
              candidateValue: existing,
              draftText: inputValue,
              draftDirty: hasUnsavedDraft,
              origin,
              extractionLoaded: !values.isLoading && values.isFetched,
            });
            if (displayState.kind === "not_applicable") {
              return null;
            }
            const confirmTarget = scopedExisting;
            const durationMode =
              definition.data_type === "duration"
                ? durationInputMode(
                    draftValues[definition.field_key] !== undefined
                      ? inputValue
                      : (sourceValue?.normalized_value ?? sourceValue?.value ?? inputValue),
                    definition.unit ??
                      parseStructuredAmountValue(
                        sourceValue?.normalized_value ?? sourceValue?.value,
                      )?.unit,
                  )
                : null;
            const durationUnit =
              definition.unit ??
              parseStructuredAmountValue(sourceValue?.normalized_value ?? sourceValue?.value)
                ?.unit ??
              "个月";
            const toneClass =
              displayState.tone === "emerald"
                ? "bg-emerald-50 text-emerald-700"
                : displayState.tone === "blue"
                  ? "bg-blue-50 text-blue-700"
                  : displayState.tone === "amber"
                    ? "bg-amber-50 text-amber-800"
                    : displayState.tone === "red"
                      ? "bg-red-50 text-red-700"
                      : "bg-slate-100 text-slate-600";
            const submitGroupId = selectedDocumentId;
            return (
              <div
                key={definition.id}
                id={`basics-field-${definition.field_key}`}
                className={`grid gap-4 py-5 lg:grid-cols-[200px_1fr_auto] ${
                  highlightFieldKey === definition.field_key
                    ? "rounded-xl bg-amber-50/70 ring-1 ring-amber-200"
                    : ""
                }`}
              >
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
                      onChange={(value) => markDraftValue(definition.field_key, value)}
                    />
                  ) : definition.data_type === "text" ? (
                    <textarea
                      className="form-input min-h-24 resize-y"
                      value={inputValue}
                      placeholder={`请输入${definition.field_label}`}
                      onChange={(event) =>
                        markDraftValue(definition.field_key, event.target.value)
                      }
                    />
                  ) : durationMode === "number_unit" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="form-input max-w-[12rem]"
                        type="number"
                        value={inputValue}
                        placeholder={`请输入${definition.field_label}`}
                        onChange={(event) =>
                          markDraftValue(definition.field_key, event.target.value)
                        }
                      />
                      <span className="text-sm text-slate-600">{durationUnit}</span>
                      <span className="text-xs text-slate-400">
                        含修饰语或非纯数字时请改为原文文本并确认
                      </span>
                    </div>
                  ) : durationMode === "text" ? (
                    <div>
                      <input
                        className="form-input"
                        type="text"
                        value={inputValue}
                        placeholder={`请输入${definition.field_label}原文（需人工确认）`}
                        onChange={(event) =>
                          markDraftValue(definition.field_key, event.target.value)
                        }
                      />
                      <div className="mt-1 text-xs text-amber-700">
                        工期含建议/约/不超过等修饰或非结构化原文，须人工核对后保存确认。
                      </div>
                    </div>
                  ) : (
                    <input
                      className="form-input"
                      type={
                        ["money", "percentage"].includes(definition.data_type) ? "number" : "text"
                      }
                      value={inputValue}
                      placeholder={`请输入${definition.field_label}`}
                      onChange={(event) =>
                        markDraftValue(definition.field_key, event.target.value)
                      }
                    />
                  )}
                  {isTender && definition.field_key === "bid_bond" && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          如确实不收取，请使用明确结论并保留采购审批、制度材料或人工确认依据；不得编造金额。
                        </span>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => markDraftValue(definition.field_key, NO_BID_BOND_VALUE)}
                        >
                          填入“不要求投标保证金”
                        </button>
                      </div>
                      {isNoBidBond && (
                        <label className="mt-3 block font-medium text-amber-950">
                          不收取投标保证金的确认依据
                          <textarea
                            className="form-input mt-1 min-h-20 resize-y bg-white"
                            value={manualEvidenceValue}
                            placeholder="例如：采购审批意见第×条，或经办人依据现行采购制度确认"
                            onChange={(event) =>
                              setManualEvidenceDrafts((current) => ({
                                ...current,
                                [manualEvidenceKey]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {definition.unit && durationMode !== "number_unit" && (
                      <span>单位：{definition.unit}</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 font-medium ${toneClass}`}>
                      {displayState.label}
                    </span>
                    <span>
                      来源：
                      {SOURCE_TYPE_LABELS[
                        scopedExisting?.source_type ?? existing?.source_type ?? ""
                      ] ??
                        (origin?.kind.startsWith("package_")
                          ? "采购包信息"
                          : displayState.kind === "material_candidate"
                            ? "上传材料"
                            : "待补充")}
                    </span>
                  </div>
                  {displayState.detail &&
                    displayState.kind !== "material_candidate" &&
                    displayState.kind !== "confirmed" &&
                    displayState.kind !== "saved_unconfirmed" && (
                      <div className="mt-2 text-xs leading-5 text-amber-700">{displayState.detail}</div>
                    )}
                  {evidence?.excerpt && displayState.kind === "material_candidate" && (
                    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-xs leading-5 text-slate-600">
                      <div className="font-medium text-blue-800">
                        来源证据 · {evidenceSourceLabel}
                        {evidence.section_path ? ` · ${evidence.section_path}` : ""}
                        {evidence.page_number ? ` · 第 ${evidence.page_number} 页` : ""}
                      </div>
                      <div className="mt-1 line-clamp-3">{evidence.excerpt}</div>
                    </div>
                  )}
                  {evidence?.excerpt &&
                    displayState.kind !== "material_candidate" &&
                    (displayState.kind === "manual_draft" ||
                      displayState.kind === "saved_unconfirmed" ||
                      displayState.kind === "needs_verification") && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                        <div className="font-medium text-slate-700">
                          参考来源 · {evidenceSourceLabel}
                          {evidence.section_path ? ` · ${evidence.section_path}` : ""}
                        </div>
                        <div className="mt-1 line-clamp-3">{evidence.excerpt}</div>
                      </div>
                    )}
                </div>
                <div className="flex items-start gap-2">
                  <button
                    className="secondary-button"
                    disabled={
                      !inputValue.trim() ||
                      (isNoBidBond && !manualEvidenceValue.trim()) ||
                      (Boolean(scopedExisting) && !hasUnsavedDraft) ||
                      save.isPending
                    }
                    onClick={() => {
                      const groupIdAtClick = submitGroupId;
                      const scopedAtClick = resolveScopedOnly(definition.field_key);
                      const candidateAtClick = resolveExisting(definition.field_key);
                      save.mutate({
                        definition,
                        groupId: groupIdAtClick,
                        draftText: inputValue,
                        manualEvidence: manualEvidenceValue,
                        scopedExisting: scopedAtClick,
                        candidate: candidateAtClick,
                        origin: draftState.origins[definition.field_key],
                      });
                    }}
                  >
                    {scopedExisting
                      ? hasUnsavedDraft
                        ? "保存修改"
                        : "采纳候选"
                      : existing && fieldHasEvidence(existing)
                        ? "采纳候选"
                        : "保存"}
                  </button>
                  <button
                    className="primary-button"
                    disabled={
                      !confirmTarget ||
                      confirmTarget.status === "user_confirmed" ||
                      hasUnsavedDraft ||
                      confirm.isPending
                    }
                    onClick={() => {
                      if (!confirmTarget) return;
                      const groupIdAtClick = submitGroupId;
                      const fieldAtClick = resolveScopedOnly(definition.field_key) ?? confirmTarget;
                      confirm.mutate({ field: fieldAtClick, groupId: groupIdAtClick });
                    }}
                  >
                    {confirmTarget?.status === "user_confirmed"
                      ? "已确认"
                      : hasUnsavedDraft
                        ? "先保存"
                        : "确认"}
                  </button>
                </div>
              </div>
            );
          })}

        </div>
      )}
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

type TemplateOutlineSection = {
  id: string;
  key: string;
  title: string;
  sequence: number;
  parent_id: string | null;
  level: number;
  required: boolean;
};

export function generationSectionSubtreeKeys(
  sections: TemplateOutlineSection[],
  sectionKey: string,
): string[] {
  const root = sections.find((section) => section.key === sectionKey);
  if (!root) return [];
  const includedIds = new Set([root.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const section of sections) {
      if (section.parent_id && includedIds.has(section.parent_id) && !includedIds.has(section.id)) {
        includedIds.add(section.id);
        changed = true;
      }
    }
  }
  return sections.filter((section) => includedIds.has(section.id)).map((section) => section.key);
}

export function toggleGenerationSectionSelection(
  selectedKeys: string[],
  sections: TemplateOutlineSection[],
  sectionKey: string,
): string[] {
  const subtreeKeys = generationSectionSubtreeKeys(sections, sectionKey);
  if (subtreeKeys.length === 0) return selectedKeys;
  const selected = new Set(selectedKeys);
  if (selected.has(sectionKey)) {
    for (const key of subtreeKeys) selected.delete(key);
  } else {
    for (const key of subtreeKeys) selected.add(key);
  }
  return sections.filter((section) => selected.has(section.key)).map((section) => section.key);
}

type GenerationDocument = {
  id: string;
  stage: string;
  current_version: number;
  procurement_document_group_id?: string | null;
};

type GenerationProvenance = {
  template_id?: string;
  template_version?: number;
  selected_section_keys?: string[];
  template_applicability_confirmed?: boolean;
  generation_job_id?: string;
};

type GenerationDocumentDetail = GenerationDocument & {
  versions: Array<{ id: string; version: number; provenance?: GenerationProvenance }>;
};

type GenerationVersionSection = {
  id: string;
  key: string;
  title: string;
  sequence: number;
  parent_id: string | null;
  level: number;
  blocks: Array<{
    id: string;
    block_type?: string;
    content:
      | { text?: string }
      | { caption?: string; headers?: string[]; rows?: string[][] }
      | string;
  }>;
};

type GenerationJobStepRecord = {
  id: string;
  step_key: string;
  sequence: number;
  status: string;
  output?: Record<string, unknown> | null;
  error?: string | null;
  revision: number;
};

function GenerationPanel({ projectId, stage }: { projectId: string; stage: string }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTemplateId = searchParams.get("template") ?? "";
  const requestedJobId = searchParams.get("job");
  const fromFields =
    searchParams.get("from") === "fields" || searchParams.get("from") === "basics";
  const storedDraft = useMemo(() => readGenerationDraft(projectId, stage), [projectId, stage]);
  const urlOverridesTemplate =
    Boolean(requestedTemplateId) && requestedTemplateId !== (storedDraft?.templateId ?? "");
  const [templateId, setTemplateId] = useState(
    () => requestedTemplateId || storedDraft?.templateId || "",
  );
  const [templateVersion, setTemplateVersion] = useState(() =>
    urlOverridesTemplate ? 1 : (storedDraft?.templateVersion ?? 1),
  );
  const [outlineRequest, setOutlineRequest] = useState<{ id: string; version: number } | null>(
    () => (urlOverridesTemplate ? null : (storedDraft?.outlineRequest ?? null)),
  );
  const [selectedSectionKeys, setSelectedSectionKeys] = useState<string[]>(() => {
    if (fromFields || urlOverridesTemplate) return [];
    return storedDraft?.selectedSectionKeys ?? [];
  });
  const [submittedSectionKeys, setSubmittedSectionKeys] = useState<string[]>([]);
  const [activeSectionKey, setActiveSectionKey] = useState("");
  const [jobId, setJobId] = useState<string | null>(
    () => requestedJobId || storedDraft?.jobId || null,
  );
  const [handledJobId, setHandledJobId] = useState<string | null>(null);
  const [prefilledFromFields, setPrefilledFromFields] = useState(false);
  const [templateApplicabilityConfirmed, setTemplateApplicabilityConfirmed] = useState(() => {
    if (urlOverridesTemplate) return false;
    return storedDraft?.templateApplicabilityConfirmed ?? false;
  });
  const [pendingProvenanceSectionKeys, setPendingProvenanceSectionKeys] = useState<string[] | null>(
    null,
  );
  const [selectedTenderDocumentId, setSelectedTenderDocumentId] = useState(
    () => storedDraft?.selectedTenderDocumentId ?? "",
  );
  const hydratedFromProvenance = useRef(false);
  const hasSessionDraft = Boolean(storedDraft?.templateId);

  const templates = useQuery({
    queryKey: ["templates", stage, "generation", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/templates", {
        params: {
          query: { stage, current_only: true, generation_only: true, project_id: projectId },
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data ?? [];
    },
  });
  const tenderFields = useQuery({
    queryKey: ["field-values", projectId, stage, "template-applicability"],
    enabled: stage === "tender",
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-values", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return (result.data ?? []) as FieldValue[];
    },
  });
  const tenderPlans = useQuery({
    queryKey: ["procurement-plans", projectId, "generation-gate"],
    enabled: stage === "tender",
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/procurement-plans", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementPlan[];
    },
  });
  const preferredTenderPlan = useMemo(
    () => (stage === "tender" ? pickPreferredProcurementPlan(tenderPlans.data) : null),
    [stage, tenderPlans.data],
  );
  const tenderPendingDocuments = useMemo(
    () => (stage === "tender" ? listPendingDocuments(preferredTenderPlan) : []),
    [stage, preferredTenderPlan],
  );
  const selectedTenderDocument = tenderPendingDocuments.find(
    (document) => document.id === selectedTenderDocumentId,
  );
  const tenderDraftContextReady =
    stage !== "tender" ||
    Boolean(
      preferredTenderPlan?.status === "confirmed" &&
      preferredTenderPlan.draft_generation_allowed &&
      tenderPendingDocuments.length > 0,
    );
  const documents = useQuery({
    queryKey: ["documents", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents", {
        params: { query: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as GenerationDocument[];
    },
  });
  const stageDocument = documents.data?.find(
    (document) =>
      document.stage === stage &&
      (stage !== "tender" || document.procurement_document_group_id === selectedTenderDocumentId),
  );
  const documentDetail = useQuery({
    queryKey: ["document", stageDocument?.id],
    enabled: Boolean(stageDocument?.id),
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents/{document_id}", {
        params: { path: { document_id: stageDocument?.id ?? "" } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as GenerationDocumentDetail;
    },
  });
  const currentVersionId = documentDetail.data?.versions[0]?.id ?? "";
  const latestProvenance = documentDetail.data?.versions[0]?.provenance;
  const currentVersion = useQuery({
    queryKey: ["document-version", currentVersionId],
    enabled: Boolean(currentVersionId),
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents/versions/{version_id}", {
        params: { path: { version_id: currentVersionId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as { sections: GenerationVersionSection[] };
    },
  });
  const outline = useQuery({
    queryKey: ["generation-outline", outlineRequest?.id, outlineRequest?.version],
    enabled: Boolean(outlineRequest),
    queryFn: async () => {
      const result = await api.GET(
        "/api/v1/templates/{template_id}/versions/{version_number}/sections",
        {
          params: {
            path: {
              template_id: outlineRequest?.id ?? "",
              version_number: outlineRequest?.version ?? 1,
            },
          },
        },
      );
      if (result.error) throw apiError(result.error, result.response);
      return result.data as TemplateOutlineSection[];
    },
  });

  useEffect(() => {
    if (requestedTemplateId || hasSessionDraft || hydratedFromProvenance.current) return;
    const provenance = latestProvenance;
    if (!provenance || typeof provenance.template_id !== "string") return;
    hydratedFromProvenance.current = true;
    const version =
      typeof provenance.template_version === "number" ? provenance.template_version : 1;
    setTemplateId(provenance.template_id);
    setTemplateVersion(version);
    setOutlineRequest({ id: provenance.template_id, version });
    if (typeof provenance.template_applicability_confirmed === "boolean") {
      setTemplateApplicabilityConfirmed(provenance.template_applicability_confirmed);
    }
    if (typeof provenance.generation_job_id === "string") {
      setJobId((current) => current || provenance.generation_job_id || null);
    }
    if (!fromFields && Array.isArray(provenance.selected_section_keys)) {
      setPendingProvenanceSectionKeys(provenance.selected_section_keys);
    }
  }, [fromFields, hasSessionDraft, latestProvenance, requestedTemplateId]);

  useEffect(() => {
    if (!templates.data?.length) return;
    const provenanceTemplateId =
      typeof latestProvenance?.template_id === "string" ? latestProvenance.template_id : "";
    const preferred =
      templates.data.find((item: Template) => item.id === requestedTemplateId) ??
      templates.data.find((item: Template) => item.id === templateId) ??
      templates.data.find((item: Template) => item.id === provenanceTemplateId) ??
      (!templateId && !hasSessionDraft && !hydratedFromProvenance.current
        ? templates.data[0]
        : undefined);
    if (!preferred) {
      if (templateId && !templates.data.some((item: Template) => item.id === templateId)) {
        const fallback = templates.data[0];
        if (!fallback) return;
        setTemplateId(fallback.id);
        setTemplateVersion(fallback.current_version);
        setOutlineRequest(null);
        setSelectedSectionKeys([]);
        setSubmittedSectionKeys([]);
        setActiveSectionKey("");
        setTemplateApplicabilityConfirmed(false);
      }
      return;
    }
    setTemplateId((current) => (current === preferred.id ? current : preferred.id));
    setTemplateVersion((current) =>
      current === preferred.current_version ? current : preferred.current_version,
    );
    if (requestedTemplateId) {
      const next = new URLSearchParams(searchParams);
      next.delete("template");
      setSearchParams(next, { replace: true });
    }
  }, [
    templates.data,
    requestedTemplateId,
    templateId,
    latestProvenance,
    hasSessionDraft,
    searchParams,
    setSearchParams,
  ]);
  useEffect(() => {
    if (requestedJobId && requestedJobId !== jobId) setJobId(requestedJobId);
  }, [requestedJobId, jobId]);

  useEffect(() => {
    if (!templateId) return;
    const draft: GenerationWorkspaceDraft = {
      templateId,
      templateVersion,
      outlineRequest,
      selectedSectionKeys,
      templateApplicabilityConfirmed,
      jobId,
      selectedTenderDocumentId,
    };
    writeGenerationDraft(projectId, stage, draft);
  }, [
    projectId,
    stage,
    templateId,
    templateVersion,
    outlineRequest,
    selectedSectionKeys,
    templateApplicabilityConfirmed,
    jobId,
    selectedTenderDocumentId,
  ]);

  useEffect(() => {
    if (!fromFields || !templateId || outlineRequest || outline.data) return;
    setOutlineRequest({ id: templateId, version: templateVersion });
  }, [fromFields, templateId, templateVersion, outlineRequest, outline.data]);

  const outlineSections = useMemo(() => outline.data ?? [], [outline.data]);
  const generatedSectionKeys = useMemo(() => {
    const generated = new Set<string>();
    for (const section of currentVersion.data?.sections ?? []) {
      if (section.blocks.length === 0) continue;
      generated.add(section.key);
    }
    return generated;
  }, [currentVersion.data?.sections]);
  useEffect(() => {
    if (!outlineSections.length) return;
    setActiveSectionKey((current) =>
      outlineSections.some((section) => section.key === current)
        ? current
        : (outlineSections.find((section) => generatedSectionKeys.has(section.key))?.key ??
          outlineSections[0].key),
    );
  }, [generatedSectionKeys, outlineSections]);

  useEffect(() => {
    if (!fromFields || prefilledFromFields || !outlineSections.length) return;
    const previouslyGenerated = outlineSections
      .filter((section) => generatedSectionKeys.has(section.key))
      .map((section) => section.key);
    setSelectedSectionKeys(
      previouslyGenerated.length > 0
        ? previouslyGenerated
        : outlineSections.map((section) => section.key),
    );
    setPrefilledFromFields(true);
  }, [fromFields, generatedSectionKeys, outlineSections, prefilledFromFields]);

  useEffect(() => {
    if (fromFields || !pendingProvenanceSectionKeys || !outlineSections.length) return;
    const restoredSections = outlineSections
      .filter((section) => pendingProvenanceSectionKeys.includes(section.key))
      .map((section) => section.key);
    if (restoredSections.length > 0) setSelectedSectionKeys(restoredSections);
    setPendingProvenanceSectionKeys(null);
  }, [fromFields, outlineSections, pendingProvenanceSectionKeys]);

  const selectTemplate = (template: Template) => {
    setTemplateId(template.id);
    setTemplateVersion(template.current_version);
    setOutlineRequest(null);
    setSelectedSectionKeys([]);
    setSubmittedSectionKeys([]);
    setActiveSectionKey("");
    setTemplateApplicabilityConfirmed(false);
    setPendingProvenanceSectionKeys(null);
  };
  useEffect(() => {
    if (stage !== "tender" || tenderPendingDocuments.length === 0) return;
    const selected =
      tenderPendingDocuments.find((document) => document.id === selectedTenderDocumentId) ??
      tenderPendingDocuments[0];
    if (selected.id !== selectedTenderDocumentId) setSelectedTenderDocumentId(selected.id);
    if (!selected.template_id) return;
    const template = templates.data?.find((item: Template) => item.id === selected.template_id);
    if (template && (templateId !== template.id || templateVersion !== template.current_version)) {
      selectTemplate(template);
    }
  }, [
    selectedTenderDocumentId,
    stage,
    templateId,
    templates.data,
    templateVersion,
    tenderPendingDocuments,
  ]);
  const selectedTemplate = templates.data?.find((item: Template) => item.id === templateId);
  const procurementScope = String(
    tenderFields.data?.find((field) => field.field_key === "procurement_scope")?.value ?? "",
  );
  const mixedScopeKinds = [
    ["设备", /(设备|硬件|仪器|服务器|终端)/],
    ["软件", /(软件|系统|平台|许可)/],
    ["改造施工", /(施工|改造|安装工程|土建)/],
    ["多年运维", /(运维|维护服务|维保|驻场)/],
  ].filter(([, pattern]) => (pattern as RegExp).test(procurementScope));
  const mixedTenderScope = mixedScopeKinds.length >= 2;
  const directorySections = outlineSections;
  const directorySectionLabels = useMemo(() => {
    const counters: number[] = [];
    const labels: Record<string, string> = {};
    for (const section of directorySections) {
      const level = Math.max(1, Math.min(6, section.level ?? 1));
      while (counters.length < level) counters.push(0);
      counters.length = level;
      counters[level - 1] += 1;
      labels[section.key] = counters.slice(0, level).join(".");
    }
    return labels;
  }, [directorySections]);
  const activeSection =
    directorySections.find((section) => section.key === activeSectionKey) ?? directorySections[0];
  const activeContentSection = (currentVersion.data?.sections ?? []).find(
    (section) => section.key === activeSection?.key,
  );
  const activeSectionHasBody = Boolean(activeContentSection?.blocks.length);

  const start = useMutation({
    mutationFn: async (sectionKeys: string[]) => {
      const result = await api.POST("/api/v1/generation-jobs", {
        params: { query: { project_id: projectId, stage } },
        body: {
          template_id: templateId,
          template_version: templateVersion,
          template_applicability_confirmed: templateApplicabilityConfirmed,
          idempotency_key: `web-${projectId}-${stage}-${createRequestId()}`,
          selected_section_keys: sectionKeys,
          include_descendants: false,
          ...(stage === "tender" && preferredTenderPlan && selectedTenderDocument
            ? {
                procurement_plan_id: preferredTenderPlan.id,
                procurement_document_group_id: selectedTenderDocument.id,
                procurement_package_ids: selectedTenderDocument.package_ids,
              }
            : {}),
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (created, sectionKeys) => {
      setJobId(created.id);
      setSubmittedSectionKeys(sectionKeys);
      const next = new URLSearchParams(searchParams);
      next.delete("from");
      next.set("job", created.id);
      setSearchParams(next, { replace: true });
    },
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
  const effectiveJob = job.data ?? start.data;
  const jobSteps = useQuery({
    queryKey: ["generation-job-steps", jobId],
    enabled: Boolean(jobId),
    refetchInterval: () =>
      ["queued", "running", "retrying"].includes(effectiveJob?.status ?? "") ? 1_500 : false,
    queryFn: async () => {
      const result = await api.GET("/api/v1/generation-jobs/{job_id}/steps", {
        params: { path: { job_id: jobId ?? "" } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return (result.data ?? []) as GenerationJobStepRecord[];
    },
  });
  useEffect(() => {
    if (effectiveJob?.status !== "succeeded" || effectiveJob.id === handledJobId) return;
    setHandledJobId(effectiveJob.id);
    // 生成成功后保留勾选，右侧继续展示刚生成章节的全部正文
    setSelectedSectionKeys((current) => (current.length > 0 ? current : submittedSectionKeys));
    void queryClient.invalidateQueries({
      queryKey: ["generation-job-steps", effectiveJob.id],
    });
    void queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["document"] });
    void queryClient.invalidateQueries({ queryKey: ["document-version"] });
  }, [effectiveJob, handledJobId, projectId, queryClient, submittedSectionKeys]);

  const running = ["queued", "running", "retrying"].includes(effectiveJob?.status ?? "");
  const selectedJobSteps = (jobSteps.data ?? []).filter((step) => step.status !== "skipped");
  const completedJobSteps = selectedJobSteps.filter((step) => step.status === "succeeded").length;
  const failedJobStep = selectedJobSteps.find((step) => step.status === "failed");
  const activeJobStep = selectedJobSteps.find((step) =>
    ["running", "retrying"].includes(step.status),
  );
  const activeJobSection = (outline.data ?? []).find(
    (section) => section.key === activeJobStep?.step_key,
  );
  const jobFailed = effectiveJob?.status === "failed" || Boolean(failedJobStep);
  const jobSucceeded = effectiveJob?.status === "succeeded";
  const displayedCompletedJobSteps = jobSucceeded ? selectedJobSteps.length : completedJobSteps;
  const generationStages: TaskProgressStage[] = effectiveJob
    ? [
        {
          key: "lock",
          label: "锁定生成依据",
          detail: "来源、字段快照和模板版本已固定",
          status: "done",
        },
        {
          key: "queue",
          label: "后台任务就绪",
          detail:
            effectiveJob.status === "queued" ? "正在等待可用任务资源" : "任务已由后台工作进程接管",
          status: effectiveJob.status === "queued" ? "active" : "done",
        },
        {
          key: "sections",
          label: "生成所选章节",
          detail: jobSucceeded
            ? `${selectedJobSteps.length} 个章节已按模板生成`
            : activeJobSection
              ? `正在处理《${activeJobSection.title}》`
              : `${selectedJobSteps.length || submittedSectionKeys.length || selectedSectionKeys.length} 个章节按模板生成`,
          status: jobFailed
            ? "failed"
            : jobSucceeded
              ? "done"
              : effectiveJob.status === "queued"
                ? "waiting"
                : "active",
        },
        {
          key: "merge",
          label: "合并新版本",
          detail: "保留未选章节，装配并写入新的修订版本",
          status: jobSucceeded ? "done" : jobFailed ? "waiting" : "waiting",
        },
      ]
    : [];
  const allSelected =
    outlineSections.length > 0 &&
    outlineSections.every((section) => selectedSectionKeys.includes(section.key));
  const toggleSection = (key: string) => {
    setActiveSectionKey(key);
    setSelectedSectionKeys((current) =>
      toggleGenerationSectionSelection(current, outlineSections, key),
    );
  };

  const renderSectionBlocks = (section: GenerationVersionSection) => (
    <section key={section.id}>
      <h4
        className={
          section.level === 1
            ? "text-lg font-semibold text-slate-900"
            : "text-sm font-semibold text-slate-800"
        }
        style={{ paddingLeft: `${Math.max(0, section.level - 1) * 1.25}rem` }}
      >
        {section.title}
      </h4>
      <div
        className="mt-3 space-y-3"
        style={{ paddingLeft: `${Math.max(0, section.level - 1) * 1.25}rem` }}
      >
        {section.blocks.map((block) => {
          if (
            typeof block.content === "object" &&
            block.content !== null &&
            "rows" in block.content
          ) {
            return (
              <div key={block.id} className="overflow-x-auto rounded-lg border border-slate-200">
                {block.content.caption && (
                  <div className="bg-slate-50 px-3 py-2 text-center text-sm font-medium text-slate-800">
                    {block.content.caption}
                  </div>
                )}
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100">
                      {(block.content.headers ?? []).map((header) => (
                        <th key={header} className="border border-slate-300 p-2">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(block.content.rows ?? []).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="border border-slate-300 p-2 align-top">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          return (
            <p key={block.id} className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {typeof block.content === "string"
                ? block.content
                : "text" in block.content
                  ? block.content.text
                  : ""}
            </p>
          );
        })}
      </div>
    </section>
  );

  if (stage === "tender" && (tenderFields.isLoading || tenderPlans.isLoading)) {
    return <FullPageMessage title="正在校验草稿生成条件" />;
  }

  if (stage === "tender" && !tenderDraftContextReady) {
    return (
      <Card>
        <h3 className="section-title">尚不能进入文档生成</h3>
        <p className="section-description">
          {!preferredTenderPlan
            ? "请先在“文件材料”完成上传并解析，形成采购方案和待编制文件清单。"
            : preferredTenderPlan.status !== "confirmed"
              ? "请先完成文件材料解析以生成待编制清单。字段缺失不会阻止草稿，但采购范围、文件划分和模板必须先锁定。"
              : !preferredTenderPlan.draft_generation_allowed
                ? "采购范围、文件归属、来源或模板仍有阻断项，请先返回文件材料处理。"
                : "请先在“文件材料”识别至少一份待编制招标文件。"}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="secondary-button" to={`/projects/${projectId}/stages/tender/files`}>
            前往文件材料
          </Link>
          <Link className="secondary-button" to={`/projects/${projectId}/stages/tender/basics`}>
            前往基础数据
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {stage === "tender" && (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="section-title">基础数据摘要</h3>
              <p className="section-description">
                生成前请确认冲突与关键字段。未确认项可带【待确认】进入草稿，但会阻止定稿。
              </p>
            </div>
            <Link className="secondary-button" to={`/projects/${projectId}/stages/tender/basics`}>
              返回基础数据
            </Link>
          </div>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="section-title">先生成目录，再按章生成正文</h3>
            <p className="section-description">
              目录会立即从已发布模板中读取。勾选需要的章节后提交后台生成，您可以离开页面处理其他工作，返回后继续查看结果。
            </p>
          </div>
          {stageDocument && (
            <Link
              className="secondary-button"
              to={`/projects/${projectId}/stages/${stage}/confirmation${stage === "tender" && selectedTenderDocumentId ? `?documentGroup=${encodeURIComponent(selectedTenderDocumentId)}` : ""}`}
            >
              进入文档确认 · V{stageDocument.current_version}
            </Link>
          )}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ["1", "生成目录", outline.data ? "已完成" : "当前步骤"],
            [
              "2",
              "勾选所需章节",
              selectedSectionKeys.length ? `已选 ${selectedSectionKeys.length} 章` : "待选择",
            ],
            [
              "3",
              "后台生成正文",
              running
                ? "生成中"
                : effectiveJob?.status === "succeeded"
                  ? "最近任务已完成"
                  : "待提交",
            ],
          ].map(([number, label, statusLabel]) => (
            <div key={number} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-full bg-[#12345B] text-xs font-semibold text-white">
                  {number}
                </span>
                <div>
                  <div className="text-sm font-medium text-slate-800">{label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{statusLabel}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {effectiveJob && (
        <TaskProgressPanel
          title={
            jobSucceeded
              ? "所选章节已生成并合并"
              : jobFailed
                ? "章节生成需要处理"
                : effectiveJob.status === "queued"
                  ? "生成任务已进入后台队列"
                  : effectiveJob.status === "retrying"
                    ? "正在从失败位置继续生成"
                    : "正在按模板生成章节正文"
          }
          description={
            jobSucceeded
              ? "新的文档版本已经保存，您可以进入文档确认继续审阅、修改和校验。"
              : jobFailed
                ? effectiveJob.error || failedJobStep?.error || "生成过程中出现错误，请核对后重试。"
                : "任务会持续读取当前锁定的来源与字段快照；您可以离开本页处理其他工作，生成不会中断。"
          }
          stages={generationStages}
          status={jobFailed ? "failed" : jobSucceeded ? "success" : "active"}
          completed={selectedJobSteps.length > 0 ? displayedCompletedJobSteps : undefined}
          total={selectedJobSteps.length > 0 ? selectedJobSteps.length : undefined}
          progressLabel="章节完成"
          facts={[
            { label: "任务", value: effectiveJob.id.slice(0, 8) },
            { label: "生成模型", value: effectiveJob.generation_model || "等待分配" },
            ...(selectedTemplate ? [{ label: "模板", value: `V${templateVersion}` }] : []),
          ]}
          outcome="完成后创建新修订版本，已有版本和未选章节不会被覆盖"
        />
      )}

      {stage === "tender" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong className="font-semibold">当前生成的是受控草稿。</strong>
          未确认字段会以【待确认】保留，草稿可以审阅和按草稿标识导出，但不能用于发布；P0/P1
          问题未处理前，“确认定稿”仍会被校验门禁阻止。
        </div>
      )}

      {fromFields && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          当前生成会读取最新已确认字段并创建新修订版本；已有版本不会被静默覆盖。
          <span className="mt-1 block text-amber-800">
            已预选需重写的章节。请生成这些章节，否则旧正文里的「待确认」会残留。
          </span>
        </div>
      )}
      {(templates.error || documents.error || documentDetail.error || currentVersion.error) && (
        <ErrorNotice
          error={templates.error || documents.error || documentDetail.error || currentVersion.error}
        />
      )}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="self-start">
          {stage === "tender" && tenderPendingDocuments.length > 0 && (
            <label className="form-label mb-4 block">
              待编制招标文件
              <select
                className="form-input mt-2"
                value={selectedTenderDocumentId}
                disabled={running}
                onChange={(event) => setSelectedTenderDocumentId(event.target.value)}
              >
                {tenderPendingDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.code} · {document.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="form-label block">
            生成模板
            <select
              className="form-input mt-2"
              value={templateId}
              disabled={templates.isLoading || running}
              onChange={(event) => {
                const template = templates.data?.find(
                  (item: Template) => item.id === event.target.value,
                );
                if (template) selectTemplate(template);
              }}
            >
              {(templates.data ?? []).map((template: Template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · V{template.current_version}
                </option>
              ))}
            </select>
          </label>
          {selectedTemplate && (
            <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              <div className="font-medium text-slate-800">
                {selectedTemplate.has_docx_source &&
                selectedTemplate.source_kind === "other_official_template"
                  ? "客户正式模板（优先）"
                  : sourceKindLabel(selectedTemplate.source_kind)}
                {selectedTemplate.procurement_type ? ` · ${selectedTemplate.procurement_type}` : ""}
                {` · V${selectedTemplate.current_version}`}
              </div>
              <div>{selectedTemplate.applicability || "未声明适用范围，请在生成前人工确认。"}</div>
              {selectedTemplate.source_kind === "platform_reference_template" && (
                <div className="text-amber-700">
                  平台参考模板仅完成结构和项目化内容适配，不代表已经完整引用官方标准条款。
                </div>
              )}
            </div>
          )}
          {stage === "tender" && selectedTemplate && (
            <label
              className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs leading-5 ${
                mixedTenderScope
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={templateApplicabilityConfirmed}
                onChange={(event) => setTemplateApplicabilityConfirmed(event.target.checked)}
              />
              <span>
                {mixedTenderScope
                  ? `本次范围同时识别到${mixedScopeKinds.map(([kind]) => kind).join("、")}，必须人工确认采购属性、标包边界和模板适用范围。`
                  : "我已核对采购制度、采购对象、招标方式和模板适用范围；客户正式模板存在时应优先选择。"}
              </span>
            </label>
          )}
          <button
            type="button"
            className="primary-button mt-4 w-full"
            disabled={!templateId || templates.isLoading || outline.isFetching || running}
            onClick={() => setOutlineRequest({ id: templateId, version: templateVersion })}
          >
            {outline.isFetching ? "正在生成目录…" : outline.data ? "重新生成目录" : "生成文档目录"}
          </button>
          <div className="mt-2 text-xs leading-5 text-slate-500">
            此步骤只读取锁定模板的章节树，不生成正文，无需等待长任务。
          </div>
          {outline.error && (
            <div className="mt-4">
              <ErrorNotice error={outline.error} />
            </div>
          )}

          {outline.data && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-900">章节目录</h4>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    aria-label="全选"
                    checked={allSelected}
                    disabled={running}
                    onChange={() =>
                      setSelectedSectionKeys(
                        allSelected ? [] : outlineSections.map((section) => section.key),
                      )
                    }
                  />
                  全选所有章节
                </label>
              </div>
              <div
                className="mt-3 max-h-[min(52vh,560px)] space-y-1 overflow-y-auto overscroll-contain pr-1"
                aria-label="可生成章节目录"
              >
                {directorySections.map((section) => {
                  const level = Math.max(1, Math.min(6, section.level ?? 1));
                  const isRoot = !section.parent_id || level === 1;
                  const checked = selectedSectionKeys.includes(section.key);
                  const active = activeSectionKey === section.key;
                  const generated = generatedSectionKeys.has(section.key);
                  const generating = running && submittedSectionKeys.includes(section.key);
                  const label = directorySectionLabels[section.key] ?? section.title;
                  return (
                    <div
                      key={section.key}
                      className={`flex items-start gap-2 border-l-2 py-2 pr-2 transition-colors ${
                        active
                          ? "border-[#12345B] bg-slate-50"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                      style={{ paddingLeft: `${0.75 + (level - 1) * 0.85}rem` }}
                    >
                      <input
                        aria-label={`选择${section.title}`}
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        disabled={running}
                        onChange={() => toggleSection(section.key)}
                      />
                      <button
                        type="button"
                        aria-current={active ? "location" : undefined}
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setActiveSectionKey(section.key)}
                      >
                        <span
                          className={`block text-sm ${
                            isRoot ? "font-medium text-slate-800" : "text-slate-700"
                          }`}
                        >
                          {label} {section.title}
                        </span>
                        <span className="mt-1 block text-[11px] text-slate-500">
                          {generating ? "正在生成" : generated ? "已生成" : "尚未生成"}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="primary-button mt-4 w-full"
                disabled={
                  selectedSectionKeys.length === 0 ||
                  start.isPending ||
                  running ||
                  (stage === "tender" && !templateApplicabilityConfirmed)
                }
                onClick={() => start.mutate(selectedSectionKeys)}
              >
                {running ? "已提交后台生成" : `生成所选 ${selectedSectionKeys.length || ""} 个章节`}
              </button>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                每个小章节都可单独勾选；勾选父章会同时选中其下级。点击章节名称只切换右侧正文，不改变生成范围。
              </p>
            </div>
          )}
        </Card>

        <Card className="min-h-[560px] self-start xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
          {!outline.data ? (
            <div className="flex min-h-[500px] items-center justify-center text-center">
              <div className="max-w-md">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-50 text-lg font-semibold text-blue-700">
                  目录
                </div>
                <h3 className="mt-4 text-base font-semibold text-slate-900">
                  先生成可勾选的文档目录
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  目录生成后会完整展示在左侧。每个小章节都可独立勾选和预览。
                </p>
              </div>
            </div>
          ) : (
            <div role="region" aria-label="章节正文预览">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <p className="text-xs text-slate-400">章节预览</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">
                    {activeSection
                      ? `${directorySectionLabels[activeSection.key] ?? ""} ${activeSection.title}`
                      : "请选择左侧章节"}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    右侧只显示当前章节的正文；左侧勾选项决定下一次生成范围。
                  </p>
                </div>
                {activeSection && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      activeSectionHasBody
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {activeSectionHasBody ? "已生成正文" : "尚未生成"}
                  </span>
                )}
              </div>
              {!activeSection ? (
                <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-5 py-10 text-center text-sm leading-6 text-slate-500">
                  请选择左侧章节，这里会展示该章节对应的正文。
                </div>
              ) : activeSectionHasBody && activeContentSection ? (
                <div className="mt-6 space-y-7">{renderSectionBlocks(activeContentSection)}</div>
              ) : (
                <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-5 py-10 text-center text-sm leading-6 text-slate-500">
                  「{activeSection.title}」正文尚未生成。勾选该章节后，点击“生成所选章节”。
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {(start.error || job.error || jobSteps.error) && (
        <ErrorNotice error={start.error || job.error || jobSteps.error} />
      )}
    </div>
  );
}
