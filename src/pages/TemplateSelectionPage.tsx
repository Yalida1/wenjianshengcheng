import { useState, useEffect } from "react";
import { Icon } from "../components/UI";
import type { Page } from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateStatus = "active"|"deprecated"|"expired"|"draft"|"pending"|"na";
type MatchLevel = "high"|"medium"|"low"|"none";

interface Template {
  id: string;
  name: string;
  version: string;
  status: TemplateStatus;
  matchLevel: MatchLevel;
  type: string;
  effectiveDate: string;
  updatedBy: string;
  updatedDate: string;
  chapters: number;
  variables: number;
  source: string;
  mismatchReason?: string;
  deprecatedDate?: string;
  replacement?: string;
  requiredVars: number;
  availableVars: number;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  {
    id:"t1", name:"货物类公开招标文件模板", version:"V3.0", status:"active", matchLevel:"high",
    type:"货物类公开招标", effectiveDate:"2026-01-01", updatedBy:"模板管理员 李敏",
    updatedDate:"2026-01-15", chapters:8, variables:46, source:"公司标准模板库",
    requiredVars:32, availableVars:30,
  },
  {
    id:"t2", name:"设备采购及安装招标文件模板", version:"V2.2", status:"active", matchLevel:"medium",
    type:"设备采购及安装", effectiveDate:"2025-07-01", updatedBy:"模板管理员 张伟",
    updatedDate:"2025-08-10", chapters:7, variables:38, source:"公司标准模板库",
    requiredVars:28, availableVars:28,
  },
  {
    id:"t3", name:"通用服务类公开招标文件模板", version:"V2.4", status:"na", matchLevel:"none",
    type:"服务类", effectiveDate:"2025-03-01", updatedBy:"模板管理员 李敏",
    updatedDate:"2025-05-20", chapters:7, variables:35, source:"公司标准模板库",
    mismatchReason:"当前项目采购类型为货物类，该模板适用于服务类。",
    requiredVars:24, availableVars:20,
  },
  {
    id:"t4", name:"货物类公开招标文件模板旧版", version:"V2.6", status:"deprecated", matchLevel:"none",
    type:"货物类公开招标", effectiveDate:"2024-01-01", updatedBy:"模板管理员 李敏",
    updatedDate:"2024-12-30", chapters:7, variables:41, source:"公司标准模板库",
    deprecatedDate:"2026-06-30", replacement:"货物类公开招标文件模板 V3.0",
    requiredVars:29, availableVars:26,
  },
];

const CHAPTERS_PREVIEW = [
  "招标公告","投标人须知","项目概况","采购需求及技术要求",
  "商务要求","合同条款及格式","投标文件格式","附件",
];

// ─── Badge Components ─────────────────────────────────────────────────────────

const STATUS_META: Record<TemplateStatus, {label:string;cls:string;icon:"check-circle"|"alert"|"clock"|"x-circle"|"circle"}> = {
  active:     {label:"当前有效", cls:"bg-[#ECF8F2] text-[#116B46]", icon:"check-circle"},
  deprecated: {label:"已停用",   cls:"bg-[#FEF1F2] text-[#A8323C]", icon:"x-circle"},
  expired:    {label:"已过期",   cls:"bg-slate-100 text-slate-500",  icon:"clock"},
  draft:      {label:"草稿",     cls:"bg-[#EEF2FF] text-[#3B5BCC]", icon:"circle"},
  pending:    {label:"待发布",   cls:"bg-[#FFF7E6] text-[#8B520B]", icon:"clock"},
  na:         {label:"不适用",   cls:"bg-slate-100 text-slate-500",  icon:"alert"},
};

function TemplateStatusBadge({status}:{status:TemplateStatus}) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>
      <Icon name={m.icon} size={11}/>{m.label}
    </span>
  );
}

const MATCH_META: Record<MatchLevel, {label:string;cls:string}> = {
  high:   {label:"高度匹配", cls:"text-[#116B46] bg-[#ECF8F2]"},
  medium: {label:"较高匹配", cls:"text-[#8B520B] bg-[#FFF7E6]"},
  low:    {label:"低匹配",   cls:"text-slate-500 bg-slate-100"},
  none:   {label:"不匹配",   cls:"text-[#A8323C] bg-[#FEF1F2]"},
};

function TemplateMatchBadge({level}:{level:MatchLevel}) {
  const m = MATCH_META[level];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>
      {level==="high"&&<Icon name="star" size={10}/>}
      {m.label}
    </span>
  );
}

// ─── Template Preview Drawer ──────────────────────────────────────────────────

