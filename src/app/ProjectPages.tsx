import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { api, apiError, type Project, type Stage } from "../api/client";
import { ErrorNotice, FullPageMessage } from "./Auth";
import { Card, PageHeader, StatusBadge } from "./Shell";

const projectSchema = z.object({
  code: z
    .string()
    .min(2, "项目编号至少 2 个字符")
    .regex(/^[A-Za-z0-9_-]+$/, "仅允许字母、数字、横线和下划线"),
  name: z.string().min(2, "请输入项目名称").max(300),
  project_type: z.enum(["government_investment", "enterprise_investment"]),
  description: z.string().max(4000).optional(),
});
type ProjectForm = z.infer<typeof projectSchema>;

export function ProjectsPage() {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects", {
        params: { query: { page: 1, page_size: 100 } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data.items as Project[];
    },
  });
  const form = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      project_type: "government_investment",
      code: "",
      name: "",
      description: "",
    },
  });
  const createProject = useMutation({
    mutationFn: async (values: ProjectForm) => {
      const result = await api.POST("/api/v1/projects", { body: values });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="项目空间"
        description="每个项目沿项目建议书、可研报告、招标文件、合同四个阶段推进。"
        actions={
          <button className="primary-button" onClick={() => setCreating((value) => !value)}>
            新建项目
          </button>
        }
      />
      {creating && (
        <Card className="mb-6">
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={form.handleSubmit((values) => createProject.mutate(values))}
          >
            <label className="form-label">
              项目编号
              <input className="form-input mt-2" {...form.register("code")} />
              {form.formState.errors.code && (
                <span className="field-error">{form.formState.errors.code.message}</span>
              )}
            </label>
            <label className="form-label">
              项目名称
              <input className="form-input mt-2" {...form.register("name")} />
              {form.formState.errors.name && (
                <span className="field-error">{form.formState.errors.name.message}</span>
              )}
            </label>
            <label className="form-label">
              项目类型
              <select className="form-input mt-2" {...form.register("project_type")}>
                <option value="government_investment">政府投资项目</option>
                <option value="enterprise_investment">企业投资项目</option>
              </select>
            </label>
            <label className="form-label">
              项目说明
              <input className="form-input mt-2" {...form.register("description")} />
            </label>
            {createProject.error && (
              <div className="md:col-span-2">
                <ErrorNotice error={createProject.error} />
              </div>
            )}
            <div className="flex gap-2 md:col-span-2">
              <button className="primary-button" type="submit" disabled={createProject.isPending}>
                保存项目
              </button>
              <button className="secondary-button" type="button" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </form>
        </Card>
      )}
      {projects.isLoading && <FullPageMessage title="正在加载项目" />}
      {projects.error && <ErrorNotice error={projects.error} />}
      {projects.data?.length === 0 && (
        <Card>
          <div className="py-12 text-center text-slate-500">尚无项目，请先新建项目。</div>
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {projects.data?.map((project) => (
          <Link key={project.id} to={`/projects/${project.id}`} className="block">
            <Card className="h-full transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium text-blue-700">{project.code}</div>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{project.name}</h3>
                </div>
                <StatusBadge status={project.status} />
              </div>
              <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-500">
                {project.description || "尚未填写项目说明"}
              </p>
              <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-400">
                最后更新 {new Date(project.updated_at).toLocaleString("zh-CN")}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

const STAGE_LABELS: Record<string, { name: string; detail: string }> = {
  requirement: { name: "项目建议书", detail: "需求材料、项目范围和建设目标" },
  feasibility: {
    name: "可行性研究报告",
    detail: "建设方案、投资估算和可行性论证",
  },
  tender: { name: "招标文件", detail: "采购需求、投标人须知和评标办法章节" },
  contract: { name: "合同", detail: "合同主体、范围、金额、期限和付款安排" },
};

export function ProjectOverviewPage() {
  const { projectId = "" } = useParams();
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects/{project_id}", {
        params: { path: { project_id: projectId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
  });
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
  if (project.isLoading || stages.isLoading) return <FullPageMessage title="正在加载项目" />;
  if (project.error) return <ErrorNotice error={project.error} />;
  if (stages.error) return <ErrorNotice error={stages.error} />;
  return (
    <>
      <PageHeader
        title={project.data?.name ?? "项目"}
        description={`${project.data?.code} · 四阶段文件链`}
        actions={
          <Link className="secondary-button" to="/projects">
            返回项目列表
          </Link>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Metric label="项目状态" value={project.data?.status ?? "-"} />
        <Metric
          label="项目类型"
          value={project.data?.project_type === "enterprise_investment" ? "企业投资" : "政府投资"}
        />
        <Metric label="当前修订" value={`R${project.data?.revision ?? 1}`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {stages.data?.map((stage: Stage, index: number) => {
          const info = STAGE_LABELS[stage.stage] ?? {
            name: stage.stage,
            detail: "",
          };
          return (
            <Card key={stage.id}>
              <div className="flex items-start justify-between">
                <div className="flex gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 font-semibold text-blue-700">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-900">{info.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{info.detail}</p>
                  </div>
                </div>
                <StatusBadge status={stage.status} />
              </div>
              {stage.stale_reason && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {stage.stale_reason}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  className="primary-button"
                  to={`/projects/${projectId}/stages/${stage.stage}/source`}
                >
                  进入阶段
                </Link>
                {stage.finalized_document_version_id && (
                  <span className="secondary-button cursor-default">已有定稿版本</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{value}</div>
    </Card>
  );
}
