import { useState, useEffect, useRef, useCallback } from "react";
import { Icon } from "../components/UI";
import type { Page } from "../types";

// ─── Types ─────────────────────────────────────────────────────────────────

type DocStatus = "reviewing"|"validation_blocked"|"ready_to_finalize"|"finalized";
type RightPanel = null|"field-evidence"|"paragraph-evidence"|"ai-edit"|"validation";
type SaveStatus = "saved"|"saving"|"failed"|"conflict";
type BlockType = "fixed_template"|"confirmed_field"|"ai_generated"|"user_edited"|"heading"|"subheading";
type ReviewStatus = "unreviewed"|"reviewing"|"reviewed"|"blocked"|"warning"|"passed";
type AIStep = "idle"|"generating"|"diff"|"blocked"|"applied";

interface DocSection {
  id: string;
  number: string;
  title: string;
  reviewStatus: ReviewStatus;
  issueCount: number;
}

interface ContentBlock {
  id: string;
  type: BlockType;
  level?: 1|2|3;
  content: string;
  fieldKey?: string;
  aiReviewed?: boolean;
  editedBy?: string;
  editedAt?: string;
  hasIssue?: boolean;
  placeholder?: boolean;
}

interface ValidationIssue {
  id: string;
  severity: "P0"|"P1"|"P2";
  title: string;
  sectionId: string;
  sectionName: string;
  description: string;
  resolved: boolean;
  suggestion: string;
}

// ─── Data ──────────────────────────────────────────────────────────────────

const SECTIONS: DocSection[] = [
  {id:"s1",number:"1",title:"招标公告",         reviewStatus:"reviewed",  issueCount:0},
  {id:"s2",number:"2",title:"投标人须知",        reviewStatus:"warning",   issueCount:1},
  {id:"s3",number:"3",title:"项目概况",          reviewStatus:"reviewed",  issueCount:0},
  {id:"s4",number:"4",title:"采购需求及技术要求", reviewStatus:"blocked",   issueCount:3},
  {id:"s5",number:"5",title:"商务要求",          reviewStatus:"warning",   issueCount:1},
  {id:"s6",number:"6",title:"合同条款及格式",    reviewStatus:"unreviewed",issueCount:0},
  {id:"s7",number:"7",title:"投标文件格式",      reviewStatus:"unreviewed",issueCount:0},
  {id:"s8",number:"8",title:"附件",              reviewStatus:"unreviewed",issueCount:0},
];

const BLOCKS: Record<string, ContentBlock[]> = {
  s1: [
    {id:"b1-1",type:"heading",level:1,content:"第一章 招标公告"},
    {id:"b1-2",type:"fixed_template",content:'某省通信有限公司（以下简称「招标人」）委托依法开展政府采购，现就中心机房节能改造项目所需货物及配套安装服务进行公开招标，欢迎符合资格条件的供应商参与投标。'},
    {id:"b1-3",type:"subheading",level:2,content:"一、项目基本信息"},
    {id:"b1-4",type:"confirmed_field",fieldKey:"project_name",content:"项目名称：某省公司中心机房节能改造项目"},
    {id:"b1-5",type:"confirmed_field",fieldKey:"procurement_type",content:"采购类型：货物类（含安装）"},
    {id:"b1-6",type:"confirmed_field",fieldKey:"procurement_method",content:"采购方式：公开招标"},
    {id:"b1-7",type:"confirmed_field",fieldKey:"tender_budget",content:"招标预算：人民币玖佰捌拾万元整（¥9,800,000.00）",hasIssue:true},
    {id:"b1-8",type:"subheading",level:2,content:"二、投标人资格要求"},
    {id:"b1-9",type:"fixed_template",content:"投标人须具备有效的营业执照、相应等级的资质证书，以及近三年类似项目业绩证明材料。具体要求详见第二章投标人须知。"},
    {id:"b1-10",type:"subheading",level:2,content:"三、联系方式"},
    {id:"b1-11",type:"ai_generated",aiReviewed:true,content:"招标代理机构：某省通信有限公司采购中心\n联系人：采购部\n电话：联系方式详见正式公告发布页"},
  ],
  s2: [
    {id:"b2-1",type:"heading",level:1,content:"第二章 投标人须知"},
    {id:"b2-2",type:"fixed_template",content:"本章所有条款均为本次招标的法定须知，投标人须完整阅读并遵守。"},
    {id:"b2-3",type:"subheading",level:2,content:"2.1 定义"},
    {id:"b2-4",type:"fixed_template",content:'"招标人"指某省通信有限公司；"投标人"指参加本次招标的法人或其他组织；"中标人"指经依法评审程序确定的供应商。'},
    {id:"b2-5",type:"subheading",level:2,content:"2.2 招标文件及投标文件"},
    {id:"b2-6",type:"confirmed_field",fieldKey:"tender_number",content:"招标编号：{{ tender_number }}",placeholder:true,hasIssue:true},
    {id:"b2-7",type:"ai_generated",aiReviewed:false,content:"投标截止时间及开标时间以招标代理机构正式发布的公告为准。投标文件须密封提交，逾期提交的投标文件不予接受。"},
    {id:"b2-8",type:"subheading",level:2,content:"2.3 评标原则"},
    {id:"b2-9",type:"fixed_template",content:"本次招标采用综合评分法，评分细则详见评标办法章节。"},
  ],
  s3: [
    {id:"b3-1",type:"heading",level:1,content:"第三章 项目概况"},
    {id:"b3-2",type:"subheading",level:2,content:"3.1 项目名称"},
    {id:"b3-3",type:"confirmed_field",fieldKey:"project_name",content:"某省公司中心机房节能改造项目"},
    {id:"b3-4",type:"subheading",level:2,content:"3.2 项目背景"},
    {id:"b3-5",type:"ai_generated",aiReviewed:true,content:"根据现有机房运行情况及节能改造需求，某省通信有限公司现有中心机房综合能效指标（PUE）偏高，设备老化情况明显。为降低运营成本、提升机房整体能效，本项目拟对中心机房相关设备和配套环境进行系统性更新改造，以达到绿色数据中心标准。"},
    {id:"b3-6",type:"subheading",level:2,content:"3.3 本次采购范围"},
    {id:"b3-7",type:"confirmed_field",fieldKey:"procurement_scope",content:"本次采购包括 UPS 主机、蓄电池组、精密空调、动环监控系统及相关安装调试服务。具体清单详见第四章及附件。"},
    {id:"b3-8",type:"subheading",level:2,content:"3.4 建设目标"},
    {id:"b3-9",type:"ai_generated",aiReviewed:false,editedBy:"王明远",editedAt:"14:22",content:"完成改造后，机房 PUE 值应不高于 1.5，核心供电设备运行可靠性不低于 99.99%，监控系统覆盖率达到 100%。"},
  ],
  s4: [
    {id:"b4-1",type:"heading",level:1,content:"第四章 采购需求及技术要求"},
    {id:"b4-2",type:"subheading",level:2,content:"4.1 设备清单"},
    {id:"b4-3",type:"ai_generated",aiReviewed:false,content:"采购设备清单包括但不限于：UPS 主机（模块化）2 套，蓄电池组 4 组，精密空调 6 台，动环监控主机 1 套，相关辅材及安装服务 1 批。",hasIssue:true},
    {id:"b4-4",type:"subheading",level:2,content:"4.2 技术规格要求"},
    {id:"b4-5",type:"ai_generated",aiReviewed:false,content:"4.2.1 UPS 主机要求\n- 单机容量：不低于 200kVA；\n- 系统可用性：不低于 99.99%；\n- 输入电压范围：380V±15%；\n- 效率：在 50% 负载下不低于 96%。",hasIssue:true},
    {id:"b4-6",type:"subheading",level:2,content:"4.3 安装调试要求"},
    {id:"b4-7",type:"ai_generated",aiReviewed:false,content:"供应商须在交付期内完成设备安装、调试、功能测试及人员培训，并提交完整的竣工文档。"},
    {id:"b4-8",type:"subheading",level:2,content:"4.4 交付地点与交付期"},
    {id:"b4-9",type:"confirmed_field",fieldKey:"delivery_location",content:"交付地点：某省通信有限公司中心机房（具体地址以合同为准）"},
    {id:"b4-10",type:"confirmed_field",fieldKey:"delivery_period",content:"交付周期：合同签订后 90 日内完成安装调试"},
  ],
  s5: [
    {id:"b5-1",type:"heading",level:1,content:"第五章 商务要求"},
    {id:"b5-2",type:"subheading",level:2,content:"5.1 招标预算及最高限价"},
    {id:"b5-3",type:"confirmed_field",fieldKey:"tender_budget",content:"本次招标预算为人民币壹仟贰佰捌拾万元整（¥12,800,000.00）",hasIssue:true},
    {id:"b5-4",type:"ai_generated",aiReviewed:false,content:"投标人报价不得超过最高限价，超出限价的投标文件将被作为无效投标处理。"},
    {id:"b5-5",type:"subheading",level:2,content:"5.2 付款方式"},
    {id:"b5-6",type:"user_edited",editedBy:"王明远",editedAt:"14:35",content:"付款方式：合同签订后预付 30%，设备到货验收后支付 50%，竣工验收后支付剩余 20%。质保期内无息留存金 5%。"},
    {id:"b5-7",type:"subheading",level:2,content:"5.3 质保要求"},
    {id:"b5-8",type:"confirmed_field",fieldKey:"warranty_period",content:"质保期：不少于 3 年，自竣工验收合格之日起计算"},
  ],
  s6: [
    {id:"b6-1",type:"heading",level:1,content:"第六章 合同条款及格式"},
    {id:"b6-2",type:"fixed_template",content:"本章合同条款依据《政府采购法》及相关法规制定，为正式合同模板内容，不得随意修改。买卖双方须严格遵守本章所有条款。"},
    {id:"b6-3",type:"fixed_template",content:"合同主要条款包括：合同标的与数量、合同价格及支付方式、交货期及交货方式、验收条件、违约责任、争议解决方式等。详细格式见附件。"},
  ],
  s7: [
    {id:"b7-1",type:"heading",level:1,content:"第七章 投标文件格式"},
    {id:"b7-2",type:"fixed_template",content:"投标文件须按照本章规定的格式和顺序编制，缺少任何必要格式或顺序混乱将影响投标有效性。"},
    {id:"b7-3",type:"subheading",level:2,content:"7.1 投标文件目录"},
    {id:"b7-4",type:"fixed_template",content:"投标文件应包括：封面及目录、法定代表人授权书、投标函、商务响应文件、技术响应文件、资质证明文件、业绩证明材料、报价文件。"},
  ],
  s8: [
    {id:"b8-1",type:"heading",level:1,content:"第八章 附件"},
    {id:"b8-2",type:"fixed_template",content:"本章包含以下附件，均为招标文件正式组成部分："},
    {id:"b8-3",type:"fixed_template",content:"附件一：设备详细技术规格表\n附件二：项目现场勘测报告摘要\n附件三：合同格式文本\n附件四：投标报价格式"},
  ],
};

