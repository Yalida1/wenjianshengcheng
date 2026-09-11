import { useQueries, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  api,
  apiError,
  type FieldDefinition,
  type FieldValue,
  type FileRecord,
  type ProcurementPlan,
  type Stage,
} from "../api/client";
import {
  buildBasicsIntelligence,
  generationSoftGateMessage,
  type BasicsFocusTarget,
  type BasicsIssueItem,
  type FieldConflictRecord,
} from "../lib/basicsIntelligence";
import {
  applicableToFieldDefinition,
  fieldHasEvidence,
  listPendingDocuments,
  pickPreferredProcurementPlan,
  sortApplicableFields,
  type ApplicableFieldLike,
} from "../lib/tenderWorkflow";
import {
  BASIS_STAGE_DEFS,
  buildUpstreamBasisReport,
  type BasisStageKey,
} from "../lib/upstreamBasis";
import { ErrorNotice } from "./Auth";
import { Card } from "./Shell";
import { UpstreamBasisPanel } from "./UpstreamBasisPanel";

const TENDER_FIELD_ORDER = [
  "project_name",
  "procurement_scope",
  "procurement_budget",
  "maximum_price",
];

function severityClass(severity: BasicsIssueItem["severity"]) {
  if (severity === "critical") return "border-red-200 bg-red-50 text-red-950";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-blue-200 bg-blue-50 text-blue-950";
}

