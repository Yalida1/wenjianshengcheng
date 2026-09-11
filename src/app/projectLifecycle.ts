import type { Stage } from "../api/client";

/** 项目全生命周期阶段（前端流程模型）。 */
export type LifecycleStageKey =
  | "demand"
  | "requirement"
  | "feasibility"
  | "tender"
  | "contract"
  | "implementation"
  | "acceptance"
  | "archive";

export type LifecyclePhase = "done" | "current" | "upcoming" | "blocked";

export type LifecycleStageRole = "tender_basis" | "produce" | "fulfill" | "close";

export type LifecycleStageDef = {
  key: LifecycleStageKey;
  name: string;
  detail: string;
  role: LifecycleStageRole;
  /** 对应后端 stage 键；空表示流程占位，工作台尚未开放 */
  backendKey?: "demand" | "requirement" | "feasibility" | "tender" | "contract";
  /** 面向招标定稿的说明 */
  tenderBasisHint?: string;
};

export const PROJECT_LIFECYCLE: LifecycleStageDef[] = [
  {
    key: "demand",
    name: "项目需求",
    detail: "上传需求说明等材料，由大模型解析提取关键信息",
    role: "tender_basis",
    backendKey: "demand",
    tenderBasisHint: "本阶段仅做材料上传与解析，不进入招标文件编写。",
  },
  {
    key: "requirement",
    name: "建议书",
    detail: "上传项目建议书材料，由大模型解析建设目标与范围",
    role: "tender_basis",
    backendKey: "requirement",
    tenderBasisHint: "本阶段仅做材料上传与解析，解析结果可供后续招标引用。",
  },
  {
    key: "feasibility",
    name: "可行性研究报告",
    detail: "上传可研报告材料，由大模型解析方案、投资与边界",
    role: "tender_basis",
    backendKey: "feasibility",
    tenderBasisHint: "本阶段仅做材料上传与解析，解析结果可供后续招标引用。",
  },
  {
    key: "tender",
    name: "招投标",
    detail: "汇入上游依据，生成招标文件并完成审校定稿",
    role: "produce",
    backendKey: "tender",
  },
  {
    key: "contract",
    name: "合同",
    detail: "合同主体、范围、金额、期限和付款安排",
    role: "produce",
    backendKey: "contract",
  },
  {
    key: "implementation",
    name: "实施",
    detail: "履约执行、进度协同与变更记录",
    role: "fulfill",
  },
  {
    key: "acceptance",
    name: "验收",
    detail: "交付核验、问题闭环与验收结论",
    role: "fulfill",
  },
  {
    key: "archive",
    name: "归档",
    detail: "资料归集、版本封存与项目结案",
    role: "close",
  },
];

export const TENDER_BASIS_KEYS: LifecycleStageKey[] = PROJECT_LIFECYCLE.filter(
  (item) => item.role === "tender_basis",
).map((item) => item.key);

export const LIFECYCLE_KEYS = PROJECT_LIFECYCLE.map((item) => item.key);

export type DisplayPresetId = "full" | "drafting" | "tender_contract" | "delivery" | "custom";

export const DISPLAY_PRESETS: Record<
  Exclude<DisplayPresetId, "custom">,
  { label: string; hint: string; keys: LifecycleStageKey[] }
> = {
  full: {
    label: "完整链路",
    hint: "需求 → 归档全过程",
    keys: [...LIFECYCLE_KEYS],
  },
  drafting: {
    label: "编制主链路",
    hint: "需求至合同编制",
    keys: ["demand", "requirement", "feasibility", "tender", "contract"],
  },
  tender_contract: {
    label: "招投标与合同",
    hint: "聚焦采购与签约",
    keys: ["tender", "contract"],
  },
  delivery: {
    label: "履约交付",
    hint: "合同后实施至归档",
    keys: ["contract", "implementation", "acceptance", "archive"],
  },
};

const DEFAULT_PRESET_STORAGE_KEY = "wjsg.lifecycle.defaultDisplay";
const PROJECT_OVERRIDE_PREFIX = "wjsg.lifecycle.projectDisplay.";

export type StageDisplayPreference = {
  preset: DisplayPresetId;
  keys: LifecycleStageKey[];
};

export function defaultStageDisplay(): StageDisplayPreference {
  return {
    preset: "full",
    keys: [...DISPLAY_PRESETS.full.keys],
  };
}

