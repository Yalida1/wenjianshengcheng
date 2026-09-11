import { useState, useEffect } from "react";
import { Icon } from "../components/UI";
import { useMockStore } from "../mock/store";
import type { Page } from "../types";

function Crumb({
  navigate,
  stage,
  current,
}: {
  navigate: (p: Page) => void;
  stage?: string;
  current: string;
}) {
  return (
    <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3 flex-wrap">
      <button onClick={() => navigate("project-list")} className="hover:text-[#24457C]">
        项目空间
      </button>
      <span>/</span>
      <button onClick={() => navigate("project-detail")} className="hover:text-[#24457C]">
        某省公司中心机房节能改造项目
      </button>
      {stage && (
        <>
          <span>/</span>
          <span className="text-slate-400">{stage}</span>
        </>
      )}
      <span>/</span>
      <span className="font-medium text-slate-800">{current}</span>
    </nav>
  );
}

function ImmersiveShell({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">{header}</div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-8 xl:px-8">
        {children}
      </div>
    </div>
  );
}

// ─── Source Selection ──────────────────────────────────────────────────────────

export function RequirementSourceSelectionPage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, setSourceType } = useMockStore();
  const reqFinalized = state.requirement.status === "finalized";

  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="需求说明 / 项目建议书" current="选择输入来源" />
          <h1 className="text-xl font-semibold text-slate-800">选择需求说明输入方式</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            从以下方式开始编制项目建议书，支持结构化录入或上传已有材料。
          </p>
        </>
      }
    >
      <div className="mx-auto max-w-[800px]">
        {reqFinalized && (
          <div className="mb-5 rounded-xl border border-[#C3E8D5] bg-[#ECF8F2] p-4">
            <p className="text-[13px] text-[#116B46] font-medium">
              项目建议书 V2.0 已定稿于 2026-09-05 09:30 · 如需重新编制，请选择下方方式
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              id: "input",
              icon: "edit",
              title: "结构化录入",
              desc: "通过引导式问答录入项目背景、目标、建设规模和投资估算，系统自动整理为项目建议书素材。",
              action: "开始录入",
            },
            {
              id: "upload-req",
              icon: "upload",
              title: "上传已有需求材料",
              desc: "上传已有的需求说明书、立项申请或前期材料，系统自动提取关键字段。",
              action: "上传文件",
            },
            {
              id: "upload-prop",
              icon: "file",
              title: "上传已有项目建议书",
              desc: "已有完整项目建议书，直接上传进行字段确认和版本管理。",
              action: "直接上传",
            },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                setSourceType("requirement", "upload");
                if (opt.id === "input") navigate("requirement-input");
                else navigate("requirement-file-upload");
              }}
              className="text-left rounded-xl border border-slate-200 bg-white p-6 hover:border-[#2E5495] hover:shadow-md transition-all"
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[#F2F6FC]">
                <Icon name={opt.icon as "edit"} size={22} />
              </div>
              <h2 className="font-semibold text-slate-800 mb-2">{opt.title}</h2>
              <p className="text-[13px] text-slate-500 leading-5 mb-4">{opt.desc}</p>
              <span className="text-[13px] font-medium text-[#2E5495]">{opt.action} →</span>
            </button>
          ))}
        </div>
        <div className="mt-5">
          <button
            onClick={() => navigate("project-detail")}
            className="text-sm text-[#2E5495] hover:underline"
          >
            ← 返回项目详情
          </button>
        </div>
      </div>
    </ImmersiveShell>
  );
}

// ─── Structured Input ──────────────────────────────────────────────────────────

