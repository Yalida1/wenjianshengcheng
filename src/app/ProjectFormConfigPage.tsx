import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, apiError, type ProjectCodeRule, type ProjectType } from "../api/client";
import { ErrorNotice, FullPageMessage } from "./Auth";
import { Card } from "./Shell";

type Draft = {
  code: string;
  name: string;
  description: string;
  sort_order: number;
};

type CodeRuleDraft = {
  pattern: string;
  date_format: string;
  seq_width: number;
  reset_scope: "type_day" | "day" | "organization";
};

const emptyDraft: Draft = {
  code: "",
  name: "",
  description: "",
  sort_order: 100,
};

const DATE_FORMAT_OPTIONS = [
  { value: "YYYYMMDD", label: "YYYYMMDD（20260911）" },
  { value: "YYYYMM", label: "YYYYMM（202609）" },
  { value: "YYMMDD", label: "YYMMDD（260911）" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD（2026-09-11）" },
] as const;

const RESET_SCOPE_OPTIONS = [
  { value: "type_day", label: "按项目类型 + 日期重置" },
  { value: "day", label: "按日期重置（跨类型连续）" },
  { value: "organization", label: "组织内连续（不按日重置）" },
] as const;

function nextSortOrder(types: ProjectType[] | undefined): number {
  if (!types?.length) return 10;
  return Math.max(...types.map((item) => item.sort_order)) + 1;
}

function livePreview(draft: CodeRuleDraft): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateValue =
    draft.date_format === "YYYYMM"
      ? `${yyyy}${mm}`
      : draft.date_format === "YYMMDD"
        ? `${yy}${mm}${dd}`
        : draft.date_format === "YYYY-MM-DD"
          ? `${yyyy}-${mm}-${dd}`
          : `${yyyy}${mm}${dd}`;
  const seq = String(1).padStart(Math.max(1, draft.seq_width || 1), "0");
  return draft.pattern
    .split("{project_type}")
    .join("government_investment")
    .split("{date}")
    .join(dateValue)
    .split("{seq}")
    .join(seq);
}

