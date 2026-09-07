import { useState, useEffect, useRef } from "react";
import { Icon } from "../components/UI";
import type { Page } from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PreflightItem {
  id: string;
  label: string;
  status: "checking" | "passed" | "blocked" | "skipped";
  detail?: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const INITIAL_CHECKS: PreflightItem[] = [
  { id: "c1", label: "来源文件版本已锁定", status: "checking" },
  { id: "c2", label: "字段快照已锁定", status: "checking" },
  { id: "c3", label: "P0 字段全部已确认", status: "checking" },
  { id: "c4", label: "P0 来源冲突为零", status: "checking" },
  { id: "c5", label: "P0 未找到字段为零", status: "checking" },
  { id: "c6", label: "模板处于当前有效状态", status: "checking" },
  { id: "c7", label: "模板与采购类型匹配", status: "checking" },
  {
    id: "c8",
    label: "模板必填变量具备可用值",
    status: "checking",
    detail: "30 / 32 个必填变量具备映射值",
  },
  { id: "c9", label: "输出文件名称有效", status: "checking" },
  { id: "c10", label: "当前用户具有生成权限", status: "checking" },
];

const CHAPTERS = [
  "1. 招标公告",
  "2. 投标人须知",
  "3. 项目概况",
  "4. 采购需求及技术要求",
  "5. 商务要求",
  "6. 合同条款及格式",
  "7. 投标文件格式",
  "8. 附件",
];

// ─── Preflight Animation ──────────────────────────────────────────────────────

function usePreflight(running: boolean) {
  const [checks, setChecks] = useState<PreflightItem[]>(INITIAL_CHECKS);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!running) {
      setChecks(INITIAL_CHECKS);
      setDone(false);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    INITIAL_CHECKS.forEach((_, i) => {
      timers.push(
        setTimeout(
          () => {
            setChecks((prev) => prev.map((c, j) => (j === i ? { ...c, status: "passed" } : c)));
            if (i === INITIAL_CHECKS.length - 1) setTimeout(() => setDone(true), 300);
          },
          300 + i * 220,
        ),
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [running]);

  return { checks, done };
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmGenerationDialog({
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
      <div className="w-full max-w-[500px] rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,.18)]">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">确认生成招标文件</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              生成启动后，来源文件、字段快照和模板版本将被锁定，无法修改。
            </p>
          </div>
          <button onClick={onCancel} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <Icon name="close" />
          </button>
        </div>
        <div className="p-6">
          <div className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-[13px]">
            {[
              ["输出文件名", "某省公司中心机房节能改造项目招标文件_草稿"],
              ["使用模板", "货物类公开招标文件模板 V3.0"],
              ["来源文件快照", "可研报告 V1.3 · FS-20260905-001"],
              ["章节数", "8 个一级章节"],
              ["生成策略", "严格模式（5 项已开启）"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <span className="text-slate-500">{k}</span>
                <span className="text-slate-700 font-medium text-right">{v}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-[#DCE7F7] bg-[#F6F8FB] px-4 py-3 text-[13px] text-[#24457C]">
            <Icon name="info" size={13} />{" "}
            生成期间可切换至其他页面，系统将在后台继续生成，完成后通知您。
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="h-10 rounded-lg border border-slate-300 px-5 text-sm font-medium text-slate-600 hover:border-[#2E5495]"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
            >
              确认，开始生成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Policy Toggle ────────────────────────────────────────────────────────────

function PolicyRow({ label, desc, on }: { label: string; desc: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-[13px] font-medium text-slate-700 flex items-center gap-1.5">
          <Icon name="lock" size={12} />
          {label}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
      </div>
      <div
        className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
          on ? "bg-[#ECF8F2] text-[#116B46]" : "bg-slate-100 text-slate-500"
        }`}
      >
        <Icon name={on ? "check" : "close"} size={10} />
        {on ? "已开启" : "已关闭"}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function GenerationSetupPage({
  navigate,
  onConfirmGenerate,
}: {
  navigate: (p: Page) => void;
  onConfirmGenerate: () => void;
}) {
  const [outputName, setOutputName] = useState("某省公司中心机房节能改造项目招标文件_草稿");
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const { checks, done } = usePreflight(preflightRunning);
  const runOnce = useRef(false);

  function startPreflight() {
    if (runOnce.current) return;
    runOnce.current = true;
    setPreflightRunning(true);
  }

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
          <button onClick={() => navigate("template-selection")} className="hover:text-[#24457C]">
            选择模板
          </button>
          <span>/</span>
          <span className="font-medium text-slate-800">配置生成</span>
        </nav>
        <h1 className="text-xl font-semibold text-slate-800">配置生成</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          确认来源信息、生成策略，然后启动预检并生成招标文件。
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-6 xl:px-8">
        <div className="flex gap-6 max-w-[1200px]">
          {/* Left column — main config */}
          <div className="flex-[2] min-w-0 space-y-5">
            {/* Source snapshot */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">来源文件与字段快照</h2>
              <div className="space-y-2 text-[13px]">
                {[
                  {
                    label: "来源文件",
                    value: "可研报告",
                    badge: "V1.3",
                    bCls: "bg-[#ECF8F2] text-[#116B46]",
                    icon: "file" as const,
                    note: "王明远 · 2026-09-04 定稿",
                  },
                  {
                    label: "字段快照",
                    value: "FS-20260905-001",
                    badge: "已锁定",
                    bCls: "bg-[#ECF8F2] text-[#116B46]",
                    icon: "lock" as const,
                    note: "42 个字段 · P0 × 12 全部已确认",
                  },
                ].map((r) => (
                  <div
                    key={r.label}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-4 py-3 bg-slate-50"
                  >
                    <div className="flex items-center gap-3">
                      <Icon name={r.icon} size={15} />
                      <div>
                        <p className="text-slate-500 text-xs">{r.label}</p>
                        <p className="text-slate-800 font-medium">{r.value}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">{r.note}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${r.bCls}`}>
                        {r.badge}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Template */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">选定模板</h2>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-[#DCE7F7] bg-[#F6F8FB] px-4 py-3">
                <div>
                  <p className="font-medium text-slate-800">货物类公开招标文件模板</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    公司标准模板库 · 模板管理员 李敏 · 生效：2026-01-01
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-[#ECF8F2] text-[#116B46]">
                    当前有效
                  </span>
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-[#ECF8F2] text-[#116B46]">
                    高度匹配
                  </span>
                  <span className="font-mono text-xs text-slate-500">V3.0</span>
                </div>
              </div>
            </section>

            {/* Output file */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">输出文件设置</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1.5">输出文件名称</label>
                  <input
                    value={outputName}
                    onChange={(e) => setOutputName(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#DCE7F7]"
                  />
                  <p className="mt-1 text-xs text-slate-400">不含扩展名，最终将生成 .docx 文档</p>
                </div>
                <div className="flex gap-5">
                  <label className="flex items-center gap-2 text-[13px] text-slate-600">
                    <input type="checkbox" defaultChecked className="accent-[#2E5495]" />
                    同时生成 PDF 预览版
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-slate-600">
                    <input type="checkbox" className="accent-[#2E5495]" />
                    生成用于比对的 HTML 版本
                  </label>
                </div>
              </div>
            </section>

            {/* Chapter list */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">
                章节生成范围（8 个一级章节）
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {CHAPTERS.map((ch) => (
                  <div
                    key={ch}
                    className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700"
                  >
                    <Icon name="check-circle" size={13} />
                    {ch}
                  </div>
                ))}
              </div>
            </section>

            {/* Generation policies */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold text-slate-800">生成策略（已锁定）</h2>
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Icon name="lock" size={11} />
                  管理员可在系统设置中调整
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                以下策略由组织统一配置，本次生成不可修改。
              </p>
              {[
                {
                  label: "严格字段映射",
                  desc: "仅使用已确认字段，不允许 AI 推断补全缺失的必填变量",
                  on: true,
                },
                {
                  label: "禁止自由创作段落",
                  desc: "章节描述必须来自字段或模板内置文本，不允许 AI 生成",
                  on: true,
                },
                {
                  label: "合规用词库过滤",
                  desc: "自动替换不合规表述，如「谈判」改为「投标」等",
                  on: true,
                },
                {
                  label: "一致性校验",
                  desc: "同一字段在不同章节出现时，保证表述一致",
                  on: true,
                },
                {
                  label: "版本水印",
                  desc: "在草稿页眉嵌入字段快照版本号和生成任务 ID",
                  on: true,
                },
              ].map((p) => (
                <PolicyRow key={p.label} {...p} />
              ))}
            </section>
          </div>

          {/* Right column — preflight + summary */}
          <div className="w-[300px] shrink-0 space-y-4">
            {/* Preflight checklist */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">预检清单</h2>
              {!preflightRunning && (
                <p className="mb-4 text-[13px] text-slate-500">
                  点击"运行预检"验证所有条件后，即可启动生成。
                </p>
              )}
              <div className="space-y-2 mb-4">
                {checks.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <div
                      className={`mt-0.5 shrink-0 ${
                        c.status === "passed"
                          ? "text-[#116B46]"
                          : c.status === "blocked"
                            ? "text-[#A8323C]"
                            : c.status === "checking" && preflightRunning
                              ? "text-[#2E5495]"
                              : "text-slate-300"
                      }`}
                    >
                      {c.status === "passed" && <Icon name="check-circle" size={15} />}
                      {c.status === "blocked" && <Icon name="x-circle" size={15} />}
                      {c.status === "checking" && preflightRunning && (
                        <svg
                          width="15"
                          height="15"
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
                      {c.status === "checking" && !preflightRunning && (
                        <Icon name="circle" size={15} />
                      )}
                    </div>
                    <div>
                      <p
                        className={`text-[13px] leading-snug ${
                          c.status === "passed"
                            ? "text-slate-700"
                            : c.status === "blocked"
                              ? "text-[#A8323C]"
                              : "text-slate-400"
                        }`}
                      >
                        {c.label}
                      </p>
                      {c.detail && c.status === "passed" && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{c.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {!preflightRunning && (
                <button
                  onClick={startPreflight}
                  className="w-full h-9 rounded-lg bg-[#2E5495] text-sm font-medium text-white hover:bg-[#24457C]"
                >
                  运行预检
                </button>
              )}
              {preflightRunning && !done && (
                <div className="flex items-center justify-center gap-2 text-[13px] text-[#2E5495] py-1">
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
                  预检中，请稍候…
                </div>
              )}
              {done && (
                <div className="rounded-lg border border-[#C3E8D5] bg-[#ECF8F2] px-3 py-2.5 flex items-center gap-2 text-sm text-[#116B46] font-medium">
                  <Icon name="check-circle" size={15} />
                  全部 10 项预检通过
                </div>
              )}
            </section>

            {/* Summary */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">生成摘要</h2>
              <dl className="space-y-2 text-[13px]">
                {[
                  ["章节数", "8"],
                  ["模板变量", "46 个 · 32 必填"],
                  ["已映射变量", "30 / 32"],
                  ["字段快照", "FS-20260905-001"],
                  ["预计时长", "约 2–3 分钟"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-slate-700 font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* Actions */}
            <div className="space-y-2">
              <button
                disabled={!done}
                onClick={() => setShowConfirmDialog(true)}
                className="w-full h-10 rounded-lg bg-[#2E5495] text-sm font-medium text-white hover:bg-[#24457C] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                {done ? "确认并开始生成" : "请先完成预检"}
              </button>
              <button
                onClick={() => navigate("template-selection")}
                className="w-full h-10 rounded-lg border border-slate-300 bg-white text-sm text-slate-600 hover:border-[#2E5495]"
              >
                返回选择模板
              </button>
            </div>
          </div>
        </div>
      </div>

      {showConfirmDialog && (
        <ConfirmGenerationDialog
          onCancel={() => setShowConfirmDialog(false)}
          onConfirm={() => {
            setShowConfirmDialog(false);
            onConfirmGenerate();
            navigate("generation-progress");
          }}
        />
      )}
    </div>
  );
}
