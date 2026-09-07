import { useState, useEffect } from "react";
import { Icon } from "../components/UI";
import { useMockStore } from "../mock/store";
import type { Page } from "../types";

function Crumb({ navigate, current }: { navigate: (p: Page) => void; current: string }) {
  return (
    <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3 flex-wrap">
      <button onClick={() => navigate("project-list")} className="hover:text-[#24457C]">
        项目空间
      </button>
      <span>/</span>
      <button onClick={() => navigate("project-detail")} className="hover:text-[#24457C]">
        某省公司中心机房节能改造项目
      </button>
      <span>/</span>
      <span className="text-slate-400">可研报告</span>
      <span>/</span>
      <span className="font-medium text-slate-800">{current}</span>
    </nav>
  );
}

function Shell({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
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

export function FeasibilitySourceSelectionPage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, setSourceType } = useMockStore();
  const propFinalized = state.requirement.status === "finalized";

  function choose(type: "platform" | "upload", next: Page) {
    setSourceType("feasibility", type);
    navigate(next);
  }

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="选择输入来源" />
          <h1 className="text-xl font-semibold text-slate-800">选择可研报告生成输入来源</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            选择用于生成可行性研究报告的基础材料来源。
          </p>
        </>
      }
    >
      <div className="mx-auto max-w-[800px]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[
            {
              type: "platform" as const,
              icon: "check-circle",
              title: "使用平台已定稿项目建议书",
              desc: "直接继承项目建议书的字段和来源关系，自动提取可研所需信息。",
              disabled: !propFinalized,
              notice: propFinalized ? null : "需先完成项目建议书阶段",
              next: "feasibility-file-upload" as Page,
            },
            {
              type: "upload" as const,
              icon: "upload",
              title: "上传已有需求或建议书",
              desc: "上传外部已有的需求说明书或项目建议书，系统自动解析。",
              disabled: false,
              notice: null,
              next: "feasibility-file-upload" as Page,
            },
            {
              type: "upload" as const,
              icon: "file",
              title: "上传已有可研报告",
              desc: "已有完整可研报告，直接上传进行字段确认和版本管理。",
              disabled: false,
              notice: null,
              next: "feasibility-file-upload" as Page,
            },
          ].map((opt) => (
            <button
              key={opt.title}
              onClick={() => !opt.disabled && choose(opt.type, opt.next)}
              disabled={opt.disabled}
              className={`text-left rounded-xl border bg-white p-5 transition-all ${
                opt.disabled
                  ? "border-slate-200 opacity-60 cursor-not-allowed"
                  : "border-slate-200 hover:border-[#2E5495] hover:shadow-md cursor-pointer"
              }`}
            >
              <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[#F2F6FC]">
                <Icon name={opt.icon as "file"} size={20} />
              </div>
              <h3 className="font-semibold text-slate-800 mb-1 text-[14px]">{opt.title}</h3>
              <p className="text-[12px] text-slate-500 leading-5">{opt.desc}</p>
              {opt.notice && <p className="mt-2 text-[11px] text-[#A86512]">{opt.notice}</p>}
              {!opt.disabled && (
                <span className="mt-3 block text-[13px] font-medium text-[#2E5495]">选择 →</span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => navigate("project-detail")}
          className="text-sm text-[#2E5495] hover:underline"
        >
          ← 返回项目详情
        </button>
      </div>
    </Shell>
  );
}

// ─── File Upload ───────────────────────────────────────────────────────────────

export function FeasibilityFileUploadPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [files, setFiles] = useState<string[]>([]);

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="上传文件" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">上传可研参考材料</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                支持上传需求说明书、项目建议书或已有可研报告。
              </p>
            </div>
            <button
              onClick={() => navigate("feasibility-source-selection")}
              className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495] shrink-0"
            >
              返回
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[600px] space-y-5">
        <div
          onClick={() => setFiles(["项目建议书_V2.0.docx"])}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white py-12 cursor-pointer hover:border-[#2E5495] transition-all"
        >
          <div className="flex size-14 items-center justify-center rounded-xl bg-[#F2F6FC]">
            <Icon name="upload" size={26} />
          </div>
          <p className="font-medium text-slate-700">点击选择或拖拽文件</p>
          <p className="text-[13px] text-slate-400">DOCX · PDF · 最大 50 MB</p>
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
            onClick={() => navigate("feasibility-source-selection")}
            className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]"
          >
            返回
          </button>
          <button
            onClick={() => {
              advanceStage("feasibility", "files_uploaded");
              navigate("feasibility-parse-summary");
            }}
            disabled={files.length === 0}
            className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            开始解析 →
          </button>
        </div>
      </div>
    </Shell>
  );
}

