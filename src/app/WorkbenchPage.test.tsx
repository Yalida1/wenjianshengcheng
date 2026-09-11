import { describe, expect, it } from "vitest";
import type { Project, Stage } from "../api/client";
import {
  countAdhoc,
  countManagedActive,
  countUpdatedInLastWeek,
  resolveWorkbenchContinueAction,
  sortProjectsByUpdated,
} from "../lib/workbench";
import { resolveNodeHref, buildLifecycleNodes } from "./projectLifecycle";

function project(partial: Partial<Project> & Pick<Project, "id" | "name">): Project {
  return {
    code: partial.code ?? `P-${partial.id}`,
    status: partial.status ?? "active",
    workspace_kind: partial.workspace_kind ?? "managed",
    project_type: "general",
    revision: 1,
    organization_id: "org",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: partial.updated_at ?? "2026-01-08T00:00:00Z",
    ...partial,
  } as Project;
}

function stage(partial: Partial<Stage> & Pick<Stage, "stage" | "status">): Stage {
  return {
    id: `${partial.stage}-id`,
    project_id: "p1",
    revision: 1,
    stale_reason: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  } as Stage;
}

describe("workbench helpers", () => {
  it("counts managed active, adhoc and weekly updates", () => {
    const now = Date.parse("2026-01-10T00:00:00Z");
    const items = [
      project({ id: "1", name: "A", workspace_kind: "managed", status: "active" }),
      project({ id: "2", name: "B", workspace_kind: "managed", status: "archived" }),
      project({
        id: "3",
        name: "C",
        workspace_kind: "adhoc",
        status: "active",
        updated_at: "2026-01-09T12:00:00Z",
      }),
      project({
        id: "4",
        name: "D",
        workspace_kind: "managed",
        status: "active",
        updated_at: "2025-12-01T00:00:00Z",
      }),
    ];
    expect(countManagedActive(items)).toBe(2);
    expect(countAdhoc(items)).toBe(1);
    expect(countUpdatedInLastWeek(items, now)).toBe(3);
  });

  it("sorts projects by updated_at descending", () => {
    const items = [
      project({ id: "old", name: "Old", updated_at: "2026-01-01T00:00:00Z" }),
      project({ id: "new", name: "New", updated_at: "2026-01-09T00:00:00Z" }),
    ];
    expect(sortProjectsByUpdated(items).map((item) => item.id)).toEqual(["new", "old"]);
  });
});

describe("resolveWorkbenchContinueAction", () => {
  it("sends adhoc projects to tender basics", () => {
    const action = resolveWorkbenchContinueAction(
      project({ id: "adhoc-1", name: "临时", workspace_kind: "adhoc" }),
      undefined,
    );
    expect(action.href).toBe("/projects/adhoc-1/stages/tender/basics");
    expect(action.label).toContain("基础数据");
  });

  it("routes managed current basis stage to files", () => {
    const stages = [
      stage({ stage: "demand", status: "in_progress" }),
      stage({ stage: "requirement", status: "not_started" }),
      stage({ stage: "feasibility", status: "not_started" }),
      stage({ stage: "tender", status: "not_started" }),
      stage({ stage: "contract", status: "not_started" }),
    ];
    const action = resolveWorkbenchContinueAction(
      project({ id: "m1", name: "正式" }),
      stages,
    );
    expect(action.href).toBe("/projects/m1/stages/demand/files");
    expect(action.stageName).toBe("项目需求");
  });

  it("routes managed tender current stage to basics", () => {
    const stages = [
      stage({ stage: "demand", status: "finalized" }),
      stage({ stage: "requirement", status: "finalized" }),
      stage({ stage: "feasibility", status: "finalized" }),
      stage({ stage: "tender", status: "in_progress" }),
      stage({ stage: "contract", status: "not_started" }),
    ];
    const action = resolveWorkbenchContinueAction(
      project({ id: "m2", name: "招标中" }),
      stages,
    );
    expect(action.href).toBe("/projects/m2/stages/tender/basics");
    expect(action.stageName).toBe("招投标");
  });

  it("uses resolveNodeHref for contract source entry", () => {
    const stages = [
      stage({ stage: "demand", status: "finalized" }),
      stage({ stage: "requirement", status: "finalized" }),
      stage({ stage: "feasibility", status: "finalized" }),
      stage({ stage: "tender", status: "finalized" }),
      stage({ stage: "contract", status: "in_progress" }),
    ];
    const nodes = buildLifecycleNodes(stages);
    const current = nodes.find((node) => node.phase === "current");
    expect(current?.backendKey).toBe("contract");
    expect(resolveNodeHref(current!, "m3")).toBe("/projects/m3/stages/contract/source");

    const action = resolveWorkbenchContinueAction(project({ id: "m3", name: "合同中" }), stages);
    expect(action.href).toBe("/projects/m3/stages/contract/source");
  });
});
