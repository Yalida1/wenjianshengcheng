import { useState } from "react";
import { Icon } from "../components/UI";
import type { Page } from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckGroup {
  id: string;
  name: string;
  checks: Check[];
}

interface Check {
  id: string;
  label: string;
  status: "pass" | "fail_p0" | "fail_p1" | "fail_p2" | "na";
  detail?: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const GROUPS: CheckGroup[] = [
  {
    id: "g1",
    name: "模板结构完整性",
    checks: [
      { id: "c1-1", label: "模板要求章节全部存在", status: "pass" },
      { id: "c1-2", label: "一级、二级章节顺序正确", status: "pass" },
      { id: "c1-3", label: "无空白必需章节", status: "pass" },
      { id: "c1-4", label: "无重复章节", status: "pass" },
    ],
  },
  {
    id: "g2",
    name: "字段完整性",
    checks: [
      { id: "c2-1", label: "P0 字段全部为已确认状态", status: "pass" },
      { id: "c2-2", label: "不存在 missing 状态的 P0 字段", status: "pass" },
      { id: "c2-3", label: "不存在 conflict 状态的 P0 字段", status: "pass" },
      {
        id: "c2-4",
        label: "不存在未替换模板变量",
        status: "fail_p0",
        detail: "投标人须知第 2.2 节：{{ tender_number }}",
      },
    ],
  },
  {
    id: "g3",
    name: "字段一致性",
    checks: [
      { id: "c3-1", label: "项目名称全文一致", status: "pass" },
      { id: "c3-2", label: "建设单位名称全文一致", status: "pass" },
      {
        id: "c3-3",
        label: "招标预算全文一致",
        status: "fail_p0",
        detail: "招标公告：¥9,800,000；商务要求：¥12,800,000",
      },
    ],
  },
  {
    id: "g4",
    name: "金额与数值",
    checks: [
      { id: "c4-1", label: "数字金额与大写金额一致", status: "pass" },
      { id: "c4-2", label: "招标预算未错误引用可研总投资", status: "pass" },
      { id: "c4-3", label: "设备数量和单位全文一致", status: "pass" },
    ],
  },
  {
    id: "g5",
    name: "日期与期限",
    checks: [
      { id: "c5-1", label: "日期先后顺序合理", status: "pass" },
      {
        id: "c5-2",
        label: "项目总周期未等同本次交付周期",
        status: "fail_p1",
        detail: "请确认采购交付周期（90日）与项目总建设周期关系",
      },
    ],
  },
  {
    id: "g6",
    name: "采购范围",
    checks: [
      { id: "c6-1", label: "采购范围已确认且全文一致", status: "pass" },
      { id: "c6-2", label: "采购范围未超出已确认字段", status: "pass" },
    ],
  },
  {
    id: "g7",
    name: "技术参数",
    checks: [
      { id: "c7-1", label: "技术参数在正文与附件中一致", status: "pass" },
      { id: "c7-2", label: "无无来源技术指标", status: "pass" },
    ],
  },
  {
    id: "g8",
    name: "固定条款",
    checks: [{ id: "c8-1", label: "固定模板条款未被未经授权修改", status: "pass" }],
  },
  {
    id: "g9",
    name: "AI 内容审阅",
    checks: [
      {
        id: "c9-1",
        label: "关键 AI 内容已人工审阅",
        status: "fail_p1",
        detail: "采购需求及技术要求章节存在 3 段未审阅 AI 草稿",
      },
      { id: "c9-2", label: "AI 内容未引用虚构法规或数据", status: "pass" },
    ],
  },
  {
    id: "g10",
    name: "占位符",
    checks: [
      {
        id: "c10-1",
        label: "无未替换的模板变量",
        status: "fail_p0",
        detail: "{{ tender_number }}，位于投标人须知",
      },
    ],
  },
  {
    id: "g11",
    name: "文档格式",
    checks: [
      { id: "c11-1", label: "页眉、页脚、页码符合模板规范", status: "pass" },
      { id: "c11-2", label: "标题样式符合模板规范", status: "pass" },
      { id: "c11-3", label: "无未处理批注", status: "pass" },
    ],
  },
  {
    id: "g12",
    name: "来源可追溯性",
    checks: [
      { id: "c12-1", label: "关键内容可追溯到字段或来源材料", status: "pass" },
      {
        id: "c12-2",
        label: "关键字段可追溯率",
        status: "pass",
        detail: "100%",
      },
    ],
  },
];

function statusCls(s: Check["status"]) {
  if (s === "pass") return "text-[#116B46]";
  if (s === "fail_p0") return "text-[#A8323C]";
  if (s === "fail_p1") return "text-[#8B520B]";
  if (s === "fail_p2") return "text-slate-500";
  return "text-slate-300";
}

function statusIcon(s: Check["status"]) {
  if (s === "pass") return "check-circle";
  if (s === "fail_p0" || s === "fail_p1" || s === "fail_p2") return "x-circle";
  return "circle";
}

function statusSev(s: Check["status"]) {
  if (s === "fail_p0")
    return (
      <span className="rounded px-1 py-0.5 bg-[#FEF1F2] text-[#A8323C] text-[10px] font-bold">
        P0
      </span>
    );
  if (s === "fail_p1")
    return (
      <span className="rounded px-1 py-0.5 bg-[#FFF7E6] text-[#8B520B] text-[10px] font-bold">
        P1
      </span>
    );
  if (s === "fail_p2")
    return (
      <span className="rounded px-1 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold">
        P2
      </span>
    );
  return null;
}

// ─── Page Variants ─────────────────────────────────────────────────────────

type ValidationMode = "default" | "blocked" | "passed";

function ValidationSummary({ mode }: { mode: ValidationMode }) {
  if (mode === "blocked")
    return (
      <div className="mb-6 rounded-xl border border-[#FECDD0] bg-[#FEF1F2] p-5">
        <div className="flex items-start gap-3">
          <Icon name="x-circle" size={20} />
          <div>
            <p className="font-semibold text-[#A8323C] text-base">校验未通过</p>
            <div className="mt-3 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-[#A8323C]">2</p>
                <p className="text-[11px] text-[#A8323C]">P0 阻断问题</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#8B520B]">2</p>
                <p className="text-[11px] text-[#8B520B]">P1 重要问题</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-500">2</p>
                <p className="text-[11px] text-slate-500">P2 建议</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-[#A8323C]">
              请先解决所有 P0 问题。P1 问题需要处理或明确确认后才能定稿。
            </p>
          </div>
        </div>
      </div>
    );
  if (mode === "passed")
    return (
      <div className="mb-6 rounded-xl border border-[#C3E8D5] bg-[#ECF8F2] p-5">
        <div className="flex items-start gap-3">
          <Icon name="check-circle" size={20} />
          <div>
            <p className="font-semibold text-[#116B46] text-base">最终校验已通过</p>
            <div className="mt-3 grid grid-cols-4 gap-3 text-center text-[12px]">
              {[
                { label: "P0 阻断问题", v: "0", cls: "text-[#116B46]" },
                { label: "P1 未处理", v: "0", cls: "text-[#116B46]" },
                { label: "P2 建议", v: "3", cls: "text-slate-500" },
                { label: "模板章节", v: "8/8", cls: "text-[#116B46]" },
                { label: "字段可追溯", v: "100%", cls: "text-[#116B46]" },
                { label: "未替换变量", v: "0", cls: "text-[#116B46]" },
                { label: "未审阅AI内容", v: "0", cls: "text-[#116B46]" },
              ].map((s) => (
                <div key={s.label}>
                  <p className={`text-base font-bold ${s.cls}`}>{s.v}</p>
                  <p className="text-[10px] text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
      <div className="grid grid-cols-4 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-[#A8323C]">2</p>
          <p className="text-[11px] text-slate-500">P0 阻断</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-[#8B520B]">2</p>
          <p className="text-[11px] text-slate-500">P1 重要</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-500">2</p>
          <p className="text-[11px] text-slate-500">P2 建议</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-[#116B46]">0</p>
          <p className="text-[11px] text-slate-500">已解决</p>
        </div>
      </div>
      <div className="mt-3 text-[13px] text-slate-600">
        校验时间：2026-09-05 14:26 · 来源：可研 V1.3 · 字段快照：FS-20260905-001 ·
        模板：货物类公开招标文件模板 V3.0
      </div>
    </div>
  );
}

export function ValidationCenterPage({ navigate }: { navigate: (p: Page) => void }) {
  const mode: ValidationMode = "blocked";
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["g2", "g3", "g5", "g9", "g10"]),
  );

  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allChecks = GROUPS.flatMap((g) => g.checks);
  const failedChecks = allChecks.filter((c) => c.status !== "pass" && c.status !== "na");

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
          <button onClick={() => navigate("document-preview")} className="hover:text-[#24457C]">
            招标文件
          </button>
          <span>/</span>
          <span className="font-medium text-slate-800">校验报告</span>
        </nav>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">招标文件校验报告</h1>
            <p className="mt-1 text-[13px] text-slate-500">招标文件 V0.3 · 2026-09-05 14:26</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-6 xl:px-8">
        <ValidationSummary mode={mode} />

        {/* Actions */}
        <div className="mb-5 flex gap-3">
          <button className="h-10 rounded-lg bg-[#C2414B] px-5 text-sm font-medium text-white hover:bg-[#A8323C]">
            处理阻断问题
          </button>
          <button
            onClick={() => navigate("document-preview")}
            className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]"
          >
            返回文档
          </button>
        </div>

        {/* Check groups */}
        <div className="space-y-3">
          {GROUPS.map((group) => {
            const groupFails = group.checks.filter((c) => c.status !== "pass" && c.status !== "na");
            const expanded = expandedGroups.has(group.id);
            return (
              <div
                key={group.id}
                className="rounded-xl border border-slate-200 bg-white overflow-hidden"
              >
                <button
                  className="w-full flex items-center justify-between px-5 py-3.5"
                  onClick={() => toggleGroup(group.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className={groupFails.length > 0 ? "text-[#A8323C]" : "text-[#116B46]"}>
                      <Icon name={groupFails.length > 0 ? "alert" : "check-circle"} size={15} />
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{group.name}</span>
                    {groupFails.length > 0 && (
                      <span className="text-xs text-[#A8323C]">{groupFails.length} 项问题</span>
                    )}
                  </div>
                  <Icon name="chevron" size={14} />
                </button>
                {expanded && (
                  <div className="border-t border-slate-100">
                    {group.checks.map((check) => (
                      <div
                        key={check.id}
                        className={`flex items-start gap-3 px-5 py-3 border-b border-slate-50 last:border-0 ${
                          check.status !== "pass" && check.status !== "na" ? "bg-[#FAFAFA]" : ""
                        }`}
                      >
                        <span className={`mt-0.5 shrink-0 ${statusCls(check.status)}`}>
                          <Icon name={statusIcon(check.status) as any} size={14} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-slate-700">{check.label}</span>
                            {statusSev(check.status)}
                          </div>
                          {check.detail && (
                            <p
                              className={`text-[12px] mt-0.5 ${
                                check.status !== "pass" ? "text-[#A8323C]" : "text-slate-400"
                              }`}
                            >
                              {check.detail}
                            </p>
                          )}
                        </div>
                        {check.status !== "pass" && check.status !== "na" && (
                          <button className="shrink-0 h-6 rounded border border-slate-300 px-2 text-[11px] text-slate-600 hover:border-[#2E5495]">
                            定位
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
