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

export function TemplateAdminPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    stage: "requirement",
    source_kind: "customer_template",
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
          source_kind: form.source_kind as "customer_template" | "demo_general",
          specialty: null,
          procurement_type: null,
          contract_type: null,
          format_profile: { page_size: "A4", standard: "customer_template" },
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      setForm((current) => ({ ...current, name: "" }));
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
        description="管理客户模板和明确标记的 Demo 通用模板。发布后的版本才能用于生成。"
      />
      <Card className="mb-5">
        <h3 className="section-title">新增模板</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_220px_auto]">
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
            <option value="customer_template">客户模板</option>
            <option value="demo_general">Demo 通用模板</option>
          </select>
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
      <Card>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>模板名称</th>
                <th>阶段</th>
                <th>来源</th>
                <th>版本</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.data?.map((template: Template) => (
                <tr key={template.id}>
                  <td className="font-medium text-slate-900">{template.name}</td>
                  <td>{STAGE_NAMES[template.stage] ?? template.stage}</td>
                  <td>{template.source_kind}</td>
                  <td>V{template.current_version}</td>
                  <td>
                    <StatusBadge status={template.status} />
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
                      <span className="text-slate-400">当前有效</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {templates.error && <ErrorNotice error={templates.error} />}
        {(uploadSource.error || publish.error) && (
          <ErrorNotice error={uploadSource.error || publish.error} />
        )}
      </Card>
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
