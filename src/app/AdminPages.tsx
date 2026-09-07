import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, apiError, type FieldDefinition, type Template, type User } from "../api/client";
import { ErrorNotice } from "./Auth";
import { Card, PageHeader, StatusBadge } from "./Shell";

const STAGE_NAMES: Record<string, string> = {
  requirement: "项目建议书",
  feasibility: "可研报告",
  tender: "招标文件",
  contract: "合同",
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
      <Card className="mb-5">
        <h3 className="section-title">新增模板</h3>
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