const QA_GROUPS = [
  {
    title: "项目背景",
    qs: [
      {
        id: "bg1",
        label: "项目提出的背景和缘由",
        ph: "说明项目的来源、立项依据、政策背景等…",
      },
      {
        id: "bg2",
        label: "建设必要性",
        ph: "说明不建设将带来的问题，以及建设的必要性和紧迫性…",
      },
    ],
  },
  {
    title: "建设目标",
    qs: [
      {
        id: "tg1",
        label: "总体建设目标",
        ph: "描述建设完成后希望达到的状态和效果…",
      },
      {
        id: "tg2",
        label: "主要建设内容",
        ph: "列举主要建设内容、采购范围或改造项目…",
      },
    ],
  },
  {
    title: "建设规模与方案",
    qs: [
      {
        id: "sc1",
        label: "建设规模",
        ph: "说明建设规模，如设备数量、覆盖面积、系统数量等…",
      },
      {
        id: "sc2",
        label: "技术路线与方案",
        ph: "简述技术方案选型和主要技术路线…",
      },
    ],
  },
  {
    title: "投资与工期",
    qs: [
      { id: "inv1", label: "项目总投资估算（万元）", ph: "例如：1280" },
      { id: "inv2", label: "建设周期（月）", ph: "例如：12" },
      { id: "inv3", label: "资金来源", ph: "例如：省公司自有资金" },
    ],
  },
];

export function RequirementInputPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [answers, setAnswers] = useState<Record<string, string>>({
    bg1: "某省公司中心机房现有制冷系统能效低，年均 PUE 超过 2.0，导致运营成本持续攀升，亟需节能改造。",
    bg2: "现有精密空调系统老化，部分设备已超过使用年限，故障率上升，存在安全隐患，且能耗指标不达标。",
  });
  const [activeGroup, setActiveGroup] = useState(0);
  const filled = QA_GROUPS[activeGroup].qs.filter((q) => answers[q.id]?.trim()).length;
  const total = QA_GROUPS[activeGroup].qs.length;

  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="需求说明" current="结构化录入" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">项目建议书 · 结构化录入</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                共 {QA_GROUPS.length} 组问题，完成后系统将生成字段快照。
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => navigate("requirement-source-selection")}
                className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]"
              >
                返回
              </button>
              <button
                onClick={() => {
                  advanceStage("requirement", "fields_confirmed");
                  navigate("requirement-field-confirmation");
                }}
                className="h-9 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C]"
              >
                完成录入 →
              </button>
            </div>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[900px] grid grid-cols-[200px_1fr] gap-6">
        <aside className="rounded-xl border border-slate-200 bg-white p-3 self-start sticky top-0">
          {QA_GROUPS.map((g, i) => {
            const done = g.qs.filter((q) => answers[q.id]?.trim()).length;
            return (
              <button
                key={g.title}
                onClick={() => setActiveGroup(i)}
                className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                  i === activeGroup
                    ? "bg-[#F2F6FC] font-medium text-[#24457C]"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>{g.title}</span>
                <span
                  className={`ml-2 text-[11px] ${
                    done === g.qs.length ? "text-[#116B46]" : "text-slate-400"
                  }`}
                >
                  {done}/{g.qs.length}
                </span>
              </button>
            );
          })}
        </aside>
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-slate-800">{QA_GROUPS[activeGroup].title}</h2>
              <span className="text-[12px] text-slate-400">
                {filled}/{total} 已填写
              </span>
            </div>
            {QA_GROUPS[activeGroup].qs.map((q) => (
              <div key={q.id} className="mb-5 last:mb-0">
                <label className="block text-[13px] font-medium text-slate-700 mb-2">
                  {q.label}
                </label>
                <textarea
                  value={answers[q.id] || ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  placeholder={q.ph}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm text-slate-800 placeholder-slate-400 focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#2E5495]/20"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <button
              onClick={() => setActiveGroup(Math.max(0, activeGroup - 1))}
              disabled={activeGroup === 0}
              className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495] disabled:opacity-40"
            >
              ← 上一组
            </button>
            {activeGroup < QA_GROUPS.length - 1 ? (
              <button
                onClick={() => setActiveGroup(activeGroup + 1)}
                className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
              >
                下一组 →
              </button>
            ) : (
              <button
                onClick={() => {
                  advanceStage("requirement", "fields_confirmed");
                  navigate("requirement-field-confirmation");
                }}
                className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
              >
                完成录入 →
              </button>
            )}
          </div>
        </div>
      </div>
    </ImmersiveShell>
  );
}

// ─── File Upload ───────────────────────────────────────────────────────────────

export function RequirementFileUploadPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [files, setFiles] = useState<string[]>([]);

  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="需求说明" current="上传文件" />
          <h1 className="text-xl font-semibold text-slate-800">上传需求材料</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            上传已有需求说明书或项目建议书，系统将自动提取字段。
          </p>
        </>
      }
    >
      <div className="mx-auto max-w-[600px] space-y-5">
        <div
          onClick={() => setFiles(["项目建议书_初稿.docx"])}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white py-12 cursor-pointer hover:border-[#2E5495] transition-all"
        >
          <div className="flex size-14 items-center justify-center rounded-xl bg-[#F2F6FC]">
            <Icon name="upload" size={26} />
          </div>
          <p className="font-medium text-slate-700">点击选择文件或拖拽至此</p>
          <p className="text-[13px] text-slate-400">支持 DOCX、PDF；最大 50 MB</p>
        </div>
        {files.map((f) => (
          <div
            key={f}
            className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
          >
            <Icon name="file" size={20} />
            <p className="flex-1 text-sm font-medium text-slate-800">{f}</p>
            <span className="text-[11px] rounded-full bg-[#ECF8F2] px-2.5 py-1 text-[#116B46]">
              就绪
            </span>
          </div>
        ))}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => navigate("requirement-source-selection")}
            className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]"
          >
            返回
          </button>
          <button
            onClick={() => {
              advanceStage("requirement", "parsed");
              navigate("requirement-field-confirmation");
            }}
            disabled={files.length === 0}
            className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            开始解析 →
          </button>
        </div>
      </div>
    </ImmersiveShell>
  );
}

