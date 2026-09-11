import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { api, apiError, type Project } from "../api/client";
import { ErrorNotice, FullPageMessage } from "./Auth";
import { useProjectTypes } from "./ProjectFormConfigPage";
import { ProjectStageFlow } from "./ProjectStageFlow";
import {
  DISPLAY_PRESETS,
  LIFECYCLE_KEYS,
  type DisplayPresetId,
  type LifecycleStageKey,
  type StageDisplayPreference,
  buildLifecycleNodes,
  clearProjectStageDisplay,
  loadDefaultStageDisplay,
  loadProjectStageDisplay,
  matchPreset,
  preferenceFromPreset,
  saveProjectStageDisplay,
} from "./projectLifecycle";
import { Card, PageHeader, StatusBadge, statusLabel } from "./Shell";

const projectSchema = z.object({
  name: z.string().min(2, "请输入名称").max(300),
  project_type: z.string().min(1, "请选择项目类型"),
});
type ProjectForm = z.infer<typeof projectSchema>;
type CreateMode = "managed" | "adhoc";
type ListFilter = "managed" | "adhoc";

function isTemporaryProjectCode(code: string | null | undefined): boolean {
  return Boolean(code && /^TMP-\d+(?:-\d+)?$/.test(code));
}

function isAdhocProject(project: Project): boolean {
  return project.workspace_kind === "adhoc";
}

function ProjectFormSettingsButton() {
  return (
    <Link
      to="/admin/project-form"
      title="项目单配置"
      aria-label="项目单配置"
      className="inline-flex size-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M11.984 2.247a.75.75 0 0 0-1.468-.194l-.32 2.42a5.52 5.52 0 0 0-1.59.921l-2.2-1.07a.75.75 0 0 0-.97.34l-.74 1.61a.75.75 0 0 0 .34.97l2.2 1.07a5.6 5.6 0 0 0 0 1.842l-2.2 1.07a.75.75 0 0 0-.34.97l.74 1.61a.75.75 0 0 0 .97.34l2.2-1.07c.47.39 1.01.7 1.59.921l.32 2.42a.75.75 0 0 0 1.468-.194l.32-2.42a5.52 5.52 0 0 0 1.59-.921l2.2 1.07a.75.75 0 0 0 .97-.34l.74-1.61a.75.75 0 0 0-.34-.97l-2.2-1.07a5.6 5.6 0 0 0 0-1.842l2.2-1.07a.75.75 0 0 0 .34-.97l-.74-1.61a.75.75 0 0 0-.97-.34l-2.2 1.07a5.52 5.52 0 0 0-1.59-.921l-.32-2.42ZM10 12.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"
          clipRule="evenodd"
        />
      </svg>
    </Link>
  );
}

