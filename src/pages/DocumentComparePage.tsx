import { useState } from "react";
import { Icon } from "../components/UI";
import type { Page } from "../types";

type CompareMode = "internal"|"historical"|"upload";

interface VersionRecord {
  id: string; version: string; label: string; author: string; date: string; summary: string;
}

interface DiffEntry {
  id: string;
  section: string;
  type: "modified"|"added"|"deleted"|"field-sync"|"format";
  count?: number;
  before?: string;
  after?: string;
  author?: string;
  date?: string;
  reason?: string;
  affectsField?: boolean;
}

interface HistoricalDiff {
  id: string; category: string; current: string; historical: string;
  action: "keep"|"review"; fieldKey?: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const VERSIONS: VersionRecord[] = [
  {id:"v1",version:"V0.1",label:"初始生成版本",author:"系统生成",date:"2026-09-05 09:03",summary:"招标文件初始自动生成"},
  {id:"v2",version:"V0.2",label:"王明远修改",author:"王明远",date:"2026-09-05 13:15",summary:"补充3.4节建设目标，调整5.2节付款条款"},
  {id:"v3",version:"V0.3",label:"审校后版本",author:"王明远",date:"2026-09-05 14:35",summary:"处理4.2节技术规格，补充附件说明"},
];

const DIFFS: DiffEntry[] = [
  {id:"d1",section:"第四章 采购需求及技术要求",type:"modified",count:6,
   before:"采购设备清单包括但不限于：UPS 主机（模块化）2 套，蓄电池组 4 组……",
   after:"本次采购设备清单如下：模块化 UPS 主机 2 套、铅酸蓄电池组 4 组……",
   author:"王明远",date:"14:22",reason:"AI 辅助修改，表述更正式",affectsField:false},
  {id:"d2",section:"第五章 商务要求",type:"modified",count:3,
   before:"付款方式：合同签订后预付 20%，设备到货验收后支付 60%，竣工验收后支付剩余 20%。",
   after:"付款方式：合同签订后预付 30%，设备到货验收后支付 50%，竣工验收后支付剩余 20%。质保期内无息留存金 5%。",
   author:"王明远",date:"14:35",reason:"按财务部门意见调整付款比例",affectsField:false},
  {id:"d3",section:"第六章 合同条款及格式",type:"modified",count:1,
   before:"",after:"补充了合同格式标准说明",author:"系统同步",date:"09:03",reason:"模板变量填充",affectsField:true},
];

const HISTORICAL_DIFFS: HistoricalDiff[] = [
  {id:"h1",category:"采购需求及技术要求",
   current:"包含动环监控系统安装调试",historical:"未包含动环监控系统",action:"keep"},
  {id:"h2",category:"字段：质保期",
   current:"3 年",historical:"2 年",action:"review",fieldKey:"warranty_period"},
  {id:"h3",category:"格式：投标文件格式章节结构",
   current:"7 个二级章节",historical:"5 个二级章节",action:"review"},
];

// ─── Internal Version Compare ──────────────────────────────────────────────

function InternalVersionCompare({navigate}:{navigate:(p:Page)=>void}) {
  const [leftVer, setLeftVer] = useState("v1");
  const [rightVer, setRightVer] = useState("v3");
  const [selectedDiff, setSelectedDiff] = useState("d1");
  const diff = DIFFS.find(d=>d.id===selectedDiff)||DIFFS[0];

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3">
          <button onClick={()=>navigate("project-list")} className="hover:text-[#24457C]">项目空间</button>
          <span>/</span>
          <button onClick={()=>navigate("document-preview")} className="hover:text-[#24457C]">招标文件</button>
          <span>/</span>
          <span className="font-medium text-slate-800">版本对比</span>
        </nav>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-slate-800">招标文件版本对比</h1>
          <button onClick={()=>navigate("document-preview")} className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]">返回文档</button>
        </div>
      </div>

