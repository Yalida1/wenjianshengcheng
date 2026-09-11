import type { Project, Stage } from "../api/client";
import {
  buildLifecycleNodes,
  resolveNodeHref,
  type LifecycleNode,
} from "../app/projectLifecycle";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function isAdhocProject(project: Pick<Project, "workspace_kind">): boolean {
  return project.workspace_kind === "adhoc";
}

export function isTemporaryProjectCode(code: string | null | undefined): boolean {
  return Boolean(code && /^TMP-\d+(?:-\d+)?$/.test(code));
}

export function countManagedActive(projects: Project[]): number {
  return projects.filter(
    (project) => !isAdhocProject(project) && project.status === "active",
  ).length;
}

export function countAdhoc(projects: Project[]): number {
  return projects.filter((project) => isAdhocProject(project)).length;
}

export function countUpdatedInLastWeek(projects: Project[], now = Date.now()): number {
  return projects.filter((project) => {
    const updated = Date.parse(project.updated_at);
    return Number.isFinite(updated) && now - updated <= WEEK_MS;
  }).length;
}

export function sortProjectsByUpdated(projects: Project[]): Project[] {
  return [...projects].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

export type WorkbenchContinueAction = {
  href: string;
  label: string;
  stageName: string;
  statusLabel: string;
};

/** Resolve the primary continue action for a project on the workbench. */
export function resolveWorkbenchContinueAction(
  project: Pick<Project, "id" | "workspace_kind">,
  stages: Stage[] | undefined,
): WorkbenchContinueAction {
  if (isAdhocProject(project)) {
    return {
      href: `/projects/${project.id}/stages/tender/basics`,
      label: "进入招标基础数据",
      stageName: "招投标",
      statusLabel: "临时编标",
    };
  }

  const nodes = buildLifecycleNodes(stages);
  const current = nodes.find((node) => node.phase === "current");
  const fallback =
    current ??
    nodes.find((node) => node.enterable && node.phase !== "done") ??
    nodes.find((node) => node.enterable);

  if (fallback) {
    const href = resolveNodeHref(fallback, project.id);
    if (href) {
      return {
        href,
        label: fallback.actionLabel ? `继续：${fallback.actionLabel}` : `进入${fallback.name}`,
        stageName: fallback.name,
        statusLabel: fallback.statusLabel,
      };
    }
  }

  return {
    href: `/projects/${project.id}`,
    label: "打开项目概览",
    stageName: "项目概览",
    statusLabel: "待推进",
  };
}

export function currentStageSummary(
  project: Pick<Project, "id" | "workspace_kind">,
  stages: Stage[] | undefined,
): { stageName: string; statusLabel: string } {
  const action = resolveWorkbenchContinueAction(project, stages);
  return { stageName: action.stageName, statusLabel: action.statusLabel };
}

export function pickCurrentLifecycleNode(nodes: LifecycleNode[]): LifecycleNode | undefined {
  return (
    nodes.find((node) => node.phase === "current") ??
    nodes.find((node) => node.enterable && node.phase !== "done")
  );
}
