import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  apiError,
  createRequestId,
  type ApiSchemas,
  type ProcurementAnalysisRun,
  type ProcurementGenerationBatch,
  type ProcurementPlan,
  type Project,
  type Template,
} from "../api/client";
import { ErrorNotice, FullPageMessage } from "./Auth";
import { Card, StatusBadge } from "./Shell";
import { TaskProgressPanel } from "../components/TaskProgressPanel";

type StructureUpdate = ApiSchemas["ProcurementPlanStructureUpdate"];
type Group = ProcurementPlan["document_groups"][number];
type Package = ProcurementPlan["packages"][number];
type DocumentRecord = {
  id: string;
  stage: string;
  title: string;
  status: string;
  current_version: number;
  procurement_document_group_id?: string | null;
};

const METHOD_LABELS: Record<string, string> = {
  public_tender: "公开招标",
  invited_tender: "邀请招标",
  tender: "招标",
  competitive_negotiation: "竞争性谈判",
  competitive_consultation: "竞争性磋商",
  single_source: "单一来源",
  inquiry: "询价",
  direct_purchase: "直接采购",
  unknown: "采购方式待确认",
};

export function displayCount(value: number | null): string {
  return value === null ? "暂不能可靠判断" : `${value} 份`;
}

function money(value: string | number | null): string {
  if (value === null || value === "") return "待确认";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toLocaleString("zh-CN")} 元` : String(value);
}

function displayList(value: unknown[]): string {
  if (!value.length) return "待确认";
  return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("；");
}

function planToStructure(plan: ProcurementPlan): StructureUpdate {
  return {
    revision: plan.revision,
    name: plan.name,
    packages: plan.packages.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      procurement_category: item.procurement_category,
      business_subcategory: item.business_subcategory,
      procurement_method: item.procurement_method,
      scope: item.scope,
      exclusions: item.exclusions,
      deliverables: item.deliverables,
      implementation_period: item.implementation_period,
      estimated_amount: item.estimated_amount,
      confirmed_budget: item.confirmed_budget,
      maximum_price: item.maximum_price,
      currency: item.currency,
      original_unit: item.original_unit,
      tax_included: item.tax_included,
      budget_period: item.budget_period,
      budget_status: item.budget_status,
      budget_basis: item.budget_basis,
      evidence_status: item.evidence_status,
      content_item_ids: item.content_item_ids,
    })),
    document_groups: plan.document_groups.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      procurement_category: item.procurement_category,
      business_subcategory: item.business_subcategory,
      procurement_method: item.procurement_method,
      organization_method: item.organization_method,
      scope: item.scope,
      exclusions: item.exclusions,
      deliverables: item.deliverables,
      implementation_period: item.implementation_period,
      rationale: item.rationale,
      template_id: item.template_id,
      template_version: item.template_version,
      template_match_basis: item.template_match_basis,
      status: item.status as "active" | "excluded",
      package_ids: item.package_ids,
    })),
  };
}

function nextGroupCode(index: number): string {
  return `DOC-${String(index + 1).padStart(2, "0")}`;
}

export function ProcurementAnalysisProgress({
  run,
  submitting = false,
}: {
  run?: Pick<ProcurementAnalysisRun, "status" | "coverage_json" | "started_at">;
  submitting?: boolean;
}) {
  const current = submitting ? undefined : run;
  const succeeded = ["succeeded", "succeeded_demo"].includes(current?.status ?? "");
  const failed = ["failed", "stale", "cancelled"].includes(current?.status ?? "");
  const queued = !current || current.status === "queued";
  const total = Number(current?.coverage_json.chunk_count ?? 0);
  const completed = Number(current?.coverage_json.completed_chunk_count ?? 0);
  return (
    <TaskProgressPanel
      title={
        succeeded ? "可研全文分析已完成" : failed ? "可研全文分析需要处理" : "正在分析可研全文"
      }
      description="按正文分块核对建设内容、采购安排和来源证据，再汇总独立文件与采购包边界。"
      status={succeeded ? "success" : failed ? "failed" : "active"}
      startedAt={current?.started_at}
      completed={Number.isFinite(completed) ? completed : undefined}
      total={Number.isFinite(total) && total > 0 ? total : undefined}
      progressLabel="全文分块"
      stages={[
        { key: "queue", label: "提交分析任务", status: queued ? "active" : "done" },
        {
          key: "analysis",
          label: "全文分析与证据核对",
          status: succeeded ? "done" : failed ? "failed" : queued ? "waiting" : "active",
        },
        { key: "result", label: "形成待确认方案", status: succeeded ? "done" : "waiting" },
      ]}
      outcome={
        failed
          ? "已完成的分块会保留，可处理错误后继续分析"
          : "分析结果保留来源依据，由您确认采购范围与文件份数"
      }
    />
  );
}

export function ProcurementBatchProgress({
  batch,
}: {
  batch: Pick<
    ProcurementGenerationBatch,
    "status" | "succeeded_count" | "failed_count" | "total_count"
  >;
}) {
  const succeeded = batch.status === "succeeded";
  const failed = ["failed", "partial_failed"].includes(batch.status);
  return (
    <TaskProgressPanel
      compact
      className="mt-4"
      title={
        succeeded ? "所选文件已全部生成" : failed ? "部分文件需要重试" : "正在逐份生成招标文件"
      }
      description={`已成功生成 ${batch.succeeded_count} 份，失败 ${batch.failed_count} 份；各份文件独立处理。`}
      status={succeeded ? "success" : failed ? "failed" : "active"}
      completed={batch.succeeded_count}
      total={batch.total_count}
      progressLabel="成功生成"
      stages={[
        {
          key: "generate",
          label: "生成独立主文件",
          status: succeeded ? "done" : failed ? "failed" : "active",
        },
      ]}
      outcome={
        failed
          ? "成功文件已保留，点击“重试失败项”仅重试失败文件"
          : "完成后可逐份审阅正文、核对来源并确认文档"
      }
    />
  );
}

export function ProcurementPlanPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [draft, setDraft] = useState<ProcurementPlan | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [evidenceEntityId, setEvidenceEntityId] = useState<string | null>(null);
  const [batch, setBatch] = useState<ProcurementGenerationBatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const features = useQuery({
    queryKey: ["features"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/features");
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as Project;
    },
  });
  const analyses = useQuery({
    queryKey: ["procurement-analyses", projectId],
    enabled: features.data?.procurement_planning !== false,
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/procurement-analyses", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementAnalysisRun[];
    },
    refetchInterval: (query) =>
      query.state.data?.some((item) => ["queued", "running", "retrying"].includes(item.status))
        ? 1_500
        : false,
  });
  const plans = useQuery({
    queryKey: ["procurement-plans", projectId],
    enabled: features.data?.procurement_planning !== false,
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/procurement-plans", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementPlan[];
    },
  });
  const templates = useQuery({
    queryKey: ["templates", "tender", "procurement-plan"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/templates", {
        params: { query: { stage: "tender", generation_only: true } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as Template[];
    },
  });
  const documents = useQuery({
    queryKey: ["documents", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/documents", {
        params: { query: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as DocumentRecord[];
    },
  });
  const batchStatus = useQuery({
    queryKey: ["procurement-generation-batch", batch?.id],
    enabled: Boolean(batch?.id),
    queryFn: async () => {
      if (!batch) throw new Error("批量任务尚未创建");
      const result = await api.GET("/api/v1/procurement-generation-batches/{batch_id}", {
        params: { path: { batch_id: batch.id } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementGenerationBatch;
    },
    refetchInterval: (query) =>
      query.state.data &&
      ["succeeded", "partial_failed", "failed"].includes(query.state.data.status)
        ? false
        : 1_000,
  });

  const selectedPlan = useMemo(
    () => plans.data?.find((item) => item.id === selectedPlanId) ?? plans.data?.[0],
    [plans.data, selectedPlanId],
  );
  const latestAnalysis = analyses.data?.[0];

  useEffect(() => {
    if (!selectedPlan && plans.data?.[0]) setSelectedPlanId(plans.data[0].id);
  }, [plans.data, selectedPlan]);
  useEffect(() => {
    if (selectedPlan) {
      setDraft(structuredClone(selectedPlan));
      setSelectedGroupIds(
        selectedPlan.document_groups
          .filter((item) =>
            ["public_tender", "invited_tender", "tender"].includes(item.procurement_method),
          )
          .map((item) => item.id),
      );
    }
  }, [selectedPlan]);
  useEffect(() => {
    if (latestAnalysis && ["succeeded", "succeeded_demo"].includes(latestAnalysis.status)) {
      void queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
    }
  }, [latestAnalysis?.id, latestAnalysis?.status, projectId, queryClient]);
  useEffect(() => {
    if (!batchStatus.data) return;
    setBatch(batchStatus.data);
    if (["succeeded", "partial_failed", "failed"].includes(batchStatus.data.status)) {
      void queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
    }
  }, [batchStatus.data, projectId, queryClient]);

  const analyze = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/projects/{project_id}/procurement-analyses", {
        params: { path: { project_id: projectId } },
        body: { include_alternative: true },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: async () => {
      setNotice("分析任务已提交。系统会覆盖可研全文并保留版本、定位和证据状态。");
      await queryClient.invalidateQueries({ queryKey: ["procurement-analyses", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
    },
  });

  const retryAnalysis = useMutation({
    mutationFn: async (runId: string) => {
      const result = await api.POST("/api/v1/procurement-analyses/{run_id}/retry", {
        params: { path: { run_id: runId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementAnalysisRun;
    },
    onSuccess: async () => {
      setNotice("已重新接管原分析任务；已完成的分块会直接复用，不会从头重复分析。");
      await queryClient.invalidateQueries({ queryKey: ["procurement-analyses", projectId] });
    },
  });

  const save = useMutation({
    mutationFn: async (body: StructureUpdate) => {
      if (!draft) throw new Error("采购方案尚未加载");
      const result = await api.PUT("/api/v1/procurement-plans/{plan_id}/structure", {
        params: { path: { plan_id: draft.id } },
        body,
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementPlan;
    },
    onSuccess: async (updated) => {
      setNotice("采购包归属、范围、预算和文件数量已在服务端重新校验并保存。");
      setDraft(updated);
      await queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
    },
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("采购方案尚未加载");
      const result = await api.POST("/api/v1/procurement-plans/{plan_id}/confirm", {
        params: { path: { plan_id: draft.id } },
        body: {
          revision: draft.revision,
          decision_note: "已在采购方案确认页核对范围、归属和文件份数",
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementPlan;
    },
    onSuccess: async (updated) => {
      setDraft(updated);
      setNotice("采购方案已确认并生成不可变确认快照；预算等定稿参数仍按待确认项控制。");
      await queryClient.invalidateQueries({ queryKey: ["procurement-plans", projectId] });
    },
  });

  const generate = useMutation({
    mutationFn: async (groupIds: string[]) => {
      if (!draft) throw new Error("采购方案尚未加载");
      const result = await api.POST("/api/v1/procurement-plans/{plan_id}/generate-batch", {
        params: { path: { plan_id: draft.id } },
        body: { group_ids: groupIds, idempotency_key: `web-procurement-${createRequestId()}` },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementGenerationBatch;
    },
    onSuccess: async (created) => {
      setBatch(created);
      setNotice("生成任务已按主文件分别创建；成功项会保留，失败项可单独重试。");
      await queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
    },
  });

  const retryBatch = useMutation({
    mutationFn: async () => {
      if (!batch) throw new Error("没有可重试的批量任务");
      const result = await api.POST(
        "/api/v1/procurement-generation-batches/{batch_id}/retry-failed",
        { params: { path: { batch_id: batch.id } } },
      );
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProcurementGenerationBatch;
    },
    onSuccess: setBatch,
  });

  if (features.isLoading || project.isLoading || plans.isLoading) {
    return <FullPageMessage title="正在加载采购方案" />;
  }
  if (features.error || project.error || plans.error) {
    return <ErrorNotice error={features.error || project.error || plans.error} />;
  }
  if (features.data?.procurement_planning === false) {
    return (
      <Card>
        <h3 className="section-title">采购方案功能当前已关闭</h3>
        <p className="section-description">
          已有采购方案数据不会被删除；已进入新流程的文件仍保留原有校验。历史招标文件和外部上传文件可继续按原入口生成合同。
        </p>
      </Card>
    );
  }

  if (!draft) {
    return (
      <div className="space-y-5">
        <Card>
          <h3 className="section-title">采购方案分析与确认</h3>
          <p className="section-description">
            系统将读取当前锁定可研全文，先提取建设内容、采购安排、排除范围和预算证据，再由程序核算采购包与独立主招标文件数量。
          </p>
          <button
            className="primary-button mt-5"
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending}
          >
            {analyze.isPending ? "正在启动分析" : "分析当前可研"}
          </button>
          {(analyze.error || analyses.error) && (
            <div className="mt-4">
              <ErrorNotice error={analyze.error || analyses.error} />
            </div>
          )}
        </Card>
        {(analyze.isPending || latestAnalysis) && (
          <ProcurementAnalysisProgress run={latestAnalysis} submitting={analyze.isPending} />
        )}
        {latestAnalysis && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <StatusBadge status={latestAnalysis.status} />
                <span className="text-sm text-slate-600">分析任务 {latestAnalysis.id}</span>
              </div>
              {["failed", "retrying"].includes(latestAnalysis.status) && (
                <button
                  className="secondary-button"
                  onClick={() => retryAnalysis.mutate(latestAnalysis.id)}
                  disabled={retryAnalysis.isPending}
                >
                  {retryAnalysis.isPending ? "正在重新接管" : "继续分析"}
                </button>
              )}
            </div>
            {Number(latestAnalysis.coverage_json.chunk_count ?? 0) > 0 && (
              <p className="mt-3 text-sm text-slate-600">
                全文分块进度：
                {Number(latestAnalysis.coverage_json.completed_chunk_count ?? 0)} /{" "}
                {Number(latestAnalysis.coverage_json.chunk_count)}；已处理正文块{" "}
                {Number(latestAnalysis.coverage_json.processed_block_count ?? 0)} /{" "}
                {Number(latestAnalysis.coverage_json.block_count ?? 0)}
              </p>
            )}
            {latestAnalysis.error && (
              <p className="mt-3 text-sm text-red-700">{latestAnalysis.error}</p>
            )}
            {retryAnalysis.error && (
              <div className="mt-3">
                <ErrorNotice error={retryAnalysis.error} />
              </div>
            )}
          </Card>
        )}
      </div>
    );
  }

  const editable = draft.status === "draft";
  const activeTenderGroups = draft.document_groups.filter(
    (item) =>
      item.status === "active" &&
      ["public_tender", "invited_tender", "tender"].includes(item.procurement_method),
  );
  const selectedEvidence = evidenceEntityId
    ? draft.evidence.filter((item) => item.entity_id === evidenceEntityId)
    : [];
  const allSelected =
    activeTenderGroups.length > 0 &&
    activeTenderGroups.every((item) => selectedGroupIds.includes(item.id));

  const updateGroup = (groupId: string, patch: Partial<Group>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            document_groups: current.document_groups.map((item) =>
              item.id === groupId ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  };
  const updatePackage = (packageId: string, patch: Partial<Package>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            packages: current.packages.map((item) =>
              item.id === packageId ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  };
  const assignPackage = (packageId: string, groupId: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            document_groups: current.document_groups.map((item) => ({
              ...item,
              package_ids:
                item.id === groupId
                  ? Array.from(new Set([...item.package_ids, packageId]))
                  : item.package_ids.filter((id) => id !== packageId),
            })),
          }
        : current,
    );
  };
  const splitByPackage = () => {
    const template = draft.document_groups.find((item) => item.template_id);
    const groups = draft.packages.map((item, index) => ({
      id: `new-${item.id}`,
      code: nextGroupCode(index),
      name: `${project.data?.name ?? "项目"}${item.name}招标文件`,
      procurement_category: item.procurement_category,
      business_subcategory: item.business_subcategory,
      procurement_method: item.procurement_method,
      organization_method: null,
      scope: item.scope,
      exclusions: item.exclusions,
      deliverables: item.deliverables,
      implementation_period: item.implementation_period,
      rationale: "按采购包的独立交付、验收和责任边界拆分，需在保存前复核依据。",
      template_id: template?.template_id ?? null,
      template_version: template?.template_version ?? null,
      template_match_basis: template?.template_match_basis ?? "沿用当前候选模板，需复核适配性",
      status: "active" as const,
      package_ids: [item.id],
      revision: 1,
    }));
    const next = { ...draft, document_groups: groups };
    setDraft(next);
    save.mutate(planToStructure(next));
  };
  const mergeAll = () => {
    const first = draft.document_groups[0];
    if (!first) return;
    const next = {
      ...draft,
      document_groups: [
        {
          ...first,
          code: "DOC-01",
          name: `${project.data?.name ?? "项目"}采购项目招标文件`,
          scope: draft.packages.map((item) => item.scope).join("；"),
          rationale: "合并为一个主招标文件并保留多个采购包，需复核共同接口、整体责任和竞争条件。",
          package_ids: draft.packages.map((item) => item.id),
        },
      ],
    };
    setDraft(next);
    save.mutate(planToStructure(next));
  };

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500">
              {project.data?.name} · 可研来源 {draft.source_version_id.slice(0, 8)}
            </div>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">采购方案分析与确认</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{draft.analysis_summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="form-input min-w-56"
              value={draft.id}
              onChange={(event) => setSelectedPlanId(event.target.value)}
            >
              {plans.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  V{item.version} · {item.name}
                  {item.is_recommended ? "（推荐）" : ""}
                </option>
              ))}
            </select>
            <StatusBadge status={draft.status} />
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            ["推荐招标文件份数", displayCount(draft.recommended_document_count)],
            [
              "已确认份数",
              draft.confirmed_document_count === null
                ? "尚未确认"
                : `${draft.confirmed_document_count} 份`,
            ],
            ["采购包/标段", `${draft.procurement_package_count} 个`],
            ["其他采购文件", `${draft.other_procurement_document_count} 份`],
            [
              "影响判断待确认",
              `${draft.unresolved_items.filter((item) => item.severity === "P0").length} 项`,
            ],
            [
              "生成/定稿",
              `${draft.draft_generation_allowed ? "可生成草稿" : "暂不可生成"} / ${draft.finalization_allowed ? "可定稿" : "不可定稿"}`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-xs text-slate-500">{label}</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
            </div>
          ))}
        </div>
        {draft.analysis_coverage.provider_mode === "test_demo" && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            当前为确定性 Demo/Test
            Provider，仅识别材料中显式标记的采购安排，不冒充真实语义分析。生产启用前需配置真实模型并重新分析。
          </div>
        )}
        {notice && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {notice}
          </div>
        )}
      </Card>

      {(analyze.isPending ||
        (latestAnalysis && !["succeeded", "succeeded_demo"].includes(latestAnalysis.status))) && (
        <div className="space-y-3">
          <ProcurementAnalysisProgress run={latestAnalysis} submitting={analyze.isPending} />
          {latestAnalysis?.error && <p className="text-sm text-red-700">{latestAnalysis.error}</p>}
          {latestAnalysis && ["failed", "retrying"].includes(latestAnalysis.status) && (
            <button
              className="secondary-button"
              disabled={retryAnalysis.isPending}
              onClick={() => retryAnalysis.mutate(latestAnalysis.id)}
            >
              {retryAnalysis.isPending ? "正在重新接管" : "继续分析"}
            </button>
          )}
          {retryAnalysis.error && <ErrorNotice error={retryAnalysis.error} />}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          className="secondary-button"
          onClick={() => analyze.mutate()}
          disabled={analyze.isPending}
        >
          重新分析可研全文
        </button>
        {editable && (
          <button
            className="secondary-button"
            onClick={splitByPackage}
            disabled={save.isPending || draft.packages.length === 0}
          >
            按采购包拆成独立文件
          </button>
        )}
        {editable && (
          <button
            className="secondary-button"
            onClick={mergeAll}
            disabled={save.isPending || draft.document_groups.length === 0}
          >
            合并为一份多包文件
          </button>
        )}
        {editable && (
          <button
            className="primary-button"
            onClick={() => save.mutate(planToStructure(draft))}
            disabled={save.isPending}
          >
            保存调整并重新校验
          </button>
        )}
        {editable && (
          <button
            className="primary-button"
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending || draft.confirmation_blocked}
          >
            确认采购方案
          </button>
        )}
        <button
          className="primary-button"
          onClick={() => generate.mutate(selectedGroupIds)}
          disabled={
            !draft.draft_generation_allowed || selectedGroupIds.length === 0 || generate.isPending
          }
        >
          批量生成选中项
        </button>
      </div>
      {(analyze.error ||
        save.error ||
        confirm.error ||
        generate.error ||
        retryBatch.error ||
        batchStatus.error) && (
        <ErrorNotice
          error={
            analyze.error ||
            save.error ||
            confirm.error ||
            generate.error ||
            retryBatch.error ||
            batchStatus.error
          }
        />
      )}

      <div className="space-y-4">
        {draft.document_groups.map((group, groupIndex) => {
          const groupPackages = draft.packages.filter((item) =>
            group.package_ids.includes(item.id),
          );
          const generatedDocument = documents.data?.find(
            (item) => item.procurement_document_group_id === group.id,
          );
          return (
            <Card key={group.id}>
              <div className="flex flex-wrap items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={`选择${group.name}`}
                  checked={selectedGroupIds.includes(group.id)}
                  disabled={!activeTenderGroups.some((item) => item.id === group.id)}
                  onChange={() =>
                    setSelectedGroupIds((current) =>
                      current.includes(group.id)
                        ? current.filter((id) => id !== group.id)
                        : [...current, group.id],
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-blue-700">
                    独立主招标文件 {groupIndex + 1} ·{" "}
                    {METHOD_LABELS[group.procurement_method] ?? group.procurement_method}
                  </div>
                  {editable ? (
                    <input
                      className="form-input mt-2 w-full text-base font-semibold"
                      value={group.name}
                      onChange={(event) => updateGroup(group.id, { name: event.target.value })}
                    />
                  ) : (
                    <h4 className="mt-1 text-lg font-semibold text-slate-950">{group.name}</h4>
                  )}
                </div>
                <button
                  className="secondary-button"
                  onClick={() =>
                    setEvidenceEntityId(evidenceEntityId === group.id ? null : group.id)
                  }
                >
                  查看来源证据
                </button>
                <button
                  className="primary-button"
                  onClick={() => generate.mutate([group.id])}
                  disabled={!draft.draft_generation_allowed || generate.isPending}
                >
                  生成这一份
                </button>
                {generatedDocument && (
                  <Link
                    className="text-button"
                    to={`/projects/${projectId}/documents/${generatedDocument.id}`}
                  >
                    打开 V{generatedDocument.current_version}
                  </Link>
                )}
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <label className="form-label block">
                  采购范围
                  <textarea
                    className="form-input mt-2 min-h-24 w-full"
                    value={group.scope}
                    readOnly={!editable}
                    onChange={(event) => updateGroup(group.id, { scope: event.target.value })}
                  />
                </label>
                <label className="form-label block">
                  排除范围
                  <textarea
                    className="form-input mt-2 min-h-24 w-full"
                    value={group.exclusions ?? ""}
                    readOnly={!editable}
                    onChange={(event) => updateGroup(group.id, { exclusions: event.target.value })}
                  />
                </label>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  [
                    "采购类别 / 业务子类",
                    [group.procurement_category, group.business_subcategory]
                      .filter(Boolean)
                      .join(" / ") || "待确认",
                  ],
                  ["主要交付成果", displayList(group.deliverables)],
                  ["实施期限", group.implementation_period || "待确认"],
                  ["采购包数量", `${groupPackages.length} 个`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-200 px-3 py-3 text-sm">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="mt-1 text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  <div className="font-medium text-slate-900">拆分或合并理由</div>
                  <div className="mt-1">{group.rationale}</div>
                </div>
                <label className="form-label block">
                  匹配模板
                  <select
                    className="form-input mt-2 w-full"
                    value={group.template_id ?? ""}
                    disabled={!editable}
                    onChange={(event) => {
                      const template = templates.data?.find(
                        (item) => item.id === event.target.value,
                      );
                      updateGroup(group.id, {
                        template_id: template?.id ?? null,
                        template_version: template?.current_version ?? null,
                        template_match_basis: template
                          ? `用户选择已发布模板：${template.name}`
                          : "未匹配",
                      });
                    }}
                  >
                    <option value="">未匹配到模板</option>
                    {templates.data?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · V{item.current_version}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    {group.template_match_basis}
                  </span>
                </label>
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500">
                    <tr>
                      <th className="pb-2">采购包/标段</th>
                      <th className="pb-2">采购范围</th>
                      <th className="pb-2">估算依据</th>
                      <th className="pb-2">已确认预算</th>
                      <th className="pb-2">最高限价</th>
                      <th className="pb-2">预算确认依据</th>
                      <th className="pb-2">主文件归属</th>
                      <th className="pb-2">证据</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groupPackages.map((item) => (
                      <tr key={item.id}>
                        <td className="py-3 pr-3 font-medium text-slate-900">
                          {item.code} · {item.name}
                        </td>
                        <td className="py-3 pr-3 text-slate-600">{item.scope}</td>
                        <td className="py-3 pr-3 text-slate-600">{money(item.estimated_amount)}</td>
                        <td className="py-3 pr-3">
                          <input
                            className="form-input w-32"
                            type="number"
                            min="0"
                            readOnly={!editable}
                            value={item.confirmed_budget ?? ""}
                            placeholder="待确认"
                            onChange={(event) =>
                              updatePackage(item.id, {
                                confirmed_budget: event.target.value ? event.target.value : null,
                                budget_status: event.target.value ? "confirmed" : "missing",
                              })
                            }
                          />
                        </td>
                        <td className="py-3 pr-3">
                          <input
                            className="form-input w-32"
                            type="number"
                            min="0"
                            readOnly={!editable}
                            value={item.maximum_price ?? ""}
                            placeholder="待确认"
                            onChange={(event) =>
                              updatePackage(item.id, {
                                maximum_price: event.target.value ? event.target.value : null,
                              })
                            }
                          />
                        </td>
                        <td className="py-3 pr-3">
                          <input
                            className="form-input min-w-52"
                            readOnly={!editable}
                            value={item.budget_basis ?? ""}
                            placeholder="填写预算批复、测算表或人工确认依据"
                            onChange={(event) =>
                              updatePackage(item.id, { budget_basis: event.target.value || null })
                            }
                          />
                        </td>
                        <td className="py-3 pr-3">
                          <select
                            className="form-input min-w-44"
                            value={group.id}
                            disabled={!editable}
                            onChange={(event) => assignPackage(item.id, event.target.value)}
                          >
                            {draft.document_groups.map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3">
                          <button
                            className="text-button"
                            onClick={() => setEvidenceEntityId(item.id)}
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

      {draft.packages.some(
        (item) => !draft.document_groups.some((group) => group.package_ids.includes(item.id)),
      ) && (
        <Card>
          <h3 className="section-title">未归属采购包</h3>
          <p className="section-description">
            这些采购包尚未分配到唯一主文件，保存后会形成阻断项。
          </p>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <h3 className="section-title">待确认与风险</h3>
          <div className="mt-4 space-y-3">
            {draft.unresolved_items.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border p-3 ${item.severity === "P0" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{item.severity}</span>
                  <span className="text-sm font-medium text-slate-900">{item.title}</span>
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{item.detail}</p>
                <p className="mt-1 text-xs text-slate-600">影响：{item.impact}</p>
                {item.resolution_guidance && (
                  <p className="mt-1 text-xs text-blue-700">补充位置：{item.resolution_guidance}</p>
                )}
              </div>
            ))}
            {draft.unresolved_items.length === 0 && (
              <div className="text-sm text-emerald-700">当前没有未解决项。</div>
            )}
          </div>
        </Card>
        <Card>
          <h3 className="section-title">来源证据</h3>
          <p className="section-description">
            Word 无稳定页码时显示章节、段落或表格定位；系统不会伪造页码。
          </p>
          <div className="mt-4 space-y-3">
            {selectedEvidence.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="text-xs text-slate-500">
                  {item.section_path || "无章节标题"} ·{" "}
                  {item.page_number
                    ? `第 ${item.page_number} 页`
                    : `结构定位 ${JSON.stringify(item.locator)}`}
                </div>
                <p className="mt-2 leading-6 text-slate-700">{item.excerpt}</p>
                <div className="mt-2 text-xs text-blue-700">
                  {item.evidence_type} · {item.status}
                </div>
              </div>
            ))}
            {selectedEvidence.length === 0 && (
              <div className="text-sm text-slate-500">点击文件组或采购包的“查看来源证据”。</div>
            )}
          </div>
        </Card>
      </div>

      {batch && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="section-title">批量生成进度</h3>
            <StatusBadge status={batch.status} />
            <span className="text-sm text-slate-600">
              成功 {batch.succeeded_count}/{batch.total_count}，失败 {batch.failed_count}
            </span>
            <button
              className="secondary-button ml-auto"
              disabled={batch.failed_count === 0 || retryBatch.isPending}
              onClick={() => retryBatch.mutate()}
            >
              重试失败项
            </button>
          </div>
          <ProcurementBatchProgress batch={batch} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {batch.jobs.map((job) => (
              <div key={job.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">任务 {job.id.slice(0, 8)}</span>
                  <StatusBadge status={job.status} />
                </div>
                {job.error && <p className="mt-2 text-xs text-red-700">{job.error}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() =>
            setSelectedGroupIds(allSelected ? [] : activeTenderGroups.map((item) => item.id))
          }
        />
        选择全部可生成的招标文件组
      </label>
    </div>
  );
}