function parsePreference(raw: string | null): StageDisplayPreference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StageDisplayPreference;
    if (!parsed || !Array.isArray(parsed.keys)) return null;
    const keys = parsed.keys.filter((key): key is LifecycleStageKey =>
      (LIFECYCLE_KEYS as string[]).includes(key),
    );
    if (!keys.length) return null;
    return { preset: parsed.preset ?? "custom", keys };
  } catch {
    return null;
  }
}

export function loadDefaultStageDisplay(): StageDisplayPreference {
  if (typeof window === "undefined") return defaultStageDisplay();
  return parsePreference(localStorage.getItem(DEFAULT_PRESET_STORAGE_KEY)) ?? defaultStageDisplay();
}

export function saveDefaultStageDisplay(preference: StageDisplayPreference): void {
  localStorage.setItem(DEFAULT_PRESET_STORAGE_KEY, JSON.stringify(preference));
}

export function loadProjectStageDisplay(projectId: string): StageDisplayPreference | null {
  if (typeof window === "undefined") return null;
  return parsePreference(localStorage.getItem(PROJECT_OVERRIDE_PREFIX + projectId));
}

export function saveProjectStageDisplay(projectId: string, preference: StageDisplayPreference): void {
  localStorage.setItem(PROJECT_OVERRIDE_PREFIX + projectId, JSON.stringify(preference));
}

export function clearProjectStageDisplay(projectId: string): void {
  localStorage.removeItem(PROJECT_OVERRIDE_PREFIX + projectId);
}

export function resolveDisplayPreference(projectId?: string): StageDisplayPreference {
  if (projectId) {
    const override = loadProjectStageDisplay(projectId);
    if (override) return override;
  }
  return loadDefaultStageDisplay();
}

export function matchPreset(keys: LifecycleStageKey[]): DisplayPresetId {
  const normalized = keys.join(",");
  for (const [id, preset] of Object.entries(DISPLAY_PRESETS) as Array<
    [Exclude<DisplayPresetId, "custom">, (typeof DISPLAY_PRESETS)[Exclude<DisplayPresetId, "custom">]]
  >) {
    if (preset.keys.join(",") === normalized) return id;
  }
  return "custom";
}

export function preferenceFromPreset(preset: Exclude<DisplayPresetId, "custom">): StageDisplayPreference {
  return { preset, keys: [...DISPLAY_PRESETS[preset].keys] };
}

export type LifecycleNode = LifecycleStageDef & {
  index: number;
  phase: LifecyclePhase;
  status: string;
  statusLabel: string;
  enterable: boolean;
  /** 可跳转完善/引用的路径（依据阶段可直达招标材料） */
  actionHref?: string;
  actionLabel?: string;
  staleReason?: string | null;
  finalized: boolean;
  backendStage?: Stage;
};

function backendProgressRank(status: string | undefined): number {
  if (!status || status === "not_started") return 0;
  if (status === "finalized") return 2;
  return 1;
}

function basisStatusLabel(rank: number, hasBackend: boolean): string {
  if (rank >= 2) return "已定稿·可引用";
  if (rank === 1) return "编制中";
  if (!hasBackend) return "待补充依据";
  return "待编制";
}