const INITIAL_ISSUES: ValidationIssue[] = [
  {id:"v1",severity:"P0",title:"招标预算在不同章节中不一致",sectionId:"s4",sectionName:"商务要求",description:"招标公告（第1章）：¥9,800,000；商务要求（第5章）：¥12,800,000。金额不一致，可能导致投标无效或法律纠纷。",resolved:false,suggestion:"使用已确认字段值 ¥9,800,000 统一全文"},
  {id:"v2",severity:"P0",title:"发现未替换占位符 {{ tender_number }}",sectionId:"s2",sectionName:"投标人须知",description:"投标人须知第2.2节存在未替换的模板变量 {{ tender_number }}。",resolved:false,suggestion:"在字段确认中补充招标编号字段"},
  {id:"v3",severity:"P1",title:"采购需求章节包含 3 段未人工审阅的 AI 草稿",sectionId:"s4",sectionName:"采购需求及技术要求",description:"第四章3处AI生成段落尚未经人工审阅，在定稿前需确认内容准确性。",resolved:false,suggestion:"逐段审阅并标记已确认"},
  {id:"v4",severity:"P1",title:"商务要求中交付周期与第四章表述不一致",sectionId:"s5",sectionName:"商务要求",description:"第四章：合同签订后90日；商务要求第5.1节：未明确。请确认二者一致。",resolved:false,suggestion:"在商务要求中补充交付周期表述"},
  {id:"v5",severity:"P2",title:"项目背景存在重复表述",sectionId:"s3",sectionName:"项目概况",description:'第3.2节与第3.4节中均出现「提升机房整体能效」相关表述，建议精简。',resolved:false,suggestion:"使用 AI 辅助精简重复段落"},
  {id:"v6",severity:"P2",title:"第七章投标文件格式未包含电子版提交说明",sectionId:"s7",sectionName:"投标文件格式",description:"模板要求包含电子文件提交说明，当前版本未见相关内容。",resolved:false,suggestion:"补充电子文件提交格式说明"},
];

// ─── Utility Components ─────────────────────────────────────────────────────

function SectionStatusIcon({status}:{status:ReviewStatus}) {
  const m: Record<ReviewStatus,{icon:string;cls:string}> = {
    unreviewed: {icon:"circle",   cls:"text-slate-300"},
    reviewing:  {icon:"clock",    cls:"text-[#2E5495]"},
    reviewed:   {icon:"check-circle",cls:"text-[#116B46]"},
    blocked:    {icon:"x-circle", cls:"text-[#A8323C]"},
    warning:    {icon:"alert",    cls:"text-[#8B520B]"},
    passed:     {icon:"check-circle",cls:"text-[#116B46]"},
  };
  const {icon,cls} = m[status];
  return <span className={cls}><Icon name={icon as any} size={13}/></span>;
}