// ─── Field Confirmation ────────────────────────────────────────────────────────

const REQ_FIELDS = [
  {
    id: "f1",
    label: "项目名称",
    value: "某省公司中心机房节能改造项目",
    status: "confirmed" as const,
  },
  {
    id: "f2",
    label: "建设单位",
    value: "某省通信有限公司",
    status: "confirmed" as const,
  },
  {
    id: "f3",
    label: "项目总投资",
    value: "¥12,800,000",
    status: "pending" as const,
  },
  {
    id: "f4",
    label: "建设周期",
    value: "12 个月",
    status: "confirmed" as const,
  },
  {
    id: "f5",
    label: "主要建设内容",
    value: "数据中心精密空调节能改造",
    status: "confirmed" as const,
  },
  {
    id: "f6",
    label: "投资来源",
    value: "省公司自有资金",
    status: "confirmed" as const,
  },
  {
    id: "f7",
    label: "节能目标",
    value: "PUE ≤ 1.5",
    status: "pending" as const,
  },
  {
    id: "f8",
    label: "项目负责人",
    value: "王明远",
    status: "confirmed" as const,
  },
];

export function RequirementFieldConfirmationPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [fields, setFields] = useState(REQ_FIELDS);
  const pending = fields.filter((f) => f.status === "pending").length;

  function confirm(id: string) {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, status: "confirmed" as const } : f)));
  }

  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="项目建议书" current="字段确认" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">项目建议书字段确认</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                {pending > 0 ? `${pending} 个字段待确认` : "所有字段已确认，可进入文档生成"}
              </p>
            </div>
            <button
              onClick={() => {
                advanceStage("requirement", "fields_confirmed");
                navigate("proposal-generation-setup");
              }}
              disabled={pending > 0}
              className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              进入文档生成 →
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[800px]">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-[1fr_1.5fr_120px_80px] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs text-slate-500">
            <span>字段名称</span>
            <span>当前值</span>
            <span>来源</span>
            <span>状态</span>
          </div>
          {fields.map((f) => (
            <div
              key={f.id}
              className="grid grid-cols-[1fr_1.5fr_120px_80px] items-center gap-4 border-t border-slate-100 px-5 py-4 text-[13px]"
            >
              <span className="font-medium text-slate-800">{f.label}</span>
              <span className="text-slate-700">{f.value}</span>
              <span className="text-slate-400 text-[12px]">结构化录入</span>
              {f.status === "confirmed" ? (
                <span className="text-[12px] text-[#116B46] font-medium">已确认</span>
              ) : (
                <button
                  onClick={() => confirm(f.id)}
                  className="h-7 rounded-lg bg-[#FFF7E6] border border-[#F0C070] px-2 text-[11px] font-medium text-[#8B520B] hover:bg-[#F0C070]"
                >
                  确认
                </button>
              )}
            </div>
          ))}
        </div>
        {pending === 0 && (
          <div className="mt-4 rounded-xl border border-[#C3E8D5] bg-[#ECF8F2] p-4 text-[13px] text-[#116B46]">
            所有字段已确认。点击右上角"进入文档生成"继续。
          </div>
        )}
      </div>
    </ImmersiveShell>
  );
}

