import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, apiError } from "../api/client";
import { ErrorNotice } from "./Auth";
import { Card } from "./Shell";

type ProviderKind = "demo" | "openai_compatible";

type ModelDraft = {
  name: string;
  provider: ProviderKind;
  base_url: string;
  model_name: string;
  api_key: string;
  timeout_seconds: number;
  notes: string;
  activate: boolean;
};

type ModelItem = {
  id: string;
  name: string;
  provider: ProviderKind;
  base_url: string | null;
  model_name: string | null;
  timeout_seconds: number;
  is_active: boolean;
  notes: string | null;
  has_api_key: boolean;
  api_key_hint: string | null;
  revision: number;
};

const emptyDraft = (): ModelDraft => ({
  name: "",
  provider: "openai_compatible",
  base_url: "https://api.deepseek.com",
  model_name: "deepseek-chat",
  api_key: "",
  timeout_seconds: 90,
  notes: "",
  activate: true,
});

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  demo: "演示模式（不消耗额度）",
  openai_compatible: "OpenAI 兼容接口",
};

const PRESETS = [
  { label: "DeepSeek", base_url: "https://api.deepseek.com", model_name: "deepseek-chat" },
  { label: "OpenAI", base_url: "https://api.openai.com/v1", model_name: "gpt-4o-mini" },
] as const;

function providerLabel(provider: ProviderKind) {
  return PROVIDER_LABEL[provider] ?? provider;
}