function TemplatePreviewDrawer({template, onClose, onSelect}:{template:Template;onClose:()=>void;onSelect:()=>void}) {
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  return (
    <div className="fixed inset-0 z-20">
      <button aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-slate-950/10"/>
      <aside className="absolute right-0 top-0 h-full w-[440px] max-w-[calc(100vw-48px)] border-l border-slate-200 bg-white shadow-[-12px_0_30px_rgba(15,23,42,.08)]">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <h2 className="font-semibold text-slate-800">模板预览</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <Icon name="close"/>
          </button>
        </div>
        <div className="h-[calc(100%-64px)] overflow-auto p-6">
          {/* Header */}
          <div className="mb-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="text-base font-semibold text-slate-800 leading-snug">{template.name}</h3>
              <span className="shrink-0 font-mono text-xs text-slate-500">{template.version}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <TemplateStatusBadge status={template.status}/>
              <TemplateMatchBadge level={template.matchLevel}/>
            </div>
          </div>

          {template.status==="deprecated" && (
            <div className="mb-4 rounded-lg border border-[#FECDD0] bg-[#FEF1F2] p-3 text-sm">
              <p className="font-medium text-[#A8323C]">该模板已于 {template.deprecatedDate} 停用</p>
              <p className="mt-1 text-xs text-[#A8323C]">替代模板：{template.replacement}</p>
            </div>
          )}
          {template.mismatchReason && (
            <div className="mb-4 rounded-lg border border-[#FDDBA0] bg-[#FFF7E6] p-3 text-sm text-[#8B520B]">
              <Icon name="alert" size={13}/>{" "}{template.mismatchReason}
            </div>
          )}

          {/* Meta */}
          <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dl className="space-y-2 text-[13px]">
              {[
                ["适用范围", template.type],
                ["生效时间", template.effectiveDate],
                ["来源", template.source],
                ["最近更新人", template.updatedBy],
                ["最近更新", template.updatedDate],
              ].map(([k,v])=>(
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-slate-700 text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Chapter structure */}
          <div className="mb-5">
            <p className="mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">章节结构（{template.chapters} 个一级章节）</p>
            <div className="space-y-1">
              {CHAPTERS_PREVIEW.slice(0, template.chapters).map((ch,i)=>(
                <div key={ch} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] text-slate-400">{i+1}.</span>
                  {ch}
                </div>
              ))}
            </div>
          </div>

          {/* Variable summary */}
          <div className="mb-5">
            <p className="mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">模板变量（共 {template.variables} 个）</p>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 grid grid-cols-3 gap-3 text-center">
                {[
                  {label:"必填变量", v:template.requiredVars, cls:"text-slate-800"},
                  {label:"已具备", v:template.availableVars, cls:"text-[#116B46]"},
                  {label:"待确认", v:template.requiredVars-template.availableVars, cls:"text-[#8B520B]"},
                ].map(s=>(
                  <div key={s.label}>
                    <p className={`text-xl font-semibold ${s.cls}`}>{s.v}</p>
                    <p className="text-[11px] text-slate-500">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="h-1.5 rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-[#2E5495]" style={{width:`${Math.round(template.availableVars/template.requiredVars*100)}%`}}/>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                {[["项目基础字段","12 个"],["采购范围字段","8 个"],["技术字段","10 个"],["商务字段","9 个"],["其他字段","7 个"]].map(([k,v])=>(
                  <div key={k} className="flex justify-between"><span>{k}</span><span>{v}</span></div>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {template.status==="active" && template.matchLevel!=="none" && (
              <button onClick={()=>{onSelect();onClose();}}
                className="w-full rounded-lg bg-[#2E5495] py-2.5 text-sm font-medium text-white hover:bg-[#24457C]">
                选择此模板
              </button>
            )}
            <button className="w-full rounded-lg border border-slate-300 py-2.5 text-sm text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
              查看版本记录
            </button>
            <button className="w-full rounded-lg border border-slate-300 py-2.5 text-sm text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
              查看完整变量清单
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Context Summary ──────────────────────────────────────────────────────────

function TemplateContextSummary() {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3">
      {[
        ["项目名称","某省公司中心机房节能改造项目"],
        ["采购类型","货物类"],
        ["采购内容","设备采购及安装"],
        ["采购方式","公开招标"],
        ["来源文件","可研报告 V1.3"],
        ["字段快照","FS-20260905-001"],
        ["P0 字段","12 / 12 已确认"],
      ].map(([k,v])=>(
        <div key={k} className="flex items-center gap-2 text-[13px]">
          <span className="text-slate-500">{k}：</span>
          <span className={`font-medium ${k==="P0 字段"?"text-[#116B46]":"text-slate-700"}`}>{v}</span>
        </div>
      ))}
      <button className="ml-auto text-xs text-[#2E5495] hover:underline">查看已确认字段</button>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

function TemplateFilterBar({search, onSearch}:{search:string;onSearch:(v:string)=>void}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3 xl:px-8">
      <label className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" size={15}/></span>
        <input className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#DCE7F7]"
          placeholder="搜索模板名称" value={search} onChange={e=>onSearch(e.target.value)}/>
      </label>
      {[
        {label:"文件阶段", value:"招标文件"},
        {label:"采购类型", value:"货物类"},
        {label:"采购方式", value:"公开招标"},
      ].map(f=>(
        <div key={f.label} className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">{f.label}：</span>
          <span className="rounded-md border border-[#DCE7F7] bg-[#F2F6FC] px-2 py-1 text-xs font-medium text-[#24457C]">{f.value}</span>
        </div>
      ))}
      <select className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-600 focus:border-[#2E5495] focus:outline-none">
        <option>全部状态</option>
        <option>当前有效</option>
        <option>已停用</option>
      </select>
      <select className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-600 focus:border-[#2E5495] focus:outline-none">
        <option>最近更新时间</option>
      </select>
    </div>
  );
}

// ─── Template Row ─────────────────────────────────────────────────────────────

function TemplateRow({t, selected, onSelect, onPreview}:{t:Template;selected:boolean;onSelect:()=>void;onPreview:()=>void}) {
  const selectable = t.status==="active" && t.matchLevel!=="none";
  return (
    <tr className={`border-b border-slate-100 transition-colors ${selected?"bg-[#F2F6FC]":selectable?"hover:bg-[#FBFCFE]":"opacity-70"}`}>
      <td className="px-5 py-4 w-10">
        <button
          disabled={!selectable}
          onClick={onSelect}
          className={`size-5 rounded-full border-2 flex items-center justify-center transition-colors ${selected?"border-[#2E5495] bg-[#2E5495]":selectable?"border-slate-400 hover:border-[#2E5495]":"border-slate-200 cursor-not-allowed"}`}>
          {selected && <span className="size-2 rounded-full bg-white"/>}
        </button>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-start gap-2 flex-wrap">
          <p className={`font-medium ${selectable?"text-slate-800":"text-slate-500"}`}>{t.name}</p>
          {selected && <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-[#2E5495] text-white"><Icon name="check" size={10}/>已选择</span>}
        </div>
        <p className="mt-0.5 text-xs text-slate-400">{t.source}</p>
        {t.mismatchReason && <p className="mt-1 text-xs text-[#A8323C]"><Icon name="alert" size={11}/>{" "}{t.mismatchReason}</p>}
        {t.status==="deprecated" && <p className="mt-1 text-xs text-[#A8323C]"><Icon name="x-circle" size={11}/>{" "}已停用于 {t.deprecatedDate}。替代：{t.replacement}</p>}
      </td>
      <td className="px-4 py-4 hidden xl:table-cell">
        <TemplateMatchBadge level={t.matchLevel}/>
      </td>
      <td className="px-4 py-4 text-[13px] text-slate-600 hidden xl:table-cell">{t.type}</td>
      <td className="px-4 py-4">
        <span className="font-mono text-sm text-slate-700">{t.version}</span>
      </td>
      <td className="px-4 py-4">
        <TemplateStatusBadge status={t.status}/>
      </td>
      <td className="px-4 py-4 text-[13px] text-slate-500 hidden xl:table-cell">{t.effectiveDate}</td>
      <td className="px-4 py-4 text-[13px] text-slate-500 hidden xl:table-cell">{t.updatedDate}</td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-2">
          <button onClick={onPreview}
            className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
            预览
          </button>
          {selectable && (
            <button onClick={onSelect}
              className={`h-8 rounded-lg border px-3 text-[12px] font-medium transition-colors ${selected?"border-[#2E5495] bg-[#F2F6FC] text-[#24457C]":"border-[#2E5495] text-[#2E5495] hover:bg-[#F2F6FC]"}`}>
              {selected?"已选择":"选择"}
            </button>
          )}
          {t.status==="deprecated" && (
            <button className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-500 hover:bg-slate-50">
              查看历史版本
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── No Matching State ────────────────────────────────────────────────────────

function NoMatchingTemplateState({navigate}:{navigate:(p:Page)=>void}) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white">
          <Icon name="search" size={24}/>
        </div>
        <h3 className="text-lg font-semibold text-slate-700">没有找到完全匹配的招标模板</h3>
        <p className="mt-2 text-sm text-slate-500 leading-6">
          当前条件：货物类 · 公开招标 · 设备采购及安装 · 某省通信有限公司<br/>
          没有找到当前有效且完全匹配的模板。
        </p>
        <div className="mt-2 rounded-lg border border-[#DCE7F7] bg-[#F6F8FB] p-3 text-left text-xs text-slate-600 leading-5">
          <p className="font-medium text-slate-700 mb-1">普通用户须知</p>
          没有正式模板时，系统不允许由 AI 自由生成完整招标文件，请通过以下方式处理。
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <button className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]">
            查看通用货物类模板
          </button>
          <button className="h-10 rounded-lg border border-slate-300 bg-white px-5 text-sm text-slate-700 hover:border-[#2E5495]">
            提交模板需求
          </button>
          <button onClick={()=>navigate("field-confirmation")}
            className="text-sm text-[#2E5495] hover:underline">
            返回字段确认
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Recommendation Strip ─────────────────────────────────────────────────────

function RecommendationStrip() {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#DCE7F7] bg-[#F6F8FB] px-5 py-3">
      <Icon name="info" size={15}/>
      <div className="text-[13px] text-slate-600">
        <span className="font-medium text-slate-700">系统根据以下条件推荐模板：</span>
        {" "}文件阶段：招标文件 · 采购类型：货物类 · 采购方式：公开招标 · 业务类型：设备采购及安装 · 所属组织：某省通信有限公司 · 当前有效版本。
        <span className="ml-2 text-[#8B520B]">推荐结果仍需用户明确选择，系统不会自动代入。</span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function TemplateSelectionPage({navigate, onNext}:{navigate:(p:Page)=>void;onNext:(id:string)=>void}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [previewTemplate, setPreviewTemplate] = useState<Template|null>(null);
  const [search, setSearch] = useState("");
  const filtered = TEMPLATES.filter(t=>!search || t.name.toLowerCase().includes(search.toLowerCase()));
  const selected = TEMPLATES.find(t=>t.id===selectedId);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3">
          <button onClick={()=>navigate("project-list")} className="hover:text-[#24457C]">项目空间</button>
          <span>/</span>
          <button onClick={()=>navigate("project-detail")} className="hover:text-[#24457C]">某省公司中心机房节能改造项目</button>
          <span>/</span>
          <button onClick={()=>navigate("project-detail")} className="hover:text-[#24457C]">招标文件</button>
          <span>/</span>
          <span className="font-medium text-slate-800">选择模板</span>
        </nav>
        <h1 className="text-xl font-semibold text-slate-800">选择招标文件模板</h1>
        <p className="mt-1 text-[13px] text-slate-500">请选择本次招标文件使用的正式模板。系统将锁定所选模板版本，并根据已确认的项目字段生成内容。</p>
      </div>

      <TemplateFilterBar search={search} onSearch={setSearch}/>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-5 xl:px-8">
        <TemplateContextSummary/>
        <RecommendationStrip/>

        {filtered.length === 0 ? (
          <NoMatchingTemplateState navigate={navigate}/>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] text-slate-500">
                  <th className="px-5 py-3 w-10"></th>
                  <th className="px-4 py-3">模板名称</th>
                  <th className="px-4 py-3 hidden xl:table-cell">匹配程度</th>
                  <th className="px-4 py-3 hidden xl:table-cell">适用类型</th>
                  <th className="px-4 py-3">版本</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 hidden xl:table-cell">生效时间</th>
                  <th className="px-4 py-3 hidden xl:table-cell">最近更新</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t=>(
                  <TemplateRow key={t.id} t={t} selected={selectedId===t.id}
                    onSelect={()=>setSelectedId(t.id)}
                    onPreview={()=>setPreviewTemplate(t)}/>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4 xl:px-8">
        {selected && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-[#DCE7F7] bg-[#F2F6FC] px-4 py-2">
            <Icon name="check-circle" size={15}/>
            <span className="text-[13px] text-[#24457C]">
              已选择：<strong>{selected.name}</strong>
              <span className="ml-3 font-mono text-xs">{selected.version}</span>
              <span className="ml-2"><TemplateStatusBadge status={selected.status}/></span>
              <span className="ml-3 text-slate-500">· {selected.chapters} 章节 · {selected.variables} 个变量</span>
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <button onClick={()=>navigate("field-confirmation")}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
            返回字段确认
          </button>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">已确认字段快照：<span className="font-mono">FS-20260905-001</span></span>
            <button onClick={()=>setSelectedId("")}
              className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-600 hover:border-[#2E5495]">
              取消
            </button>
            <button
              disabled={!selectedId}
              onClick={()=>{onNext(selectedId);navigate("generation-setup");}}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
              下一步：配置生成
            </button>
          </div>
        </div>
      </div>

      {/* Preview drawer */}
      {previewTemplate && (
        <TemplatePreviewDrawer
          template={previewTemplate}
          onClose={()=>setPreviewTemplate(null)}
          onSelect={()=>{setSelectedId(previewTemplate.id);}}/>
      )}
    </div>
  );
}
