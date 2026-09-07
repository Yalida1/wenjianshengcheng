import { useState, useEffect, useCallback } from "react";
import { Icon } from "../components/UI";
import type { Page } from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "done" | "running" | "pending" | "failed";

interface GenStep {
  id: string;
  name: string;
  status: StepStatus;
  detail?: string;
}

interface ChapterItem {
  id: string;
  name: string;
  status: "done" | "generating" | "pending" | "failed";
}

interface LogEntry {
  time: string;
  level: "info" | "warn" | "error";
  msg: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const INITIAL_STEPS: GenStep[] = [
  {
    id: "s1",
    name: "锁定来源文件与字段快照",
    status: "done",
    detail: "FS-20260905-001",
  },
  {
    id: "s2",
    name: "读取模板结构和变量",
    status: "done",
    detail: "货物类公开招标 V3.0 · 46 变量",
  },
  {
    id: "s3",
    name: "填充确定性字段",
    status: "done",
    detail: "30 个确定性变量已填充",
  },
  { id: "s4", name: "分章节生成动态内容", status: "running" },
  { id: "s5", name: "装配表格和附件", status: "pending" },
  { id: "s6", name: "执行基础一致性检查", status: "pending" },
  { id: "s7", name: "生成预览版本", status: "pending" },
  { id: "s8", name: "保存招标文件草稿", status: "pending" },
];

const INITIAL_CHAPTERS: ChapterItem[] = [
  { id: "ch1", name: "招标公告", status: "done" },
  { id: "ch2", name: "投标人须知", status: "done" },
  { id: "ch3", name: "项目概况", status: "done" },
  { id: "ch4", name: "采购需求及技术要求", status: "generating" },
  { id: "ch5", name: "商务要求", status: "pending" },
  { id: "ch6", name: "合同条款及格式", status: "pending" },
  { id: "ch7", name: "投标文件格式", status: "pending" },
  { id: "ch8", name: "附件", status: "pending" },
];

const INITIAL_LOG: LogEntry[] = [
  { time: "09:03:00", level: "info", msg: "任务 GEN-20260905-001 已创建" },
  {
    time: "09:03:01",
    level: "info",
    msg: "来源文件锁定：可研报告 V1.3 (FS-20260905-001)",
  },
  {
    time: "09:03:02",
    level: "info",
    msg: "模板已加载：货物类公开招标文件模板 V3.0",
  },
  { time: "09:03:04", level: "info", msg: "填充 30 个确定性变量完成" },
  { time: "09:03:06", level: "info", msg: "开始生成章节 1：招标公告" },
  { time: "09:03:12", level: "info", msg: "章节 1 完成，字数 624" },
  { time: "09:03:13", level: "info", msg: "开始生成章节 2：投标人须知" },
  { time: "09:03:22", level: "info", msg: "章节 2 完成，字数 1842" },
  { time: "09:03:24", level: "info", msg: "开始生成章节 3：项目概况" },
  { time: "09:03:31", level: "info", msg: "章节 3 完成，字数 980" },
  {
    time: "09:03:32",
    level: "info",
    msg: "开始生成章节 4：采购需求及技术要求",
  },
];

// ─── Banner Components ────────────────────────────────────────────────────────

function SourceChangedBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-start gap-3 border-b border-[#FDDBA0] bg-[#FFF7E6] px-6 py-3 xl:px-8">
      <Icon name="alert" size={15} />
      <p className="flex-1 text-[13px] text-[#8B520B]">
        <strong>来源文件已更新：</strong>可研报告已于 09:01 更新至 V1.4，本次生成已锁定 V1.3
        版本，不受影响。生成完成后可在项目详情中决定是否重新生成。
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-[#8B520B] hover:text-[#6A3E08]"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

// ─── Cancel Dialog ────────────────────────────────────────────────────────────

function CancelGenerationDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-slate-950/25 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[440px] rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,.18)]">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-slate-800">取消生成？</h2>
          <button onClick={onCancel} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <Icon name="close" />
          </button>
        </div>
        <div className="p-6">
          <p className="text-[13px] text-slate-600 leading-6">
            取消后，本次生成任务将被中止，已生成的部分内容不会被保存。 您可以随时重新配置并生成。
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="h-10 rounded-lg border border-slate-300 px-5 text-sm font-medium text-slate-600 hover:border-[#2E5495]"
            >
              继续生成
            </button>
            <button
              onClick={onConfirm}
              className="h-10 rounded-lg border border-[#FECDD0] bg-[#FEF1F2] px-5 text-sm font-medium text-[#A8323C] hover:bg-[#FDDDE0]"
            >
              确认取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Document Preview Placeholder (W08) ──────────────────────────────────────

function DocumentPreviewPlaceholder({ navigate }: { navigate: (p: Page) => void }) {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3">
          <button onClick={() => navigate("project-list")} className="hover:text-[#24457C]">
            项目空间
          </button>
          <span>/</span>
          <button onClick={() => navigate("project-detail")} className="hover:text-[#24457C]">
            某省公司中心机房节能改造项目
          </button>
          <span>/</span>
          <span className="font-medium text-slate-800">预览与审校</span>
        </nav>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">招标文件 · 预览与审校</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              某省公司中心机房节能改造项目招标文件_草稿 · 任务 GEN-20260905-001
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-600 hover:border-[#2E5495]">
              <Icon name="copy" size={15} />
              导出 .docx
            </button>
            <button
              onClick={() => navigate("generation-progress")}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-600 hover:border-[#2E5495]"
            >
              查看生成报告
            </button>
          </div>
        </div>
      </div>

      {/* 3-panel body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* TOC panel */}
        <aside className="w-56 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">目录</p>
          </div>
          <nav className="py-2">
            {[
              "1. 招标公告",
              "2. 投标人须知",
              "3. 项目概况",
              "4. 采购需求及技术要求",
              "5. 商务要求",
              "6. 合同条款及格式",
              "7. 投标文件格式",
              "8. 附件",
            ].map((ch, i) => (
              <button
                key={ch}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left text-[13px] hover:bg-slate-50 ${
                  i === 0 ? "text-[#24457C] font-medium bg-[#F2F6FC]" : "text-slate-600"
                }`}
              >
                <Icon name="hash" size={12} />
                {ch}
              </button>
            ))}
          </nav>
        </aside>

        {/* A4 canvas */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-slate-200/50 p-8">
          <div className="mx-auto max-w-[794px] min-h-[1123px] bg-white shadow-[0_2px_16px_rgba(15,23,42,.12)] rounded-sm px-20 py-16">
            <div className="border-b border-slate-200 pb-8 mb-8 text-center">
              <p className="text-xs text-slate-400 tracking-widest mb-4">某省通信有限公司</p>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">
                某省公司中心机房节能改造项目
              </h1>
              <h2 className="text-xl font-semibold text-slate-700">招 标 文 件</h2>
              <p className="mt-4 text-sm text-slate-500">（草稿 · 仅供审阅，不得对外发布）</p>
            </div>
            <div className="space-y-6 text-sm text-slate-700 leading-7">
              <section>
                <h2 className="text-base font-bold text-slate-900 mb-3 pb-1 border-b border-slate-200">
                  第一章 招标公告
                </h2>
                <p>
                  某省通信有限公司（以下简称"招标人"）对某省公司中心机房节能改造项目所需货物及安装服务进行公开招标，欢迎符合资格条件的供应商参与投标。
                </p>
                <p className="mt-4">
                  <strong>一、项目名称：</strong>某省公司中心机房节能改造项目
                </p>
                <p className="mt-2">
                  <strong>二、采购类型：</strong>货物类（含安装）
                </p>
                <p className="mt-2">
                  <strong>三、采购方式：</strong>公开招标
                </p>
                <p className="mt-2">
                  <strong>四、投标截止时间：</strong>以补充公告为准
                </p>
              </section>
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-400 italic">
                <Icon name="layers" size={14} />
                后续章节正在加载预览，实际内容以最终导出文件为准。
              </div>
            </div>
          </div>
        </main>

        {/* Review panel */}
        <aside className="w-64 shrink-0 border-l border-slate-200 bg-white overflow-y-auto">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">审校面板</p>
          </div>
          <div className="p-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[13px] text-slate-500 text-center leading-6">
              <Icon name="shield" size={18} />
              <p className="mt-2">审校功能</p>
              <p className="text-xs">正式版将提供一致性检查、合规检查及审批流程入口</p>
            </div>
            <div className="mt-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500">快速统计</p>
              {[
                ["总字数", "约 12,400"],
                ["章节数", "8"],
                ["表格数", "6"],
                ["附件数", "4"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-[13px]">
                  <span className="text-slate-500">{k}</span>
                  <span className="text-slate-700 font-medium">{v}</span>
                </div>
              ))}
            </div>
            <button className="mt-4 w-full h-9 rounded-lg bg-[#2E5495] text-sm font-medium text-white hover:bg-[#24457C]">
              导出审校报告
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Main Generation Progress Page ───────────────────────────────────────────

export function GenerationProgressPage({
  navigate,
  onBgRun,
}: {
  navigate: (p: Page) => void;
  onBgRun: () => void;
}) {
  const [steps, setSteps] = useState<GenStep[]>(INITIAL_STEPS);
  const [chapters, setChapters] = useState<ChapterItem[]>(INITIAL_CHAPTERS);
  const [log, setLog] = useState<LogEntry[]>(INITIAL_LOG);
  const [logExpanded, setLogExpanded] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [currentStep, setCurrentStep] = useState(4);

  const addLog = useCallback((level: LogEntry["level"], msg: string) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    setLog((prev) => [...prev, { time, level, msg }]);
  }, []);

  // Simulation
  useEffect(() => {
    let chIdx = 4; // next chapter index (0-based)
    const advance = () => {
      if (chIdx >= 8) {
        // All chapters done — advance remaining steps
        setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as StepStatus })));
        setCompleted(true);
        addLog("info", "所有章节生成完成");
        addLog("info", "一致性检查通过");
        addLog("info", "招标文件草稿已保存：某省公司中心机房节能改造项目招标文件_草稿.docx");
        return;
      }
      setChapters((prev) =>
        prev.map((c, i) => {
          if (i === chIdx) return { ...c, status: "done" };
          if (i === chIdx + 1 && i < 8) return { ...c, status: "generating" };
          return c;
        }),
      );
      if (chIdx + 1 < 8) addLog("info", `开始生成章节 ${chIdx + 2}`);
      else addLog("info", "章节生成完成，开始装配表格");
      setCurrentStep(4);
      if (chIdx >= 6) {
        setSteps((prev) =>
          prev.map((s, i) =>
            i === 3 ? { ...s, status: "done" } : i === 4 ? { ...s, status: "running" } : s,
          ),
        );
      }
      chIdx++;
      setTimeout(advance, 2200 + Math.random() * 1000);
    };
    const t = setTimeout(advance, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneChapters = chapters.filter((c) => c.status === "done").length;
  const progress = Math.round((doneChapters / 8) * 100);

  useEffect(() => {
    if (completed) navigate("document-preview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <SourceChangedBanner />

      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3">
          <button onClick={() => navigate("project-list")} className="hover:text-[#24457C]">
            项目空间
          </button>
          <span>/</span>
          <button onClick={() => navigate("project-detail")} className="hover:text-[#24457C]">
            某省公司中心机房节能改造项目
          </button>
          <span>/</span>
          <span className="font-medium text-slate-800">生成中</span>
        </nav>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-slate-800">招标文件生成</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F2F6FC] px-3 py-1 text-xs font-medium text-[#24457C]">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="animate-spin"
                >
                  <path d="M21 12a9 9 0 1 1-9-9" />
                  <path d="M21 3v9h-9" />
                </svg>
                生成中
              </span>
            </div>
            <p className="mt-1 text-[13px] text-slate-500">
              任务 ID：GEN-20260905-001 · 开始于 09:03:00
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                onBgRun();
                navigate("project-detail");
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-600 hover:border-[#2E5495]"
            >
              返回项目（后台继续）
            </button>
            <button
              onClick={() => setShowCancel(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#FECDD0] bg-[#FEF1F2] px-4 text-sm font-medium text-[#A8323C] hover:bg-[#FDDDE0]"
            >
              <Icon name="stop" size={14} />
              取消生成
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-6 xl:px-8">
        {/* Meta strip */}
        <div className="mb-5 flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-[13px]">
          {[
            ["来源文件", "可研报告 V1.3（已锁定）"],
            ["字段快照", "FS-20260905-001（已锁定）"],
            ["模板", "货物类公开招标文件模板 V3.0（已锁定）"],
            ["操作人", "王明远"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="text-slate-500">{k}：</span>
              <span className="text-slate-700 font-medium">{v}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-6">
          {/* Steps */}
          <div className="flex-1 min-w-0 space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-4">生成步骤</h2>
              <div className="space-y-1">
                {steps.map((s, i) => (
                  <div
                    key={s.id}
                    className={`flex items-start gap-3 rounded-lg px-3 py-3 ${
                      s.status === "running" ? "bg-[#F2F6FC]" : ""
                    }`}
                  >
                    <div
                      className={`mt-0.5 shrink-0 ${
                        s.status === "done"
                          ? "text-[#116B46]"
                          : s.status === "running"
                            ? "text-[#2E5495]"
                            : s.status === "failed"
                              ? "text-[#A8323C]"
                              : "text-slate-300"
                      }`}
                    >
                      {s.status === "done" && <Icon name="check-circle" size={16} />}
                      {s.status === "running" && (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="animate-spin"
                        >
                          <path d="M21 12a9 9 0 1 1-9-9" />
                          <path d="M21 3v9h-9" />
                        </svg>
                      )}
                      {s.status === "pending" && <Icon name="circle" size={16} />}
                      {s.status === "failed" && <Icon name="x-circle" size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-[13px] font-medium ${
                          s.status === "pending" ? "text-slate-400" : "text-slate-700"
                        }`}
                      >
                        {i + 1}. {s.name}
                        {s.status === "running" && (
                          <span className="ml-2 text-xs font-normal text-[#2E5495]">进行中…</span>
                        )}
                      </p>
                      {s.detail && s.status === "done" && (
                        <p className="text-xs text-slate-400 mt-0.5">{s.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Event log */}
            <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-4"
                onClick={() => setLogExpanded((x) => !x)}
              >
                <span className="text-sm font-semibold text-slate-800">
                  事件日志（{log.length} 条）
                </span>
                <Icon name="chevron" size={15} />
              </button>
              {logExpanded && (
                <div className="border-t border-slate-100 bg-slate-950 rounded-b-xl max-h-48 overflow-y-auto font-mono p-4 space-y-1">
                  {log.map((entry, i) => (
                    <div
                      key={i}
                      className={`text-[11px] flex gap-3 ${
                        entry.level === "error"
                          ? "text-red-400"
                          : entry.level === "warn"
                            ? "text-amber-400"
                            : "text-slate-400"
                      }`}
                    >
                      <span className="shrink-0 text-slate-600">{entry.time}</span>
                      <span className="shrink-0 uppercase text-[10px] font-semibold">
                        {entry.level}
                      </span>
                      <span>{entry.msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Chapter progress */}
          <div className="w-[280px] shrink-0 space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-800">章节进度</h2>
                <span className="text-xs font-medium text-slate-500">{doneChapters}/8</span>
              </div>
              <div className="mb-4 h-2 rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-[#2E5495] transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="space-y-2">
                {chapters.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] ${
                      c.status === "generating" ? "bg-[#F2F6FC]" : ""
                    }`}
                  >
                    <span
                      className={`shrink-0 ${
                        c.status === "done"
                          ? "text-[#116B46]"
                          : c.status === "generating"
                            ? "text-[#2E5495]"
                            : c.status === "failed"
                              ? "text-[#A8323C]"
                              : "text-slate-300"
                      }`}
                    >
                      {c.status === "done" && <Icon name="check-circle" size={14} />}
                      {c.status === "generating" && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="animate-spin"
                        >
                          <path d="M21 12a9 9 0 1 1-9-9" />
                          <path d="M21 3v9h-9" />
                        </svg>
                      )}
                      {c.status === "pending" && <Icon name="circle" size={14} />}
                      {c.status === "failed" && <Icon name="x-circle" size={14} />}
                    </span>
                    <span className={c.status === "pending" ? "text-slate-400" : "text-slate-700"}>
                      {c.name}
                    </span>
                    {c.status === "generating" && (
                      <span className="ml-auto text-[11px] text-[#2E5495]">生成中…</span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold text-slate-500 mb-2">已生成字数（估计）</p>
              <p className="text-2xl font-semibold text-slate-800">
                {(doneChapters * 1450 + 800).toLocaleString()}
              </p>
              <p className="text-xs text-slate-400 mt-1">预计总字数约 12,000</p>
            </section>
          </div>
        </div>
      </div>

      {showCancel && (
        <CancelGenerationDialog
          onCancel={() => setShowCancel(false)}
          onConfirm={() => {
            setShowCancel(false);
            navigate("generation-setup");
          }}
        />
      )}
    </div>
  );
}