export function ModelSettingsPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<ModelDraft>(emptyDraft);
  const [message, setMessage] = useState<string>();

  const catalog = useQuery({
    queryKey: ["llm-models"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/llm-models");
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });

  useEffect(() => {
    if (!editingId || !catalog.data) return;
    const current = catalog.data.items.find((item) => item.id === editingId);
    if (!current) return;
    setDraft({
      name: current.name,
      provider: current.provider,
      base_url: current.base_url ?? "",
      model_name: current.model_name ?? "",
      api_key: "",
      timeout_seconds: current.timeout_seconds,
      notes: current.notes ?? "",
      activate: current.is_active,
    });
  }, [editingId, catalog.data]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["llm-models"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/llm-models", {
        body: {
          name: draft.name.trim(),
          provider: draft.provider,
          base_url: draft.provider === "demo" ? null : draft.base_url.trim() || null,
          model_name: draft.provider === "demo" ? null : draft.model_name.trim() || null,
          api_key: draft.provider === "demo" ? null : draft.api_key.trim() || null,
          timeout_seconds: draft.timeout_seconds,
          notes: draft.notes.trim() || null,
          activate: draft.activate,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: async () => {
      setCreating(false);
      setDraft(emptyDraft());
      setMessage("模型已添加。");
      await invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (item: ModelItem) => {
      const result = await api.PATCH("/api/v1/llm-models/{profile_id}", {
        params: { path: { profile_id: item.id } },
        body: {
          name: draft.name.trim(),
          provider: draft.provider,
          base_url: draft.provider === "demo" ? null : draft.base_url.trim() || null,
          model_name: draft.provider === "demo" ? null : draft.model_name.trim() || null,
          api_key: draft.api_key.trim() || null,
          clear_api_key: false,
          timeout_seconds: draft.timeout_seconds,
          notes: draft.notes.trim() || null,
          revision: item.revision,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: async () => {
      setEditingId(undefined);
      setDraft(emptyDraft());
      setMessage("模型信息已更新。");
      await invalidate();
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const result = await api.POST("/api/v1/llm-models/{profile_id}/activate", {
        params: { path: { profile_id: profileId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: async () => {
      setMessage("已切换当前启用模型。");
      await invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const result = await api.DELETE("/api/v1/llm-models/{profile_id}", {
        params: { path: { profile_id: profileId } },
      });
      if (result.error) throw apiError(result.error, result.response);
    },
    onSuccess: async () => {
      setMessage("模型已删除。");
      if (editingId) setEditingId(undefined);
      await invalidate();
    },
  });

  const error =
    catalog.error ||
    createMutation.error ||
    updateMutation.error ||
    activateMutation.error ||
    deleteMutation.error;

  const active = catalog.data?.items.find((item) => item.is_active);
  const envFallback = catalog.data?.env_fallback;

  const formValid =
    draft.name.trim().length > 0 &&
    (draft.provider === "demo" ||
      (draft.base_url.trim().length > 0 &&
        draft.model_name.trim().length > 0 &&
        (Boolean(editingId) || draft.api_key.trim().length > 0)));

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">模型配置</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              添加常用大模型连接信息，一键启用即可用于文档生成与解析。API Key 仅管理员可见并脱敏展示。
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setMessage(undefined);
              setEditingId(undefined);
              setCreating((value) => !value);
              setDraft(emptyDraft());
            }}
          >
            {creating ? "收起" : "添加模型"}
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {active ? (
            <>
              当前启用：
              <span className="ml-1 font-medium text-slate-900">{active.name}</span>
              <span className="ml-2 text-slate-500">
                {providerLabel(active.provider)}
                {active.model_name ? ` · ${active.model_name}` : ""}
              </span>
            </>
          ) : (
            <>
              当前使用环境变量默认配置
              {envFallback?.model_name ? (
                <span className="ml-1 font-medium text-slate-900">
                  （{String(envFallback.provider)} / {String(envFallback.model_name)}）
                </span>
              ) : null}
              。添加并启用模型后将优先使用此处配置。
            </>
          )}
        </div>

        {error && (
          <div className="mt-4">
            <ErrorNotice error={error} />
          </div>
        )}
        {message && !error && <p className="mt-4 text-sm text-emerald-700">{message}</p>}

        {(creating || editingId) && (
          <form
            className="mt-5 grid gap-4 rounded-xl border border-blue-100 bg-blue-50/30 p-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              setMessage(undefined);
              if (editingId) {
                const item = catalog.data?.items.find((row) => row.id === editingId);
                if (item) {
                  updateMutation.mutate({
                    id: item.id,
                    name: item.name,
                    provider: item.provider,
                    base_url: item.base_url ?? null,
                    model_name: item.model_name ?? null,
                    timeout_seconds: item.timeout_seconds,
                    is_active: item.is_active,
                    notes: item.notes ?? null,
                    has_api_key: item.has_api_key,
                    api_key_hint: item.api_key_hint ?? null,
                    revision: item.revision,
                  });
                }
                return;
              }
              createMutation.mutate();
            }}
          >
            <label className="form-label md:col-span-2">
              显示名称
              <input
                className="form-input mt-2"
                value={draft.name}
                maxLength={120}
                placeholder="例如：DeepSeek 正式"
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>

            <label className="form-label md:col-span-2">
              接入方式
              <select
                className="form-input mt-2"
                value={draft.provider}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    provider: event.target.value as ProviderKind,
                  }))
                }
              >
                <option value="openai_compatible">OpenAI 兼容接口（DeepSeek / 通义等）</option>
                <option value="demo">演示模式（确定性输出，不调外部模型）</option>
              </select>
            </label>

            {draft.provider === "openai_compatible" && (
              <>
                <div className="md:col-span-2">
                  <p className="text-sm font-medium text-slate-700">快捷填入</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            base_url: preset.base_url,
                            model_name: preset.model_name,
                            name: prev.name || `${preset.label} 正式`,
                          }))
                        }
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="form-label md:col-span-2">
                  API 地址
                  <input
                    className="form-input mt-2 font-mono text-sm"
                    value={draft.base_url}
                    placeholder="https://api.deepseek.com"
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, base_url: event.target.value }))
                    }
                  />
                </label>
                <label className="form-label">
                  模型名称
                  <input
                    className="form-input mt-2 font-mono text-sm"
                    value={draft.model_name}
                    placeholder="deepseek-chat"
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, model_name: event.target.value }))
                    }
                  />
                </label>
                <label className="form-label">
                  超时（秒）
                  <input
                    className="form-input mt-2"
                    type="number"
                    min={10}
                    max={600}
                    value={draft.timeout_seconds}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        timeout_seconds: Number(event.target.value) || 90,
                      }))
                    }
                  />
                </label>
                <label className="form-label md:col-span-2">
                  API Key
                  <input
                    className="form-input mt-2 font-mono text-sm"
                    type="password"
                    autoComplete="off"
                    value={draft.api_key}
                    placeholder={
                      editingId
                        ? "留空则保留原密钥"
                        : "只保存在本组织，不会写入前端缓存"
                    }
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, api_key: event.target.value }))
                    }
                  />
                  {editingId && catalog.data?.items.find((item) => item.id === editingId)?.api_key_hint ? (
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      当前密钥：
                      {catalog.data.items.find((item) => item.id === editingId)?.api_key_hint}
                    </span>
                  ) : null}
                </label>
              </>
            )}

            <label className="form-label md:col-span-2">
              备注（可选）
              <input
                className="form-input mt-2"
                value={draft.notes}
                maxLength={500}
                placeholder="例如：生产环境 / 仅测试"
                onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </label>

            {!editingId && (
              <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={draft.activate}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, activate: event.target.checked }))
                  }
                />
                保存后立即启用
              </label>
            )}

            <div className="flex flex-wrap gap-2 md:col-span-2">
              <button
                className="primary-button"
                type="submit"
                disabled={
                  !formValid || createMutation.isPending || updateMutation.isPending
                }
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "保存中…"
                  : editingId
                    ? "保存修改"
                    : "添加"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditingId(undefined);
                  setDraft(emptyDraft());
                }}
              >
                取消
              </button>
            </div>
          </form>
        )}
      </Card>

      <Card>
        <h3 className="text-base font-semibold text-slate-900">已配置模型</h3>
        {catalog.isLoading ? (
          <p className="mt-4 text-sm text-slate-500">正在加载…</p>
        ) : (catalog.data?.items.length ?? 0) === 0 ? (
          <p className="mt-4 text-sm text-slate-500">暂无模型。点击「添加模型」开始配置。</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>接入方式</th>
                  <th>模型</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {catalog.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="font-medium text-slate-900">{item.name}</div>
                      {item.notes ? (
                        <div className="mt-1 text-xs text-slate-500">{item.notes}</div>
                      ) : null}
                    </td>
                    <td>{providerLabel(item.provider)}</td>
                    <td className="font-mono text-xs">
                      {item.model_name || "—"}
                      {item.base_url ? (
                        <div className="mt-1 text-slate-500">{item.base_url}</div>
                      ) : null}
                    </td>
                    <td>
                      {item.is_active ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          使用中
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          未启用
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {!item.is_active && (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={activateMutation.isPending}
                            onClick={() => {
                              setMessage(undefined);
                              activateMutation.mutate(item.id);
                            }}
                          >
                            启用
                          </button>
                        )}
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => {
                            setMessage(undefined);
                            setCreating(false);
                            setEditingId(item.id);
                          }}
                        >
                          修改
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (!window.confirm(`确认删除「${item.name}」？`)) return;
                            setMessage(undefined);
                            deleteMutation.mutate(item.id);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
