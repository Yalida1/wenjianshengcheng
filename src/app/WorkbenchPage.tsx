import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, apiError, type Project, type Stage } from "../api/client";
import {
  countAdhoc,
  countManagedActive,
  countUpdatedInLastWeek,
  currentStageSummary,
  isAdhocProject,
  isTemporaryProjectCode,
  resolveWorkbenchContinueAction,
  sortProjectsByUpdated,
} from "../lib/workbench";
import { ErrorNotice, FullPageMessage, useAuth } from "./Auth";
import { Card, PageHeader, StatusBadge } from "./Shell";

const CONTINUE_LIMIT = 3;
const RECENT_LIMIT = 8;

export function WorkbenchPage() {
  const { user } = useAuth();
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

  const items = projects.data ?? [];
  const sorted = sortProjectsByUpdated(items);
  const continueProjects = sorted.slice(0, CONTINUE_LIMIT);
  const recent = sorted.slice(0, RECENT_LIMIT);

  const stageQueries = useQueries({
    queries: continueProjects.map((project) => ({
      queryKey: ["stages", project.id],
      queryFn: async () => {
        const result = await api.GET("/api/v1/projects/{project_id}/stages", {
          params: { path: { project_id: project.id } },
        });
        if (result.error) throw apiError(result.error, result.response);
        return result.data as Stage[];
      },
      enabled: !isAdhocProject(project),
    })),
  });

  const stagesByProjectId = new Map<string, Stage[] | undefined>();
  continueProjects.forEach((project, index) => {
    stagesByProjectId.set(project.id, stageQueries[index]?.data);
  });

  const managedActive = countManagedActive(items);
  const adhocCount = countAdhoc(items);
  const weekUpdated = countUpdatedInLastWeek(items);

  return (
    <>
      <PageHeader
        title="工作台"
        description={`${user?.display_name ?? "您好"}，从这里继续推进依据材料、招标编制与合同。`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="primary-button" to="/projects?kind=managed">
              新建正式项目
            </Link>
            <Link className="secondary-button" to="/projects?kind=adhoc">
              临时编标
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Metric label="正式项目进行中" value={String(managedActive)} />
        <Metric label="临时编标" value={String(adhocCount)} />
        <Metric label="本周有更新" value={String(weekUpdated)} />
      </div>

      <Card className="mb-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">继续推进</h3>
            <p className="mt-1 text-sm text-slate-500">
              按最近更新列出待继续项目，并跳到正确的下一步入口。
            </p>
          </div>
        </div>

        {projects.isLoading && <FullPageMessage title="正在加载工作台" />}
        {projects.error && <ErrorNotice error={projects.error} />}
        {!projects.isLoading && !projects.error && continueProjects.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
            <p>暂无项目可继续。请先创建正式项目，或发起临时编标。</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link className="primary-button" to="/projects?kind=managed">
                新建正式项目
              </Link>
              <Link className="secondary-button" to="/projects?kind=adhoc">
                临时编标
              </Link>
            </div>
          </div>
        )}

        {continueProjects.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-3">
            {continueProjects.map((project, index) => {
              const adhoc = isAdhocProject(project);
              const stages = stagesByProjectId.get(project.id);
              const loading = !adhoc && stageQueries[index]?.isLoading;
              const action = resolveWorkbenchContinueAction(project, stages);
              return (
                <div
                  key={project.id}
                  className="flex h-full flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-blue-700">
                        {isTemporaryProjectCode(project.code)
                          ? "待从材料解析编号"
                          : project.code}
                      </div>
                      <div className="mt-1 truncate font-medium text-slate-900">{project.name}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        adhoc ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {adhoc ? "临时编标" : "正式项目"}
                    </span>
                  </div>
                  <div className="mt-3 text-sm text-slate-600">
                    {loading ? (
                      <span className="text-slate-400">正在识别当前阶段…</span>
                    ) : (
                      <>
                        当前：{action.stageName}
                        <span className="text-slate-400"> · {action.statusLabel}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link className="primary-button" to={action.href}>
                      {action.label}
                    </Link>
                    <Link className="secondary-button" to={`/projects/${project.id}`}>
                      概览
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <h3 className="text-base font-semibold text-slate-900">编制主链路</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          依据材料上传解析 → 招标基础数据 → 文档生成 → 文档确认 → 合同
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-500">
          <li>需求 / 建议书 / 可研仅做材料上传与解析，不进入招标文件编写。</li>
          <li>招标阶段固定三步：基础数据确认、文档生成、文档确认。</li>
          <li>实施 / 验收 / 归档为本期流程占位，工作台暂不开放入口。</li>
        </ul>
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">最近项目</h3>
            <Link className="text-sm text-blue-700 hover:underline" to="/projects?kind=managed">
              查看全部
            </Link>
          </div>
          {!projects.isLoading && !projects.error && recent.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
              暂无项目。
            </div>
          )}
          <div className="space-y-3">
            {recent.map((project) => {
              const adhoc = isAdhocProject(project);
              const stages = stagesByProjectId.get(project.id);
              const summary =
                stages || adhoc
                  ? currentStageSummary(project, stages)
                  : { stageName: "项目概览", statusLabel: "进入查看" };
              return (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3 transition hover:border-blue-200 hover:bg-blue-50/40"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs font-medium text-blue-700">
                        {isTemporaryProjectCode(project.code)
                          ? "待从材料解析编号"
                          : project.code}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          adhoc ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {adhoc ? "临时编标" : "正式项目"}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-medium text-slate-900">{project.name}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {summary.stageName} · {summary.statusLabel} · 更新于{" "}
                      {new Date(project.updated_at).toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <StatusBadge status={project.status} />
                </Link>
              );
            })}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-base font-semibold text-slate-900">快捷入口</h3>
          <div className="space-y-3">
            <QuickLink
              to="/projects?kind=managed"
              title="正式项目空间"
              description="创建与管理主链路项目"
            />
            <QuickLink
              to="/projects?kind=adhoc"
              title="临时编标"
              description="已有招标文件的检查与快速起草"
            />
            <QuickLink to="/templates" title="模板中心" description="查看与维护生成模板" />
          </div>
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <Link className="hover:text-blue-700 hover:underline" to="/field-dictionary">
              字段字典
            </Link>
            <Link className="hover:text-blue-700 hover:underline" to="/admin/users">
              系统管理
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </Card>
  );
}

function QuickLink({
  to,
  title,
  description,
}: {
  to: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-lg border border-slate-200 px-4 py-3 transition hover:border-blue-200 hover:bg-blue-50/40"
    >
      <div className="font-medium text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{description}</div>
    </Link>
  );
}
