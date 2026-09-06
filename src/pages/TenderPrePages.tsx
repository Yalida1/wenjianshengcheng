import { useState, useEffect } from "react";
import { Icon } from "../components/UI";
import { useMockStore } from "../mock/store";
import type { Page } from "../types";

function TenderCrumb({ navigate, current }: { navigate: (p: Page) => void; current: string }) {
  return (
    <nav className="flex items-center gap-2 text-xs text-slate-500 mb-3">
      <button onClick={() => navigate("project-list")} className="hover:text-[#24457C]">项目空间</button>
      <span>/</span>
      <button onClick={() => navigate("project-detail")} className="hover:text-[#24457C]">某省公司中心机房节能改造项目</button>
      <span>/</span>
      <span className="text-slate-400">招标文件</span>
      <span>/</span>
      <span className="font-medium text-slate-800">{current}</span>
    </nav>
  );
}

export function TenderSourceSelectionPage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, setSourceType } = useMockStore();
  const feasFinalized = state.feasibility.status === "finalized";

  function choose(type: "platform" | "upload") {
    setSourceType("tender", type);
    if (type === "platform") {
      navigate("tender-parse-progress");
    } else {
      navigate("tender-file-upload");
    }
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <TenderCrumb navigate={navigate} current="选择输入来源" />
        <h1 className="text-xl font-semibold text-slate-800">选择招标文件生成输入来源</h1>
        <p className="mt-1 text-[13px] text-slate-500">系统将从可研报告中提取招标字段，并根据确认结果生成招标文件。</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-8 xl:px-8">
        <div className="mx-auto max-w-[720px] grid grid-cols-2 gap-5">
          <button
            onClick={() => choose("platform")}
            className={`text-left rounded-xl border-2 bg-white p-6 transition-all hover:shadow-md ${feasFinalized ? "border-[#2E5495] cursor-pointer" : "border-slate-200 opacity-60 cursor-not-allowed"}`}
            disabled={!feasFinalized}
          >
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[#F2F6FC]">
              <Icon name="check-circle" size={22} />
            </div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">使用平台已定稿可研报告</h2>
            <p className="text-[13px] text-slate-500 mb-4 leading-5">直接继承平台已定稿可研报告的字段和来源关系，自动提取招标字段。</p>
            {feasFinalized ? (
              <div className="rounded-lg border border-[#DCE7F7] bg-[#F6F8FB] p-3 text-[12px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="rounded bg-[#ECF8F2] px-1.5 py-0.5 text-[11px] font-medium text-[#116B46]">已定稿</span>
                  <span className="font-medium text-slate-700">可行性研究报告 V1.3</span>
                </div>
                <p className="text-slate-500">定稿于 2026-09-05 09:30</p>
              </div>
            ) : (
              <p className="text-[12px] text-slate-400">可研报告尚未定稿，请先完成可研阶段。</p>
            )}
          </button>

          <button
            onClick={() => choose("upload")}
            className="text-left rounded-xl border border-slate-200 bg-white p-6 cursor-pointer transition-all hover:border-[#2E5495] hover:shadow-md"
          >
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-slate-100">
              <Icon name="upload" size={22} />
            </div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">上传已有可研报告</h2>
            <p className="text-[13px] text-slate-500 mb-4 leading-5">上传外部已有的可研报告，系统将解析并提取招标所需字段。</p>
            <div className="flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
              支持 DOCX · PDF · 最大 50 MB
            </div>
          </button>
        </div>

        <div className="mx-auto mt-6 max-w-[720px] rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">招标阶段流程</p>
          <div className="flex items-center gap-2 text-[12px] text-slate-500 flex-wrap">
            {["选择来源","上传/确认文件","字段解析","字段确认","选择模板","配置生成","生成中","审校","校验","定稿"].map((s, i, arr) => (
              <span key={s} className="flex items-center gap-2">
                <span className={i === 0 ? "font-medium text-[#2E5495]" : ""}>{s}</span>
                {i < arr.length - 1 && <span className="text-slate-300">→</span>}
              </span>
            ))}
          </div>
          <button onClick={() => navigate("project-detail")} className="mt-4 text-sm text-[#2E5495] hover:underline">返回项目详情</button>
        </div>
      </div>
    </div>
  );
}

export function TenderFileUploadPage({ navigate }: { navigate: (p: Page) => void }) {
  const [files, setFiles] = useState([{ name: "可行性研究报告_V1.3_终稿.docx", size: "2.4 MB", status: "ready" }]);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <TenderCrumb navigate={navigate} current="上传可研报告" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">上传可研报告</h1>
            <p className="mt-1 text-[13px] text-slate-500">上传后系统将自动解析文档结构，提取招标所需字段。</p>
          </div>
          <button onClick={() => navigate("tender-source-selection")} className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495] shrink-0">返回</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-8 xl:px-8">
        <div className="mx-auto max-w-[680px] space-y-5">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); }}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-12 transition-all ${dragging ? "border-[#2E5495] bg-[#F2F6FC]" : "border-slate-300 bg-white"}`}
          >
            <div className="flex size-14 items-center justify-center rounded-xl bg-[#F2F6FC]">
              <Icon name="upload" size={26} />
            </div>
            <div className="text-center">
              <p className="font-medium text-slate-700">拖拽文件至此，或点击选择文件</p>
              <p className="mt-1 text-[13px] text-slate-400">支持 DOCX、PDF；单文件最大 50 MB</p>
            </div>
            <button className="h-9 rounded-lg border border-[#2E5495] px-5 text-sm font-medium text-[#2E5495] hover:bg-[#F2F6FC]">选择文件</button>
          </div>

          {files.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500 font-semibold">已选文件</div>
              {files.map(f => (
                <div key={f.name} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-[#F2F6FC] shrink-0">
                    <Icon name="file" size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-800 truncate">{f.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{f.size} · DOCX</p>
                  </div>
                  <span className="rounded-full bg-[#ECF8F2] px-2.5 py-1 text-[11px] font-medium text-[#116B46]">就绪</span>
                  <button onClick={() => setFiles([])} className="text-slate-400 hover:text-red-500">
                    <Icon name="x-circle" size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button onClick={() => navigate("tender-source-selection")} className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]">返回</button>
            <button
              onClick={() => navigate("tender-parse-progress")}
              disabled={files.length === 0}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              开始解析 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TenderParseProgressPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [step, setStep] = useState(0);

  const steps = [
    "读取可研报告文档结构",
    "识别章节与字段占位符",
    "提取项目基础信息字段",
    "提取投资与技术参数字段",
    "生成字段快照与来源关系",
  ];

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => {
      timers.push(setTimeout(() => setStep(i + 1), (i + 1) * 900));
    });
    timers.push(setTimeout(() => {
      advanceStage("tender", "parsed");
      navigate("tender-parse-summary");
    }, steps.length * 900 + 600));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <TenderCrumb navigate={navigate} current="文件解析中" />
        <h1 className="text-xl font-semibold text-slate-800">正在解析可研报告</h1>
        <p className="mt-1 text-[13px] text-slate-500">系统正在提取招标所需字段，请稍候…</p>
      </div>
      <div className="flex flex-1 min-h-0 items-center justify-center bg-[#F6F8FB]">
        <div className="w-full max-w-[480px] px-6">
          <div className="rounded-xl border border-slate-200 bg-white p-8">
            <div className="mb-6 flex items-center gap-3">
              <svg className="animate-spin text-[#2E5495]" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v9h-9"/></svg>
              <span className="font-semibold text-slate-800">解析进行中</span>
            </div>
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div key={s} className={`flex items-center gap-3 text-sm transition-all ${i < step ? "text-slate-800" : "text-slate-400"}`}>
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i < step ? "bg-[#ECF8F2] text-[#116B46]" : i === step ? "bg-[#F2F6FC] text-[#2E5495]" : "bg-slate-100 text-slate-400"}`}>
                    {i < step ? "✓" : i + 1}
                  </span>
                  {s}
                  {i === step && <svg className="animate-spin ml-auto text-[#2E5495]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v9h-9"/></svg>}
                </div>
              ))}
            </div>
            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#2E5495] transition-all duration-700" style={{ width: `${(step / steps.length) * 100}%` }} />
            </div>
            <p className="mt-3 text-center text-[12px] text-slate-400">{step}/{steps.length} 完成</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const EXTRACTED = [
  { group: "项目基础信息", fields: ["项目名称", "项目编号", "建设单位", "建设地点", "建设规模"] },
  { group: "投资与预算", fields: ["项目总投资", "建安工程费", "设备购置费", "其他费用"] },
  { group: "技术指标", fields: ["设备数量", "冷量需求", "能效比要求", "安装周期"] },
  { group: "合规与资质", fields: ["资质要求", "项目负责人要求", "售后服务要求"] },
];