export function ProjectsPage() {
  const [createMode, setCreateMode] = useState<CreateMode | null>(null);
  const [searchParams] = useSearchParams();
  const listFilter: ListFilter = searchParams.get("kind") === "adhoc" ? "adhoc" : "managed";
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [deleteSubmitted, setDeleteSubmitted] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projectTypes = useProjectTypes(true);
  const projects = useQuery({
    queryKey: ["projects", listFilter],
    queryFn: async () => {
      const result = await api.GET("/api/v1/projects", {
        params: {
          query: {
            page: 1,
            page_size: 100,
            workspace_kind: listFilter,
          },
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data.items as Project[];
    },
  });
  const form = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      project_type: "",
      name: "",
    },
  });
  useEffect(() => {
    const first = projectTypes.data?.[0]?.code;
    if (first && !form.getValues("project_type")) {
      form.setValue("project_type", first);
    }
  }, [projectTypes.data, form]);
  const createProject = useMutation({
    mutationFn: async ({
      values,
      workspace_kind,
    }: {
      values: ProjectForm;
      workspace_kind: CreateMode;
    }) => {
      const result = await api.POST("/api/v1/projects", {
        body: { ...values, workspace_kind },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setCreateMode(null);
      form.reset({ name: "", project_type: projectTypes.data?.[0]?.code ?? "" });
      if (project.workspace_kind === "adhoc") {
        navigate(`/projects/${project.id}/stages/tender/basics`);
        return;
      }
      navigate(`/projects/${project.id}`);
    },
  });
  const requestDeletion = useMutation({
    mutationFn: async ({
      project,
      code,
      reason,
    }: {
      project: Project;
      code: string;
      reason: string;
    }) => {
      const result = await api.POST("/api/v1/projects/{project_id}/deletion-requests", {
        params: { path: { project_id: project.id } },
        body: {
          revision: project.revision,
          confirmation_code: code,
          reason,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
      setDeleteSubmitted(true);
    },
  });

  const closeDeleteDialog = () => {
    if (requestDeletion.isPending) return;
    requestDeletion.reset();
    setProjectToDelete(null);
    setDeleteReason("");
    setConfirmationCode("");
    setDeleteSubmitted(false);
  };

  const closeCreateDialog = () => {
    if (createProject.isPending) return;
    createProject.reset();
    setCreateMode(null);
  };

  const openCreate = (mode: CreateMode) => {
    createProject.reset();
    form.reset({
      name: "",
      project_type: projectTypes.data?.[0]?.code ?? "",
    });
    setCreateMode(mode);
  };

  return (
    <>
      <PageHeader
        title={listFilter === "adhoc" ? "临时编标" : "正式项目"}
        description={
          listFilter === "adhoc"
            ? "用于已有招标文件的检查、套模板或快速起草，不必按项目台账管理。"
            : "正式项目走完整招标管理链路，按项目台账推进各阶段。"
        }
        actions={
          listFilter === "adhoc" ? (
            <button className="primary-button" type="button" onClick={() => openCreate("adhoc")}>
              临时编标
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={() => openCreate("managed")}>
              新建项目
            </button>
          )
        }
      />

      {projects.isLoading && <FullPageMessage title="正在加载项目" />}
      {projects.error && <ErrorNotice error={projects.error} />}
      {projects.data?.length === 0 && (
        <Card>
          <div className="py-12 text-center text-slate-500">
            {listFilter === "adhoc"
              ? "暂无临时编标任务，可点击右上角「临时编标」开始。"
              : "尚无正式项目，请先新建项目。"}
          </div>
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {projects.data?.map((project) => {
          const adhoc = isAdhocProject(project);
          const entryTo = adhoc
            ? `/projects/${project.id}/stages/tender/basics`
            : `/projects/${project.id}`;
          return (
            <Card key={project.id} className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-4">
                <Link to={entryTo} className="min-w-0 hover:text-blue-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xs font-medium text-blue-700">
                      {isTemporaryProjectCode(project.code) ? "待从材料解析编号" : project.code}
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        adhoc
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {adhoc ? "临时编标" : "正式项目"}
                    </span>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{project.name}</h3>
                </Link>
                <StatusBadge status={project.status} />
              </div>
              <p className="mt-4 line-clamp-2 flex-1 text-sm leading-6 text-slate-500">
                {adhoc
                  ? "用于招标文件检查、套用模板或快速起草，不按完整项目台账推进。"
                  : project.description ||
                    "尚未填写项目说明（上传依据材料解析后可自动补齐）"}
              </p>
              <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-slate-400">
                  最后更新 {new Date(project.updated_at).toLocaleString("zh-CN")}
                </span>
                <div className="flex gap-2">
                  <Link className="secondary-button" to={entryTo}>
                    {adhoc ? "继续编标" : "进入项目"}
                  </Link>
                  <button
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:border-red-300 hover:bg-red-50"
                    type="button"
                    aria-label={adhoc ? "申请删除临时编标" : "申请删除项目"}
                    onClick={() => {
                      requestDeletion.reset();
                      setDeleteReason("");
                      setConfirmationCode("");
                      setDeleteSubmitted(false);
                      setProjectToDelete(project);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {createMode && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-slate-950/30 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCreateDialog();
          }}
        >
          <section
            aria-describedby="create-project-description"
            aria-labelledby="create-project-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl"
            role="dialog"
          >
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-semibold text-slate-900" id="create-project-title">
                {createMode === "managed" ? "新建正式项目" : "开始临时编标"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500" id="create-project-description">
                {createMode === "managed"
                  ? "用于需要按项目维度推进的正式招标管理流程，进入后可从招标阶段继续。"
                  : "不强调项目台账管理。创建后直接进入招标文件工作流，适合上传已有招标文件做检查、套用模板或快速起草。"}
              </p>
            </div>
            <form
              className="grid gap-4 p-6"
              onSubmit={form.handleSubmit((values) =>
                createProject.mutate({ values, workspace_kind: createMode }),
              )}
            >
              <label className="form-label">
                {createMode === "managed" ? "项目名称" : "编标任务名称"}
                <input
                  className="form-input mt-2"
                  autoFocus
                  placeholder={
                    createMode === "managed"
                      ? "例如：某机房节能改造项目"
                      : "例如：某某货物招标文件检查"
                  }
                  {...form.register("name")}
                />
                {form.formState.errors.name && (
                  <span className="field-error">{form.formState.errors.name.message}</span>
                )}
              </label>
              {createMode === "managed" && (
                <label className="form-label">
                  <span className="flex items-center justify-between gap-2">
                    <span>项目类型</span>
                    <ProjectFormSettingsButton />
                  </span>
                  <select
                    className="form-input mt-2"
                    disabled={projectTypes.isLoading || !projectTypes.data?.length}
                    {...form.register("project_type")}
                  >
                    {(projectTypes.data ?? []).map((item) => (
                      <option key={item.id} value={item.code}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  {projectTypes.error && (
                    <span className="field-error">
                      无法加载项目类型，请稍后重试或检查项目单配置
                    </span>
                  )}
                  {!projectTypes.isLoading && projectTypes.data?.length === 0 && (
                    <span className="field-error">
                      暂无启用的项目类型，请先在项目单配置中维护
                    </span>
                  )}
                  {form.formState.errors.project_type && (
                    <span className="field-error">
                      {form.formState.errors.project_type.message}
                    </span>
                  )}
                </label>
              )}
              {createMode === "adhoc" && (
                <p className="text-sm leading-6 text-slate-500">
                  临时编标会创建轻量工作区并自动分配编号；默认沿用组织启用的项目类型以复用招标模板与校验能力，不进入完整项目台账视角。
                </p>
              )}
              {createMode === "managed" && (
                <p className="text-sm leading-6 text-slate-500">
                  项目编号将按组织规则自动生成（项目类型 + 日期 + 流水号）；项目说明可在上传依据材料并完成解析后自动补齐。
                </p>
              )}
              {createProject.error && <ErrorNotice error={createProject.error} />}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={createProject.isPending}
                  onClick={closeCreateDialog}
                >
                  取消
                </button>
                <button className="primary-button" type="submit" disabled={createProject.isPending}>
                  {createMode === "managed"
                    ? createProject.isPending
                      ? "创建中…"
                      : "创建并进入项目"
                    : createProject.isPending
                      ? "创建中…"
                      : "开始编标"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {projectToDelete && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-slate-950/30 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteDialog();
          }}
        >
          <section
            aria-describedby="delete-project-description"
            aria-labelledby="delete-project-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl"
            role="dialog"
          >
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-semibold text-slate-900" id="delete-project-title">
                {deleteSubmitted
                  ? "删除申请已提交"
                  : isAdhocProject(projectToDelete)
                    ? "申请删除临时编标"
                    : "申请删除项目"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500" id="delete-project-description">
                {deleteSubmitted
                  ? "申请已进入审批队列。管理员在「运营配置 → 申请审批」通过后才会真正删除，删除后无法恢复。"
                  : "删除需先提交申请并经审批通过后才会执行。通过后将永久删除相关上传文件、解析结果、字段证据、生成记录和定稿文件。"}
              </p>
            </div>
            <div className="p-6">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <div className="font-semibold">{projectToDelete.name}</div>
                <div className="mt-1">
                  项目编号：
                  <span className="font-mono font-semibold">{projectToDelete.code}</span>
                </div>
              </div>

              {deleteSubmitted ? (
                <div className="mt-6 flex justify-end gap-2">
                  <Link className="secondary-button" to="/admin/approvals">
                    查看申请审批
                  </Link>
                  <button className="primary-button" type="button" onClick={closeDeleteDialog}>
                    知道了
                  </button>
                </div>
              ) : (
                <>
                  <label className="form-label mt-4 block">
                    删除原因
                    <textarea
                      className="form-input mt-2 min-h-24"
                      value={deleteReason}
                      onChange={(event) => setDeleteReason(event.target.value)}
                      placeholder="请说明申请删除的原因"
                    />
                  </label>
                  <label className="form-label mt-4 block">
                    确认码（请输入项目编号）
                    <input
                      className="form-input mt-2 font-mono"
                      value={confirmationCode}
                      onChange={(event) => setConfirmationCode(event.target.value)}
                      placeholder={projectToDelete.code}
                      autoComplete="off"
                    />
                  </label>
                  {requestDeletion.error && (
                    <div className="mt-4">
                      <ErrorNotice error={requestDeletion.error} />
                    </div>
                  )}
                  <div className="mt-6 flex justify-end gap-2">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={requestDeletion.isPending}
                      onClick={closeDeleteDialog}
                    >
                      取消
                    </button>
                    <button
                      className="inline-flex min-h-10 items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        requestDeletion.isPending ||
                        deleteReason.trim().length < 2 ||
                        confirmationCode.trim() !== projectToDelete.code
                      }
                      type="button"
                      onClick={() =>
                        requestDeletion.mutate({
                          project: projectToDelete,
                          code: confirmationCode.trim(),
                          reason: deleteReason.trim(),
                        })
                      }
                    >
                      {requestDeletion.isPending ? "提交中…" : "提交删除申请"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function ProjectOverviewPage() {
  const { projectId = "" } = useParams();
  const projectTypes = useProjectTypes(false);
  const [display, setDisplay] = useState<StageDisplayPreference>(() => {
    return loadProjectStageDisplay(projectId) ?? loadDefaultStageDisplay();
  });
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    setDisplay(loadProjectStageDisplay(projectId) ?? loadDefaultStageDisplay());
    setFilterOpen(false);
  }, [projectId]);

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

  const allNodes = useMemo(() => buildLifecycleNodes(stages.data), [stages.data]);
  const visibleNodes = useMemo(
    () => allNodes.filter((node) => display.keys.includes(node.key)),
    [allNodes, display.keys],
  );
  const usingOverride = Boolean(loadProjectStageDisplay(projectId));
  const presetLabel =
    display.preset === "custom"
      ? "自定义"
      : DISPLAY_PRESETS[display.preset as Exclude<DisplayPresetId, "custom">]?.label ?? "自定义";

  function applyDisplay(next: StageDisplayPreference, persistProject = true) {
    const normalized: StageDisplayPreference = {
      preset: matchPreset(next.keys),
      keys: next.keys,
    };
    setDisplay(normalized);
    if (persistProject) saveProjectStageDisplay(projectId, normalized);
  }

  function applyPreset(preset: Exclude<DisplayPresetId, "custom">) {
    applyDisplay(preferenceFromPreset(preset));
  }

  function toggleKey(key: LifecycleStageKey) {
    const selected = new Set(display.keys);
    if (selected.has(key)) {
      if (selected.size === 1) return;
      selected.delete(key);
    } else {
      selected.add(key);
    }
    applyDisplay({
      preset: "custom",
      keys: LIFECYCLE_KEYS.filter((item) => selected.has(item)),
    });
  }

  function resetToOrgDefault() {
    clearProjectStageDisplay(projectId);
    setDisplay(loadDefaultStageDisplay());
  }

  if (project.isLoading || stages.isLoading) return <FullPageMessage title="正在加载项目" />;
  if (project.error) return <ErrorNotice error={project.error} />;
  if (stages.error) return <ErrorNotice error={stages.error} />;
  const projectTypeLabel =
    projectTypes.data?.find((item) => item.code === project.data?.project_type)?.name ??
    project.data?.project_type ??
    "-";
  const adhoc = project.data?.workspace_kind === "adhoc";
  return (
    <>
      <PageHeader
        title={project.data?.name ?? "项目"}
        description={
          adhoc
            ? `${isTemporaryProjectCode(project.data?.code) ? "临时编号" : project.data?.code} · 临时编标工作区`
            : `${isTemporaryProjectCode(project.data?.code) ? "编号待从材料解析" : project.data?.code} · 项目全生命周期推进`
        }
        actions={
          <div className="flex gap-2">
            {adhoc && (
              <Link className="primary-button" to={`/projects/${projectId}/stages/tender/basics`}>
                进入招标编标
              </Link>
            )}
            <Link className="secondary-button" to="/projects?kind=managed">
              返回项目列表
            </Link>
          </div>
        }
      />
      {adhoc && (
        <Card className="mb-6 border-amber-200 bg-amber-50/40">
          <div className="text-sm leading-6 text-amber-900">
            这是<strong>临时编标</strong>工作区：适合上传已有招标文件做检查、套用模板或快速起草，不按完整项目台账管理。
          </div>
        </Card>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={adhoc ? "工作区类型" : "项目状态"}
          value={adhoc ? "临时编标" : statusLabel(project.data?.status ?? "-")}
        />
        <Metric label="项目类型" value={projectTypeLabel} />
        <Metric label="当前修订" value={`R${project.data?.revision ?? 1}`} />
        <Card className="relative">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-slate-500">展示范围</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{presetLabel}</div>
              <div className="mt-1 text-xs text-slate-400">
                显示 {display.keys.length}/{LIFECYCLE_KEYS.length} 个阶段
                {usingOverride ? " · 本项目已覆盖" : " · 跟随系统默认"}
              </div>
            </div>
            <button
              type="button"
              className="secondary-button !min-h-8 !px-3 !py-1 text-xs"
              onClick={() => setFilterOpen((open) => !open)}
              aria-expanded={filterOpen}
            >
              {filterOpen ? "收起" : "筛选"}
            </button>
          </div>
          {filterOpen && (
            <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
              <div className="mb-3 flex flex-wrap gap-2">
                {(Object.entries(DISPLAY_PRESETS) as Array<
                  [
                    Exclude<DisplayPresetId, "custom">,
                    (typeof DISPLAY_PRESETS)[Exclude<DisplayPresetId, "custom">],
                  ]
                >).map(([id, preset]) => (
                  <button
                    key={id}
                    type="button"
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      display.preset === id
                        ? "bg-[#155AA8] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                    onClick={() => applyPreset(id)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {allNodes.map((node) => (
                  <label
                    key={node.key}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={display.keys.includes(node.key)}
                      onChange={() => toggleKey(node.key)}
                    />
                    <span className="text-slate-700">{node.name}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
                <button type="button" className="text-button" onClick={resetToOrgDefault}>
                  恢复系统默认
                </button>
                <Link className="text-button" to="/admin/stage-display">
                  系统常态设置
                </Link>
              </div>
            </div>
          )}
        </Card>
      </div>
      <ProjectStageFlow projectId={projectId} nodes={visibleNodes} adhoc={adhoc} />
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