/** 根据后端阶段状态推导全链路推进相位。 */
export function buildLifecycleNodes(backendStages: Stage[] | undefined): LifecycleNode[] {
  const byBackend = new Map((backendStages ?? []).map((stage) => [stage.stage, stage]));

  const ranks = PROJECT_LIFECYCLE.map((def) => {
    if (!def.backendKey) return 0;
    return backendProgressRank(byBackend.get(def.backendKey)?.status);
  });

  const tenderIndex = PROJECT_LIFECYCLE.findIndex((def) => def.key === "tender");
  const tenderRank = ranks[tenderIndex] ?? 0;
  const basisDefs = PROJECT_LIFECYCLE.filter((def) => def.role === "tender_basis");
  const basisAllReady = basisDefs.every((def) => {
    if (!def.backendKey) return true;
    return backendProgressRank(byBackend.get(def.backendKey)?.status) >= 2;
  });
  const anyProduceProgress = PROJECT_LIFECYCLE.some(
    (def, index) => def.role !== "tender_basis" && ranks[index] > 0,
  );

  const activeBackendIndex = PROJECT_LIFECYCLE.findIndex((_, index) => ranks[index] === 1);
  const firstPendingProduceIndex = PROJECT_LIFECYCLE.findIndex(
    (def, index) => def.role !== "tender_basis" && def.backendKey && ranks[index] === 0,
  );
  const allBackendDone = PROJECT_LIFECYCLE.every(
    (def, index) => !def.backendKey || ranks[index] === 2,
  );

  let currentIndex = PROJECT_LIFECYCLE.findIndex((def) => def.key === "demand");
  if (activeBackendIndex >= 0) {
    currentIndex = activeBackendIndex;
  } else if (allBackendDone) {
    currentIndex = PROJECT_LIFECYCLE.findIndex((def) => def.key === "implementation");
  } else if (tenderRank === 0 && (basisAllReady || anyProduceProgress)) {
    currentIndex = tenderIndex;
  } else if (firstPendingProduceIndex >= 0 && anyProduceProgress) {
    currentIndex = firstPendingProduceIndex;
  } else if (!basisDefs.some((def) => def.backendKey && backendProgressRank(byBackend.get(def.backendKey)?.status) > 0)) {
    // 尚无依据进度：聚焦依据簇第一项
    currentIndex = PROJECT_LIFECYCLE.findIndex((def) => def.role === "tender_basis");
  } else {
    // 有依据在编或已定稿，但招标未启动：当前落在招标
    currentIndex = tenderIndex;
  }

  return PROJECT_LIFECYCLE.map((def, index) => {
    const backendStage = def.backendKey ? byBackend.get(def.backendKey) : undefined;
    const rank = def.backendKey ? backendProgressRank(backendStage?.status) : 0;

    let phase: LifecyclePhase = "upcoming";
    if (def.role === "tender_basis") {
      if (rank >= 2) phase = "done";
      else if (rank === 1 || index === currentIndex) phase = "current";
      else phase = "upcoming";
    } else if (rank >= 2) {
      phase = "done";
    } else if (rank === 1 || index === currentIndex) {
      phase = "current";
    } else if (index < currentIndex) {
      phase = "done";
    }

    const finalized = backendStage?.status === "finalized" || (phase === "done" && !def.backendKey);
    const status =
      backendStage?.status ??
      (phase === "done" ? "completed" : phase === "current" ? "in_progress" : "not_started");

    let actionHref: string | undefined;
    let actionLabel: string | undefined;
    if (def.backendKey && backendStage) {
      actionHref = `/projects/{id}/stages/${def.backendKey}/${
        def.role === "tender_basis" ? "files" : def.backendKey === "tender" ? "basics" : "source"
      }`;
      actionLabel = rank >= 2 ? "回看阶段" : phase === "current" ? "进入并继续" : "进入阶段";
    }

    return {
      ...def,
      index,
      phase,
      status,
      statusLabel:
        def.role === "tender_basis"
          ? basisStatusLabel(rank, Boolean(def.backendKey))
          : status === "completed"
            ? "已完成"
            : status === "in_progress"
              ? "进行中"
              : "未开始",
      enterable: Boolean(actionHref),
      actionHref,
      actionLabel,
      staleReason: backendStage?.stale_reason,
      finalized: Boolean(finalized),
      backendStage,
    };
  });
}

export function resolveNodeHref(node: LifecycleNode, projectId: string): string | undefined {
  return node.actionHref?.replace("{id}", projectId);
}

export function splitLifecycleNodes(nodes: LifecycleNode[]): {
  basisNodes: LifecycleNode[];
  downstreamNodes: LifecycleNode[];
} {
  return {
    basisNodes: nodes.filter((node) => node.role === "tender_basis"),
    downstreamNodes: nodes.filter((node) => node.role !== "tender_basis"),
  };
}

export function lifecycleProgress(nodes: LifecycleNode[]): {
  doneCount: number;
  total: number;
  percent: number;
  currentName: string;
} {
  const doneCount = nodes.filter((node) => node.phase === "done").length;
  const current = nodes.find((node) => node.phase === "current");
  const total = nodes.length;
  const percent = total ? Math.round(((doneCount + (current ? 0.45 : 0)) / total) * 100) : 0;
  return {
    doneCount,
    total,
    percent: Math.min(100, percent),
    currentName: current?.name ?? (doneCount === total ? "已全部完成" : "待启动"),
  };
}