export function useProjectTypes(activeOnly = false) {
  return useQuery({
    queryKey: ["project-types", activeOnly ? "active" : "all"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/project-types", {
        params: { query: { active_only: activeOnly } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
}

function useProjectCodeRule() {
  return useQuery({
    queryKey: ["project-code-rules"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/project-code-rules");
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProjectCodeRule;
    },
  });
}

export function ProjectTypeConfigPanel() {
  const queryClient = useQueryClient();
  const types = useProjectTypes(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);

  const createType = useMutation({
    mutationFn: async (values: Draft) => {
      const result = await api.POST("/api/v1/project-types", {
        body: {
          code: values.code.trim(),
          name: values.name.trim(),
          description: values.description.trim() || null,
          sort_order: values.sort_order,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      setCreating(false);
      setDraft(emptyDraft);
      void queryClient.invalidateQueries({ queryKey: ["project-types"] });
    },
  });

  const openCreate = () => {
    createType.reset();
    setDraft({
      ...emptyDraft,
      sort_order: nextSortOrder(types.data),
    });
    setCreating(true);
  };

  const patchType = useMutation({
    mutationFn: async ({
      item,
      values,
      is_active,
    }: {
      item: ProjectType;
      values?: Draft;
      is_active?: boolean;
    }) => {
      const result = await api.PATCH("/api/v1/project-types/{type_id}", {
        params: { path: { type_id: item.id } },
        body: {
          revision: item.revision,
          ...(values
            ? {
                name: values.name.trim(),
                description: values.description.trim() || null,
                sort_order: values.sort_order,
              }
            : {}),
          ...(typeof is_active === "boolean" ? { is_active } : {}),
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ["project-types"] });
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">项目类型</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            维护本组织新建项目时可选的项目类型。类型编码会作为项目编号前缀；系统预置项可改名称与排序，不可删除编码。
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            if (creating) {
              setCreating(false);
              setDraft(emptyDraft);
              return;
            }
            openCreate();
          }}
        >
          {creating ? "收起" : "新增类型"}
        </button>
      </div>

      {creating && (
        <Card className="border-blue-100 bg-blue-50/30">
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              createType.mutate(draft);
            }}
          >
            <label className="form-label">
              编码
              <input
                className="form-input mt-2 font-mono text-sm"
                placeholder="municipal_special"
                value={draft.code}
                onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
              />
              <span className="mt-1 block text-xs text-slate-400">
                小写字母开头；该编码会出现在项目编号前缀中
              </span>
            </label>
            <label className="form-label">
              显示名称
              <input
                className="form-input mt-2"
                placeholder="市政专项项目"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label className="form-label md:col-span-2">
              说明（可选）
              <input
                className="form-input mt-2"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>
            <label className="form-label">
              排序
              <input
                className="form-input mt-2"
                type="number"
                min={0}
                max={10000}
                value={draft.sort_order}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sort_order: Number(event.target.value) || 0,
                  }))
                }
              />
              <span className="mt-1 block text-xs text-slate-400">
                已按现有类型自动取最近序号 + 1，可再调整
              </span>
            </label>
            {createType.error && (
              <div className="md:col-span-2">
                <ErrorNotice error={createType.error} />
              </div>
            )}
            <div className="flex gap-2 md:col-span-2">
              <button className="primary-button" type="submit" disabled={createType.isPending}>
                {createType.isPending ? "保存中…" : "保存类型"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setCreating(false);
                  setDraft(emptyDraft);
                }}
              >
                取消
              </button>
            </div>
          </form>
        </Card>
      )}

      {types.isLoading && <FullPageMessage title="正在加载项目类型" />}
      {types.error && <ErrorNotice error={types.error} />}
      {types.data && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>编码</th>
                <th>排序</th>
                <th>状态</th>
                <th>来源</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {types.data.map((item) => {
                const editing = editingId === item.id;
                return (
                  <tr key={item.id}>
                    <td>
                      {editing ? (
                        <input
                          className="form-input"
                          value={editDraft.name}
                          onChange={(event) =>
                            setEditDraft((current) => ({ ...current, name: event.target.value }))
                          }
                        />
                      ) : (
                        <div>
                          <div className="font-medium text-slate-900">{item.name}</div>
                          {item.description && (
                            <div className="mt-1 text-xs text-slate-400">{item.description}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="font-mono text-xs text-slate-600">{item.code}</td>
                    <td>
                      {editing ? (
                        <input
                          className="form-input w-24"
                          type="number"
                          min={0}
                          max={10000}
                          value={editDraft.sort_order}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              sort_order: Number(event.target.value) || 0,
                            }))
                          }
                        />
                      ) : (
                        item.sort_order
                      )}
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          item.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {item.is_active ? "启用" : "停用"}
                      </span>
                    </td>
                    <td>{item.is_system ? "系统预置" : "组织自定义"}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {editing ? (
                          <>
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={patchType.isPending}
                              onClick={() => patchType.mutate({ item, values: editDraft })}
                            >
                              保存
                            </button>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => setEditingId(null)}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => {
                                setEditingId(item.id);
                                setEditDraft({
                                  code: item.code,
                                  name: item.name,
                                  description: item.description ?? "",
                                  sort_order: item.sort_order,
                                });
                                patchType.reset();
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={patchType.isPending}
                              onClick={() =>
                                patchType.mutate({ item, is_active: !item.is_active })
                              }
                            >
                              {item.is_active ? "停用" : "启用"}
                            </button>
                          </>
                        )}
                      </div>
                      {patchType.error && editingId === item.id && (
                        <div className="mt-2">
                          <ErrorNotice error={patchType.error} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {types.data.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">暂无项目类型</div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectCodeRulePanel() {
  const queryClient = useQueryClient();
  const rule = useProjectCodeRule();
  const [draft, setDraft] = useState<CodeRuleDraft | null>(null);

  const activeDraft = useMemo<CodeRuleDraft | null>(() => {
    if (draft) return draft;
    if (!rule.data) return null;
    return {
      pattern: rule.data.pattern,
      date_format: rule.data.date_format,
      seq_width: rule.data.seq_width,
      reset_scope: rule.data.reset_scope as CodeRuleDraft["reset_scope"],
    };
  }, [draft, rule.data]);

  const saveRule = useMutation({
    mutationFn: async (values: CodeRuleDraft) => {
      if (!rule.data) throw new Error("编号规则尚未加载");
      const result = await api.PUT("/api/v1/project-code-rules", {
        body: {
          pattern: values.pattern.trim(),
          date_format: values.date_format,
          seq_width: values.seq_width,
          reset_scope: values.reset_scope,
          revision: rule.data.revision,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ProjectCodeRule;
    },
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["project-code-rules"] });
    },
  });

  if (rule.isLoading) return <FullPageMessage title="正在加载编号规则" />;
  if (rule.error) return <ErrorNotice error={rule.error} />;
  if (!activeDraft || !rule.data) return null;

  const preview = livePreview(activeDraft);
  const dirty =
    activeDraft.pattern !== rule.data.pattern ||
    activeDraft.date_format !== rule.data.date_format ||
    activeDraft.seq_width !== rule.data.seq_width ||
    activeDraft.reset_scope !== rule.data.reset_scope;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-900">项目编号规则</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          新建项目时按规则自动分配编号。可用占位符：
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {"{project_type}"}
          </code>
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{"{date}"}</code>
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{"{seq}"}</code>
          。仅当编号仍为 TMP-* 时，材料解析才可覆盖。
        </p>
      </div>

      <form
        className="grid max-w-3xl gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          saveRule.mutate(activeDraft);
        }}
      >
        <label className="form-label md:col-span-2">
          编号模板
          <input
            className="form-input mt-2 font-mono text-sm"
            value={activeDraft.pattern}
            onChange={(event) =>
              setDraft({
                ...activeDraft,
                pattern: event.target.value,
              })
            }
          />
        </label>
        <label className="form-label">
          日期格式
          <select
            className="form-input mt-2"
            value={activeDraft.date_format}
            onChange={(event) =>
              setDraft({
                ...activeDraft,
                date_format: event.target.value,
              })
            }
          >
            {DATE_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          序号位数
          <input
            className="form-input mt-2"
            type="number"
            min={1}
            max={8}
            value={activeDraft.seq_width}
            onChange={(event) =>
              setDraft({
                ...activeDraft,
                seq_width: Number(event.target.value) || 1,
              })
            }
          />
        </label>
        <label className="form-label md:col-span-2">
          流水号重置范围
          <select
            className="form-input mt-2"
            value={activeDraft.reset_scope}
            onChange={(event) =>
              setDraft({
                ...activeDraft,
                reset_scope: event.target.value as CodeRuleDraft["reset_scope"],
              })
            }
          >
            {RESET_SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">预览示例</div>
          <div className="mt-2 font-mono text-slate-800">{preview}</div>
        </div>
        {saveRule.error && (
          <div className="md:col-span-2">
            <ErrorNotice error={saveRule.error} />
          </div>
        )}
        <div className="flex gap-2 md:col-span-2">
          <button
            className="primary-button"
            type="submit"
            disabled={saveRule.isPending || !dirty}
          >
            {saveRule.isPending ? "保存中…" : "保存规则"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!dirty || saveRule.isPending}
            onClick={() => setDraft(null)}
          >
            重置
          </button>
        </div>
      </form>
    </div>
  );
}

export function ProjectFormConfigPage() {
  const [tab, setTab] = useState<"types" | "codes">("types");
  return (
    <Card>
      <div className="mb-5 border-b border-slate-100 pb-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">项目单配置</div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className={`tab-button ${tab === "types" ? "tab-button-active" : ""}`}
            onClick={() => setTab("types")}
          >
            项目类型
          </button>
          <button
            type="button"
            className={`tab-button ${tab === "codes" ? "tab-button-active" : ""}`}
            onClick={() => setTab("codes")}
          >
            编号规则
          </button>
        </div>
      </div>
      {tab === "types" ? <ProjectTypeConfigPanel /> : <ProjectCodeRulePanel />}
    </Card>
  );
}