function SeverityBadge({s}:{s:"P0"|"P1"|"P2"}) {
  const cls={P0:"bg-[#FEF1F2] text-[#A8323C]",P1:"bg-[#FFF7E6] text-[#8B520B]",P2:"bg-slate-100 text-slate-500"};
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${cls[s]}`}>{s}</span>;
}

// ─── Document Toolbar ────────────────────────────────────────────────────────

function DocumentToolbar({
  docStatus, saveStatus, p0Count, zoom, showMarkers, onZoomChange,
  onToggleMarkers, onRunValidation, onFinalize, onExport,
  onOpenPanel, onNavigate, onShowVersionMenu, onShowSourceChanged,
  onShowTemplateChanged,
}: {
  docStatus: DocStatus;
  saveStatus: SaveStatus;
  p0Count: number;
  zoom: number;
  showMarkers: boolean;
  onZoomChange: (z:number)=>void;
  onToggleMarkers: ()=>void;
  onRunValidation: ()=>void;
  onFinalize: ()=>void;
  onExport: ()=>void;
  onOpenPanel: (p:RightPanel)=>void;
  onNavigate: (p:Page)=>void;
  onShowVersionMenu: ()=>void;
  onShowSourceChanged: ()=>void;
  onShowTemplateChanged: ()=>void;
}) {
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const h=(e:MouseEvent)=>{if(moreRef.current&&!moreRef.current.contains(e.target as Node))setShowMore(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);

  const saveLabel = {
    saved:"已保存",saving:"保存中…",failed:"保存失败",conflict:"版本冲突"
  }[saveStatus];
  const saveCls = {
    saved:"text-slate-400",saving:"text-[#2E5495]",failed:"text-[#A8323C]",conflict:"text-[#8B520B]"
  }[saveStatus];

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 xl:px-6">
      {/* Back */}
      <button onClick={()=>onNavigate("project-detail")}
        className="shrink-0 flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#24457C]">
        <Icon name="arrow" size={13}/><span className="hidden xl:block">项目详情</span>
      </button>
      <div className="h-5 w-px bg-slate-200"/>
      {/* Title + meta */}
      <div className="flex min-w-0 items-center gap-3 flex-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-800">某省公司中心机房节能改造项目招标文件</span>
            <span className="shrink-0 font-mono text-xs text-slate-500">V0.3</span>
            {docStatus==="finalized" ? (
              <span className="shrink-0 rounded-full bg-[#ECF8F2] px-2 py-0.5 text-[11px] font-medium text-[#116B46]">已定稿</span>
            ) : (
              <span className="shrink-0 rounded-full bg-[#FFF7E6] px-2 py-0.5 text-[11px] font-medium text-[#8B520B]">
                {{reviewing:"待审校",validation_blocked:"校验未通过",ready_to_finalize:"可定稿",finalized:"已定稿"}[docStatus]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] text-slate-400">可研 V1.3</span>
            <span className="text-[11px] text-slate-400">货物类公开招标模板 V3.0</span>
          </div>
        </div>
      </div>
      {/* Save status */}
      <div className={`hidden shrink-0 items-center gap-1.5 text-[12px] xl:flex ${saveCls}`}>
        {saveStatus==="saving"&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v9h-9"/></svg>}
        {saveStatus==="saved"&&<Icon name="check" size={12}/>}
        {saveStatus==="failed"&&<Icon name="alert" size={12}/>}
        {saveStatus==="conflict"&&<Icon name="alert" size={12}/>}
        {saveLabel}
      </div>
      {/* Toolbar actions */}
      <div className="flex shrink-0 items-center gap-1">
        <select value={zoom} onChange={e=>onZoomChange(Number(e.target.value))}
          className="h-7 rounded border border-slate-200 bg-white px-1 text-xs text-slate-600 focus:outline-none focus:border-[#2E5495]">
          {[75,100,125].map(z=><option key={z} value={z}>{z===125?"适合宽度":`${z}%`}</option>)}
        </select>
        <button onClick={onToggleMarkers} title="显示来源标记"
          className={`h-7 w-7 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100 ${showMarkers?"bg-[#F2F6FC] text-[#2E5495]":""}`}>
          <Icon name="eye" size={14}/>
        </button>
        <button onClick={onShowVersionMenu} title="版本对比"
          className="h-7 w-7 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100">
          <Icon name="layers" size={14}/>
        </button>
        <button onClick={()=>onOpenPanel("validation")} title="校验问题"
          className={`relative h-7 rounded px-2 flex items-center gap-1 text-xs text-slate-500 hover:bg-slate-100 ${p0Count>0?"text-[#A8323C]":""}`}>
          <Icon name="shield" size={14}/>
          {p0Count>0&&<span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#A8323C] text-[9px] font-bold text-white">{p0Count}</span>}
        </button>
        {/* More menu */}
        <div ref={moreRef} className="relative">
          <button onClick={()=>setShowMore(x=>!x)}
            className="h-7 w-7 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100">
            <Icon name="more" size={14}/>
          </button>
          {showMore&&(
            <div className="absolute right-0 top-8 z-10 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {[
                {label:"查看来源关系",  action:()=>{onOpenPanel("field-evidence");setShowMore(false);}},
                {label:"对比内部版本",  action:()=>{onNavigate("document-compare");setShowMore(false);}},
                {label:"来源可研已更新",action:()=>{onShowSourceChanged();setShowMore(false);}},
                {label:"模板已更新",    action:()=>{onShowTemplateChanged();setShowMore(false);}},
              ].map(item=>(
                <button key={item.label} onClick={item.action}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Primary action */}
      <div className="shrink-0">
        {docStatus==="reviewing"&&(
          <button onClick={onRunValidation}
            className="h-8 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C]">
            运行校验
          </button>
        )}
        {docStatus==="validation_blocked"&&(
          <button onClick={()=>onOpenPanel("validation")}
            className="h-8 rounded-lg bg-[#C2414B] px-4 text-sm font-medium text-white hover:bg-[#A8323C]">
            处理阻断问题
          </button>
        )}
        {docStatus==="ready_to_finalize"&&(
          <button onClick={onFinalize}
            className="h-8 rounded-lg bg-[#116B46] px-4 text-sm font-medium text-white hover:bg-[#0E5838]">
            定稿
          </button>
        )}
        {docStatus==="finalized"&&(
          <button onClick={onExport}
            className="h-8 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C]">
            导出 DOCX
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Document Outline ─────────────────────────────────────────────────────

function DocumentOutline({
  sections, selectedId, collapsed, onSelect, onToggleCollapse,
}: {
  sections: DocSection[];
  selectedId: string;
  collapsed: boolean;
  onSelect: (id:string)=>void;
  onToggleCollapse: ()=>void;
}) {
  const reviewedCount = sections.filter(s=>s.reviewStatus==="reviewed"||s.reviewStatus==="passed").length;
  const blockedCount  = sections.reduce((a,s)=>a+(s.issueCount||0),0);

  if(collapsed){
    return (
      <aside className="flex w-[52px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-10 items-center justify-center border-b border-slate-100">
          <button onClick={onToggleCollapse} title="展开目录" className="text-slate-400 hover:text-[#24457C]">
            <Icon name="panel" size={15}/>
          </button>
        </div>
        <nav className="flex-1 py-2">
          {sections.map(s=>(
            <button key={s.id} onClick={()=>onSelect(s.id)} title={s.title}
              className={`w-full flex flex-col items-center gap-0.5 py-2 text-[10px] ${selectedId===s.id?"text-[#2E5495] font-bold":"text-slate-400 hover:text-slate-600"}`}>
              <span className="font-mono">{s.number}</span>
              <SectionStatusIcon status={s.reviewStatus}/>
            </button>
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside className="flex w-[250px] shrink-0 flex-col border-r border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b border-slate-100 px-3">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">章节目录</span>
        <button onClick={onToggleCollapse} title="折叠目录" className="text-slate-400 hover:text-[#24457C]">
          <Icon name="panel" size={14}/>
        </button>
      </div>
      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {sections.map(s=>(
          <button key={s.id} onClick={()=>onSelect(s.id)}
            className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 ${selectedId===s.id?"bg-[#F2F6FC]":""}`}>
            <span className="mt-0.5 shrink-0"><SectionStatusIcon status={s.reviewStatus}/></span>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] leading-snug ${selectedId===s.id?"text-[#24457C] font-medium":"text-slate-700"}`}>
                {s.number}. {s.title}
              </p>
              {s.issueCount>0&&<p className="text-[11px] text-[#A8323C] mt-0.5">{s.issueCount} 个问题</p>}
            </div>
          </button>
        ))}
      </nav>
      {/* Footer stats */}
      <div className="border-t border-slate-100 px-3 py-3">
        <div className="flex justify-between text-[12px]">
          <span className="text-slate-500">已审阅章节</span>
          <span className="font-medium text-[#116B46]">{reviewedCount} / {sections.length}</span>
        </div>
        {blockedCount>0&&(
          <div className="flex justify-between text-[12px] mt-1">
            <span className="text-slate-500">问题总数</span>
            <span className="font-medium text-[#A8323C]">{blockedCount}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Content Block Renderer ────────────────────────────────────────────────

function ContentBlockView({
  block, showMarkers, finalized,
  onFieldClick, onParagraphSourceClick, onAIEditRequest,
}: {
  block: ContentBlock;
  showMarkers: boolean;
  finalized: boolean;
  onFieldClick: (key:string)=>void;
  onParagraphSourceClick: (blockId:string)=>void;
  onAIEditRequest: (blockId:string)=>void;
}) {
  const [showFieldMenu, setShowFieldMenu] = useState(false);
  const [showFixedMenu, setShowFixedMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const h=(e:MouseEvent)=>{if(menuRef.current&&!menuRef.current.contains(e.target as Node)){setShowFieldMenu(false);setShowFixedMenu(false);}};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);

  if(block.type==="heading") return (
    <h2 id={`block-${block.id}`} className="mt-8 mb-4 text-lg font-bold text-slate-900 border-b border-slate-200 pb-2">{block.content}</h2>
  );
  if(block.type==="subheading") return (
    <h3 id={`block-${block.id}`} className="mt-5 mb-2 text-[15px] font-semibold text-slate-800">{block.content}</h3>
  );

  const isPlaceholder = block.placeholder;

  return (
    <div id={`block-${block.id}`}
      className={`relative group mb-3 rounded-sm ${block.hasIssue?"ring-1 ring-[#FECDD0] ring-offset-1":""}`}>
      {/* Left margin indicator */}
      {showMarkers && (
        <div className="absolute -left-7 top-1 flex flex-col items-center gap-1">
          {block.type==="fixed_template"&&<span title="模板固定内容" className="text-slate-300 hover:text-slate-500"><Icon name="lock" size={12}/></span>}
          {block.type==="ai_generated"&&!block.aiReviewed&&<span title="AI 草稿，待审阅" className="text-[#8B520B]"><Icon name="zap" size={11}/></span>}
          {block.type==="ai_generated"&&block.aiReviewed&&<span title="AI 内容，已确认" className="text-[#116B46]"><Icon name="check-circle" size={11}/></span>}
          {block.type==="user_edited"&&<span title={`${block.editedBy} 编辑于 ${block.editedAt}`} className="text-[#2E5495]"><Icon name="edit" size={11}/></span>}
        </div>
      )}

      {/* Main content */}
      {block.type==="fixed_template"&&(
        <div className="relative">
          <p className={`text-[14px] leading-7 text-slate-700 whitespace-pre-line ${!finalized?"cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5":""}`}
            onClick={()=>!finalized&&setShowFixedMenu(true)}>
            {block.content}
          </p>
          {showFixedMenu&&!finalized&&(
            <div ref={menuRef} className="absolute left-0 top-full z-10 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <p className="text-xs font-medium text-slate-700 mb-1.5">该段内容来自正式模板，当前不可直接编辑</p>
              <p className="text-[11px] text-slate-500 mb-3">货物类公开招标文件模板 V3.0</p>
              <div className="flex gap-2">
                <button className="flex-1 h-7 rounded border border-slate-300 text-xs text-slate-600 hover:border-[#2E5495]">查看模板原文</button>
                <button className="flex-1 h-7 rounded border border-slate-300 text-xs text-slate-600 hover:border-[#2E5495]">申请解锁</button>
                <button onClick={()=>setShowFixedMenu(false)} className="h-7 w-7 flex items-center justify-center rounded border border-slate-300 text-slate-400 hover:bg-slate-100"><Icon name="close" size={12}/></button>
              </div>
            </div>
          )}
        </div>
      )}

      {block.type==="confirmed_field"&&(
        <div ref={menuRef} className="relative">
          <p className={`text-[14px] leading-7 whitespace-pre-line cursor-pointer rounded px-1 py-0.5 ${isPlaceholder?"font-mono text-[#A8323C] bg-[#FEF1F2]":"text-slate-800 font-medium hover:bg-[#F2F6FC]"} ${showMarkers&&!isPlaceholder?"underline decoration-dotted decoration-[#2E5495] underline-offset-2":""}`}
            onClick={()=>setShowFieldMenu(true)}>
            {block.content}
          </p>
          {showFieldMenu&&(
            <div className="absolute left-0 top-full z-10 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <button className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={()=>{setShowFieldMenu(false);if(block.fieldKey)onFieldClick(block.fieldKey);}}>
                查看字段详情 / 来源
              </button>
              <button className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={()=>setShowFieldMenu(false)}>
                查看全文引用位置
              </button>
              {!finalized&&<button className="w-full px-3 py-2 text-left text-sm text-[#A8323C] hover:bg-[#FEF1F2]" onClick={()=>setShowFieldMenu(false)}>
                申请修改字段值
              </button>}
              <button className="w-full px-3 py-2 text-left text-xs text-slate-400 hover:bg-slate-50 border-t border-slate-100 mt-1" onClick={()=>setShowFieldMenu(false)}>关闭</button>
            </div>
          )}
        </div>
      )}

      {(block.type==="ai_generated"||block.type==="user_edited")&&(
        <div className="relative">
          <p className={`text-[14px] leading-7 text-slate-700 whitespace-pre-line rounded px-1 py-0.5 ${!finalized?"hover:bg-slate-50":""}`}>
            {block.content}
          </p>
          {!finalized&&(
            <div className="absolute right-0 top-0 hidden items-center gap-1 group-hover:flex">
              {block.type==="ai_generated"&&(
                <button onClick={()=>onParagraphSourceClick(block.id)}
                  title="查看来源" className="h-6 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-500 hover:border-[#2E5495] shadow-sm">
                  <Icon name="eye" size={11}/>
                </button>
              )}
              <button onClick={()=>onAIEditRequest(block.id)}
                title="AI 辅助修改" className="h-6 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-[#2E5495] hover:bg-[#F2F6FC] shadow-sm">
                <Icon name="zap" size={11}/>
              </button>
            </div>
          )}
          {block.type==="user_edited"&&showMarkers&&(
            <p className="mt-0.5 text-[11px] text-[#2E5495]">{block.editedBy} 编辑于 {block.editedAt}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Field Evidence Drawer ─────────────────────────────────────────────────

function FieldEvidenceDrawer({fieldKey, onClose}:{fieldKey:string;onClose:()=>void}) {
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  const isBudget = fieldKey==="tender_budget";
  return (
    <div className="flex flex-col h-full border-l border-slate-200 bg-white">
      <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
        <h3 className="text-sm font-semibold text-slate-800">字段来源证据</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="close" size={16}/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4">
          <p className="text-xs text-slate-500 mb-0.5">字段名称</p>
          <p className="font-semibold text-slate-800">{isBudget?"招标预算":"项目名称"}</p>
        </div>
        <div className="mb-4">
          <p className="text-xs text-slate-500 mb-0.5">字段键</p>
          <p className="font-mono text-xs text-slate-600">{isBudget?"procurement.tender_budget":"project.name"}</p>
        </div>
        <div className="mb-4">
          <p className="text-xs text-slate-500 mb-0.5">当前值</p>
          <p className="font-semibold text-slate-800">{isBudget?"人民币玖佰捌拾万元整（¥9,800,000）":"某省公司中心机房节能改造项目"}</p>
        </div>
        {[
          {label:"字段级别",  v:"P0"},
          {label:"字段状态",  v:"已确认"},
          {label:"确认人",    v:"王明远"},
          {label:"确认时间",  v:"2026-09-05 10:48"},
        ].map(r=>(
          <div key={r.label} className="flex justify-between mb-2 text-[13px]">
            <span className="text-slate-500">{r.label}</span>
            <span className={`font-medium ${r.v==="P0"?"text-[#A8323C]":r.v==="已确认"?"text-[#116B46]":"text-slate-700"}`}>{r.v}</span>
          </div>
        ))}
        <div className="my-4 border-t border-slate-100"/>
        <p className="text-xs font-semibold text-slate-500 mb-2">数据来源</p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-4">
          {[
            {label:"来源文件",  v:"某省公司中心机房节能改造项目采购计划.pdf"},
            {label:"来源章节",  v:"项目预算"},
            {label:"来源页码",  v:"第 3 页"},
          ].map(r=>(
            <div key={r.label} className="flex gap-2 mb-1.5 text-[12px]">
              <span className="text-slate-500 shrink-0">{r.label}：</span>
              <span className="text-slate-700">{r.v}</span>
            </div>
          ))}
          <div className="mt-3 rounded border border-[#DCE7F7] bg-white p-2 text-[12px] text-slate-700 italic leading-5">
            "本项目本次采购预算为人民币玖佰捌拾万元整，不超过年度采购计划批复金额……"
          </div>
        </div>
        <p className="text-xs font-semibold text-slate-500 mb-2">引用位置</p>
        {["招标公告，第 1 页","投标人须知，第 8 页","商务要求，第 36 页"].map(loc=>(
          <div key={loc} className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] text-slate-600">{loc}</span>
            <button className="text-xs text-[#2E5495] hover:underline">定位</button>
          </div>
        ))}
        {isBudget&&(
          <div className="mt-4 rounded-lg border border-[#FECDD0] bg-[#FEF1F2] p-3">
            <p className="text-[12px] font-medium text-[#A8323C]">发现引用不一致</p>
            <p className="text-[12px] text-[#A8323C] mt-1">商务要求（第5章）显示 ¥12,800,000，与本字段值不符。</p>
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 p-3 space-y-2">
        <button className="w-full h-8 rounded-lg border border-[#2E5495] text-sm text-[#2E5495] hover:bg-[#F2F6FC]">查看字段修改记录</button>
        <button className="w-full h-8 rounded-lg border border-[#FECDD0] bg-[#FEF1F2] text-sm text-[#A8323C] hover:bg-[#FDDDE0]">申请修改字段值</button>
      </div>
    </div>
  );
}

// ─── Paragraph Evidence Drawer ─────────────────────────────────────────────

function ParagraphEvidenceDrawer({blockId, onClose, onAIEdit}:{blockId:string;onClose:()=>void;onAIEdit:()=>void}) {
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  return (
    <div className="flex flex-col h-full border-l border-slate-200 bg-white">
      <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
        <h3 className="text-sm font-semibold text-slate-800">段落来源关系</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="close" size={16}/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]">
          <p className="text-slate-500 text-xs mb-1">段落位置</p>
          <p className="text-slate-800 font-medium">第四章 采购需求及技术要求</p>
          <p className="text-slate-500">4.2 建设内容</p>
        </div>
        <div className="flex gap-3 mb-4">
          <span className="rounded px-2 py-0.5 bg-[#FFF7E6] text-[#8B520B] text-[11px] font-medium">AI 起草</span>
          <span className="rounded px-2 py-0.5 bg-slate-100 text-slate-500 text-[11px]">未审阅</span>
        </div>
        <p className="text-xs font-semibold text-slate-500 mb-3">生成依据</p>
        {[
          "本次采购范围（已确认字段）",
          "设备清单（已确认字段）",
          "技术指标（已确认字段）",
          "可研第三章 建设内容与规模",
          "可研第四章 技术方案",
        ].map((d,i)=>(
          <div key={i} className="flex items-center gap-2 mb-2 text-[13px] text-slate-600">
            <Icon name="hash" size={12}/>
            {d}
          </div>
        ))}
        <div className="my-4 border-t border-slate-100"/>
        <p className="text-xs font-semibold text-slate-500 mb-3">关联来源片段</p>
        {[
          {src:"可研第三章 建设内容与规模",page:"第 24 页",text:"本项目拟采购 UPS 主机 2 套、蓄电池组 4 组、精密空调 6 台……"},
          {src:"可研第四章 技术方案",page:"第 31 页",text:"精密空调制冷量不低于 40kW，支持上送风/下送风两种安装方式……"},
        ].map((s,i)=>(
          <div key={i} className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex justify-between text-[12px] mb-2">
              <span className="font-medium text-slate-700">{s.src}</span>
              <span className="text-slate-400">{s.page}</span>
            </div>
            <p className="text-[12px] text-slate-600 italic">{s.text}</p>
            <button className="mt-2 text-[11px] text-[#2E5495] hover:underline">打开来源原文</button>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 p-3 space-y-2">
        <button className="w-full h-8 rounded-lg border border-[#116B46] bg-[#ECF8F2] text-sm text-[#116B46] hover:bg-[#D9F2E8]">标记为已人工审阅</button>
        <button onClick={()=>{onAIEdit();onClose();}} className="w-full h-8 rounded-lg border border-[#2E5495] text-sm text-[#2E5495] hover:bg-[#F2F6FC]">使用 AI 辅助修改</button>
      </div>
    </div>
  );
}

// ─── AI Edit Drawer ────────────────────────────────────────────────────────

function AIEditDrawer({blockId, onClose}:{blockId:string;onClose:()=>void}) {
  const [step, setStep] = useState<AIStep>("idle");
  const [mode, setMode] = useState("formal");
  const [custom, setCustom] = useState("");
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  const ORIGINAL = "采购设备清单包括但不限于：UPS 主机（模块化）2 套，蓄电池组 4 组，精密空调 6 台，动环监控主机 1 套，相关辅材及安装服务 1 批。";
  const SUGGESTED = "本次采购设备清单如下：模块化 UPS 主机 2 套、铅酸蓄电池组 4 组、精密空调 6 台（含配套末端）、动环监控主机及传感器 1 套，以及相关安装辅材与调试服务 1 批。";
  const BLOCKED_SUGGESTED = "本次采购 UPS 主机 5 套（原为 2 套），总采购预算调整为人民币 1280 万元整。";

  function generate() {
    if(mode==="add_quantity") { setStep("blocked"); setIsBlocked(true); return; }
    setStep("generating");
    setTimeout(()=>setStep("diff"), 1800);
  }

  const MODES = [
    {v:"formal",    l:"表述更正式"},
    {v:"simplify",  l:"精简重复内容"},
    {v:"structure", l:"补充结构"},
    {v:"expand",    l:"根据来源材料扩写"},
    {v:"template",  l:"与模板语气保持一致"},
    {v:"grammar",   l:"修正语病"},
    {v:"add_quantity",l:"自定义要求（含数量修改演示）"},
  ];

  return (
    <div className="flex flex-col h-full border-l border-slate-200 bg-white">
      <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
        <h3 className="text-sm font-semibold text-slate-800">AI 辅助修改</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="close" size={16}/></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {/* Current content */}
        <p className="text-xs font-semibold text-slate-500 mb-2">选中内容</p>
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700 leading-6">
          {ORIGINAL}
        </div>

        {step==="blocked"&&isBlocked&&(
          <div className="mb-4 rounded-lg border border-[#FECDD0] bg-[#FEF1F2] p-4">
            <p className="text-sm font-semibold text-[#A8323C] mb-2">无法应用：涉及已确认关键字段</p>
            <p className="text-[13px] text-[#A8323C] leading-5">该建议修改涉及已确认关键字段（设备数量、招标预算），不能直接应用到正文。</p>
            <div className="mt-3 space-y-2">
              <button className="w-full h-8 rounded border border-[#FECDD0] text-sm text-[#A8323C] hover:bg-[#FDDDE0]">查看涉及字段</button>
              <button className="w-full h-8 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">返回字段确认</button>
              <button onClick={()=>{setStep("idle");setIsBlocked(false);}} className="w-full h-8 rounded border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">放弃建议</button>
            </div>
          </div>
        )}

        {step!=="blocked"&&(
          <>
            <p className="text-xs font-semibold text-slate-500 mb-2">修改方式</p>
            <div className="mb-3 space-y-1">
              {MODES.map(m=>(
                <label key={m.v} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 cursor-pointer text-[13px] text-slate-700">
                  <input type="radio" value={m.v} checked={mode===m.v} onChange={()=>setMode(m.v)} className="accent-[#2E5495]"/>
                  {m.l}
                </label>
              ))}
            </div>
            {mode==="add_quantity"&&(
              <textarea value={custom} onChange={e=>setCustom(e.target.value)} rows={3} placeholder="请在不改变设备数量和技术指标的前提下…"
                className="w-full rounded-lg border border-slate-300 p-2 text-[13px] focus:border-[#2E5495] focus:outline-none resize-none mb-3"/>
            )}

            {/* Constraints */}
            <div className="mb-4 rounded-lg border border-[#DCE7F7] bg-[#F6F8FB] p-3">
              <p className="text-[11px] font-semibold text-[#24457C] mb-1.5">强制约束（不可修改）</p>
              <ul className="space-y-1 text-[11px] text-slate-500 list-none">
                {["不得修改已确认金额","不得修改数量和单位","不得修改主体名称","不得修改日期和期限","不得扩大采购范围"].map(r=>(
                  <li key={r} className="flex items-center gap-1"><Icon name="lock" size={10}/>{r}</li>
                ))}
              </ul>
            </div>

            {/* Diff view */}
            {step==="diff"&&(
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-500 mb-2">修改前后对比</p>
                <div className="rounded-lg border border-slate-200 overflow-hidden text-[13px]">
                  <div className="bg-[#FEF1F2] px-3 py-2 border-b border-slate-200">
                    <p className="text-[10px] text-[#A8323C] font-semibold mb-1">原文</p>
                    <p className="text-slate-700 leading-6">{ORIGINAL}</p>
                  </div>
                  <div className="bg-[#ECF8F2] px-3 py-2">
                    <p className="text-[10px] text-[#116B46] font-semibold mb-1">建议修改稿</p>
                    <p className="text-slate-700 leading-6">{SUGGESTED}</p>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12px]">
                  <div className="flex justify-between mb-1"><span className="text-slate-500">修改依据</span><span className="text-slate-700">当前字段快照与来源材料</span></div>
                  <div className="flex justify-between mb-1"><span className="text-slate-500">影响字段</span><span className="text-[#116B46]">无</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">风险提示</span><span className="text-slate-700">未改变确定性字段</span></div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {step!=="blocked"&&(
        <div className="border-t border-slate-100 p-3 space-y-2">
          {step==="idle"&&<button onClick={generate} className="w-full h-9 rounded-lg bg-[#2E5495] text-sm font-medium text-white hover:bg-[#24457C]">生成修改建议</button>}
          {step==="generating"&&<button disabled className="w-full h-9 rounded-lg bg-[#2E5495] text-sm font-medium text-white flex items-center justify-center gap-2 opacity-70">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v9h-9"/></svg>生成中…
          </button>}
          {step==="diff"&&<>
            <button onClick={()=>setStep("applied")} className="w-full h-9 rounded-lg bg-[#116B46] text-sm font-medium text-white hover:bg-[#0E5838]">应用修改</button>
            <button onClick={generate} className="w-full h-8 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">重新生成</button>
            <button onClick={()=>setStep("idle")} className="w-full h-8 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">放弃</button>
          </>}
          {step==="applied"&&<div className="rounded-lg border border-[#C3E8D5] bg-[#ECF8F2] p-3 text-[13px] text-[#116B46] flex items-center gap-2">
            <Icon name="check-circle" size={14}/>修改已应用，状态：AI 修改，待人工确认
          </div>}
        </div>
      )}
    </div>
  );
}

// ─── Validation Drawer ─────────────────────────────────────────────────────

function ValidationDrawer({issues, onClose, onViewFull, onResolve, navigate}:{
  issues:ValidationIssue[];onClose:()=>void;onViewFull:()=>void;onResolve:(id:string)=>void;navigate:(p:Page)=>void;
}) {
  const [filter, setFilter] = useState("all");
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  const p0 = issues.filter(i=>i.severity==="P0"&&!i.resolved);
  const p1 = issues.filter(i=>i.severity==="P1"&&!i.resolved);
  const p2 = issues.filter(i=>i.severity==="P2"&&!i.resolved);
  const resolved = issues.filter(i=>i.resolved);

  const filtered = filter==="all" ? issues.filter(i=>!i.resolved) :
    filter==="P0" ? p0 : filter==="P1" ? p1 : filter==="P2" ? p2 : resolved;

  return (
    <div className="flex flex-col h-full border-l border-slate-200 bg-white">
      <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
        <h3 className="text-sm font-semibold text-slate-800">校验问题</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="close" size={16}/></button>
      </div>
      {/* Summary */}
      <div className="grid grid-cols-4 border-b border-slate-100 text-center">
        {[
          {label:"P0 阻断",count:p0.length,cls:"text-[#A8323C]"},
          {label:"P1 重要",count:p1.length,cls:"text-[#8B520B]"},
          {label:"P2 建议",count:p2.length,cls:"text-slate-500"},
          {label:"已解决",count:resolved.length,cls:"text-[#116B46]"},
        ].map(s=>(
          <div key={s.label} className="py-3">
            <p className={`text-xl font-bold ${s.cls}`}>{s.count}</p>
            <p className="text-[10px] text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>
      {/* Filter */}
      <div className="flex gap-1 px-3 py-2 border-b border-slate-100 overflow-x-auto">
        {["all","P0","P1","P2","resolved"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            className={`shrink-0 h-6 rounded-full px-3 text-[11px] font-medium ${filter===f?"bg-[#2E5495] text-white":"border border-slate-300 text-slate-500 hover:border-[#2E5495]"}`}>
            {f==="all"?"全部":f==="resolved"?"已解决":f}
          </button>
        ))}
      </div>
      {/* Issue list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length===0&&<p className="text-center py-8 text-sm text-slate-400">暂无问题</p>}
        {filtered.map(issue=>(
          <div key={issue.id} className={`border-b border-slate-100 p-4 ${issue.resolved?"opacity-50":""}`}>
            <div className="flex items-start gap-2 mb-2">
              <SeverityBadge s={issue.severity}/>
              <p className="text-[13px] font-semibold text-slate-800 flex-1">{issue.title}</p>
            </div>
            <p className="text-[12px] text-slate-500 mb-1">章节：{issue.sectionName}</p>
            <p className="text-[12px] text-slate-600 mb-3 leading-5">{issue.description}</p>
            {!issue.resolved&&(
              <div className="flex gap-2 flex-wrap">
                <button className="h-6 rounded border border-slate-300 px-2 text-[11px] text-slate-600 hover:border-[#2E5495]">定位到正文</button>
                <button onClick={()=>onResolve(issue.id)}
                  className="h-6 rounded border border-[#116B46] bg-[#ECF8F2] px-2 text-[11px] text-[#116B46] hover:bg-[#D9F2E8]">
                  {issue.severity==="P0"?"使用确认值修复":"标记已处理"}
                </button>
              </div>
            )}
            {issue.resolved&&<p className="text-[11px] text-[#116B46]">已解决</p>}
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 p-3">
        <button onClick={onViewFull} className="w-full h-8 rounded-lg border border-slate-300 text-sm text-slate-600 hover:border-[#2E5495]">查看完整校验报告</button>
      </div>
    </div>
  );
}

// ─── Finalize Dialog ─────────────────────────────────────────────────────────

function FinalizeDocumentDialog({onClose, onConfirm}:{onClose:()=>void;onConfirm:()=>void}) {
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/25 p-6" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="w-full max-w-[560px] rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,.18)]">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-slate-800">确认定稿招标文件</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="close"/></button>
        </div>
        <div className="p-6">
          <div className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-[13px]">
            {[
              ["文件","某省公司中心机房节能改造项目招标文件"],
              ["当前草稿","V0.3"],
              ["定稿后版本","V1.0"],
              ["来源文件","可研报告 V1.3"],
              ["字段快照","FS-20260905-001"],
              ["招标模板","货物类公开招标文件模板 V3.0"],
              ["校验结果","已通过"],
            ].map(([k,v])=>(
              <div key={k} className="flex justify-between gap-3">
                <span className="text-slate-500">{k}</span>
                <span className={`text-right font-medium ${v==="已通过"?"text-[#116B46]":"text-slate-800"}`}>{v}</span>
              </div>
            ))}
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">定稿说明（可选）</label>
            <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} placeholder="例如：已完成项目、采购、技术和商务部门联合审校。"
              className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:border-[#2E5495] focus:outline-none resize-none"/>
          </div>
          <label className="flex items-start gap-3 mb-5 cursor-pointer">
            <input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} className="mt-0.5 accent-[#2E5495]"/>
            <span className="text-[13px] text-slate-700">我确认本文件中的项目、金额、范围、期限和技术要求已经审核。</span>
          </label>
          <div className="rounded-lg border border-[#DCE7F7] bg-[#F6F8FB] p-3 text-[13px] text-[#24457C] mb-5">
            <Icon name="info" size={13}/>{" "}定稿后，V1.0 将锁定为只读版本。后续修改需要创建新的修订草稿。
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="h-10 rounded-lg border border-slate-300 px-5 text-sm font-medium text-slate-600 hover:border-[#2E5495]">取消</button>
            <button onClick={onConfirm} disabled={!checked}
              className="h-10 rounded-lg bg-[#116B46] px-5 text-sm font-medium text-white hover:bg-[#0E5838] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
              确认定稿
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Export Flow ─────────────────────────────────────────────────────────────

function ExportDocumentDialog({onClose, onStart}:{onClose:()=>void;onStart:()=>void}) {
  const [format, setFormat] = useState("docx");
  const FORMATS = [
    {v:"docx",l:"Word 文档 DOCX"},
    {v:"pdf",l:"PDF 文档"},
    {v:"report",l:"校验报告 PDF"},
    {v:"trace",l:"来源追溯清单"},
  ];
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/25 p-6" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="w-full max-w-[500px] rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,.18)]">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-slate-800">导出招标文件</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="close"/></button>
        </div>
        <div className="p-6">
          <div className="mb-4 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]">
            {[["文件","某省公司中心机房节能改造项目招标文件"],["版本","V1.0"],["状态","已定稿"]].map(([k,v])=>(
              <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-medium text-slate-800">{v}</span></div>
            ))}
          </div>
          <p className="text-xs font-medium text-slate-600 mb-2">导出格式</p>
          <div className="mb-4 space-y-1">
            {FORMATS.map(f=>(
              <label key={f.v} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50 cursor-pointer text-[13px] text-slate-700">
                <input type="radio" value={f.v} checked={format===f.v} onChange={()=>setFormat(f.v)} className="accent-[#2E5495]"/>
                {f.l}
              </label>
            ))}
          </div>
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-slate-500 mb-0.5">文件名称预览</p>
            <p className="font-mono text-[12px] text-slate-700">某省公司中心机房节能改造项目_招标文件_V1.0.{format==="docx"?"docx":format==="report"?"pdf":format==="trace"?"xlsx":"pdf"}</p>
          </div>
          <p className="text-xs font-medium text-slate-600 mb-2">导出选项（默认开启）</p>
          <div className="mb-5 space-y-1">
            {["包含正式封面","包含目录","包含页眉页脚","更新页码","保留模板格式"].map(opt=>(
              <label key={opt} className="flex items-center gap-2 text-[13px] text-slate-700">
                <input type="checkbox" defaultChecked className="accent-[#2E5495]"/>{opt}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="h-10 rounded-lg border border-slate-300 px-5 text-sm font-medium text-slate-600 hover:border-[#2E5495]">取消</button>
            <button onClick={onStart} className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]">开始导出</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportProgress({onBack}:{onBack:()=>void}) {
  const steps = ["读取定稿版本","应用模板样式","装配章节和表格","更新目录与页码","执行导出完整性检查","保存导出文件"];
  const [done, setDone] = useState(2);
  useEffect(()=>{
    if(done>=steps.length) return;
    const t=setTimeout(()=>setDone(d=>d+1),900);
    return()=>clearTimeout(t);
  },[done]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/25 p-6">
      <div className="w-full max-w-[440px] rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,.18)] p-6">
        <h2 className="text-xl font-semibold text-slate-800 mb-4">正在生成 Word 文件</h2>
        <div className="space-y-3 mb-6">
          {steps.map((s,i)=>(
            <div key={s} className="flex items-center gap-3">
              <span className={`shrink-0 ${i<done?"text-[#116B46]":i===done?"text-[#2E5495]":"text-slate-300"}`}>
                {i<done?<Icon name="check-circle" size={15}/>:i===done?<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v9h-9"/></svg>:<Icon name="circle" size={15}/>}
              </span>
              <span className={`text-[13px] ${i<done?"text-slate-700":i===done?"text-[#2E5495] font-medium":"text-slate-400"}`}>{s}</span>
            </div>
          ))}
        </div>
        <button onClick={onBack} className="w-full h-9 rounded-lg border border-slate-300 text-sm text-slate-600 hover:border-[#2E5495]">后台导出并返回项目详情</button>
      </div>
    </div>
  );
}

function ExportCompleted({onClose, onDownload}:{onClose:()=>void;onDownload:()=>void}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/25 p-6" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="w-full max-w-[440px] rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,.18)] p-6 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-[#ECF8F2]">
          <Icon name="check-circle" size={28}/>
        </div>
        <h2 className="text-xl font-semibold text-slate-800 mb-1">文件导出完成</h2>
        <p className="font-mono text-xs text-slate-500 mb-4">某省公司中心机房节能改造项目_招标文件_V1.0.docx</p>
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px]">
          {[["文件大小","4.2 MB"],["生成时间","2026-09-05 15:10"],["文件校验","通过"]].map(([k,v])=>(
            <div key={k} className="flex justify-between">
              <span className="text-slate-500">{k}</span>
              <span className={`font-medium ${v==="通过"?"text-[#116B46]":"text-slate-700"}`}>{v}</span>
            </div>
          ))}
        </div>
        <button onClick={onDownload} className="w-full h-10 rounded-lg bg-[#2E5495] text-sm font-medium text-white hover:bg-[#24457C] mb-2">下载文件</button>
        <div className="flex gap-2">
          <button className="flex-1 h-8 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">复制链接</button>
          <button className="flex-1 h-8 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">导出 PDF</button>
          <button onClick={onClose} className="flex-1 h-8 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ─── Source / Template Changed Banners ────────────────────────────────────

function SourceChangedBannerDoc({onDismiss}:{onDismiss:()=>void}) {
  return (
    <div className="flex items-start gap-3 border-b border-[#DCE7F7] bg-[#F2F6FC] px-5 py-3 text-[13px] shrink-0">
      <Icon name="info" size={14}/>
      <p className="flex-1 text-[#24457C]">
        <strong>来源可研报告已有新版本：</strong>当前招标文件依据可研 V1.3，最新版本为 V1.4。当前文件不会自动更新。
      </p>
      <div className="flex gap-2 shrink-0">
        <button className="h-6 rounded border border-[#2E5495] px-2 text-[11px] text-[#2E5495] hover:bg-[#DCE7F7]">查看影响字段</button>
        <button className="h-6 rounded border border-[#2E5495] px-2 text-[11px] text-[#2E5495] hover:bg-[#DCE7F7]">继续使用 V1.3</button>
        <button onClick={onDismiss} className="text-[#2E5495] hover:text-[#24457C]"><Icon name="close" size={13}/></button>
      </div>
    </div>
  );
}

function TemplateChangedBannerDoc({onDismiss}:{onDismiss:()=>void}) {
  return (
    <div className="flex items-start gap-3 border-b border-[#FDDBA0] bg-[#FFF7E6] px-5 py-3 text-[13px] shrink-0">
      <Icon name="alert" size={14}/>
      <p className="flex-1 text-[#8B520B]">
        <strong>模板已有新版本：</strong>当前文件使用货物类公开招标文件模板 V3.0，模板中心最新版本为 V3.1。当前文件不受影响。
      </p>
      <div className="flex gap-2 shrink-0">
        <button className="h-6 rounded border border-[#8B520B] px-2 text-[11px] text-[#8B520B] hover:bg-[#FDDBA0]">查看差异</button>
        <button className="h-6 rounded border border-[#8B520B] px-2 text-[11px] text-[#8B520B] hover:bg-[#FDDBA0]">继续使用 V3.0</button>
        <button onClick={onDismiss} className="text-[#8B520B]"><Icon name="close" size={13}/></button>
      </div>
    </div>
  );
}

// ─── Revision Conflict Dialog ─────────────────────────────────────────────

function RevisionConflictDialog({onClose}:{onClose:()=>void}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/25 p-6">
      <div className="w-full max-w-[500px] rounded-xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,.18)] p-6">
        <h2 className="text-xl font-semibold text-slate-800 mb-2">文档已有其他用户的更新</h2>
        <p className="text-sm text-slate-500 mb-5">你的编辑基于旧版本，无法直接保存，请选择处理方式。</p>
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-[13px]">
          {[
            ["你的基础版本","V0.3 revision 12"],
            ["服务器最新版本","V0.3 revision 13"],
            ["更新人","李梓涵"],
            ["更新时间","2026-09-05 14:28"],
          ].map(([k,v])=>(
            <div key={k} className="flex justify-between mb-1.5">
              <span className="text-slate-500">{k}</span>
              <span className="text-slate-800 font-medium">{v}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <button className="w-full h-10 rounded-lg bg-[#2E5495] text-sm font-medium text-white hover:bg-[#24457C]">查看差异并合并</button>
          <button className="w-full h-10 rounded-lg border border-slate-300 text-sm text-slate-600 hover:border-[#2E5495]">保存为我的修改副本</button>
          <button onClick={onClose} className="w-full text-sm text-[#A8323C] hover:underline py-1">放弃我的修改并加载最新版</button>
        </div>
      </div>
    </div>
  );
}

// ─── Finalized View ────────────────────────────────────────────────────────

function FinalizedCompletedView({navigate, onExport}:{navigate:(p:Page)=>void;onExport:()=>void}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-6">
        <button onClick={()=>navigate("project-detail")} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#24457C]">
          <Icon name="arrow" size={13}/>项目详情
        </button>
        <div className="h-5 w-px bg-slate-200"/>
        <span className="text-sm font-semibold text-slate-800">招标文件已定稿</span>
        <span className="rounded-full bg-[#ECF8F2] px-2.5 py-0.5 text-[11px] font-medium text-[#116B46]">V1.0 · 已定稿</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] flex items-start justify-center p-8">
        <div className="w-full max-w-[640px]">
          <div className="mb-8 rounded-2xl border border-[#C3E8D5] bg-white p-8 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[#ECF8F2]">
              <Icon name="check-circle" size={32}/>
            </div>
            <h1 className="text-2xl font-semibold text-slate-900 mb-1">招标文件已定稿</h1>
            <p className="text-sm text-slate-500 mb-5">某省公司中心机房节能改造项目招标文件 · V1.0</p>
            <div className="mx-auto max-w-sm space-y-2 text-[13px] mb-6">
              {[
                ["状态","已定稿"],["定稿人","王明远"],["定稿时间","2026-09-05 15:06"],
                ["来源","可研报告 V1.3"],["字段快照","FS-20260905-001"],
                ["模板","货物类公开招标文件模板 V3.0"],["校验报告","已通过"],
              ].map(([k,v])=>(
                <div key={k} className="flex justify-between">
                  <span className="text-slate-500">{k}</span>
                  <span className={`font-medium ${v==="已定稿"||v==="已通过"?"text-[#116B46]":"text-slate-800"}`}>{v}</span>
                </div>
              ))}
            </div>
            <button onClick={onExport}
              className="w-full h-10 rounded-lg bg-[#2E5495] text-sm font-medium text-white hover:bg-[#24457C] mb-3">
              导出 DOCX
            </button>
            <div className="flex gap-2 mb-4">
              <button className="flex-1 h-9 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">导出 PDF</button>
              <button className="flex-1 h-9 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">查看校验报告</button>
              <button className="flex-1 h-9 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">查看来源关系</button>
            </div>
            <button onClick={()=>navigate("project-detail")} className="text-sm text-slate-500 hover:underline">返回项目详情</button>
          </div>
          {/* Next step */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">下一步</p>
            <p className="text-sm text-slate-700 mb-3">使用已定稿招标文件生成合同</p>
            <button onClick={()=>navigate("contract-source")}
              className="inline-flex items-center gap-2 h-9 rounded-lg border border-[#2E5495] px-4 text-sm text-[#2E5495] hover:bg-[#F2F6FC]">
              进入合同阶段<Icon name="arrow" size={14}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Version Menu ─────────────────────────────────────────────────────────

function VersionMenu({onClose, navigate}:{onClose:()=>void;navigate:(p:Page)=>void}) {
  return (
    <div className="fixed inset-0 z-20" onClick={onClose}>
      <div className="absolute right-24 top-14 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg" onClick={e=>e.stopPropagation()}>
        <p className="px-4 py-2 text-[11px] text-slate-500 font-semibold uppercase tracking-wide border-b border-slate-100">版本对比</p>
        <button onClick={()=>{navigate("document-compare");onClose();}}
          className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
          对比内部版本
        </button>
        <button onClick={()=>{navigate("document-compare");onClose();}}
          className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
          对比历史人工文件
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export function DocumentWorkspacePage({navigate, onFinalized}:{navigate:(p:Page)=>void;onFinalized?:()=>void}) {
  const [docStatus, setDocStatus] = useState<DocStatus>("reviewing");
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [selectedSection, setSelectedSection] = useState("s1");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [zoom, setZoom] = useState(100);
  const [showMarkers, setShowMarkers] = useState(false);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportState, setExportState] = useState<"idle"|"generating"|"completed">("idle");
  const [showRevisionConflict, setShowRevisionConflict] = useState(false);
  const [showSourceChanged, setShowSourceChanged] = useState(false);
  const [showTemplateChanged, setShowTemplateChanged] = useState(false);
  const [showVersionMenu, setShowVersionMenu] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>(INITIAL_ISSUES);
  const [fieldKey, setFieldKey] = useState("tender_budget");
  const [paragraphBlockId, setParagraphBlockId] = useState("b4-3");
  const [aiBlockId, setAIBlockId] = useState("b4-3");
  const [showFinalizedComplete, setShowFinalizedComplete] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const p0Count = issues.filter(i=>i.severity==="P0"&&!i.resolved).length;

  // Auto-collapse outline when right panel opens
  useEffect(()=>{
    if(rightPanel!==null) setOutlineCollapsed(true);
    else setOutlineCollapsed(false);
  },[rightPanel]);

  function openPanel(panel: RightPanel) {
    setRightPanel(p => p===panel ? null : panel);
  }

  function handleSectionSelect(id: string) {
    setSelectedSection(id);
    const el = document.getElementById(`section-${id}`);
    if(el && canvasRef.current) {
      canvasRef.current.scrollTo({top: el.offsetTop - 32, behavior:"smooth"});
    }
  }

  function handleRunValidation() {
    setSaveStatus("saving");
    setTimeout(()=>{
      setSaveStatus("saved");
      if(p0Count>0) setDocStatus("validation_blocked");
      else setDocStatus("ready_to_finalize");
      setRightPanel("validation");
    }, 1200);
  }

  function handleResolveIssue(id: string) {
    setIssues(prev=>prev.map(i=>i.id===id?{...i,resolved:true}:i));
    setTimeout(()=>{
      const remaining = issues.filter(i=>i.severity==="P0"&&!i.resolved&&i.id!==id);
      if(remaining.length===0) setDocStatus("ready_to_finalize");
    },100);
  }

  function handleFinalize() {
    if(p0Count>0) { openPanel("validation"); return; }
    setShowFinalizeDialog(true);
  }

  function confirmFinalize() {
    setShowFinalizeDialog(false);
    setDocStatus("finalized");
    setShowFinalizedComplete(true);
    onFinalized?.();
  }

  function handleExport() {
    setShowExportDialog(true);
  }

  function startExport() {
    setShowExportDialog(false);
    setExportState("generating");
    setTimeout(()=>setExportState("completed"), 6000);
  }

  if(showFinalizedComplete) {
    return <FinalizedCompletedView navigate={navigate} onExport={()=>{setShowFinalizedComplete(false);handleExport();}}/>;
  }

  const isFinalized = docStatus==="finalized";

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Banners */}
      {showSourceChanged&&<SourceChangedBannerDoc onDismiss={()=>setShowSourceChanged(false)}/>}
      {showTemplateChanged&&<TemplateChangedBannerDoc onDismiss={()=>setShowTemplateChanged(false)}/>}
      {saveStatus==="failed"&&(
        <div className="flex items-center gap-3 border-b border-[#FECDD0] bg-[#FEF1F2] px-5 py-2.5 shrink-0">
          <Icon name="alert" size={14}/>
          <p className="flex-1 text-[13px] text-[#A8323C]"><strong>自动保存失败。</strong>当前修改已保留在本地，请检查网络后重新保存。</p>
          <div className="flex gap-2 shrink-0">
            <button onClick={()=>setSaveStatus("saving")} className="h-6 rounded border border-[#A8323C] px-2 text-[11px] text-[#A8323C] hover:bg-[#FDDDE0]">重新保存</button>
            <button className="h-6 rounded border border-[#A8323C] px-2 text-[11px] text-[#A8323C] hover:bg-[#FDDDE0]">下载副本</button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <DocumentToolbar
        docStatus={docStatus} saveStatus={saveStatus} p0Count={p0Count}
        zoom={zoom} showMarkers={showMarkers}
        onZoomChange={setZoom} onToggleMarkers={()=>setShowMarkers(m=>!m)}
        onRunValidation={handleRunValidation} onFinalize={handleFinalize}
        onExport={handleExport} onOpenPanel={openPanel}
        onNavigate={navigate}
        onShowVersionMenu={()=>setShowVersionMenu(true)}
        onShowSourceChanged={()=>setShowSourceChanged(true)}
        onShowTemplateChanged={()=>setShowTemplateChanged(true)}
      />

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Outline */}
        <DocumentOutline
          sections={SECTIONS} selectedId={selectedSection}
          collapsed={outlineCollapsed}
          onSelect={handleSectionSelect}
          onToggleCollapse={()=>setOutlineCollapsed(c=>!c)}
        />

        {/* Canvas */}
        <main ref={canvasRef} className="flex-1 min-w-0 overflow-y-auto bg-slate-200/60 px-8 py-6">
          <div className="mx-auto" style={{maxWidth: zoom===125?"100%":"794px"}}>
            {SECTIONS.map(section=>(
              <div key={section.id} id={`section-${section.id}`} className="mb-6 bg-white shadow-sm rounded-sm px-14 py-10"
                style={{fontSize:`${zoom/100}em`}}>
                {/* Page header */}
                <div className="flex justify-between items-center border-b border-slate-200 pb-2 mb-6 text-[10px] text-slate-400">
                  <span>某省公司中心机房节能改造项目招标文件 · V0.3 草稿</span>
                  <span>第 {SECTIONS.indexOf(section)+1} 章</span>
                </div>
                {/* Content blocks */}
                <div className="pl-8">
                  {(BLOCKS[section.id]||[]).map(block=>(
                    <ContentBlockView
                      key={block.id}
                      block={block}
                      showMarkers={showMarkers}
                      finalized={isFinalized}
                      onFieldClick={(key)=>{setFieldKey(key);openPanel("field-evidence");}}
                      onParagraphSourceClick={(bid)=>{setParagraphBlockId(bid);openPanel("paragraph-evidence");}}
                      onAIEditRequest={(bid)=>{setAIBlockId(bid);openPanel("ai-edit");}}
                    />
                  ))}
                </div>
                {/* Page footer */}
                <div className="mt-8 flex justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-400">
                  <span>FS-20260905-001 · GEN-20260905-001</span>
                  <span>— {SECTIONS.indexOf(section)+1} —</span>
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Right Panel */}
        {rightPanel&&(
          <div className="w-[400px] shrink-0 flex flex-col overflow-hidden">
            {rightPanel==="field-evidence"&&<FieldEvidenceDrawer fieldKey={fieldKey} onClose={()=>setRightPanel(null)}/>}
            {rightPanel==="paragraph-evidence"&&<ParagraphEvidenceDrawer blockId={paragraphBlockId} onClose={()=>setRightPanel(null)} onAIEdit={()=>setRightPanel("ai-edit")}/>}
            {rightPanel==="ai-edit"&&<AIEditDrawer blockId={aiBlockId} onClose={()=>setRightPanel(null)}/>}
            {rightPanel==="validation"&&(
              <ValidationDrawer
                issues={issues}
                onClose={()=>setRightPanel(null)}
                onViewFull={()=>navigate("validation-center")}
                onResolve={handleResolveIssue}
                navigate={navigate}
              />
            )}
          </div>
        )}
      </div>

      {/* Finalized overlay banner */}
      {isFinalized&&!showFinalizedComplete&&(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 rounded-xl border border-[#C3E8D5] bg-white px-5 py-3 shadow-lg z-10">
          <Icon name="check-circle" size={18}/>
          <span className="text-sm font-medium text-slate-800">已定稿 V1.0 · 只读模式</span>
          <button onClick={handleExport} className="h-8 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C]">导出 DOCX</button>
          <button className="h-8 rounded-lg border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50">创建修订版本</button>
          <button onClick={()=>navigate("contract-source")} className="h-8 rounded-lg border border-[#2E5495] px-3 text-sm text-[#2E5495] hover:bg-[#F2F6FC]">进入合同阶段</button>
        </div>
      )}

      {/* Dialogs */}
      {showFinalizeDialog&&<FinalizeDocumentDialog onClose={()=>setShowFinalizeDialog(false)} onConfirm={confirmFinalize}/>}
      {showExportDialog&&<ExportDocumentDialog onClose={()=>setShowExportDialog(false)} onStart={startExport}/>}
      {exportState==="generating"&&<ExportProgress onBack={()=>{setExportState("idle");navigate("project-detail");}}/>}
      {exportState==="completed"&&<ExportCompleted onClose={()=>setExportState("idle")} onDownload={()=>setExportState("idle")}/>}
      {showRevisionConflict&&<RevisionConflictDialog onClose={()=>setShowRevisionConflict(false)}/>}
      {showVersionMenu&&<VersionMenu onClose={()=>setShowVersionMenu(false)} navigate={navigate}/>}
    </div>
  );
}
