import { useState, useEffect, useRef, useCallback } from "react";
import { Icon } from "../components/UI";
import type { Page } from "../types";

// ─── Types ───────────────────────────────────────────────────────────────────

type FieldStatus = "pending"|"confirmed"|"conflict"|"missing"|"ai-suggested"|"reference-only"|"invalid"|"not-applicable";
type FieldCriticality = "P0"|"P1"|"P2";

interface FieldEvidence { id:string; chapter:string; page:number; excerpt:string; version:string; confidence:number; source?:string; }
interface ConflictCandidate { id:string; value:string; chapter:string; page:number; excerpt:string; confidence:number; }
interface Field {
  id:string; key:string; name:string; criticality:FieldCriticality; status:FieldStatus;
  value:string; groupId:string; evidence:FieldEvidence[]; conflicts?:ConflictCandidate[];
  confirmedBy?:string; confirmedAt?:string; note?:string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GROUPS = [
  {id:"projectInfo",name:"项目基础信息"},
  {id:"procurementScope",name:"采购标的与范围"},
  {id:"techRequirements",name:"技术要求"},
  {id:"equipmentList",name:"设备与数量清单"},
  {id:"delivery",name:"交付地点与周期"},
  {id:"budget",name:"预算与价格信息"},
  {id:"acceptance",name:"验收与质保"},
  {id:"service",name:"服务与交付成果"},
  {id:"other",name:"其他招标条件"},
];

const STATUS_LABEL:Record<FieldStatus,string> = {
  pending:"待确认", confirmed:"已确认", conflict:"来源冲突", missing:"未找到",
  "ai-suggested":"AI 建议", "reference-only":"仅供参考", invalid:"无效", "not-applicable":"不适用",
};
const STATUS_CLS:Record<FieldStatus,string> = {
  pending:"bg-[#FFF7E6] text-[#8B520B]", confirmed:"bg-[#ECF8F2] text-[#116B46]",
  conflict:"bg-[#FFF3E0] text-[#8B4A00]", missing:"bg-[#FEF1F2] text-[#A8323C]",
  "ai-suggested":"bg-[#EEF2FF] text-[#3B5BCC]", "reference-only":"bg-slate-100 text-slate-600",
  invalid:"bg-[#FEF1F2] text-[#A8323C]", "not-applicable":"bg-slate-50 text-slate-400",
};
const CRIT_CLS:Record<FieldCriticality,string> = {
  P0:"bg-[#FEF1F2] text-[#A8323C] border border-[#FECDD0]",
  P1:"bg-[#FFF7E6] text-[#8B520B] border border-[#FDDBA0]",
  P2:"bg-slate-50 text-slate-500 border border-slate-200",
};

// ─── Initial Data (42 fields) ────────────────────────────────────────────────

const INITIAL_FIELDS: Field[] = [
  // projectInfo (7): 5 confirmed, 2 pending
  { id:"f1", key:"project.project_name", name:"项目名称", criticality:"P0", status:"pending",
    value:"某省公司中心机房节能改造项目", groupId:"projectInfo",
    evidence:[{id:"e1",chapter:"第一章 项目概况",page:6,excerpt:"本项目名称为某省公司中心机房节能改造项目，建设单位为某省通信有限公司……",version:"V1.3",confidence:98,source:"文档结构识别 + 语义抽取"}] },
  { id:"f2", key:"project.owner_name", name:"建设单位", criticality:"P0", status:"confirmed",
    value:"某省通信有限公司", groupId:"projectInfo",
    evidence:[{id:"e2",chapter:"封面、第一章 项目概况",page:1,excerpt:"建设单位：某省通信有限公司。本单位依法注册……",version:"V1.3",confidence:99,source:"文档结构识别"}],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:32" },
  { id:"f3", key:"project.project_number", name:"项目编号", criticality:"P0", status:"confirmed",
    value:"XM-2026-0048", groupId:"projectInfo",
    evidence:[{id:"e3",chapter:"项目基本信息表",page:3,excerpt:"项目编号：XM-2026-0048",version:"V1.3",confidence:97,source:"表格提取"}],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:33" },
  { id:"f4", key:"project.location", name:"建设地点", criticality:"P1", status:"confirmed",
    value:"某省某市高新区中心机房", groupId:"projectInfo",
    evidence:[{id:"e4",chapter:"第一章，第 8 页",page:8,excerpt:"项目建设地点为某省某市高新区中心机房，现有机房面积……",version:"V1.3",confidence:95,source:"语义抽取"}],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:33" },
  { id:"f5", key:"project.background", name:"项目背景说明", criticality:"P1", status:"confirmed",
    value:"现有机房 PUE 值达 2.1，高于行业节能标准",groupId:"projectInfo",
    evidence:[{id:"e5",chapter:"第一章 项目背景",page:5,excerpt:"目前机房 PUE 值达 2.1，远高于国家绿色数据中心 PUE≤1.5 的要求……",version:"V1.3",confidence:92,source:"语义抽取"}],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:34" },
  { id:"f6", key:"project.approval_doc", name:"立项批复文号", criticality:"P1", status:"confirmed",
    value:"某通信〔2026〕52 号", groupId:"projectInfo",
    evidence:[{id:"e6",chapter:"第二章 项目立项",page:12,excerpt:"根据某通信〔2026〕52 号批复文件……",version:"V1.3",confidence:96,source:"文档结构识别"}],
    confirmedBy:"陈昊", confirmedAt:"2026-09-05 11:02" },
  { id:"f7", key:"project.approval_status", name:"审批状态", criticality:"P2", status:"pending",
    value:"已批复（待核实）", groupId:"projectInfo",
    evidence:[{id:"e7",chapter:"第二章 项目立项",page:12,excerpt:"可研报告已于 2026 年 8 月完成评审……",version:"V1.3",confidence:78,source:"语义抽取"}] },

  // procurementScope (4): 3 confirmed, 1 pending P0
  { id:"f8", key:"procurement.scope", name:"本次采购范围", criticality:"P0", status:"pending",
    value:"已识别 9 项建设内容，尚未确定哪些属于本次采购范围", groupId:"procurementScope",
    note:"scope-selection",
    evidence:[{id:"e8",chapter:"第三章 建设内容与规模",page:18,excerpt:"本次节能改造工程主要包含机房基础环境改造、UPS 主机采购、蓄电池组采购、精密空调采购、动环监控系统、综合布线、安装调试、用户培训和三年运维服务共九项内容……",version:"V1.3",confidence:85,source:"语义抽取"}] },
  { id:"f9", key:"procurement.type", name:"采购类型", criticality:"P1", status:"confirmed",
    value:"货物类 + 服务类", groupId:"procurementScope", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:35" },
  { id:"f10", key:"procurement.method", name:"采购方式", criticality:"P1", status:"confirmed",
    value:"公开招标", groupId:"procurementScope", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:35" },
  { id:"f11", key:"procurement.bid_opening", name:"开标方式", criticality:"P1", status:"confirmed",
    value:"集中开标", groupId:"procurementScope", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:35" },

  // techRequirements (5): 4 confirmed, 1 conflict
  { id:"f12", key:"tech.energy_target", name:"节能效率目标", criticality:"P1", status:"confirmed",
    value:"改造后 PUE ≤ 1.5", groupId:"techRequirements", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:36" },
  { id:"f13", key:"tech.pue", name:"PUE 要求", criticality:"P1", status:"confirmed",
    value:"1.5 以下", groupId:"techRequirements", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:36" },
  { id:"f14", key:"tech.standard", name:"技术规范标准", criticality:"P1", status:"conflict",
    value:"存在 2 个候选值", groupId:"techRequirements", evidence:[],
    conflicts:[
      {id:"c1",value:"GB 50174-2017 数据中心设计规范",chapter:"第五章 技术要求",page:38,excerpt:"本项目应遵循 GB 50174-2017 数据中心设计规范执行……",confidence:82},
      {id:"c2",value:"T/CEC 201-2019 数据中心绿色等级评价标准",chapter:"第四章 建设标准",page:28,excerpt:"依据 T/CEC 201-2019 绿色数据中心评价要求……",confidence:76},
    ] },
  { id:"f15", key:"tech.origin", name:"产品产地要求", criticality:"P2", status:"confirmed",
    value:"国产化优先", groupId:"techRequirements", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:37" },
  { id:"f16", key:"tech.qualification", name:"制造商资质要求", criticality:"P2", status:"confirmed",
    value:"ISO 9001 认证", groupId:"techRequirements", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:37" },

  // equipmentList (5): 3 confirmed, 1 conflict, 1 missing
  { id:"f17", key:"procurement.equipment_quantity", name:"设备数量", criticality:"P1", status:"conflict",
    value:"存在 2 个候选值", groupId:"equipmentList", evidence:[],
    conflicts:[
      {id:"c3",value:"12 套",chapter:"第六章 主要设备清单",page:54,excerpt:"核心设备共配置 12 套。",confidence:88},
      {id:"c4",value:"10 套",chapter:"第四章 技术方案",page:31,excerpt:"本次计划部署 10 套核心设备。",confidence:84},
    ] },
  { id:"f18", key:"equipment.ups", name:"UPS 主机数量", criticality:"P1", status:"confirmed",
    value:"2 台（200kVA 模块化）", groupId:"equipmentList", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:38" },
  { id:"f19", key:"equipment.battery", name:"蓄电池组数量", criticality:"P1", status:"confirmed",
    value:"4 组（2V×240 节）", groupId:"equipmentList", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:38" },
  { id:"f20", key:"equipment.ac", name:"精密空调数量", criticality:"P1", status:"confirmed",
    value:"6 台（30kW）", groupId:"equipmentList", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:38" },
  { id:"f21", key:"equipment.monitoring", name:"动环监控系统", criticality:"P1", status:"missing",
    value:"未找到", groupId:"equipmentList", evidence:[],
    note:"可研中未明确动环监控系统的品牌和规格要求。" },

  // delivery (4): 2 confirmed, 1 pending, 1 ai-suggested P0
  { id:"f22", key:"procurement.delivery_location", name:"交付地点", criticality:"P1", status:"pending",
    value:"某省某市高新区中心机房", groupId:"delivery",
    evidence:[{id:"e22",chapter:"第一章，第 8 页",page:8,excerpt:"项目建设地点为某省某市高新区中心机房",version:"V1.3",confidence:91,source:"语义抽取"}] },
  { id:"f23", key:"procurement.delivery_period", name:"本次招标交付周期", criticality:"P0", status:"ai-suggested",
    value:"项目建设周期 12 个月", groupId:"delivery",
    note:"项目总建设周期可能包含审批、设计、采购和实施，不能自动等同本次招标交付周期。",
    evidence:[{id:"e23",chapter:"第二章 建设期",page:15,excerpt:"项目计划建设周期为 12 个月，自合同签订之日起算……",version:"V1.3",confidence:72,source:"AI 上下文推断"}] },
  { id:"f24", key:"procurement.install_period", name:"安装调试周期", criticality:"P1", status:"confirmed",
    value:"60 天", groupId:"delivery", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:39" },
  { id:"f25", key:"procurement.acceptance_period", name:"验收周期", criticality:"P1", status:"confirmed",
    value:"30 天", groupId:"delivery", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:39" },

  // budget (3): 1 confirmed, 1 reference-only, 1 missing P0
  { id:"f26", key:"investment.total", name:"项目总投资", criticality:"P1", status:"reference-only",
    value:"人民币 1,280 万元", groupId:"budget",
    note:"项目总投资仅供参考，不能直接作为招标预算或合同金额。",
    evidence:[{id:"e26",chapter:"第八章 投资估算",page:72,excerpt:"本项目总投资估算约 1,280 万元，其中建设投资……",version:"V1.3",confidence:94,source:"表格提取"}] },
  { id:"f27", key:"procurement.tender_budget", name:"招标预算", criticality:"P0", status:"missing",
    value:"未找到", groupId:"budget", evidence:[],
    note:"可研中未找到可以直接作为招标预算的权威值。" },
  { id:"f28", key:"procurement.payment_terms", name:"付款条件", criticality:"P1", status:"confirmed",
    value:"分三期付款", groupId:"budget", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:40" },

  // acceptance (5): 3 confirmed, 1 pending, 1 missing
  { id:"f29", key:"procurement.acceptance_req", name:"验收要求", criticality:"P1", status:"pending",
    value:"已识别 5 项验收要求", groupId:"acceptance",
    evidence:[{id:"e29",chapter:"第七章 验收标准",page:65,excerpt:"验收应包括：性能测试、安全检查、文档移交、培训完成及试运行稳定……",version:"V1.3",confidence:88,source:"语义抽取"}] },
  { id:"f30", key:"procurement.acceptance_std", name:"验收标准文件", criticality:"P1", status:"confirmed",
    value:"遵循国家相关行业标准", groupId:"acceptance", evidence:[],
    confirmedBy:"陈昊", confirmedAt:"2026-09-05 11:05" },
  { id:"f31", key:"procurement.trial_run", name:"试运行周期", criticality:"P1", status:"confirmed",
    value:"90 天", groupId:"acceptance", evidence:[],
    confirmedBy:"陈昊", confirmedAt:"2026-09-05 11:05" },
  { id:"f32", key:"procurement.perf_guarantee", name:"履约担保比例", criticality:"P1", status:"confirmed",
    value:"合同金额 10%", groupId:"acceptance", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:41" },
  { id:"f33", key:"procurement.warranty", name:"质保期", criticality:"P1", status:"missing",
    value:"未找到", groupId:"acceptance", evidence:[],
    note:"可研中未明确设备质保期要求。" },

  // service (4): 2 confirmed, 1 conflict, 1 missing
  { id:"f34", key:"service.training", name:"培训要求", criticality:"P2", status:"confirmed",
    value:"提供现场操作培训不少于 3 天", groupId:"service", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:41" },
  { id:"f35", key:"service.support", name:"售后服务期", criticality:"P1", status:"confirmed",
    value:"3 年", groupId:"service", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:41" },
  { id:"f36", key:"service.spare_parts", name:"备品备件", criticality:"P2", status:"conflict",
    value:"存在 2 个候选值", groupId:"service", evidence:[],
    conflicts:[
      {id:"c5",value:"提供不少于 2 年所需备品备件",chapter:"第七章 服务要求",page:63,excerpt:"供方应提供不少于 2 年的备品备件清单和采购渠道……",confidence:79},
      {id:"c6",value:"提供不少于 1 年所需备品备件",chapter:"第五章 技术规格",page:42,excerpt:"备品备件供应期限不少于 1 年……",confidence:73},
    ] },
  { id:"f37", key:"service.documentation", name:"交付文档要求", criticality:"P2", status:"missing",
    value:"未找到", groupId:"service", evidence:[],
    note:"可研中未明确交付文档清单要求。" },

  // other (5): 4 confirmed, 1 pending
  { id:"f38", key:"bid.validity", name:"投标有效期", criticality:"P1", status:"confirmed",
    value:"90 天", groupId:"other", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:42" },
  { id:"f39", key:"bid.bond", name:"投标保证金", criticality:"P1", status:"confirmed",
    value:"人民币 5 万元", groupId:"other", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:42" },
  { id:"f40", key:"bid.perf_bond", name:"履约保证金比例", criticality:"P1", status:"missing",
    value:"未找到", groupId:"other", evidence:[],
    note:"可研中未明确履约保证金比例要求。" },
  { id:"f41", key:"bid.qualifications", name:"投标人资质要求", criticality:"P1", status:"pending",
    value:"系统集成资质三级及以上", groupId:"other",
    evidence:[{id:"e41",chapter:"第九章 资质要求",page:78,excerpt:"投标人应具备系统集成资质……",version:"V1.3",confidence:83,source:"语义抽取"}] },
  { id:"f42", key:"bid.consortium", name:"是否允许联合体", criticality:"P2", status:"confirmed",
    value:"不允许联合体投标", groupId:"other", evidence:[],
    confirmedBy:"王明远", confirmedAt:"2026-09-05 10:42" },
];

const SCOPE_ITEMS = [
  "机房基础环境改造","UPS 主机采购","蓄电池组采购","精密空调采购",
  "动环监控系统","综合布线","安装调试","用户培训","三年运维服务",
];

// ─── Badge Components ─────────────────────────────────────────────────────────

function FieldStatusBadge({status}:{status:FieldStatus}) {
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium ${STATUS_CLS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function FieldCriticalityBadge({criticality}:{criticality:FieldCriticality}) {
  return (
    <span className={`inline-flex h-5 items-center rounded px-1.5 font-mono text-[11px] font-bold ${CRIT_CLS[criticality]}`}>
      {criticality}
    </span>
  );
}

// ─── Evidence Drawer ──────────────────────────────────────────────────────────

function EvidenceDrawer({field, onClose, onConfirm, readOnly}:{field:Field;onClose:()=>void;onConfirm:()=>void;readOnly:boolean}) {
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  return (
    <div className="fixed inset-0 z-20">
      <button aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-slate-950/10"/>
      <aside className="absolute right-0 top-0 h-full w-[420px] max-w-[calc(100vw-48px)] border-l border-slate-200 bg-white shadow-[-12px_0_30px_rgba(15,23,42,.08)]">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
          <h2 className="font-semibold text-slate-800">字段证据</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <Icon name="close"/>
          </button>
        </div>
        <div className="h-[calc(100%-64px)] overflow-auto p-6">
          <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <FieldCriticalityBadge criticality={field.criticality}/>
              <FieldStatusBadge status={field.status}/>
            </div>
            <p className="font-semibold text-slate-800">{field.name}</p>
            <p className="mt-1 font-mono text-xs text-slate-500">{field.key}</p>
            <p className="mt-3 text-sm text-slate-700">{field.value}</p>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">来源证据</p>
            <span className="text-xs text-slate-400">来源文件：V1.3</span>
          </div>

          {field.evidence.length === 0 && (
            <p className="text-sm text-slate-400 italic">该字段暂无来源证据记录。</p>
          )}

          <div className="space-y-4">
            {field.evidence.map(ev=>(
              <div key={ev.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs font-medium text-slate-700">{ev.chapter}</p>
                    <p className="mt-0.5 text-xs text-slate-500">第 {ev.page} 页</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">置信度</p>
                    <p className={`text-sm font-semibold ${ev.confidence>=90?"text-[#168A5B]":ev.confidence>=75?"text-[#A86512]":"text-[#C2414B]"}`}>{ev.confidence}%</p>
                  </div>
                </div>
                <blockquote className="rounded border-l-2 border-[#2E5495] bg-[#F6F8FB] px-3 py-2 text-sm leading-6 text-slate-700">
                  "{ev.excerpt}"
                </blockquote>
                {ev.source && (
                  <p className="mt-2 text-xs text-slate-400">提取方式：{ev.source}</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                    <Icon name="external" size={13}/>打开原文位置
                  </button>
                  <button className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                    <Icon name="copy" size={13}/>复制原文
                  </button>
                </div>
              </div>
            ))}
          </div>

          {field.conflicts && (
            <div className="mt-4">
              <p className="mb-3 text-xs font-medium text-slate-500">冲突候选值</p>
              <div className="space-y-3">
                {field.conflicts.map(c=>(
                  <div key={c.id} className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <p className="font-medium text-sm text-slate-800">{c.value}</p>
                    <p className="mt-1 text-xs text-slate-500">{c.chapter}，第 {c.page} 页 · 置信度 {c.confidence}%</p>
                    <p className="mt-2 text-xs text-slate-600 italic">"{c.excerpt}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!readOnly && field.status !== "confirmed" && field.status !== "reference-only" && field.status !== "conflict" && field.status !== "missing" && (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <button onClick={()=>{onConfirm();onClose();}}
                className="w-full rounded-lg bg-[#2E5495] py-2 text-sm font-medium text-white hover:bg-[#24457C]">
                确认此值
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Conflict Resolution Dialog ───────────────────────────────────────────────

function ConflictResolutionDialog({field, onClose, onSave}:{field:Field;onClose:()=>void;onSave:(value:string,reason:string)=>void}) {
  const [selected, setSelected] = useState<string>("");
  const [customValue, setCustomValue] = useState("");
  const [reason, setReason] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  const canSave = ((useCustom && customValue.trim()) || (!useCustom && selected)) && reason.trim();

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/30 p-6"
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="w-full max-w-[920px] max-h-[calc(100vh-96px)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,.2)]">
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">解决字段冲突</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              字段：<strong>{field.name}</strong>　系统在不同章节识别到多个候选值，请选择正确值或输入最终确认值。
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Icon name="close"/></button>
        </div>

        <div className="p-7">
          <p className="mb-4 text-sm font-medium text-slate-700">候选值</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(field.conflicts ?? []).map((c,idx)=>(
              <label key={c.id}
                className={`cursor-pointer rounded-xl border-2 p-5 transition-all ${selected===c.id&&!useCustom?"border-[#2E5495] bg-[#F2F6FC]":"border-slate-200 hover:border-slate-300"}`}
                onClick={()=>{setSelected(c.id);setUseCustom(false);}}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <span className="text-[11px] font-medium text-slate-400">候选值 {idx+1}</span>
                    <p className="mt-1 text-lg font-semibold text-slate-800">{c.value}</p>
                  </div>
                  <div className={`size-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 ${selected===c.id&&!useCustom?"border-[#2E5495] bg-[#2E5495]":"border-slate-300"}`}>
                    {selected===c.id&&!useCustom&&<span className="size-2 rounded-full bg-white"/>}
                  </div>
                </div>
                <p className="text-xs text-slate-500 mb-1">{c.chapter}，第 {c.page} 页</p>
                <p className="text-xs leading-5 text-slate-600 italic">"{c.excerpt}"</p>
                <p className="mt-2 text-xs text-slate-400">置信度 {c.confidence}%</p>
              </label>
            ))}
          </div>

          <div className={`mt-4 rounded-xl border-2 p-5 cursor-pointer transition-all ${useCustom?"border-[#2E5495] bg-[#F2F6FC]":"border-slate-200 hover:border-slate-300"}`}
            onClick={()=>{setUseCustom(true);setSelected("");}}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-slate-700">使用自定义值</p>
              <div className={`size-5 rounded-full border-2 flex items-center justify-center ${useCustom?"border-[#2E5495] bg-[#2E5495]":"border-slate-300"}`}>
                {useCustom&&<span className="size-2 rounded-full bg-white"/>}
              </div>
            </div>
            {useCustom && (
              <div className="grid grid-cols-3 gap-3" onClick={e=>e.stopPropagation()}>
                <input autoFocus className="col-span-2 h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#DCE7F7]"
                  placeholder="输入最终确认值" value={customValue} onChange={e=>setCustomValue(e.target.value)}/>
                <input className="h-9 rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#DCE7F7]"
                  placeholder="单位（可选）"/>
              </div>
            )}
          </div>

          <div className="mt-5">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              确认依据 / 修改原因 <span className="text-[#C2414B]">*</span>
            </label>
            <textarea rows={3}
              className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#DCE7F7]"
              placeholder="请说明选择该值的依据，或修改值的原因……"
              value={reason} onChange={e=>setReason(e.target.value)}/>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-7 py-4">
          <button onClick={onClose} className="h-10 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 hover:border-[#2E5495] hover:text-[#24457C]">取消</button>
          <button
            disabled={!canSave}
            onClick={()=>{
              const val = useCustom ? customValue : (field.conflicts?.find(c=>c.id===selected)?.value ?? "");
              onSave(val, reason);
              onClose();
            }}
            className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            确认并保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Manual Input Dialog ──────────────────────────────────────────────────────

function ManualInputDialog({field, onClose, onSave}:{field:Field;onClose:()=>void;onSave:(value:string,source:string)=>void}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("人民币");
  const [taxIncluded, setTaxIncluded] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [sourceNote, setSourceNote] = useState("");

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  const canSave = amount.trim() && sourceType;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/30 p-6"
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="w-full max-w-[600px] rounded-xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,.2)]">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">补充{field.name}</h2>
            <p className="mt-1 text-[13px] text-slate-500">请手动输入该字段的确认值，并注明数据来源。</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Icon name="close"/></button>
        </div>

        <div className="p-6">
          {/* Reference info */}
          <div className="mb-5 rounded-lg border border-[#DCE7F7] bg-[#F6F8FB] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="info" size={14}/>
              <span className="text-xs font-medium text-[#24457C]">参考信息</span>
            </div>
            <p className="text-sm text-slate-700">可研项目总投资：<strong>1,280 万元</strong></p>
            <p className="mt-1 text-xs text-[#8B520B]">⚠ 仅供参考，不会自动带入招标预算，也不会自动等同合同金额。</p>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                  {field.name}金额 <span className="text-[#C2414B]">*</span>
                </label>
                <input autoFocus className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#DCE7F7]"
                  placeholder="例如：800" value={amount} onChange={e=>setAmount(e.target.value)}/>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">币种</label>
                <select className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#2E5495] focus:outline-none"
                  value={currency} onChange={e=>setCurrency(e.target.value)}>
                  <option>人民币</option><option>美元</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">是否含税</label>
              <div className="flex gap-4">
                {["含税","不含税","待定"].map(opt=>(
                  <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="tax" value={opt} checked={taxIncluded===opt} onChange={()=>setTaxIncluded(opt)}/>
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                数据来源类型 <span className="text-[#C2414B]">*</span>
              </label>
              <select className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#2E5495] focus:outline-none"
                value={sourceType} onChange={e=>setSourceType(e.target.value)}>
                <option value="">请选择来源类型</option>
                <option>用户确认</option>
                <option>正式业务系统</option>
                <option>采购计划</option>
                <option>财务批复</option>
                <option>其他正式材料</option>
              </select>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">来源说明</label>
              <textarea rows={2} className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#DCE7F7]"
                placeholder="请简要说明该值的来源依据……"
                value={sourceNote} onChange={e=>setSourceNote(e.target.value)}/>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-[#FECDD0] bg-[#FEF1F2] px-3 py-2 text-xs text-[#A8323C]">
            <Icon name="alert" size={12}/>{" "}
            招标预算需来自用户确认或权威业务数据，系统不会根据项目总投资自行推算。
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button onClick={onClose} className="h-10 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 hover:border-[#2E5495]">取消</button>
          <button disabled={!canSave}
            onClick={()=>{
              onSave(`${currency} ${amount} 万元（${taxIncluded||"税额待定"}）`, sourceType);
              onClose();
            }}
            className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            保存并确认
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Scope Selection Dialog ───────────────────────────────────────────────────

function ScopeSelectionDialog({onClose, onSave, initialChecked}:{onClose:()=>void;onSave:(items:string[])=>void;initialChecked:string[]}) {
  const [checked, setChecked] = useState<string[]>(initialChecked.length > 0 ? initialChecked : SCOPE_ITEMS.slice(0,6));
  const [selected, setSelected] = useState<string>(SCOPE_ITEMS[0]);
  const [details, setDetails] = useState<Record<string,string>>({});

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);
    return()=>document.removeEventListener("keydown",h);
  },[onClose]);

  const toggle = (item:string) => {
    setChecked(prev => prev.includes(item) ? prev.filter(x=>x!==item) : [...prev, item]);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/30 p-6"
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="w-full max-w-[1000px] max-h-[calc(100vh-80px)] flex flex-col rounded-xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,.2)]">
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5 shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">确定本次采购范围</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              可研描述的是整个项目范围。请勾选本次招标实际包含的建设内容，未勾选内容不会进入本次招标文件。
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Icon name="close"/></button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: checklist */}
          <div className="w-[340px] shrink-0 border-r border-slate-200 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <span className="text-xs font-medium text-slate-500">可研识别的全部建设内容</span>
              <div className="flex gap-3">
                <button className="text-xs text-[#2E5495] hover:underline" onClick={()=>setChecked([...SCOPE_ITEMS])}>全选</button>
                <button className="text-xs text-slate-500 hover:underline" onClick={()=>setChecked([])}>清除</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-1">
              {SCOPE_ITEMS.map(item=>(
                <label key={item}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${selected===item?"bg-[#F2F6FC]":"hover:bg-slate-50"}`}
                  onClick={()=>setSelected(item)}>
                  <input type="checkbox" checked={checked.includes(item)}
                    onChange={()=>toggle(item)}
                    onClick={e=>e.stopPropagation()}
                    className="size-4 rounded border-slate-300 accent-[#2E5495]"/>
                  <span className={`text-sm ${checked.includes(item)?"text-slate-800":"text-slate-400 line-through"}`}>{item}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Right: detail */}
          <div className="flex-1 overflow-auto p-6">
            <p className="text-sm font-semibold text-slate-800 mb-4">{selected} — 详细配置</p>
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">本次采购是否包含</label>
                <div className="flex gap-4">
                  {["包含","不包含"].map(opt=>(
                    <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" name={`include-${selected}`} defaultChecked={opt==="包含" && checked.includes(selected)}/>
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">数量</label>
                  <input className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none" placeholder="数量"/>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">单位</label>
                  <input className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none" placeholder="套 / 台 / 项"/>
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">交付成果</label>
                <input className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none"
                  placeholder="描述该建设内容的交付成果"/>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">边界说明</label>
                <textarea rows={2} className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm focus:border-[#2E5495] focus:outline-none"
                  placeholder="说明本次采购范围的边界……"/>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">不包含内容</label>
                <textarea rows={2} className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm focus:border-[#2E5495] focus:outline-none"
                  placeholder="明确排除在本次招标外的内容……"/>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5">来源章节</label>
                <input readOnly className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
                  value="第三章 建设内容与规模，第 18 页"/>
              </div>
              <button className="inline-flex items-center gap-1.5 text-xs text-[#2E5495] hover:underline">
                <Icon name="external" size={13}/>查看来源原文
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-7 py-4 shrink-0">
          <p className="text-sm text-slate-600">
            已选择 <strong className="text-[#2E5495]">{checked.length}</strong> 项
            <span className="text-slate-400">未选择 {SCOPE_ITEMS.length - checked.length} 项</span>
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="h-10 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 hover:border-[#2E5495]">取消</button>
            <button disabled={checked.length===0}
              onClick={()=>{onSave(checked);onClose();}}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
              保存采购范围
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Upstream Changed Banner ──────────────────────────────────────────────────

function UpstreamChangedBanner({onDismiss}:{onDismiss:()=>void}) {
  return (
    <div className="border-b border-blue-200 bg-[#EFF6FF] px-6 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon name="info" size={16}/>
          <div>
            <p className="text-sm font-semibold text-[#1D4ED8]">源可研报告已有新版本</p>
            <p className="mt-0.5 text-xs text-[#3B82F6]">
              当前确认依据：V1.3　最新版本：V1.4　系统不会自动覆盖当前字段，请查看变化后决定是否同步。
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button className="h-8 rounded-lg bg-[#2563EB] px-4 text-xs font-medium text-white hover:bg-[#1D4ED8]">查看差异</button>
          <button onClick={onDismiss} className="h-8 rounded-lg border border-blue-300 bg-white px-4 text-xs font-medium text-[#2563EB] hover:bg-blue-50">继续使用 V1.3</button>
          <button className="text-xs text-[#6B7280] hover:text-[#374151]">重新基于 V1.4 提取</button>
        </div>
      </div>
    </div>
  );
}

// ─── Read Only Banner ─────────────────────────────────────────────────────────

function ReadOnlyBanner() {
  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5">
      <Icon name="lock" size={15}/>
      <p className="text-sm text-amber-800">
        <strong>只读模式</strong>　招标文件已定稿，当前字段快照已被后续文件使用。
        锁定人：陈昊　锁定时间：2026-09-05 14:20
      </p>
      <button className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50">
        <Icon name="external" size={13}/>导出字段清单
      </button>
    </div>
  );
}

// ─── Field Confirmation Header ────────────────────────────────────────────────

function FieldConfirmationHeader({fields, navigate, readOnly}:{fields:Field[];navigate:(p:Page)=>void;readOnly:boolean}) {
  const confirmed = fields.filter(f=>f.status==="confirmed").length;
  const pending = fields.filter(f=>["pending","ai-suggested","reference-only"].includes(f.status)).length;
  const conflict = fields.filter(f=>f.status==="conflict").length;
  const missing = fields.filter(f=>f.status==="missing").length;
  const p0Blocked = fields.filter(f=>f.criticality==="P0" && !["confirmed","not-applicable"].includes(f.status)).length;
  const total = fields.length;
  const pct = Math.round(confirmed / total * 100);

  return (
    <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-slate-500 mb-4">
        <button onClick={()=>navigate("project-list")} className="hover:text-[#24457C]">项目空间</button>
        <span>/</span>
        <button onClick={()=>navigate("project-detail")} className="hover:text-[#24457C]">某省公司中心机房节能改造项目</button>
        <span>/</span>
        <button onClick={()=>navigate("project-detail")} className="hover:text-[#24457C]">招标文件</button>
        <span>/</span>
        <span className="text-slate-800 font-medium">字段确认</span>
      </nav>

      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-800">确认招标文件关键字段</h1>
            {readOnly && <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"><Icon name="lock" size={12}/>只读</span>}
          </div>
          <p className="mt-1 text-[13px] text-slate-500">请核对从可研报告中识别的信息。只有经过确认的关键字段才能用于生成招标文件。</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>来源文件：某省公司中心机房节能改造项目可行性研究报告</span>
            <span>来源方式：平台已定稿文件</span>
            <span>使用版本：<strong className="text-slate-700">V1.3</strong></span>
            <span className="flex items-center gap-1 text-[#116B46]"><Icon name="lock" size={11}/>已锁定 · 2026-09-05 10:32</span>
            <button className="flex items-center gap-1 text-[#2E5495] hover:underline"><Icon name="external" size={12}/>查看源文件</button>
          </div>
        </div>

        <div className="shrink-0 flex items-end gap-6">
          {/* Stats */}
          <div className="flex items-center gap-4">
            {[
              {label:"字段总数", value:total, cls:"text-slate-700"},
              {label:"已确认", value:confirmed, cls:"text-[#116B46]"},
              {label:"待确认", value:pending, cls:"text-[#8B520B]"},
              {label:"存在冲突", value:conflict, cls:"text-[#8B4A00]"},
              {label:"未找到", value:missing, cls:"text-[#A8323C]"},
              {label:"P0 阻断", value:p0Blocked, cls:`font-bold ${p0Blocked>0?"text-[#A8323C]":"text-[#116B46]"}`},
            ].map(s=>(
              <div key={s.label} className="text-center">
                <p className={`text-xl font-semibold leading-none ${s.cls}`}>{s.value}</p>
                <p className="mt-1 text-[11px] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
          {/* Progress */}
          <div className="w-[120px]">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>完成度</span><span className="font-medium text-slate-700">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-[#2E5495] transition-all" style={{width:`${pct}%`}}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Field Group Navigation ───────────────────────────────────────────────────

function FieldGroupNavigation({fields, currentGroup, onSelect}:{fields:Field[];currentGroup:string;onSelect:(g:string)=>void}) {
  const groupStats = (gid:string) => {
    const gf = fields.filter(f=>f.groupId===gid);
    return {
      total: gf.length,
      confirmed: gf.filter(f=>f.status==="confirmed").length,
      conflict: gf.filter(f=>f.status==="conflict").length,
      missing: gf.filter(f=>f.status==="missing").length,
      pending: gf.filter(f=>["pending","ai-suggested"].includes(f.status)).length,
    };
  };

  return (
    <nav className="w-[220px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
      <div className="p-3">
        <button
          onClick={()=>onSelect("all")}
          className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${currentGroup==="all"?"border-l-[3px] border-[#2E5495] bg-[#F2F6FC] text-[#24457C]":"text-slate-600 hover:bg-slate-50"}`}>
          <p className="text-[13px] font-medium">全部字段</p>
          <p className="mt-0.5 text-xs text-slate-400">{fields.filter(f=>f.status==="confirmed").length} / {fields.length}</p>
        </button>
      </div>
      <div className="border-t border-slate-100 p-3 space-y-0.5">
        {GROUPS.map(g=>{
          const s = groupStats(g.id);
          const isActive = currentGroup === g.id;
          return (
            <button key={g.id} onClick={()=>onSelect(g.id)}
              className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${isActive?"border-l-[3px] border-[#2E5495] bg-[#F2F6FC] text-[#24457C]":"text-slate-600 hover:bg-slate-50"}`}>
              <p className="text-[13px] font-medium leading-snug">{g.name}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                <span className="text-slate-400">{s.confirmed}/{s.total}</span>
                {s.conflict>0 && <span className="text-[#8B4A00]">{s.conflict} 冲突</span>}
                {s.missing>0 && <span className="text-[#A8323C]">{s.missing} 缺失</span>}
                {s.pending>0 && !isActive && <span className="text-[#8B520B]">{s.pending} 待确认</span>}
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Field Filter Bar ─────────────────────────────────────────────────────────

function FieldFilterBar({
  statusFilter, criticalityFilter, searchKeyword, onlyBlocked,
  onChange,
}:{
  statusFilter:string; criticalityFilter:string; searchKeyword:string; onlyBlocked:boolean;
  onChange:(k:string,v:string|boolean)=>void;
}) {
  const statusTabs = [
    {key:"all",label:"全部"},
    {key:"pending",label:"待确认"},
    {key:"conflict",label:"来源冲突"},
    {key:"missing",label:"未找到"},
    {key:"ai-suggested",label:"AI 建议"},
    {key:"confirmed",label:"已确认"},
    {key:"invalid",label:"无效"},
  ];

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 xl:px-8">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <label className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" size={15}/></span>
          <input className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#DCE7F7]"
            placeholder="搜索字段名称或字段键"
            value={searchKeyword} onChange={e=>onChange("search",e.target.value)}/>
        </label>

        {/* Status tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {statusTabs.map(t=>(
            <button key={t.key}
              onClick={()=>onChange("status",t.key)}
              className={`h-7 rounded-md px-3 text-[12px] font-medium transition-colors ${statusFilter===t.key?"bg-white text-slate-800 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Criticality */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {["all","P0","P1","P2"].map(c=>(
            <button key={c}
              onClick={()=>onChange("criticality",c)}
              className={`h-7 rounded-md px-3 text-[12px] font-medium transition-colors ${criticalityFilter===c?"bg-white text-slate-800 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>
              {c==="all"?"全部":c}
            </button>
          ))}
        </div>

        {/* Blocked quick filter */}
        <button
          onClick={()=>onChange("blocked",!onlyBlocked)}
          className={`h-9 rounded-lg border px-3 text-[12px] font-medium transition-colors ${onlyBlocked?"border-[#C2414B] bg-[#FEF1F2] text-[#A8323C]":"border-slate-300 bg-white text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]"}`}>
          <span className="flex items-center gap-1.5"><Icon name="alert" size={13}/>仅查看阻断项</span>
        </button>
      </div>
    </div>
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────

function FieldRowItem({field, readOnly, onViewEvidence, onConfirm, onResolveConflict, onManualInput, onSelectScope}:{
  field:Field; readOnly:boolean;
  onViewEvidence:(f:Field)=>void; onConfirm:(id:string)=>void;
  onResolveConflict:(f:Field)=>void; onManualInput:(f:Field)=>void;
  onSelectScope:()=>void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!moreOpen) return;
    const h=(e:MouseEvent)=>{if(moreRef.current&&!moreRef.current.contains(e.target as Node))setMoreOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[moreOpen]);

  const isScope = field.note === "scope-selection";
  const isBlocking = field.criticality === "P0" && !["confirmed","not-applicable"].includes(field.status);

  return (
    <article className={`border-b border-slate-100 px-5 py-4 transition-colors hover:bg-[#FBFCFE] ${isBlocking?"border-l-2 border-l-[#C2414B]":""}`}>
      {/* Row 1: badges + name + value */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <FieldCriticalityBadge criticality={field.criticality}/>
          <FieldStatusBadge status={field.status}/>
          <span className="font-medium text-slate-800">{field.name}</span>
          <span className="font-mono text-[11px] text-slate-400">{field.key}</span>
        </div>
        <div className="shrink-0 max-w-xs text-right">
          {field.status === "missing" ? (
            <span className="text-sm italic text-slate-400">未找到</span>
          ) : field.status === "conflict" ? (
            <span className="text-sm text-orange-600">{field.value}</span>
          ) : (
            <span className="text-sm text-slate-700">{field.value}</span>
          )}
        </div>
      </div>

      {/* Special note */}
      {field.note && field.note !== "scope-selection" && (
        <div className={`mt-2 flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-5 ${field.status==="reference-only"?"border-l-2 border-slate-300 bg-slate-50 text-slate-600":field.status==="ai-suggested"?"border-l-2 border-[#3B5BCC] bg-[#EEF2FF] text-[#3B5BCC]":"border-l-2 border-[#FECDD0] bg-[#FEF1F2] text-[#A8323C]"}`}>
          <Icon name="info" size={13}/>
          <span>{field.note}</span>
        </div>
      )}

      {/* Conflict candidates preview */}
      {field.conflicts && (
        <div className="mt-2 flex flex-wrap gap-2">
          {field.conflicts.map((c,i)=>(
            <span key={c.id} className="rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
              候选 {i+1}：{c.value}（{c.chapter.split(" ")[0]}）
            </span>
          ))}
        </div>
      )}

      {/* Row 2: meta + actions */}
      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {field.evidence.length > 0 && (
            <span>来源：{field.evidence[0].chapter}，第 {field.evidence[0].page} 页</span>
          )}
          {field.evidence.length > 0 && (
            <span className={`${field.evidence[0].confidence>=90?"text-[#116B46]":field.evidence[0].confidence>=75?"text-[#8B520B]":"text-[#A8323C]"}`}>
              置信度 {field.evidence[0].confidence}%
            </span>
          )}
          {field.confirmedBy && (
            <span className="flex items-center gap-1 text-[#116B46]">
              <Icon name="check-circle" size={11}/>{field.confirmedBy} · {field.confirmedAt?.slice(11)}
            </span>
          )}
        </div>

        {!readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            {/* Primary actions */}
            {isScope ? (
              <>
                <button onClick={onSelectScope}
                  className="h-8 rounded-lg border border-[#2E5495] px-3 text-[12px] font-medium text-[#2E5495] hover:bg-[#F2F6FC]">
                  选择采购范围
                </button>
                <button onClick={()=>onViewEvidence(field)}
                  className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
                  查看证据
                </button>
              </>
            ) : field.status === "conflict" ? (
              <>
                <button onClick={()=>onResolveConflict(field)}
                  className="h-8 rounded-lg border border-orange-400 bg-orange-50 px-3 text-[12px] font-medium text-orange-700 hover:bg-orange-100">
                  解决冲突
                </button>
                <button onClick={()=>onViewEvidence(field)}
                  className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
                  查看证据
                </button>
              </>
            ) : field.status === "missing" ? (
              <>
                <button onClick={()=>onManualInput(field)}
                  className="h-8 rounded-lg border border-[#2E5495] px-3 text-[12px] font-medium text-[#2E5495] hover:bg-[#F2F6FC]">
                  人工补充
                </button>
                <button onClick={()=>onViewEvidence(field)}
                  className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
                  查看参考
                </button>
              </>
            ) : field.status === "reference-only" ? (
              <button onClick={()=>onViewEvidence(field)}
                className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
                查看证据
              </button>
            ) : field.status === "ai-suggested" ? (
              <>
                <button onClick={()=>onConfirm(field.id)}
                  className="h-8 rounded-lg border border-[#2E5495] bg-[#2E5495] px-3 text-[12px] font-medium text-white hover:bg-[#24457C]">
                  确认并修改
                </button>
                <button onClick={()=>onViewEvidence(field)}
                  className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
                  查看证据
                </button>
              </>
            ) : field.status === "confirmed" ? (
              <>
                <button onClick={()=>onViewEvidence(field)}
                  className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
                  查看证据
                </button>
                <button onClick={()=>onConfirm(field.id)}
                  className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
                  修改
                </button>
              </>
            ) : (
              /* pending */
              <>
                <button onClick={()=>onViewEvidence(field)}
                  className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
                  查看证据
                </button>
                <button onClick={()=>onConfirm(field.id)}
                  className="h-8 rounded-lg border border-[#2E5495] bg-[#2E5495] px-3 text-[12px] font-medium text-white hover:bg-[#24457C]">
                  确认
                </button>
              </>
            )}

            {/* More */}
            {field.status !== "reference-only" && (
              <div className="relative" ref={moreRef}>
                <button onClick={()=>setMoreOpen(o=>!o)}
                  className={`h-8 w-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-500 hover:border-[#2E5495] hover:text-[#24457C] ${moreOpen?"bg-slate-50":""}`}>
                  <Icon name="more" size={15}/>
                </button>
                {moreOpen && (
                  <div className="absolute right-0 top-9 z-10 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-[0_4px_16px_rgba(15,23,42,.12)]">
                    {field.status !== "not-applicable" && (
                      <button className="w-full px-3 py-2 text-left text-[13px] text-slate-600 hover:bg-slate-50"
                        onClick={()=>{onConfirm(field.id);setMoreOpen(false);}}>
                        标记不适用
                      </button>
                    )}
                    {field.status === "confirmed" && (
                      <button className="w-full px-3 py-2 text-left text-[13px] text-[#A8323C] hover:bg-slate-50"
                        onClick={()=>{onConfirm(field.id);setMoreOpen(false);}}>
                        撤销确认
                      </button>
                    )}
                    <button className="w-full px-3 py-2 text-left text-[13px] text-slate-600 hover:bg-slate-50"
                      onClick={()=>setMoreOpen(false)}>
                      复制字段键
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {readOnly && (
          <button onClick={()=>onViewEvidence(field)}
            className="h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495]">
            查看证据
          </button>
        )}
      </div>
    </article>
  );
}

// ─── Field List ───────────────────────────────────────────────────────────────

function FieldList({fields, readOnly, onViewEvidence, onConfirm, onResolveConflict, onManualInput, onSelectScope}:{
  fields:Field[]; readOnly:boolean;
  onViewEvidence:(f:Field)=>void; onConfirm:(id:string)=>void;
  onResolveConflict:(f:Field)=>void; onManualInput:(f:Field)=>void;
  onSelectScope:()=>void;
}) {
  if(fields.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Icon name="search" size={32}/>
          <p className="mt-3 text-sm text-slate-400">没有符合条件的字段</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {fields.map(f=>(
        <FieldRowItem key={f.id} field={f} readOnly={readOnly}
          onViewEvidence={onViewEvidence} onConfirm={onConfirm}
          onResolveConflict={onResolveConflict} onManualInput={onManualInput}
          onSelectScope={onSelectScope}/>
      ))}
    </div>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function FieldConfirmationFooter({p0Count, navigate, onSave, readOnly}:{p0Count:number;navigate:(p:Page)=>void;onSave:()=>void;readOnly:boolean}) {
  const canProceed = p0Count === 0;
  return (
    <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4 xl:px-8">
      {p0Count > 0 && !readOnly && (
        <div className="mb-3 flex items-center gap-2 text-[13px] text-[#A8323C]">
          <Icon name="alert" size={14}/>
          <span>还有 <strong>{p0Count}</strong> 个阻断字段未完成确认，无法进入模板选择。</span>
        </div>
      )}
      {canProceed && !readOnly && (
        <div className="mb-3 flex items-center gap-2 text-[13px] text-[#116B46]">
          <Icon name="check-circle" size={14}/>
          <span>招标文件关键字段已完成确认，可以进入模板选择。</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <button onClick={()=>navigate("project-detail")}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 hover:border-[#2E5495] hover:text-[#24457C]">
          <Icon name="arrow" size={14}/>返回解析结果
        </button>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">上次自动保存：10:36</span>
          {!readOnly && (
            <>
              <button onClick={onSave}
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:border-[#2E5495] hover:text-[#24457C]">
                保存草稿
              </button>
              {canProceed ? (
                <button onClick={()=>navigate("template-selection")}
                  className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]">
                  保存并进入模板选择
                </button>
              ) : (
                <div className="group relative">
                  <button disabled
                    className="h-10 cursor-not-allowed rounded-lg bg-slate-200 px-5 text-sm font-medium text-slate-400">
                    进入模板选择
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

function sortFields(fields: Field[]): Field[] {
  const order: Record<string, number> = {
    "P0-conflict":0, "P0-missing":1, "P0-ai-suggested":2, "P0-pending":3,
    "P1-conflict":4, "P1-missing":5, "P1-ai-suggested":6, "P1-pending":7,
    "P0-confirmed":8, "P1-confirmed":9, "P2-conflict":10, "P2-missing":11, "P2-pending":12, "P2-confirmed":13,
    "P1-reference-only":14, "P2-reference-only":15,
  };
  return [...fields].sort((a,b)=>{
    const ak = `${a.criticality}-${a.status}`;
    const bk = `${b.criticality}-${b.status}`;
    return (order[ak]??99) - (order[bk]??99);
  });
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function FieldConfirmationPage({navigate}:{navigate:(p:Page)=>void}) {
  const [fields, setFields] = useState<Field[]>(INITIAL_FIELDS);
  const [currentGroup, setCurrentGroup] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [criticalityFilter, setCriticalityFilter] = useState("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [evidenceField, setEvidenceField] = useState<Field|null>(null);
  const [conflictField, setConflictField] = useState<Field|null>(null);
  const [manualField, setManualField] = useState<Field|null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeChecked, setScopeChecked] = useState<string[]>([]);
  const [upstreamChanged, setUpstreamChanged] = useState(false);
  const [readOnly] = useState(false);

  const p0Blocked = useCallback(()=>{
    return fields.filter(f=>f.criticality==="P0"&&!["confirmed","not-applicable"].includes(f.status)).length;
  },[fields]);

  const confirmField = useCallback((id:string)=>{
    setFields(prev=>prev.map(f=>f.id===id
      ? {...f, status:"confirmed", confirmedBy:"王明远", confirmedAt:`2026-09-05 ${new Date().toTimeString().slice(0,5)}`}
      : f));
  },[]);

  const resolveConflict = useCallback((fieldId:string, value:string)=>{
    setFields(prev=>prev.map(f=>f.id===fieldId
      ? {...f, status:"confirmed", value, conflicts:undefined, confirmedBy:"王明远", confirmedAt:`2026-09-05 ${new Date().toTimeString().slice(0,5)}`}
      : f));
  },[]);

  const saveManualInput = useCallback((fieldId:string, value:string)=>{
    setFields(prev=>prev.map(f=>f.id===fieldId
      ? {...f, status:"confirmed", value, confirmedBy:"王明远", confirmedAt:`2026-09-05 ${new Date().toTimeString().slice(0,5)}`}
      : f));
  },[]);

  const saveScope = useCallback((items:string[])=>{
    setScopeChecked(items);
    setFields(prev=>prev.map(f=>f.id==="f8"
      ? {...f, status:"confirmed", value:`已确认 ${items.length} 项采购内容`, confirmedBy:"王明远", confirmedAt:`2026-09-05 ${new Date().toTimeString().slice(0,5)}`}
      : f));
  },[]);

  const handleFilterChange = (key:string, val:string|boolean)=>{
    if(key==="status") { setStatusFilter(val as string); setOnlyBlocked(false); }
    else if(key==="criticality") setCriticalityFilter(val as string);
    else if(key==="search") setSearchKeyword(val as string);
    else if(key==="blocked") {
      const b = val as boolean;
      setOnlyBlocked(b);
      if(b) { setStatusFilter("all"); setCriticalityFilter("P0"); }
      else setCriticalityFilter("all");
    }
  };

  // Filter fields
  let visible = fields;
  if(currentGroup !== "all") visible = visible.filter(f=>f.groupId===currentGroup);
  if(statusFilter !== "all") visible = visible.filter(f=>f.status===statusFilter);
  if(criticalityFilter !== "all") visible = visible.filter(f=>f.criticality===criticalityFilter);
  if(onlyBlocked) visible = visible.filter(f=>f.criticality==="P0"&&!["confirmed","not-applicable"].includes(f.status));
  if(searchKeyword) {
    const q = searchKeyword.toLowerCase();
    visible = visible.filter(f=>f.name.includes(q)||f.key.includes(q));
  }
  visible = sortFields(visible);

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {upstreamChanged && <UpstreamChangedBanner onDismiss={()=>setUpstreamChanged(false)}/>}
      {readOnly && <ReadOnlyBanner/>}

      <FieldConfirmationHeader fields={fields} navigate={navigate} readOnly={readOnly}/>

      <FieldFilterBar
        statusFilter={statusFilter} criticalityFilter={criticalityFilter}
        searchKeyword={searchKeyword} onlyBlocked={onlyBlocked}
        onChange={handleFilterChange}/>

      <div className="flex flex-1 min-h-0 overflow-hidden bg-[#F6F8FB]">
        <FieldGroupNavigation fields={fields} currentGroup={currentGroup} onSelect={setCurrentGroup}/>
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-white">
          <FieldList
            fields={visible} readOnly={readOnly}
            onViewEvidence={setEvidenceField}
            onConfirm={confirmField}
            onResolveConflict={setConflictField}
            onManualInput={setManualField}
            onSelectScope={()=>setScopeOpen(true)}/>
        </div>
      </div>

      <FieldConfirmationFooter
        p0Count={p0Blocked()} navigate={navigate}
        onSave={()=>{}} readOnly={readOnly}/>

      {/* Overlays */}
      {evidenceField && (
        <EvidenceDrawer field={evidenceField} readOnly={readOnly}
          onClose={()=>setEvidenceField(null)}
          onConfirm={()=>confirmField(evidenceField.id)}/>
      )}
      {conflictField && (
        <ConflictResolutionDialog field={conflictField}
          onClose={()=>setConflictField(null)}
          onSave={(val,_reason)=>resolveConflict(conflictField.id, val)}/>
      )}
      {manualField && (
        <ManualInputDialog field={manualField}
          onClose={()=>setManualField(null)}
          onSave={(val,_src)=>saveManualInput(manualField.id, val)}/>
      )}
      {scopeOpen && (
        <ScopeSelectionDialog
          initialChecked={scopeChecked}
          onClose={()=>setScopeOpen(false)}
          onSave={saveScope}/>
      )}
    </div>
  );
}