// ─── Template Selection ────────────────────────────────────────────────────────

const PROPOSAL_TEMPLATES = [
  {
    id: "pt1",
    name: "信息化项目建议书模板",
    type: "信息化",
    version: "V2.0",
    match: "推荐",
    updated: "2026-08-15",
  },
  {
    id: "pt2",
    name: "通用工程项目建议书模板",
    type: "工程建设",
    version: "V1.5",
    match: "适用",
    updated: "2026-07-20",
  },
  {
    id: "pt3",
    name: "节能改造项目建议书模板",
    type: "节能改造",
    version: "V1.2",
    match: "适用",
    updated: "2026-06-01",
  },
];

export function ProposalTemplateSelectionPage({ navigate }: { navigate: (p: Page) => void }) {
  const { setTemplate } = useMockStore();
  const [selected, setSelected] = useState("");

  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="项目建议书" current="选择模板" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">选择项目建议书模板</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                请选择本次使用的项目建议书正式模板。
              </p>
            </div>
            <button
              onClick={() => {
                const t = PROPOSAL_TEMPLATES.find((t) => t.id === selected);
                if (t) {
                  setTemplate("requirement", t.id, t.name);
                  navigate("proposal-generation-setup");
                }
              }}
              disabled={!selected}
              className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              使用此模板 →
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[900px] space-y-3">
        {PROPOSAL_TEMPLATES.map((t) => (
          <label
            key={t.id}
            className={`flex items-center gap-5 rounded-xl border-2 bg-white p-5 cursor-pointer transition-all ${
              selected === t.id ? "border-[#2E5495]" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input
              type="radio"
              name="template"
              value={t.id}
              checked={selected === t.id}
              onChange={() => setSelected(t.id)}
              className="mt-0.5 h-4 w-4 text-[#2E5495]"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-800">{t.name}</span>
                {t.match === "推荐" && (
                  <span className="rounded bg-[#F2F6FC] px-2 py-0.5 text-[11px] font-medium text-[#2E5495]">
                    系统推荐
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-slate-500">
                适用类型：{t.type} · 版本 {t.version} · 更新于 {t.updated}
              </p>
            </div>
          </label>
        ))}
      </div>
    </ImmersiveShell>
  );
}

// ─── Generation Setup ──────────────────────────────────────────────────────────

export function ProposalGenerationSetupPage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, setGenerating } = useMockStore();
  const templateName = state.requirement.selectedTemplateName || "信息化项目建议书模板";
  const [options, setOptions] = useState({
    strictSource: true,
    aiExpand: true,
    auditLog: true,
  });

  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="项目建议书" current="配置生成" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">配置项目建议书生成</h1>
              <p className="mt-1 text-[13px] text-slate-500">模板：{templateName}</p>
            </div>
            <button
              onClick={() => {
                setGenerating("requirement");
                navigate("proposal-generation-progress");
              }}
              className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] shrink-0"
            >
              开始生成 →
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[680px] space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-semibold text-slate-800 mb-4">生成选项</h3>
          {[
            {
              key: "strictSource",
              label: "严格字段来源",
              desc: "仅使用已确认字段生成内容，不引入其他假设",
            },
            {
              key: "aiExpand",
              label: "AI 内容扩写",
              desc: "允许 AI 在已确认字段基础上扩写章节描述",
            },
            {
              key: "auditLog",
              label: "生成审计日志",
              desc: "记录每个字段的填充来源和生成决策",
            },
          ].map((opt) => (
            <div
              key={opt.key}
              className="flex items-start gap-4 border-t border-slate-100 pt-4 first:border-0 first:pt-0"
            >
              <input
                type="checkbox"
                checked={options[opt.key as keyof typeof options]}
                onChange={(e) => setOptions((o) => ({ ...o, [opt.key]: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#2E5495]"
              />
              <div>
                <p className="text-sm font-medium text-slate-800">{opt.label}</p>
                <p className="text-[12px] text-slate-500 mt-0.5">{opt.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-[#DCE7F7] bg-[#F2F6FC] p-4 text-[13px] text-[#24457C]">
          <p className="font-medium mb-1">生成前检查</p>
          <ul className="space-y-1 text-[12px]">
            <li className="flex items-center gap-2">
              <span className="text-[#116B46]">✓</span>所有必填字段已确认
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[#116B46]">✓</span>模板版本：{templateName}
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[#116B46]">✓</span>字段快照：FS-20260905-002
            </li>
          </ul>
        </div>
      </div>
    </ImmersiveShell>
  );
}

// ─── Generation Progress ───────────────────────────────────────────────────────

export function ProposalGenerationProgressPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [step, setStep] = useState(0);
  const steps = ["加载字段快照", "套入模板结构", "生成章节内容", "AI 内容审查", "生成文档包"];

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => timers.push(setTimeout(() => setStep(i + 1), (i + 1) * 1000)));
    timers.push(
      setTimeout(
        () => {
          advanceStage("requirement", "generated");
          navigate("proposal-document-workspace");
        },
        steps.length * 1000 + 800,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="项目建议书" current="生成中" />
          <h1 className="text-xl font-semibold text-slate-800">项目建议书生成中</h1>
          <p className="mt-1 text-[13px] text-slate-500">正在生成文档，请稍候…</p>
        </>
      }
    >
      <div className="flex items-center justify-center py-12">
        <div className="w-full max-w-[440px] rounded-xl border border-slate-200 bg-white p-8">
          <div className="mb-6 flex items-center gap-3">
            <svg
              className="animate-spin text-[#2E5495]"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-9-9" />
              <path d="M21 3v9h-9" />
            </svg>
            <span className="font-semibold text-slate-800">生成进行中</span>
          </div>
          <div className="space-y-3">
            {steps.map((s, i) => (
              <div
                key={s}
                className={`flex items-center gap-3 text-sm ${
                  i < step ? "text-slate-800" : "text-slate-400"
                }`}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    i < step ? "bg-[#ECF8F2] text-[#116B46]" : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                {s}
              </div>
            ))}
          </div>
          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#2E5495] transition-all duration-700"
              style={{ width: `${(step / steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </ImmersiveShell>
  );
}

// ─── Document Workspace ────────────────────────────────────────────────────────

const PROP_SECTIONS = [
  {
    id: "s1",
    title: "一、项目概况",
    content:
      "本项目为某省通信有限公司中心机房节能改造工程，旨在通过更换高效精密空调设备、优化机房气流组织，将机房 PUE 从现有的 2.1 降低至 1.5 以下，实现年节电约 120 万度，年节约运营成本约 80 万元。",
  },
  {
    id: "s2",
    title: "二、建设必要性",
    content:
      "现有机房精密空调系统建设于 2012 年，主要设备已超过设计使用年限，能效比（EER）仅为 2.8，远低于行业标准要求的 4.0 以上。根据省公司节能规划，该机房需在 2026 年底完成节能改造。",
  },
  {
    id: "s3",
    title: "三、建设方案",
    content:
      "拟采购高效精密空调系统 8 套，额定冷量每套 50 kW，配套 EC 风机和智能控制系统。同时优化机房封闭冷通道，减少冷热气流混合，预计改造后 PUE 可达 1.45。",
  },
  {
    id: "s4",
    title: "四、投资估算",
    content:
      "项目总投资估算 1280 万元，其中设备购置费 900 万元，安装工程费 180 万元，系统集成费 120 万元，其他费用 80 万元。资金来源为省公司自有资金。",
  },
];

export function ProposalDocumentWorkspacePage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, finalizeStage } = useMockStore();
  const [activeSection, setActiveSection] = useState("s1");
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [finalized, setFinalized] = useState(state.requirement.status === "finalized");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");

  function handleSave() {
    setSaveStatus("saving");
    setTimeout(() => setSaveStatus("saved"), 1000);
  }

  function handleFinalize() {
    finalizeStage("requirement", "项目建议书 V2.0");
    setFinalized(true);
    setShowFinalizeDialog(false);
  }

  if (finalized) {
    return (
      <ImmersiveShell
        header={
          <>
            <Crumb navigate={navigate} stage="项目建议书" current="已定稿" />
            <h1 className="text-xl font-semibold text-slate-800">项目建议书已定稿</h1>
          </>
        }
      >
        <div className="mx-auto max-w-[600px] text-center py-12">
          <div className="flex size-16 mx-auto items-center justify-center rounded-full bg-[#ECF8F2] mb-5">
            <Icon name="check-circle" size={32} />
          </div>
          <h2 className="text-2xl font-semibold text-slate-800">定稿成功</h2>
          <p className="mt-2 text-slate-500">项目建议书 V2.0 已定稿于 2026-09-05</p>
          <div className="mt-8 flex justify-center gap-3 flex-wrap">
            <button className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]">
              导出 DOCX
            </button>
            <button className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]">
              导出 PDF
            </button>
            <button
              onClick={() => navigate("project-detail")}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
            >
              返回项目详情
            </button>
          </div>
        </div>
      </ImmersiveShell>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-3 xl:px-8 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <Crumb navigate={navigate} stage="项目建议书" current="审校" />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[12px] text-slate-400">
              {saveStatus === "saving" ? "保存中…" : "已保存"}
            </span>
            <button
              onClick={handleSave}
              className="h-8 rounded-lg border border-slate-300 px-3 text-[13px] text-slate-600 hover:border-[#2E5495]"
            >
              保存草稿
            </button>
            <button
              onClick={() => navigate("proposal-validation")}
              className="h-8 rounded-lg border border-slate-300 px-3 text-[13px] text-slate-600 hover:border-[#2E5495]"
            >
              运行校验
            </button>
            <button
              onClick={() => setShowFinalizeDialog(true)}
              className="h-8 rounded-lg bg-[#2E5495] px-3 text-[13px] font-medium text-white hover:bg-[#24457C]"
            >
              定稿
            </button>
          </div>
        </div>
        <h1 className="text-base font-semibold text-slate-800 mt-1">项目建议书 V0.1 审校</h1>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-52 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
          <div className="p-3">
            <p className="px-3 pb-2 text-[11px] font-semibold text-slate-500 uppercase">文档目录</p>
            {PROP_SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-[13px] ${
                  s.id === activeSection
                    ? "bg-[#F2F6FC] font-medium text-[#24457C]"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto bg-[#F6F8FB] p-6">
          <div className="mx-auto max-w-[860px]">
            {PROP_SECTIONS.map((s) => (
              <div
                key={s.id}
                id={s.id}
                className="mb-6 rounded-xl border border-slate-200 bg-white p-6"
              >
                <h2 className="text-base font-semibold text-slate-800 mb-3">{s.title}</h2>
                <p className="text-[14px] leading-7 text-slate-700">{s.content}</p>
              </div>
            ))}
          </div>
        </main>
      </div>
      {showFinalizeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-800">确认定稿</h2>
            <p className="mt-2 text-[13px] text-slate-500">
              定稿后文档将锁定为 V2.0，可在可研阶段直接继承此版本。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowFinalizeDialog(false)}
                className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]"
              >
                取消
              </button>
              <button
                onClick={handleFinalize}
                className="h-9 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C]"
              >
                确认定稿
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Validation ────────────────────────────────────────────────────────────────

export function ProposalValidationPage({ navigate }: { navigate: (p: Page) => void }) {
  const [expanded, setExpanded] = useState(new Set(["g1"]));
  const checks = [
    {
      id: "g1",
      name: "章节完整性",
      items: [
        { label: "必要章节全部存在", ok: true },
        { label: "无空白章节", ok: true },
      ],
    },
    {
      id: "g2",
      name: "字段完整性",
      items: [
        { label: "P0 字段全部已确认", ok: true },
        {
          label: "无未填充模板变量",
          ok: false,
          detail: "{{ project_code }} 未替换",
        },
      ],
    },
    {
      id: "g3",
      name: "数值一致性",
      items: [
        { label: "投资估算全文一致", ok: true },
        { label: "项目名称全文一致", ok: true },
      ],
    },
  ];

  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="项目建议书" current="校验报告" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">项目建议书校验报告</h1>
              <p className="mt-1 text-[13px] text-slate-500">V0.1 · 2026-09-05 14:30</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => navigate("proposal-document-workspace")}
                className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]"
              >
                返回文档
              </button>
              <button
                onClick={() => navigate("proposal-document-workspace")}
                className="h-9 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C]"
              >
                处理问题并定稿
              </button>
            </div>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[760px] space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-[#FECDD0] bg-[#FEF1F2] p-4 text-center">
            <p className="text-2xl font-bold text-[#A8323C]">1</p>
            <p className="text-[11px] text-[#A8323C]">P0 阻断</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-[#8B520B]">0</p>
            <p className="text-[11px] text-slate-500">P1 重要</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-[#116B46]">0</p>
            <p className="text-[11px] text-slate-500">已解决</p>
          </div>
        </div>
        {checks.map((g) => {
          const fail = g.items.filter((i) => !i.ok);
          return (
            <div key={g.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-3.5"
                onClick={() =>
                  setExpanded((prev) => {
                    const n = new Set(prev);
                    n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                    return n;
                  })
                }
              >
                <div className="flex items-center gap-3">
                  <span className={fail.length > 0 ? "text-[#A8323C]" : "text-[#116B46]"}>
                    <Icon name={fail.length > 0 ? "alert" : "check-circle"} size={15} />
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{g.name}</span>
                  {fail.length > 0 && (
                    <span className="text-xs text-[#A8323C]">{fail.length} 项问题</span>
                  )}
                </div>
                <Icon name="chevron" size={14} />
              </button>
              {expanded.has(g.id) && (
                <div className="border-t border-slate-100">
                  {g.items.map((item) => (
                    <div
                      key={item.label}
                      className={`flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0 text-[13px] ${
                        !item.ok ? "bg-[#FAFAFA]" : ""
                      }`}
                    >
                      <span className={item.ok ? "text-[#116B46]" : "text-[#A8323C]"}>
                        <Icon name={item.ok ? "check-circle" : "x-circle"} size={14} />
                      </span>
                      <span className="flex-1 text-slate-700">{item.label}</span>
                      {!item.ok && "detail" in item && (
                        <span className="text-[12px] text-[#A8323C]">
                          {
                            (
                              item as {
                                label: string;
                                ok: boolean;
                                detail: string;
                              }
                            ).detail
                          }
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ImmersiveShell>
  );
}

// ─── Finalized ─────────────────────────────────────────────────────────────────

export function ProposalFinalizedPage({ navigate }: { navigate: (p: Page) => void }) {
  return (
    <ImmersiveShell
      header={
        <>
          <Crumb navigate={navigate} stage="项目建议书" current="已定稿" />
          <h1 className="text-xl font-semibold text-slate-800">项目建议书已定稿</h1>
        </>
      }
    >
      <div className="mx-auto max-w-[600px] py-8">
        <div className="rounded-xl border border-[#C3E8D5] bg-[#ECF8F2] p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-[#116B46]/10">
              <Icon name="check-circle" size={24} />
            </div>
            <div>
              <p className="font-semibold text-[#116B46] text-lg">项目建议书 V2.0 已定稿</p>
              <p className="text-[12px] text-[#116B46]/70 mt-0.5">定稿于 2026-09-05 09:30</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            {[
              ["字段快照", "FS-20260905-002"],
              ["模板", "信息化项目建议书模板 V2.0"],
              ["字段总数", "8 个已确认"],
              ["生成耗时", "约 38 秒"],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-[#116B46]/60">{k}</p>
                <p className="font-medium text-[#116B46] mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]">
            导出 DOCX
          </button>
          <button className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]">
            导出 PDF
          </button>
          <button
            onClick={() => navigate("feasibility-source-selection")}
            className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
          >
            进入可研阶段 →
          </button>
        </div>
        <button
          onClick={() => navigate("project-detail")}
          className="mt-4 text-sm text-[#2E5495] hover:underline"
        >
          ← 返回项目详情
        </button>
      </div>
    </ImmersiveShell>
  );
}