      {/* Version selectors */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 xl:px-8">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">对比基础：</span>
            <select value={leftVer} onChange={e=>setLeftVer(e.target.value)}
              className="h-8 rounded border border-slate-300 px-2 text-sm focus:outline-none focus:border-[#2E5495]">
              {VERSIONS.map(v=><option key={v.id} value={v.id}>{v.version} {v.label}</option>)}
            </select>
          </div>
          <Icon name="arrow" size={14}/>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">对比目标：</span>
            <select value={rightVer} onChange={e=>setRightVer(e.target.value)}
              className="h-8 rounded border border-slate-300 px-2 text-sm focus:outline-none focus:border-[#2E5495]">
              {VERSIONS.map(v=><option key={v.id} value={v.id}>{v.version} {v.label}</option>)}
            </select>
          </div>
          <span className="text-[13px] text-slate-500">共发现 {DIFFS.reduce((a,d)=>a+(d.count||0),0)} 处变更</span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: change list */}
        <aside className="w-[300px] shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">变更目录</p>
          </div>
          {DIFFS.map(d=>(
            <button key={d.id} onClick={()=>setSelectedDiff(d.id)}
              className={`w-full px-4 py-3 text-left border-b border-slate-100 hover:bg-slate-50 ${selectedDiff===d.id?"bg-[#F2F6FC]":""}`}>
              <p className={`text-[13px] font-medium ${selectedDiff===d.id?"text-[#24457C]":"text-slate-700"}`}>{d.section}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-[11px] rounded px-1.5 py-0.5 ${d.type==="modified"?"bg-[#FFF7E6] text-[#8B520B]":d.type==="added"?"bg-[#ECF8F2] text-[#116B46]":"bg-slate-100 text-slate-500"}`}>
                  {d.type==="modified"?"修改":d.type==="added"?"新增":"删除"}
                </span>
                <span className="text-[11px] text-slate-400">{d.count} 处</span>
                {d.affectsField&&<span className="text-[11px] text-[#2E5495]">字段同步</span>}
              </div>
            </button>
          ))}
        </aside>

        {/* Right: diff detail */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="mb-4 flex items-center gap-4 text-[13px]">
            {[
              {label:"修改人", v:diff.author||""},
              {label:"修改时间", v:diff.date||""},
              {label:"影响关键字段", v:diff.affectsField?"是":"否"},
            ].map(r=>(
              <div key={r.label} className="flex gap-1.5">
                <span className="text-slate-500">{r.label}：</span>
                <span className="text-slate-700 font-medium">{r.v}</span>
              </div>
            ))}
          </div>
          {diff.reason&&<div className="mb-4 flex items-center gap-2 text-[13px] text-slate-600"><Icon name="info" size={13}/>{diff.reason}</div>}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-[11px] font-semibold text-[#A8323C] mb-2 uppercase tracking-wide">修改前</p>
              <div className="rounded-lg border border-[#FECDD0] bg-[#FEF1F2] p-4 min-h-24">
                <p className="text-[13px] text-slate-700 leading-6">{diff.before||"（新增内容）"}</p>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#116B46] mb-2 uppercase tracking-wide">修改后</p>
              <div className="rounded-lg border border-[#C3E8D5] bg-[#ECF8F2] p-4 min-h-24">
                <p className="text-[13px] text-slate-700 leading-6">{diff.after||"（已删除）"}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="h-8 rounded-lg border border-slate-300 px-3 text-sm text-slate-600 hover:border-[#2E5495]">查看完整章节</button>
            <button className="h-8 rounded-lg border border-[#FFF7E6] bg-[#FFF7E6] px-3 text-sm text-[#8B520B] hover:bg-[#FDDBA0]">恢复此段（需二次确认）</button>
            <button className="h-8 rounded-lg border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50">复制旧版内容</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Historical Document Compare ───────────────────────────────────────────

function HistoricalDocumentCompare({navigate, onUpload}:{navigate:(p:Page)=>void;onUpload:()=>void}) {
  const [selectedDiff, setSelectedDiff] = useState("h1");
  const diff = HISTORICAL_DIFFS.find(d=>d.id===selectedDiff)||HISTORICAL_DIFFS[0];

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3">
          <button onClick={()=>navigate("document-preview")} className="hover:text-[#24457C]">招标文件</button>
          <span>/</span>
          <span className="font-medium text-slate-800">历史文件对比</span>
        </nav>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">与历史人工招标文件对比</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              当前文件：某省公司中心机房节能改造项目招标文件 V0.3 ←→ 对照文件：某省公司 2025 年同类机房改造项目招标文件
            </p>
          </div>
          <button onClick={onUpload} className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]">更换历史文件</button>
        </div>
      </div>

      {/* Summary */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 xl:px-8">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          {[
            {label:"章节（当前/历史）",v:"8 / 8"},
            {label:"完全匹配章节",v:"6 个"},
            {label:"需复核章节",v:"2 个"},
            {label:"关键字段差异",v:"3 项"},
            {label:"历史独有内容",v:"4 项"},
            {label:"当前独有内容",v:"2 项"},
          ].map(s=>(
            <div key={s.label} className="flex gap-1.5">
              <span className="text-slate-500">{s.label}：</span>
              <span className="font-medium text-slate-700">{s.v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Diff list */}
        <aside className="w-[280px] shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">差异项目</p>
          </div>
          {HISTORICAL_DIFFS.map(d=>(
            <button key={d.id} onClick={()=>setSelectedDiff(d.id)}
              className={`w-full px-4 py-3 text-left border-b border-slate-100 hover:bg-slate-50 ${selectedDiff===d.id?"bg-[#F2F6FC]":""}`}>
              <p className={`text-[13px] font-medium ${selectedDiff===d.id?"text-[#24457C]":"text-slate-700"}`}>{d.category}</p>
              <span className={`text-[11px] ${d.action==="review"?"text-[#8B520B]":"text-[#116B46]"}`}>
                {d.action==="review"?"需复核":"已处理"}
              </span>
            </button>
          ))}
        </aside>

        {/* Detail */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="mb-4 rounded-lg border border-[#FFF7E6] bg-[#FFFBF0] p-3 text-[13px] text-[#8B520B]">
            <Icon name="alert" size={13}/>{" "}历史人工文件只作为对照参考，不能自动成为当前项目的事实来源，不能一键覆盖已确认字段。
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-[11px] font-semibold text-[#2E5495] mb-2 uppercase tracking-wide">当前文件</p>
              <div className="rounded-lg border border-[#DCE7F7] bg-[#F2F6FC] p-4 min-h-20">
                <p className="text-[13px] text-slate-700 leading-6">{diff.current}</p>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide">历史文件</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 min-h-20">
                <p className="text-[13px] text-slate-700 leading-6">{diff.historical}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="h-8 rounded-lg border border-[#2E5495] bg-[#F2F6FC] px-3 text-sm text-[#2E5495] hover:bg-[#DCE7F7]">保留当前</button>
            {diff.fieldKey&&<button className="h-8 rounded-lg border border-slate-300 px-3 text-sm text-slate-600 hover:border-[#2E5495]">查看当前字段证据</button>}
            <button className="h-8 rounded-lg border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50">查看历史原文</button>
            <button className="h-8 rounded-lg border border-[#116B46] bg-[#ECF8F2] px-3 text-sm text-[#116B46] hover:bg-[#D9F2E8]">标记已复核</button>
          </div>
          <button onClick={()=>navigate("document-preview")} className="mt-4 text-sm text-slate-500 hover:underline">返回文档</button>
        </div>
      </div>
    </div>
  );
}

// ─── Upload Historical File ────────────────────────────────────────────────

function UploadHistoricalFile({navigate, onBack}:{navigate:(p:Page)=>void;onBack:()=>void}) {
  const [uploadState, setUploadState] = useState<"idle"|"uploading"|"parsing"|"comparing"|"done"|"failed">("idle");
  const [file, setFile] = useState("");

  function simulate() {
    setUploadState("uploading");
    setTimeout(()=>setUploadState("parsing"),1200);
    setTimeout(()=>setUploadState("comparing"),2400);
    setTimeout(()=>setUploadState("done"),3600);
  }

  const steps = ["上传中","解析中","对比中","对比完成"];
  const stateIdx = ["uploading","parsing","comparing","done"].indexOf(uploadState);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3">
          <button onClick={()=>navigate("document-preview")} className="hover:text-[#24457C]">招标文件</button>
          <span>/</span>
          <span className="font-medium text-slate-800">选择历史招标文件进行对比</span>
        </nav>
        <h1 className="text-xl font-semibold text-slate-800">选择历史招标文件进行对比</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-6 xl:px-8">
        <div className="max-w-[640px] space-y-5">
          {/* Option 1 */}
          <div className="rounded-xl border-2 border-[#2E5495] bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="size-5 rounded-full border-2 border-[#2E5495] bg-[#2E5495] flex items-center justify-center">
                <span className="size-2 rounded-full bg-white"/>
              </div>
              <p className="font-semibold text-slate-800">从项目历史文件中选择</p>
            </div>
            <p className="text-[13px] text-slate-500 mb-3">当前项目尚无历史招标文件记录。</p>
          </div>

          {/* Option 2 */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="size-5 rounded-full border-2 border-slate-400"/>
              <p className="font-semibold text-slate-800">上传历史人工招标文件</p>
            </div>
            <p className="text-[13px] text-slate-500 mb-3">支持 DOCX、PDF 格式。历史文件仅用于对照，不会覆盖当前字段和来源关系。</p>
            {uploadState==="idle"&&(
              <>
                <div className="flex items-center gap-2 mb-3">
                  <input value={file} onChange={e=>setFile(e.target.value)} placeholder="某省公司 2025 年同类机房改造项目招标文件.docx"
                    className="flex-1 h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none"/>
                  <button className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-600 hover:border-[#2E5495]">浏览</button>
                </div>
                <button onClick={simulate}
                  className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]">
                  上传并开始对比
                </button>
              </>
            )}
            {uploadState!=="idle"&&uploadState!=="failed"&&(
              <div className="space-y-3">
                {steps.map((s,i)=>(
                  <div key={s} className="flex items-center gap-3">
                    <span className={`shrink-0 ${i<stateIdx?"text-[#116B46]":i===stateIdx?"text-[#2E5495]":"text-slate-300"}`}>
                      {i<stateIdx?<Icon name="check-circle" size={15}/>:i===stateIdx?<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v9h-9"/></svg>:<Icon name="circle" size={15}/>}
                    </span>
                    <span className={`text-[13px] ${i<stateIdx?"text-slate-700":i===stateIdx?"text-[#2E5495] font-medium":"text-slate-400"}`}>{s}</span>
                  </div>
                ))}
                {uploadState==="done"&&(
                  <button onClick={onBack}
                    className="mt-2 h-9 rounded-lg bg-[#116B46] px-5 text-sm font-medium text-white hover:bg-[#0E5838]">
                    查看对比结果
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Compare Page ─────────────────────────────────────────────────────

export function DocumentComparePage({navigate}:{navigate:(p:Page)=>void}) {
  const [mode, setMode] = useState<CompareMode>("internal");

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Mode tabs */}
      <div className="flex shrink-0 border-b border-slate-200 bg-white px-6 xl:px-8">
        {[
          {v:"internal" as CompareMode,l:"内部版本对比"},
          {v:"historical" as CompareMode,l:"历史人工文件对比"},
          {v:"upload" as CompareMode,l:"上传历史文件"},
        ].map(t=>(
          <button key={t.v} onClick={()=>setMode(t.v)}
            className={`mr-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${mode===t.v?"border-[#2E5495] text-[#2E5495]":"border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t.l}
          </button>
        ))}
      </div>
      {mode==="internal"&&<InternalVersionCompare navigate={navigate}/>}
      {mode==="historical"&&<HistoricalDocumentCompare navigate={navigate} onUpload={()=>setMode("upload")}/>}
      {mode==="upload"&&<UploadHistoricalFile navigate={navigate} onBack={()=>setMode("historical")}/>}
    </div>
  );
}
