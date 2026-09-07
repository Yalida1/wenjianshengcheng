import { useState } from "react";
import { Icon } from "../components/UI";

const STATES = [
  { id: "empty", label: "空状态" },
  { id: "loading", label: "加载中" },
  { id: "failed", label: "加载失败" },
  { id: "no-permission", label: "无权限" },
  { id: "upstream-change", label: "上游变化" },
  { id: "version-conflict", label: "版本冲突" },
  { id: "save-failed", label: "保存失败" },
  { id: "template-deprecated", label: "模板过期" },
];

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-slate-100">
        <Icon name="file" size={28} />
      </div>
      <div>
        <p className="text-base font-semibold text-slate-700">暂无文件</p>
        <p className="mt-1 text-[13px] text-slate-400">
          当前阶段尚未生成任何文件，请先完成上一步骤。
        </p>
      </div>
      <button className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]">
        开始创建
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <svg
        className="animate-spin text-[#2E5495]"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M21 12a9 9 0 1 1-9-9" />
        <path d="M21 3v9h-9" />
      </svg>
      <div>
        <p className="text-base font-semibold text-slate-700">加载中</p>
        <p className="mt-1 text-[13px] text-slate-400">正在获取文档内容，请稍候…</p>
      </div>
      <div className="w-48 space-y-2 pt-2">
        {[80, 60, 90].map((w, i) => (
          <div key={i} className="h-3 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-slate-200 animate-pulse"
              style={{ width: `${w}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function FailedState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-[#FEF1F2]">
        <Icon name="x-circle" size={28} />
      </div>
      <div>
        <p className="text-base font-semibold text-[#A8323C]">加载失败</p>
        <p className="mt-1 text-[13px] text-slate-500">无法获取文档内容，请检查网络连接后重试。</p>
        <p className="mt-1 text-[12px] text-slate-400 font-mono">错误代码：ERR_NETWORK_TIMEOUT</p>
      </div>
      <div className="flex gap-3">
        <button className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]">
          重试
        </button>
        <button className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]">
          返回
        </button>
      </div>
    </div>
  );
}

function NoPermissionState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-slate-100">
        <Icon name="settings" size={28} />
      </div>
      <div>
        <p className="text-base font-semibold text-slate-700">无访问权限</p>
        <p className="mt-1 text-[13px] text-slate-500">
          您没有查看此内容的权限。如需访问，请联系项目管理员申请权限。
        </p>
      </div>
      <div className="flex gap-3">
        <button className="h-9 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C]">
          申请权限
        </button>
        <button className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]">
          返回
        </button>
      </div>
    </div>
  );
}

function UpstreamChangeState() {
  return (
    <div className="w-full max-w-[560px]">
      <div className="rounded-xl border border-[#F0C070] bg-[#FFFBEB] p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#F0C070]/30">
            <Icon name="alert" size={20} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-[#8B520B]">上游文件发生变化</p>
            <p className="mt-1 text-[13px] text-[#A86512] leading-5">
              可研报告于 2026-09-05 14:20 更新至 V1.4，当前招标字段确认基于 V1.3
              字段快照，建议重新核查以下字段。
            </p>
            <div className="mt-3 space-y-2">
              {[
                {
                  field: "招标预算金额",
                  change: "V1.3: ¥9,800,000 → V1.4: ¥10,200,000",
                  p: "P0",
                },
                { field: "建设规模描述", change: "内容已更新", p: "P1" },
              ].map((c) => (
                <div
                  key={c.field}
                  className="flex items-center gap-3 rounded-lg bg-white/60 px-3 py-2 text-[12px]"
                >
                  <span
                    className={`rounded px-1.5 py-0.5 font-bold text-[10px] ${
                      c.p === "P0" ? "bg-[#FEF1F2] text-[#A8323C]" : "bg-[#FFF7E6] text-[#8B520B]"
                    }`}
                  >
                    {c.p}
                  </span>
                  <span className="font-medium text-slate-700">{c.field}</span>
                  <span className="text-slate-500 ml-auto">{c.change}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button className="h-8 rounded-lg bg-[#8B520B] px-3 text-[12px] font-medium text-white hover:bg-[#74420A]">
                重新同步字段
              </button>
              <button className="h-8 rounded-lg border border-[#F0C070] px-3 text-[12px] text-[#8B520B] hover:bg-[#FFF7E6]">
                暂时忽略
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VersionConflictState() {
  return (
    <div className="w-full max-w-[560px]">
      <div className="rounded-xl border border-[#FECDD0] bg-[#FEF1F2] p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A8323C]/10">
            <Icon name="x-circle" size={20} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-[#A8323C]">版本冲突</p>
            <p className="mt-1 text-[13px] text-[#A8323C] leading-5">
              此文档已被另一用户修改（李梓涵 · 2026-09-05 14:18），当前编辑内容与服务器版本不一致。
            </p>
            <div className="mt-3 rounded-lg bg-white/60 p-3 text-[12px] space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">服务器版本</span>
                <span className="font-mono text-slate-700">V0.3 · 2026-09-05 14:18</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">本地版本</span>
                <span className="font-mono text-slate-700">V0.3 · 2026-09-05 14:15</span>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button className="h-8 rounded-lg bg-[#2E5495] px-3 text-[12px] font-medium text-white hover:bg-[#24457C]">
                查看差异并合并
              </button>
              <button className="h-8 rounded-lg border border-[#FECDD0] px-3 text-[12px] text-[#A8323C] hover:bg-[#FEF1F2]">
                保存冲突副本
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveFailedState() {
  return (
    <div className="w-full max-w-[480px]">
      <div className="rounded-xl border border-[#FECDD0] bg-[#FEF1F2] p-5">
        <div className="flex items-start gap-3">
          <Icon name="x-circle" size={18} />
          <div>
            <p className="font-semibold text-[#A8323C]">保存失败</p>
            <p className="mt-1 text-[13px] text-[#A8323C] leading-5">
              无法连接服务器，本次修改未能保存。内容已缓存在本地，点击重试恢复。
            </p>
            <div className="mt-3 flex gap-3">
              <button className="h-8 rounded-lg bg-[#A8323C] px-3 text-[12px] font-medium text-white hover:bg-[#8B2030]">
                重试
              </button>
              <button className="h-8 rounded-lg border border-[#FECDD0] px-3 text-[12px] text-[#A8323C]">
                下载本地副本
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-[12px] text-slate-500">
        <p className="font-medium text-slate-700 mb-2">离线状态 · 3 条未同步修改</p>
        {["段落 3.2 内容修改", "招标预算字段确认", "字段来源补充"].map((c, i) => (
          <div
            key={i}
            className="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0"
          >
            <span className="size-1.5 rounded-full bg-[#A86512]" />
            <span>{c}</span>
            <span className="ml-auto text-slate-400">待同步</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplateDeprecatedState() {
  return (
    <div className="w-full max-w-[560px]">
      <div className="rounded-xl border border-[#F0C070] bg-[#FFFBEB] p-5">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#F0C070]/30">
            <Icon name="alert" size={20} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-[#8B520B]">模板已过期</p>
            <p className="mt-1 text-[13px] text-[#A86512] leading-5">
              当前使用的模板（货物类公开招标文件模板 V2.5）已于 2026-09-01 停用，请切换到最新版本。
            </p>
            <div className="mt-3 rounded-lg bg-white/60 p-3 text-[12px] space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">当前模板</span>
                <span className="text-[#A8323C]">V2.5 · 已停用</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">可用最新版</span>
                <span className="text-[#116B46] font-medium">V3.0 · 2026-09-03 发布</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">更新内容</span>
                <span className="text-slate-600">新增评标细则、修订商务要求</span>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button className="h-8 rounded-lg bg-[#8B520B] px-3 text-[12px] font-medium text-white hover:bg-[#74420A]">
                切换到 V3.0
              </button>
              <button className="h-8 rounded-lg border border-[#F0C070] px-3 text-[12px] text-[#8B520B]">
                查看差异
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function UIStatesPage() {
  const [active, setActive] = useState("empty");

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-800">UI 状态展示</h1>
        <p className="mt-1 text-sm text-slate-500">
          用于设计审查，不出现在主导航中。通过 URL hash #ui-states 访问。
        </p>
      </div>
      <div className="grid grid-cols-[200px_1fr] gap-6">
        <aside className="rounded-xl border border-slate-200 bg-white p-3 self-start">
          {STATES.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                s.id === active
                  ? "bg-[#F2F6FC] font-medium text-[#24457C]"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </aside>
        <div className="rounded-xl border border-slate-200 bg-white min-h-[400px] p-8 flex">
          {active === "empty" && <EmptyState />}
          {active === "loading" && <LoadingState />}
          {active === "failed" && <FailedState />}
          {active === "no-permission" && <NoPermissionState />}
          {active === "upstream-change" && <UpstreamChangeState />}
          {active === "version-conflict" && <VersionConflictState />}
          {active === "save-failed" && <SaveFailedState />}
          {active === "template-deprecated" && <TemplateDeprecatedState />}
        </div>
      </div>
    </div>
  );
}
