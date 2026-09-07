import { useState } from "react";
import { Badge, Button, Dialog, Icon, PageHeader } from "../components/UI";
import { useMockStore } from "../mock/store";
import type { Page } from "../types";

const projects = [
  {
    name: "某省公司中心机房节能改造项目",
    id: "XM-2026-0048",
    owner: "王明远",
    stages: ["done", "confirm", "none", "none"],
    updated: "今天 14:20",
  },
  {
    name: "城区政务云资源池扩容项目",
    id: "XM-2026-0036",
    owner: "李梓涵",
    stages: ["done", "done", "confirm", "none"],
    updated: "昨天 16:42",
  },
  {
    name: "传输网核心设备更新工程",
    id: "XM-2026-0021",
    owner: "陈昊",
    stages: ["done", "done", "done", "failed"],
    updated: "2026-09-03",
  },
];
const names = ["需求说明", "可研报告", "招标文件", "合同"];
function Progress({ stages }: { stages: string[] }) {
  const meta: Record<string, [string, "check" | "clock" | "circle" | "alert"]> = {
    done: ["已定稿", "check"],
    confirm: ["字段待确认", "clock"],
    none: ["未开始", "circle"],
    failed: ["失败", "alert"],
  };
  const color: Record<string, string> = {
    done: "bg-[#ECF8F2] text-[#168A5B]",
    confirm: "bg-[#FFF7E6] text-[#A86512]",
    none: "bg-slate-100 text-slate-400",
    failed: "bg-[#FEF1F2] text-[#C2414B]",
  };
  return (
    <div className="flex items-center gap-1.5">
      {stages.map((s, i) => (
        <div className="flex items-center gap-1.5" key={names[i]}>
          <span
            title={`${names[i]}：${meta[s][0]}`}
            className={`grid size-6 place-items-center rounded-full ${color[s]}`}
          >
            <Icon name={meta[s][1]} size={13} />
          </span>
          {i < 3 && <span className="h-px w-5 bg-slate-200" />}
        </div>
      ))}
    </div>
  );
}
function NewProject({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  return (
    <Dialog
      title="新建项目"
      description="创建后可从需求说明或项目建议书开始编制。"
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-5">
        <label className="col-span-2 text-[13px] font-medium">
          项目名称 <b className="text-[#C2414B]">*</b>
          <input
            autoFocus
            className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
            placeholder="例如：某省公司中心机房节能改造项目"
          />
        </label>
        {["项目编号", "所属组织"].map((x, i) => (
          <label key={x} className="text-[13px] font-medium">
            {x} <b className="text-[#C2414B]">*</b>
            {i ? (
              <select className="mt-2 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                <option>省公司信息技术部</option>
              </select>
            ) : (
              <input
                className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                placeholder="XM-2026-0049"
              />
            )}
          </label>
        ))}
        <label className="col-span-2 text-[13px] font-medium">
          负责人 <b className="text-[#C2414B]">*</b>
          <select className="mt-2 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
            <option>王明远</option>
          </select>
        </label>
        <label className="col-span-2 text-[13px] font-medium">
          项目说明
          <textarea
            className="mt-2 min-h-24 w-full resize-none rounded-lg border border-slate-300 p-3 text-sm"
            placeholder="简要说明项目背景、建设目标或文件编制范围。"
          />
        </label>
      </div>
      <div className="-mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button onClick={onCreate}>创建项目</Button>
      </div>
    </Dialog>
  );
}
export function ProjectListPage({ navigate }: { navigate: (p: Page) => void }) {
  const [newOpen, setNewOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="项目空间"
        sub="管理项目文件从需求说明到合同的链式生成过程。"
        action={
          <Button onClick={() => setNewOpen(true)}>
            <Icon name="plus" size={17} />
            新建项目
          </Button>
        }
      />
      <div className="mt-8 flex flex-wrap gap-3">
        <label className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" size={17} />
          </span>
          <input
            className="h-10 w-[272px] rounded-lg border border-slate-300 pl-10 text-sm"
            placeholder="搜索项目名称或编号"
          />
        </label>
        <select className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-600">
          <option>全部状态</option>
        </select>
        <select className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-600">
          <option>最近更新时间</option>
        </select>
      </div>
      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,1fr)_100px_250px_110px_62px] gap-5 border-b border-slate-100 bg-slate-50/70 px-6 py-3 text-xs text-slate-500 xl:grid">
          <span>项目</span>
          <span>负责人</span>
          <span>文件阶段</span>
          <span className="text-right">最近更新</span>
          <span className="text-right">操作</span>
        </div>
        {projects.map((p) => (
          <article
            key={p.id}
            className="border-b border-slate-100 px-6 py-5 last:border-0 hover:bg-[#FBFCFE]"
          >
            <div className="hidden grid-cols-[minmax(0,1fr)_100px_250px_110px_62px] items-center gap-5 xl:grid">
              <div>
                <button
                  onClick={() => navigate("project-detail")}
                  className="text-left text-base font-semibold text-slate-800 hover:text-[#24457C]"
                >
                  {p.name}
                </button>
                <p className="mt-2 font-mono text-xs text-slate-500">{p.id}</p>
              </div>
              <span className="text-sm">{p.owner}</span>
              <div>
                <Progress stages={p.stages} />
                <p className="mt-2 text-xs text-slate-500">需求 · 可研 · 招标 · 合同</p>
              </div>
              <span className="text-right text-[13px] text-slate-500">{p.updated}</span>
              <Button
                onClick={() => navigate("project-detail")}
                variant="ghost"
                className="px-1 text-[#2E5495]"
              >
                进入
                <Icon name="arrow" size={14} />
              </Button>
            </div>
            <div className="xl:hidden">
              <button
                onClick={() => navigate("project-detail")}
                className="text-left text-base font-semibold text-slate-800"
              >
                {p.name}
              </button>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-500">
                <span>{p.id}</span>
                <span>负责人：{p.owner}</span>
                <span>{p.updated}</span>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <Progress stages={p.stages} />
                <Button
                  onClick={() => navigate("project-detail")}
                  variant="ghost"
                  className="px-1 text-[#2E5495]"
                >
                  进入
                  <Icon name="arrow" size={14} />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </section>
      {newOpen && (
        <NewProject
          onClose={() => setNewOpen(false)}
          onCreate={() => {
            setNewOpen(false);
            navigate("project-detail");
          }}
        />
      )}
    </>
  );
}

function getStages(
  store: ReturnType<typeof useMockStore>,
  tenderFinalized: boolean,
  generationRunning: boolean,
) {
  const req = store.state.requirement;
  const feas = store.state.feasibility;

  const reqStatus =
    req.status === "finalized" ? "已定稿" : req.status === "not_started" ? "未开始" : "进行中";
  const reqTone = (
    req.status === "finalized" ? "success" : req.status === "not_started" ? "neutral" : "warning"
  ) as "success" | "neutral" | "warning";
  const reqAction = req.status === "finalized" ? "查看文档" : "开始编制";

  const feasStatus =
    feas.status === "finalized"
      ? "已定稿"
      : feas.status === "fields_confirmed"
        ? "字段待确认"
        : feas.status === "not_started"
          ? "未开始"
          : "进行中";
  const feasTone = (
    feas.status === "finalized" ? "success" : feas.status === "not_started" ? "neutral" : "warning"
  ) as "success" | "neutral" | "warning";
  const feasAction =
    feas.status === "finalized"
      ? "查看报告"
      : feas.status === "fields_confirmed"
        ? "继续确认"
        : "开始编制";

  return [
    {
      num: "01",
      name: "需求说明 / 项目建议书",
      status: reqStatus,
      tone: reqTone,
      source: req.status === "finalized" ? "结构化录入 / 用户上传" : "尚未选择",
      version: req.version || "尚未生成",
      blocks: req.status === "finalized" ? "无" : "—",
      action: reqAction,
      hint: req.status === "finalized" ? `定稿于 ${req.finalizedAt || "2026-09-05"}` : "",
    },
    {
      num: "02",
      name: "可研报告",
      status: feasStatus,
      tone: feasTone,
      source: feas.status === "not_started" ? "等待选择输入来源" : "使用上游已定稿项目建议书",
      version: feas.version || "尚未生成",
      blocks:
        feas.status === "fields_confirmed"
          ? "2 个字段待确认"
          : feas.status === "finalized"
            ? "无"
            : "—",
      action: feasAction,
      hint:
        feas.status === "finalized"
          ? `定稿于 ${feas.finalizedAt || "2026-09-05"}`
          : feas.status !== "not_started"
            ? "可使用已定稿项目建议书，或上传已有材料"
            : "",
    },
    {
      num: "03",
      name: "招标文件",
      status: tenderFinalized ? "已定稿" : generationRunning ? "生成中" : "未开始",
      tone: (tenderFinalized ? "success" : generationRunning ? "info" : "neutral") as
        | "success"
        | "info"
        | "neutral",
      source: feas.status === "finalized" ? "可使用：可研报告 V1.3" : "等待选择输入来源",
      version: tenderFinalized ? "招标文件 V1.0" : generationRunning ? "生成中…" : "尚未生成",
      blocks: tenderFinalized ? "无" : "—",
      action: tenderFinalized ? "查看文档" : generationRunning ? "查看生成进度" : "选择输入",
      hint: tenderFinalized ? "定稿于 2026-09-05 15:06" : "可使用已定稿可研，或上传已有可研",
    },
    {
      num: "04",
      name: "合同",
      status: "未开始",
      tone: "neutral" as const,
      source: tenderFinalized ? "可用：招标文件 V1.0 已定稿" : "等待选择输入来源",
      version: "尚未生成",
      blocks: "—",
      action: "选择输入",
      hint: tenderFinalized ? "" : "可使用已定稿招标文件，或上传已有招标文件",
    },
  ];
}

export function ProjectDetailPage({
  navigate,
  generationRunning = false,
  tenderFinalized = false,
}: {
  navigate: (p: Page) => void;
  generationRunning?: boolean;
  tenderFinalized?: boolean;
}) {
  const [settings, setSettings] = useState(false);
  const store = useMockStore();
  const stages = getStages(store, tenderFinalized, generationRunning);
  return (
    <>
      {generationRunning && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#DCE7F7] bg-[#F2F6FC] px-5 py-3">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2E5495"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-spin shrink-0"
          >
            <path d="M21 12a9 9 0 1 1-9-9" />
            <path d="M21 3v9h-9" />
          </svg>
          <p className="flex-1 text-[13px] text-[#24457C]">
            <strong>招标文件正在后台生成。</strong>
            任务完成后将在消息中心提示。任务 ID：GEN-20260905-001
          </p>
          <button
            onClick={() => navigate("generation-progress")}
            className="h-8 rounded-lg border border-[#2E5495] px-3 text-xs font-medium text-[#2E5495] hover:bg-[#DCE7F7]"
          >
            查看进度
          </button>
        </div>
      )}
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="font-mono text-xs text-slate-500">XM-2026-0048</p>
          <h1 className="mt-2 text-[28px] font-semibold text-slate-900">
            某省公司中心机房节能改造项目
          </h1>
          <p className="mt-3 text-[13px] text-slate-500">负责人：王明远　最近更新：今天 14:20</p>
        </div>
        <Button onClick={() => setSettings(true)} variant="secondary">
          <Icon name="settings" size={16} />
          项目设置
        </Button>
      </div>
      <section className="mt-8">
        <h2 className="text-xl font-semibold text-slate-800">文件生成流程</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          下游阶段可使用上游已定稿文件，也可上传用户已有文件开始。
        </p>
        <div className="mt-5 grid grid-cols-2 gap-5 xl:grid-cols-4">
          {stages.map((s, i) => (
            <article
              className="relative rounded-xl border border-slate-200 bg-white p-5"
              key={s.num}
            >
              {i < 3 && (
                <span className="absolute left-[calc(50%+34px)] top-7 hidden h-px w-[calc(100%-48px)] bg-slate-300 xl:block" />
              )}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[11px] text-slate-400">阶段 {s.num}</p>
                  <h3 className="mt-2 min-h-12 text-base font-semibold leading-6">{s.name}</h3>
                </div>
                <Badge tone={s.tone}>{s.status}</Badge>
              </div>
              <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-[13px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">输入来源</dt>
                  <dd className="text-right">{s.source}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">最新版本</dt>
                  <dd className="text-right font-medium">{s.version}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">阻断项</dt>
                  <dd className={s.blocks === "无" ? "text-[#168A5B]" : "text-[#A86512]"}>
                    {s.blocks}
                  </dd>
                </div>
              </dl>
              {s.hint && (
                <p className="mt-4 border-l-2 border-[#DCE7F7] pl-3 text-xs leading-5 text-slate-500">
                  {s.hint}
                </p>
              )}
              <Button
                onClick={() => {
                  if (i === 0) {
                    const reqStatus = store.state.requirement.status;
                    if (reqStatus === "finalized") navigate("proposal-finalized");
                    else navigate("requirement-source-selection");
                  } else if (i === 1) {
                    const feasStatus = store.state.feasibility.status;
                    if (feasStatus === "finalized") navigate("feasibility-finalized");
                    else if (feasStatus === "generating" || feasStatus === "generated")
                      navigate("feasibility-generation-progress");
                    else if (feasStatus === "template_selected")
                      navigate("feasibility-generation-setup");
                    else if (feasStatus === "fields_confirmed")
                      navigate("feasibility-field-confirmation");
                    else navigate("feasibility-source-selection");
                  } else if (i === 2) {
                    if (tenderFinalized) navigate("document-preview");
                    else if (generationRunning) navigate("generation-progress");
                    else navigate("tender-source-selection");
                  } else if (i === 3) {
                    navigate("contract-source");
                  }
                }}
                variant="primary"
                className="mt-5 w-full"
              >
                {s.action}
                <Icon name="arrow" size={15} />
              </Button>
            </article>
          ))}
        </div>
      </section>
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        {["最近文档", "最近操作"].map((x, i) => (
          <section className="rounded-xl border border-slate-200 bg-white" key={x}>
            <h2 className="border-b border-slate-100 px-6 py-5 font-semibold">{x}</h2>
            <div className="px-6 py-5 text-sm text-slate-600">
              {i ? "王明远确认了「建设规模」字段" : "可行性研究报告 V1.3"}
              <p className="mt-1 text-xs text-slate-500">今天 14:20</p>
            </div>
          </section>
        ))}
      </div>
      {settings && (
        <Dialog
          title="项目设置"
          description="项目基础信息的设置入口。"
          onClose={() => setSettings(false)}
        >
          <div className="grid grid-cols-2 gap-5 text-sm">
            {[
              ["项目名称", "某省公司中心机房节能改造项目"],
              ["项目编号", "XM-2026-0048"],
              ["所属组织", "省公司信息技术部"],
              ["负责人", "王明远"],
            ].map(([k, v]) => (
              <label key={k} className="col-span-1 font-medium">
                {k}
                <input
                  defaultValue={v}
                  className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal"
                />
              </label>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setSettings(false)}>
              取消
            </Button>
            <Button onClick={() => setSettings(false)}>保存设置</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