// ─── Parse Summary ─────────────────────────────────────────────────────────────

export function FeasibilityParseSummaryPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const steps = ["读取文档结构", "提取项目信息", "分析投资数据", "生成字段快照"];

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => timers.push(setTimeout(() => setStep(i + 1), (i + 1) * 700)));
    timers.push(
      setTimeout(
        () => {
          advanceStage("feasibility", "parsed");
          setDone(true);
        },
        steps.length * 700 + 400,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current={done ? "解析摘要" : "解析中"} />
          <h1 className="text-xl font-semibold text-slate-800">
            {done ? "解析完成" : "正在解析文件…"}
          </h1>
          {done && (
            <p className="mt-1 text-[13px] text-slate-500">
              共提取 56 个字段，请确认后进入专业选择。
            </p>
          )}
        </>
      }
    >
      {!done ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-full max-w-[440px] rounded-xl border border-slate-200 bg-white p-8">
            <div className="space-y-3 mb-6">
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
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[#2E5495] transition-all duration-700"
                style={{ width: `${(step / steps.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-[760px] space-y-5">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "提取字段总数", v: "56", c: "text-slate-800" },
              { label: "自动填充", v: "51", c: "text-[#116B46]" },
              { label: "需人工确认", v: "5", c: "text-[#A86512]" },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-slate-200 bg-white p-4 text-center"
              >
                <p className={`text-2xl font-bold ${s.c}`}>{s.v}</p>
                <p className="mt-1 text-[12px] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-sm text-slate-800 mb-3">提取字段预览</h3>
            <div className="flex flex-wrap gap-2">
              {[
                "项目名称",
                "建设单位",
                "建设规模",
                "总投资估算",
                "建设工期",
                "节能目标",
                "技术路线",
                "设备参数",
                "资金来源",
                "建设地点",
              ].map((f) => (
                <span
                  key={f}
                  className="rounded-full bg-[#F2F6FC] px-3 py-1 text-[12px] text-[#2E5495]"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => navigate("feasibility-file-upload")}
              className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]"
            >
              重新上传
            </button>
            <button
              onClick={() => navigate("feasibility-profession-selection")}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
            >
              选择项目专业 →
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ─── Profession Selection ──────────────────────────────────────────────────────

const PROFESSIONS = [
  { id: "it", name: "信息技术 / 数据中心", templates: 5, icon: "settings" },
  { id: "power", name: "电力系统", templates: 3, icon: "settings" },
  { id: "civil", name: "土建工程", templates: 4, icon: "settings" },
  { id: "hvac", name: "暖通空调", templates: 3, icon: "settings" },
  { id: "comm", name: "通信工程", templates: 6, icon: "settings" },
  { id: "energy", name: "节能环保", templates: 2, icon: "settings" },
];

export function FeasibilityProfessionSelectionPage({ navigate }: { navigate: (p: Page) => void }) {
  const [selected, setSelected] = useState("it");

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="选择项目专业" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">选择可研报告专业分类</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                专业分类决定可用模板范围和字段确认项。
              </p>
            </div>
            <button
              onClick={() => navigate("feasibility-field-confirmation")}
              disabled={!selected}
              className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              确认并进入字段确认 →
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[760px]">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {PROFESSIONS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`text-left rounded-xl border-2 bg-white p-5 transition-all ${
                selected === p.id
                  ? "border-[#2E5495] shadow-sm"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                    selected === p.id ? "bg-[#2E5495] text-white" : "bg-[#F2F6FC] text-[#2E5495]"
                  }`}
                >
                  <Icon name="settings" size={18} />
                </div>
                <div>
                  <p className="font-semibold text-[14px] text-slate-800 leading-snug">{p.name}</p>
                  <p className="mt-1 text-[12px] text-slate-400">{p.templates} 个模板可用</p>
                </div>
              </div>
              {selected === p.id && (
                <div className="mt-3 flex items-center gap-1 text-[12px] text-[#2E5495] font-medium">
                  <Icon name="check-circle" size={13} /> 已选择
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}

// ─── Field Confirmation ────────────────────────────────────────────────────────

const FEASIBILITY_FIELDS = [
  {
    id: "f1",
    label: "项目名称",
    value: "某省公司中心机房节能改造项目",
    src: "项目建议书",
    ok: true,
  },
  {
    id: "f2",
    label: "建设单位",
    value: "某省通信有限公司",
    src: "项目建议书",
    ok: true,
  },
  {
    id: "f3",
    label: "项目总投资",
    value: "¥12,800,000",
    src: "项目建议书",
    ok: false,
  },
  {
    id: "f4",
    label: "建安工程费",
    value: "¥7,200,000",
    src: "估算计算",
    ok: true,
  },
  {
    id: "f5",
    label: "设备购置费",
    value: "¥4,100,000",
    src: "估算计算",
    ok: true,
  },
  {
    id: "f6",
    label: "建设周期",
    value: "12 个月",
    src: "项目建议书",
    ok: true,
  },
  {
    id: "f7",
    label: "技术方案",
    value: "高效精密空调节能改造",
    src: "人工录入",
    ok: false,
  },
  {
    id: "f8",
    label: "节能目标 PUE",
    value: "≤ 1.5",
    src: "行业标准",
    ok: true,
  },
  { id: "f9", label: "项目负责人", value: "王明远", src: "系统", ok: true },
  {
    id: "f10",
    label: "建设地点",
    value: "某省省会城市",
    src: "人工录入",
    ok: false,
  },
];

export function FeasibilityFieldConfirmationPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [fields, setFields] = useState(FEASIBILITY_FIELDS);
  const pending = fields.filter((f) => !f.ok).length;

  function confirm(id: string) {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ok: true } : f)));
  }

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="字段确认" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">可研报告字段确认</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                {pending > 0 ? `${pending} 个字段待确认` : "所有字段已确认"}
              </p>
            </div>
            <button
              onClick={() => {
                advanceStage("feasibility", "fields_confirmed");
                navigate("feasibility-template-selection");
              }}
              disabled={pending > 0}
              className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              进入模板选择 →
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[860px]">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-[1fr_1.4fr_120px_80px] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs text-slate-500">
            <span>字段名称</span>
            <span>当前值</span>
            <span>来源</span>
            <span>状态</span>
          </div>
          {fields.map((f) => (
            <div
              key={f.id}
              className="grid grid-cols-[1fr_1.4fr_120px_80px] items-center gap-4 border-t border-slate-100 px-5 py-4 text-[13px]"
            >
              <span className="font-medium text-slate-800">{f.label}</span>
              <span className="text-slate-700">{f.value}</span>
              <span className="text-slate-400 text-[12px]">{f.src}</span>
              {f.ok ? (
                <span className="text-[12px] text-[#116B46] font-medium">已确认</span>
              ) : (
                <button
                  onClick={() => confirm(f.id)}
                  className="h-7 w-full rounded-lg bg-[#FFF7E6] border border-[#F0C070] px-2 text-[11px] font-medium text-[#8B520B] hover:bg-[#F0C070]"
                >
                  确认
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

// ─── Template Selection ────────────────────────────────────────────────────────

const FEASIBILITY_TEMPLATES = [
  {
    id: "ft1",
    name: "数据中心可行性研究报告模板",
    type: "信息技术",
    version: "V2.1",
    match: "推荐",
    updated: "2026-09-01",
  },
  {
    id: "ft2",
    name: "节能改造项目可行性研究报告模板",
    type: "节能环保",
    version: "V1.8",
    match: "适用",
    updated: "2026-08-10",
  },
  {
    id: "ft3",
    name: "通用信息化项目可研报告模板",
    type: "信息化",
    version: "V3.0",
    match: "适用",
    updated: "2026-07-15",
  },
];

export function FeasibilityTemplateSelectionPage({ navigate }: { navigate: (p: Page) => void }) {
  const { setTemplate } = useMockStore();
  const [selected, setSelected] = useState("");

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="选择模板" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">选择可研报告模板</h1>
              <p className="mt-1 text-[13px] text-slate-500">请选择本次使用的正式模板。</p>
            </div>
            <button
              onClick={() => {
                const t = FEASIBILITY_TEMPLATES.find((t) => t.id === selected);
                if (t) {
                  setTemplate("feasibility", t.id, t.name);
                  navigate("feasibility-generation-setup");
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
      <div className="mx-auto max-w-[860px] space-y-3">
        {FEASIBILITY_TEMPLATES.map((t) => (
          <label
            key={t.id}
            className={`flex items-center gap-5 rounded-xl border-2 bg-white p-5 cursor-pointer transition-all ${
              selected === t.id ? "border-[#2E5495]" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input
              type="radio"
              name="tmpl"
              value={t.id}
              checked={selected === t.id}
              onChange={() => setSelected(t.id)}
              className="h-4 w-4 text-[#2E5495]"
            />
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-800">{t.name}</span>
                {t.match === "推荐" && (
                  <span className="rounded bg-[#F2F6FC] px-2 py-0.5 text-[11px] font-medium text-[#2E5495]">
                    系统推荐
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-slate-500">
                适用：{t.type} · {t.version} · 更新于 {t.updated}
              </p>
            </div>
          </label>
        ))}
      </div>
    </Shell>
  );
}

// ─── Generation Setup ──────────────────────────────────────────────────────────

export function FeasibilityGenerationSetupPage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, setGenerating } = useMockStore();
  const tplName = state.feasibility.selectedTemplateName || "数据中心可行性研究报告模板";
  const [opts, setOpts] = useState({
    strictSource: true,
    aiExpand: true,
    investCalc: true,
  });

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="配置生成" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">配置可研报告生成</h1>
              <p className="mt-1 text-[13px] text-slate-500">模板：{tplName}</p>
            </div>
            <button
              onClick={() => {
                setGenerating("feasibility");
                navigate("feasibility-generation-progress");
              }}
              className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] shrink-0"
            >
              开始生成 →
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[640px] space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-semibold text-slate-800 mb-4">生成选项</h3>
          {[
            {
              key: "strictSource",
              label: "严格字段来源",
              desc: "仅使用已确认字段生成内容",
            },
            {
              key: "aiExpand",
              label: "AI 内容扩写",
              desc: "允许 AI 在确认字段基础上扩写描述性段落",
            },
            {
              key: "investCalc",
              label: "自动生成投资估算表",
              desc: "根据已确认投资字段自动生成三级估算表",
            },
          ].map((o) => (
            <div
              key={o.key}
              className="flex items-start gap-4 border-t border-slate-100 pt-4 first:border-0 first:pt-0"
            >
              <input
                type="checkbox"
                checked={opts[o.key as keyof typeof opts]}
                onChange={(e) => setOpts((x) => ({ ...x, [o.key]: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#2E5495]"
              />
              <div>
                <p className="text-sm font-medium text-slate-800">{o.label}</p>
                <p className="text-[12px] text-slate-500 mt-0.5">{o.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-[#DCE7F7] bg-[#F2F6FC] p-4 text-[13px] text-[#24457C]">
          <p className="font-medium mb-1">生成前检查</p>
          <ul className="space-y-1 text-[12px]">
            <li className="flex items-center gap-2">
              <span className="text-[#116B46]">✓</span>所有必填字段已确认（10 个）
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[#116B46]">✓</span>模板：{tplName}
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[#116B46]">✓</span>字段快照：FS-20260905-003
            </li>
          </ul>
        </div>
      </div>
    </Shell>
  );
}

// ─── Generation Progress ───────────────────────────────────────────────────────

export function FeasibilityGenerationProgressPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [step, setStep] = useState(0);
  const steps = [
    "加载字段快照",
    "套入模板结构",
    "生成技术章节",
    "生成投资估算",
    "AI 审查",
    "生成文档包",
  ];

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => timers.push(setTimeout(() => setStep(i + 1), (i + 1) * 900)));
    timers.push(
      setTimeout(
        () => {
          advanceStage("feasibility", "generated");
          navigate("feasibility-document-workspace");
        },
        steps.length * 900 + 700,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="生成中" />
          <h1 className="text-xl font-semibold text-slate-800">可研报告生成中</h1>
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
                    i < step ? "bg-[#ECF8F2] text-[#116B46]" : "bg-slate-100"
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
    </Shell>
  );
}

// ─── Document Workspace ────────────────────────────────────────────────────────

const FEASIBILITY_SECTIONS = [
  {
    id: "s1",
    title: "一、项目概况",
    content:
      "某省通信有限公司中心机房节能改造项目位于某省省会城市，现有机房面积约 1200 平方米，安装精密空调 12 台，总冷量约 480 kW。项目总投资估算 1280 万元，建设周期 12 个月。",
  },
  {
    id: "s2",
    title: "二、建设必要性",
    content:
      "现有精密空调系统平均使用年限超过 12 年，主要设备能效比（EER）仅为 2.8，与《数据中心能效评测指标》（GB/T 32910）要求的 4.0 相比存在较大差距。经测算，改造后可将机房 PUE 从 2.1 降低至 1.45，年节电约 120 万度。",
  },
  {
    id: "s3",
    title: "三、建设方案",
    content:
      "拟采购高效精密空调系统 8 套（额定冷量 50 kW/套），配套 EC 变频风机和智能群控系统。同时实施封闭冷通道改造，增设热通道隔离屏障，优化机房气流组织，减少冷热气流混合损耗。",
  },
  {
    id: "s4",
    title: "四、投资估算",
    content:
      "项目总投资 1280 万元：设备购置费 900 万元（精密空调 700 万元、辅助设备 200 万元），安装工程费 180 万元，系统集成费 120 万元，其他费用 80 万元（含设计费、监理费）。",
  },
  {
    id: "s5",
    title: "五、节能效益分析",
    content:
      "改造后预计年节电 120 万度，按工业用电价格 0.8 元/度计算，年节约电费 96 万元。项目静态投资回收期约 13.3 年，满足省公司重大节能改造项目经济性评价要求。",
  },
];

export function FeasibilityDocumentWorkspacePage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, finalizeStage } = useMockStore();
  const [active, setActive] = useState("s1");
  const [showDialog, setShowDialog] = useState(false);
  const [finalized, setFinalized] = useState(state.feasibility.status === "finalized");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");

  function doFinalize() {
    finalizeStage("feasibility", "可行性研究报告 V1.3");
    setFinalized(true);
    setShowDialog(false);
  }

  if (finalized) {
    return (
      <Shell
        header={
          <>
            <Crumb navigate={navigate} current="已定稿" />
            <h1 className="text-xl font-semibold text-slate-800">可研报告已定稿</h1>
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
                <p className="font-semibold text-[#116B46] text-lg">可行性研究报告 V1.3 已定稿</p>
                <p className="text-[12px] text-[#116B46]/70 mt-0.5">
                  字段快照 FS-20260905-003 已锁定
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-[13px]">
              {[
                ["字段总数", "10 个已确认"],
                ["模板", "数据中心可行性研究报告模板 V2.1"],
                ["项目总投资", "¥12,800,000"],
                ["建设周期", "12 个月"],
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
              onClick={() => navigate("tender-source-selection")}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
            >
              进入招标阶段 →
            </button>
          </div>
          <button
            onClick={() => navigate("project-detail")}
            className="mt-4 text-sm text-[#2E5495] hover:underline"
          >
            ← 返回项目详情
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-3 xl:px-8 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <Crumb navigate={navigate} current="审校" />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[12px] text-slate-400">
              {saveStatus === "saving" ? "保存中…" : "已保存"}
            </span>
            <button
              onClick={() => {
                setSaveStatus("saving");
                setTimeout(() => setSaveStatus("saved"), 1000);
              }}
              className="h-8 rounded-lg border border-slate-300 px-3 text-[13px] text-slate-600 hover:border-[#2E5495]"
            >
              保存草稿
            </button>
            <button
              onClick={() => navigate("feasibility-validation")}
              className="h-8 rounded-lg border border-slate-300 px-3 text-[13px] text-slate-600 hover:border-[#2E5495]"
            >
              运行校验
            </button>
            <button
              onClick={() => setShowDialog(true)}
              className="h-8 rounded-lg bg-[#2E5495] px-3 text-[13px] font-medium text-white hover:bg-[#24457C]"
            >
              定稿
            </button>
          </div>
        </div>
        <h1 className="text-base font-semibold text-slate-800 mt-1">可行性研究报告 V0.2 审校</h1>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-52 shrink-0 border-r border-slate-200 bg-white overflow-y-auto p-3">
          <p className="px-3 pb-2 text-[11px] font-semibold text-slate-500 uppercase">文档目录</p>
          {FEASIBILITY_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-[13px] ${
                s.id === active
                  ? "bg-[#F2F6FC] font-medium text-[#24457C]"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {s.title}
            </button>
          ))}
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto bg-[#F6F8FB] p-6">
          <div className="mx-auto max-w-[860px]">
            {FEASIBILITY_SECTIONS.map((s) => (
              <div key={s.id} className="mb-6 rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="text-base font-semibold text-slate-800 mb-3">{s.title}</h2>
                <p className="text-[14px] leading-7 text-slate-700">{s.content}</p>
              </div>
            ))}
          </div>
        </main>
      </div>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-800">确认定稿可研报告</h2>
            <p className="mt-2 text-[13px] text-slate-500">
              定稿后文档将锁定为 V1.3，字段快照 FS-20260905-003 将被锁定，招标阶段可直接继承。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDialog(false)}
                className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600"
              >
                取消
              </button>
              <button
                onClick={doFinalize}
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

export function FeasibilityValidationPage({ navigate }: { navigate: (p: Page) => void }) {
  const [expanded, setExpanded] = useState(new Set(["g1", "g2"]));
  const checks = [
    {
      id: "g1",
      name: "章节完整性",
      items: [
        { label: "必要章节全部存在", ok: true },
        { label: "无重复章节", ok: true },
      ],
    },
    {
      id: "g2",
      name: "字段完整性",
      items: [
        { label: "P0 字段全部已确认", ok: true },
        { label: "无未填充模板变量", ok: true },
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
    {
      id: "g4",
      name: "AI 内容审阅",
      items: [
        {
          label: "关键章节已审阅",
          ok: false,
          detail: "第三章节存在 2 段未审阅 AI 草稿",
        },
      ],
    },
  ];

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="校验报告" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">可研报告校验报告</h1>
              <p className="mt-1 text-[13px] text-slate-500">V0.2 · 2026-09-05</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => navigate("feasibility-document-workspace")}
                className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]"
              >
                返回文档
              </button>
              <button
                onClick={() => navigate("feasibility-document-workspace")}
                className="h-9 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C]"
              >
                处理后定稿
              </button>
            </div>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[760px] space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-[#A8323C]">0</p>
            <p className="text-[11px] text-slate-500">P0 阻断</p>
          </div>
          <div className="rounded-xl border border-[#FFF0C0] bg-[#FFFBEB] p-4 text-center">
            <p className="text-2xl font-bold text-[#8B520B]">1</p>
            <p className="text-[11px] text-[#8B520B]">P1 重要</p>
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
                  setExpanded((p) => {
                    const n = new Set(p);
                    n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                    return n;
                  })
                }
              >
                <div className="flex items-center gap-3">
                  <span className={fail.length > 0 ? "text-[#8B520B]" : "text-[#116B46]"}>
                    <Icon name={fail.length > 0 ? "alert" : "check-circle"} size={15} />
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{g.name}</span>
                  {fail.length > 0 && (
                    <span className="text-xs text-[#8B520B]">{fail.length} 项问题</span>
                  )}
                </div>
                <Icon name="chevron" size={14} />
              </button>
              {expanded.has(g.id) && (
                <div className="border-t border-slate-100">
                  {g.items.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0 text-[13px]"
                    >
                      <span className={item.ok ? "text-[#116B46]" : "text-[#8B520B]"}>
                        <Icon name={item.ok ? "check-circle" : "alert"} size={14} />
                      </span>
                      <span className="flex-1 text-slate-700">{item.label}</span>
                      {!item.ok && "detail" in item && (
                        <span className="text-[12px] text-[#8B520B]">
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
    </Shell>
  );
}

// ─── Finalized ─────────────────────────────────────────────────────────────────

export function FeasibilityFinalizedPage({ navigate }: { navigate: (p: Page) => void }) {
  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="已定稿" />
          <h1 className="text-xl font-semibold text-slate-800">可研报告已定稿</h1>
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
              <p className="font-semibold text-[#116B46] text-lg">可行性研究报告 V1.3 已定稿</p>
              <p className="text-[12px] text-[#116B46]/70 mt-0.5">招标阶段可直接继承本版本字段</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            {[
              ["字段快照", "FS-20260905-003"],
              ["模板", "数据中心可研报告模板 V2.1"],
              ["项目总投资", "¥12,800,000"],
              ["字段总数", "10 个已确认"],
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
            onClick={() => navigate("tender-source-selection")}
            className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
          >
            进入招标阶段 →
          </button>
        </div>
        <button
          onClick={() => navigate("project-detail")}
          className="mt-4 text-sm text-[#2E5495] hover:underline"
        >
          ← 返回项目详情
        </button>
      </div>
    </Shell>
  );
}