function ServiceCard({
  title,
  description,
  count,
  items,
  emptyText,
  onFocus,
  onAdopt,
  adoptingId,
}: {
  title: string;
  description: string;
  count: number;
  items: BasicsIssueItem[];
  emptyText: string;
  onFocus: (item: BasicsIssueItem) => void;
  onAdopt?: (item: BasicsIssueItem) => void;
  adoptingId?: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {count}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto">
          {items.slice(0, 8).map((item) => (
            <li
              key={item.id}
              className={`rounded-lg border px-3 py-2 text-sm leading-5 ${severityClass(item.severity)}`}
            >
              <div className="font-medium">{item.title}</div>
              <div className="mt-0.5 text-xs opacity-80">
                {item.documentName} · {item.detail}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {item.fieldKey ? (
                  <button
                    className="secondary-button !px-2.5 !py-1 text-xs"
                    type="button"
                    onClick={() => onFocus(item)}
                  >
                    定位字段
                  </button>
                ) : null}
                {onAdopt && item.kind === "ai_candidate" && (
                  <button
                    className="primary-button !px-2.5 !py-1 text-xs"
                    type="button"
                    disabled={adoptingId === item.id}
                    onClick={() => onAdopt(item)}
                  >
                    {adoptingId === item.id ? "采纳中…" : "采纳并确认"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type BasicsFieldsRenderProps = {
  focusGroupId: string | null;
  focusFieldKey: string | null;
  onFocusHandled: () => void;
};

export function BasicsDataPanel({
  projectId,
  stage,
  renderFields,
}: {
  projectId: string;
  stage: string;
  renderFields: (props: BasicsFieldsRenderProps) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [focus, setFocus] = useState<BasicsFocusTarget | null>(null);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);

  const values = useQuery({
    queryKey: ["field-values", projectId, stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-values", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as FieldValue[];
    },
  });

  const stagesQuery = useQuery({
    queryKey: ["stages", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}/stages", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as Stage[];
    },
  });

  const basisValueQueries = useQueries({
    queries: BASIS_STAGE_DEFS.map((def) => ({
      queryKey: ["field-values", projectId, def.stage],
      queryFn: async () => {
        const result = await api.GET("/api/v1/field-values", {
          params: { query: { project_id: projectId, stage: def.stage } },
        });
        if (result.error) throw apiError(result.error, result.response);
        return result.data as FieldValue[];
      },
    })),
  });

  const basisFileQueries = useQueries({
    queries: BASIS_STAGE_DEFS.map((def) => ({
      queryKey: ["files", projectId, def.stage],
      queryFn: async () => {
        const result = await api.GET("/api/v1/files", {
          params: { query: { project_id: projectId, stage: def.stage } },
        });
        if (result.error) throw apiError(result.error, result.response);
        return result.data as FileRecord[];
      },
    })),
  });

  const valuesByStage = useMemo(() => {
    const map: Partial<Record<BasisStageKey, FieldValue[]>> = {};
    BASIS_STAGE_DEFS.forEach((def, index) => {
      map[def.stage] = basisValueQueries[index]?.data;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on fetched payloads, not query object identity
  }, [
    basisValueQueries[0]?.data,
    basisValueQueries[1]?.data,
    basisValueQueries[2]?.data,
  ]);

  const filesByStage = useMemo(() => {
    const map: Partial<Record<BasisStageKey, FileRecord[]>> = {};
    BASIS_STAGE_DEFS.forEach((def, index) => {
      map[def.stage] = basisFileQueries[index]?.data;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on fetched payloads, not query object identity
  }, [
    basisFileQueries[0]?.data,
    basisFileQueries[1]?.data,
    basisFileQueries[2]?.data,
  ]);

  const upstreamReport = useMemo(
    () =>
      buildUpstreamBasisReport({
        projectId,
        stages: stagesQuery.data,
        valuesByStage,
        filesByStage,
        tenderStage: stagesQuery.data?.find((item) => item.stage === "tender"),
      }),
    [filesByStage, projectId, stagesQuery.data, valuesByStage],
  );

  const upstreamLoading =
    stagesQuery.isLoading ||
    basisValueQueries.some((query) => query.isLoading) ||
    basisFileQueries.some((query) => query.isLoading);

  const definitions = useQuery({
    queryKey: ["field-definitions", stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-definitions", {
        params: { query: { stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as FieldDefinition[];
    },
  });

  const plans = useQuery({
    queryKey: ["procurement-plans", projectId],
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
    () => listPendingDocuments(preferredPlan),
    [preferredPlan],
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
    enabled: pendingDocuments.length > 0,
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

  const conflictsQuery = useQuery({
    queryKey: ["field-conflicts", projectId, stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-conflicts", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as FieldConflictRecord[];
    },
  });

  const catalogByKey = useMemo(() => {
    const map = new Map<string, FieldDefinition>();
    for (const item of definitions.data ?? []) {
      map.set(item.field_key, item);
    }
    return map;
  }, [definitions.data]);

  const definitionsByGroup = useMemo(() => {
    const map: Record<string, FieldDefinition[]> = {};
    for (const group of applicableFieldsQuery.data?.groups ?? []) {
      const fields = (group.fields ?? []) as ApplicableFieldLike[];
      map[group.document_group_id] = sortApplicableFields(fields, TENDER_FIELD_ORDER).map((field) =>
        applicableToFieldDefinition(field, catalogByKey.get(field.field_key)),
      );
    }
    return map;
  }, [applicableFieldsQuery.data, catalogByKey]);

  const feasibilityValues = valuesByStage.feasibility;

  const intelligence = useMemo(
    () =>
      buildBasicsIntelligence({
        documents: pendingDocuments,
        definitionsByGroup,
        values: values.data,
        conflictRecords: conflictsQuery.data,
        referenceValues: feasibilityValues,
        upstreamQualityIssues: upstreamReport.qualityIssues,
      }),
    [
      conflictsQuery.data,
      definitionsByGroup,
      feasibilityValues,
      pendingDocuments,
      upstreamReport.qualityIssues,
      values.data,
    ],
  );

  const softGate = generationSoftGateMessage(intelligence.overview);
  const canEnterGeneration = Boolean(
    preferredPlan?.status === "confirmed" &&
      preferredPlan.draft_generation_allowed &&
      pendingDocuments.length > 0,
  );

  const handleFocus = useCallback((item: BasicsIssueItem) => {
    if (!item.fieldKey) return;
    setFocus({
      groupId: item.groupId || pendingDocuments[0]?.id || "",
      fieldKey: item.fieldKey,
    });
  }, [pendingDocuments]);

  const handleFocusFieldKey = useCallback(
    (fieldKey: string) => {
      setFocus({
        groupId: pendingDocuments[0]?.id || "",
        fieldKey,
      });
    },
    [pendingDocuments],
  );

  const adopt = useMutation({
    mutationFn: async (item: BasicsIssueItem) => {
      setAdoptingId(item.id);
      const scopedKey = `doc::${item.groupId}::${item.fieldKey}`;
      const scoped = values.data?.find((field) => field.field_key === scopedKey);
      const shared = values.data?.find((field) => field.field_key === item.fieldKey);
      const target = scoped ?? shared;
      if (!target) throw new Error("未找到可采纳的候选字段");
      if (!fieldHasEvidence(target)) throw new Error("候选缺少证据，请手工核对后保存确认");
      if (target.status !== "extracted" && target.status !== "ai_suggested") {
        throw new Error("当前字段不是待采纳候选");
      }
      const result = await api.POST("/api/v1/field-values/{field_value_id}/confirm", {
        params: { path: { field_value_id: target.id } },
        body: {
          revision: target.revision,
          evidence_acknowledged: true,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["field-values", projectId, stage] });
      void queryClient.invalidateQueries({ queryKey: ["field-conflicts", projectId, stage] });
    },
    onSettled: () => setAdoptingId(null),
  });

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="section-title">基础数据确认</h3>
            <p className="section-description">
              汇入前序依据并核对招标字段。智能服务与质检只提供提示与候选，不会自动写入正式值。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="secondary-button" to={`/projects/${projectId}/stages/tender/files`}>
              文件材料
            </Link>
            {canEnterGeneration && softGate.allowPrimaryGeneration ? (
              <Link
                className={softGate.tone === "red" ? "secondary-button" : "primary-button"}
                to={`/projects/${projectId}/stages/tender/generation?from=basics`}
              >
                进入文档生成
              </Link>
            ) : (
              <button className="primary-button" type="button" disabled>
                进入文档生成
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["冲突待裁决", intelligence.overview.conflictCount],
            ["完整性待补", intelligence.overview.missingBlockingCount],
            ["候选待采纳", intelligence.overview.aiCandidateCount],
            ["依据质检", intelligence.overview.upstreamQualityCount],
            [
              "必填已确认",
              `${intelligence.overview.confirmedRequiredCount}/${intelligence.overview.requiredCount || "—"}`,
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

        <div
          className={`mt-5 rounded-xl border p-4 text-sm leading-6 ${
            softGate.tone === "red"
              ? "border-red-200 bg-red-50 text-red-950"
              : softGate.tone === "amber"
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <strong className="font-semibold">{softGate.title}</strong>
          <p className="mt-1">{softGate.body}</p>
          {intelligence.overview.pendingDocumentCount === 0 && (
            <div className="mt-3">
              <Link className="secondary-button" to={`/projects/${projectId}/stages/tender/files`}>
                前往文件材料识别待编制文件
              </Link>
            </div>
          )}
        </div>
      </Card>

      <UpstreamBasisPanel
        projectId={projectId}
        report={upstreamReport}
        loading={upstreamLoading}
        onFocusTenderField={handleFocusFieldKey}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <ServiceCard
          title="冲突裁决台"
          description="汇总冲突字段与冲突记录，定位后择一确认或手工修正。"
          count={intelligence.conflicts.length}
          items={intelligence.conflicts}
          emptyText="当前没有待处理冲突。"
          onFocus={handleFocus}
        />
        <ServiceCard
          title="完整性体检"
          description="检查缺失、无效或尚无可靠来源的阻断级字段。"
          count={intelligence.completeness.length}
          items={intelligence.completeness}
          emptyText="必填完整性暂无告警。"
          onFocus={handleFocus}
        />
        <ServiceCard
          title="合规护栏"
          description="禁止自动映射与金额关系警示，只提示不改值。"
          count={intelligence.compliance.length}
          items={intelligence.compliance}
          emptyText="暂无合规或金额关系警示。"
          onFocus={handleFocus}
        />
        <ServiceCard
          title="候选采纳助手"
          description="有证据的材料/AI 候选可单条采纳确认，禁止批量静默确认。"
          count={intelligence.candidates.length}
          items={intelligence.candidates}
          emptyText="暂无待采纳候选。"
          onFocus={handleFocus}
          onAdopt={(item) => adopt.mutate(item)}
          adoptingId={adoptingId}
        />
      </div>

      {(values.error ||
        plans.error ||
        applicableFieldsQuery.error ||
        conflictsQuery.error ||
        stagesQuery.error ||
        adopt.error) && (
        <ErrorNotice
          error={
            values.error ||
            plans.error ||
            applicableFieldsQuery.error ||
            conflictsQuery.error ||
            stagesQuery.error ||
            adopt.error
          }
        />
      )}

      {renderFields({
        focusGroupId: focus?.groupId ?? null,
        focusFieldKey: focus?.fieldKey ?? null,
        onFocusHandled: () => setFocus(null),
      })}

      <Card>
        <h4 className="text-sm font-semibold text-slate-900">合规边界（只提示，不自动改写）</h4>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
          <li>可研总投资不等于招标预算，也不等于最终合同金额。</li>
          <li>招标预算与最高限价不等于最终合同金额。</li>
          <li>项目全部建设范围不等于单份采购范围或合同范围。</li>
          <li>AI 建议与材料提取值仅是候选，人工确认前不得作为正式值写入定稿。</li>
          <li>上游依据变化时不得静默覆盖已确认招标字段。</li>
        </ul>
      </Card>
    </div>
  );
}