export function TenderParseSummaryPage({ navigate }: { navigate: (p: Page) => void }) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <TenderCrumb navigate={navigate} current="解析摘要" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">解析完成，请确认字段摘要</h1>
            <p className="mt-1 text-[13px] text-slate-500">共提取 42 个字段，38 个自动填充，4 个需要人工确认。</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded-full bg-[#ECF8F2] px-3 py-1 text-[12px] font-medium text-[#116B46]">解析成功</span>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-6 xl:px-8">
        <div className="mx-auto max-w-[800px] space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "提取字段总数", value: "42", color: "text-slate-800" },
              { label: "自动填充", value: "38", color: "text-[#116B46]" },
              { label: "需人工确认", value: "4", color: "text-[#A86512]" },
              { label: "来源文件", value: "1", color: "text-slate-800" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="mt-1 text-[12px] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3">
              <h3 className="font-semibold text-sm text-slate-800">来源文件</h3>
            </div>
            <div className="flex items-center gap-4 px-5 py-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[#F2F6FC] shrink-0">
                <Icon name="file" size={18} />
              </div>
              <div>
                <p className="font-medium text-sm text-slate-800">可行性研究报告_V1.3_终稿.docx</p>
                <p className="text-[12px] text-slate-400">字段快照 FS-20260905-001 · 2026-09-05 14:32</p>
              </div>
            </div>
          </div>

          {EXTRACTED.map(group => (
            <div key={group.group} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3 flex items-center justify-between">
                <h3 className="font-semibold text-sm text-slate-700">{group.group}</h3>
                <span className="text-[12px] text-slate-400">{group.fields.length} 个字段</span>
              </div>
              <div className="px-5 py-3 flex flex-wrap gap-2">
                {group.fields.map(f => (
                  <span key={f} className="rounded-full bg-[#F2F6FC] px-3 py-1 text-[12px] text-[#2E5495]">{f}</span>
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-[#FFF0C0] bg-[#FFFBEB] p-4">
            <div className="flex items-start gap-3">
              <Icon name="alert" size={16} />
              <div>
                <p className="font-semibold text-[13px] text-[#8B520B]">以下 4 个字段需要人工确认</p>
                <ul className="mt-2 space-y-1 text-[12px] text-[#A86512]">
                  <li>• 招标预算金额（多处数据不一致）</li>
                  <li>• 投标截止时间（需设置）</li>
                  <li>• 评标方法（需确认）</li>
                  <li>• 质保期（需补充）</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <input type="checkbox" id="confirm-parse" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#2E5495]" />
            <label htmlFor="confirm-parse" className="text-[13px] text-slate-700 cursor-pointer">
              已了解解析结果，确认进入字段确认工作台
            </label>
          </div>

          <div className="flex justify-end gap-3 pb-6">
            <button onClick={() => navigate("tender-file-upload")} className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]">重新上传</button>
            <button
              onClick={() => navigate("field-confirmation")}
              disabled={!confirmed}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              进入字段确认 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
