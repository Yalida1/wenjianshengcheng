import { useState, useEffect, useCallback } from "react";
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
      <span className="text-slate-400">合同</span>
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

// ─── Source Selection (replaces ContractSourceSelectionPage placeholder) ───────

export function ContractSourceSelectionPageFull({ navigate }: { navigate: (p: Page) => void }) {
  const { state, setSourceType } = useMockStore();
  const tenderFinalized = state.tender.status === "finalized";

  function choose(type: "platform" | "upload") {
    setSourceType("contract", type);
    if (type === "platform") navigate("contract-parse-summary");
    else navigate("contract-file-upload");
  }

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="选择输入来源" />
          <h1 className="text-xl font-semibold text-slate-800">选择合同生成输入来源</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            系统将从招标文件中提取合同标的、范围、验收和商务条件，并补充合同签署必需信息。
          </p>
        </>
      }
    >
      <div className="mx-auto max-w-[720px] grid grid-cols-2 gap-5">
        <button
          onClick={() => choose("platform")}
          disabled={!tenderFinalized}
          className={`text-left rounded-xl border-2 bg-white p-6 transition-all ${
            tenderFinalized
              ? "border-[#2E5495] hover:shadow-md cursor-pointer"
              : "border-slate-200 opacity-60 cursor-not-allowed"
          }`}
        >
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[#F2F6FC]">
            <Icon name="check-circle" size={22} />
          </div>
          <h2 className="text-base font-semibold text-slate-800 mb-1">使用平台已定稿招标文件</h2>
          <p className="text-[13px] text-slate-500 mb-4 leading-5">
            直接使用本平台已定稿的招标文件，字段和来源关系将自动继承。
          </p>
          {tenderFinalized ? (
            <div className="rounded-lg border border-[#DCE7F7] bg-[#F6F8FB] p-3 text-[12px]">
              <div className="flex items-center gap-2 mb-1">
                <span className="rounded bg-[#ECF8F2] px-1.5 py-0.5 text-[11px] font-medium text-[#116B46]">
                  已定稿
                </span>
                <span className="font-medium text-slate-700">招标文件 V1.0</span>
              </div>
              <p className="text-slate-400">定稿于 2026-09-05</p>
            </div>
          ) : (
            <p className="text-[12px] text-slate-400">招标文件尚未定稿，请先完成招标阶段。</p>
          )}
        </button>

        <button
          onClick={() => choose("upload")}
          className="text-left rounded-xl border border-slate-200 bg-white p-6 hover:border-[#2E5495] hover:shadow-md transition-all cursor-pointer"
        >
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-slate-100">
            <Icon name="upload" size={22} />
          </div>
          <h2 className="text-base font-semibold text-slate-800 mb-1">上传已有招标文件</h2>
          <p className="text-[13px] text-slate-500 mb-4 leading-5">
            上传外部已有的招标文件，系统将解析并提取合同要素。
          </p>
          <div className="flex items-center justify-center h-16 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
            DOCX · PDF · 最大 50 MB
          </div>
        </button>
      </div>
      <div className="mx-auto mt-5 max-w-[720px]">
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

export function ContractFileUploadPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [files, setFiles] = useState<string[]>([]);

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="上传招标文件" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">上传招标文件</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                上传已有招标文件，系统将自动提取合同要素。
              </p>
            </div>
            <button
              onClick={() => navigate("contract-source")}
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
          onClick={() => setFiles(["招标文件_终稿_V1.0.docx"])}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white py-12 cursor-pointer hover:border-[#2E5495] transition-all"
        >
          <div className="flex size-14 items-center justify-center rounded-xl bg-[#F2F6FC]">
            <Icon name="upload" size={26} />
          </div>
          <p className="font-medium text-slate-700">点击选择文件或拖拽至此</p>
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
            onClick={() => navigate("contract-source")}
            className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]"
          >
            返回
          </button>
          <button
            onClick={() => {
              advanceStage("contract", "files_uploaded");
              navigate("contract-parse-summary");
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

export function ContractParseSummaryPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const steps = ["读取招标文件", "提取商务条款", "识别合同要素", "生成字段快照"];

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => timers.push(setTimeout(() => setStep(i + 1), (i + 1) * 700)));
    timers.push(
      setTimeout(
        () => {
          advanceStage("contract", "parsed");
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
            {done ? "招标文件解析完成" : "正在解析招标文件…"}
          </h1>
          {done && (
            <p className="mt-1 text-[13px] text-slate-500">
              提取合同要素完成，请确认后进入要素确认。
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
                      i < step ? "bg-[#ECF8F2] text-[#116B46]" : "bg-slate-100"
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
        <div className="mx-auto max-w-[720px] space-y-5">
          <div className="grid grid-cols-3 gap-4">
            {[
              { l: "提取要素数", v: "14", c: "text-slate-800" },
              { l: "自动提取", v: "11", c: "text-[#116B46]" },
              { l: "需人工填写", v: "3", c: "text-[#A86512]" },
            ].map((s) => (
              <div
                key={s.l}
                className="rounded-xl border border-slate-200 bg-white p-4 text-center"
              >
                <p className={`text-2xl font-bold ${s.c}`}>{s.v}</p>
                <p className="mt-1 text-[12px] text-slate-500">{s.l}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-sm text-slate-800 mb-3">提取要素预览</h3>
            <div className="flex flex-wrap gap-2">
              {[
                "合同标的",
                "建设单位（甲方）",
                "采购范围",
                "交货地点",
                "交货期",
                "验收标准",
                "质保期",
                "违约条款",
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
          <div className="rounded-xl border border-[#FFF0C0] bg-[#FFFBEB] p-4">
            <p className="font-semibold text-[13px] text-[#8B520B] mb-2">以下 3 项需要人工填写</p>
            <ul className="space-y-1 text-[12px] text-[#A86512]">
              <li>• 乙方（承包商）信息</li>
              <li>• 最终合同金额</li>
              <li>• 付款计划</li>
            </ul>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => navigate("contract-field-confirmation")}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
            >
              进入字段确认 →
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ─── Field Confirmation ────────────────────────────────────────────────────────

const CONTRACT_BASIC_FIELDS = [
  {
    id: "cf1",
    label: "合同标的",
    value: "数据中心精密空调节能改造",
    src: "招标文件",
    ok: true,
  },
  {
    id: "cf2",
    label: "建设单位（甲方）",
    value: "某省通信有限公司",
    src: "系统",
    ok: true,
  },
  {
    id: "cf3",
    label: "采购范围",
    value: "提供并安装精密空调系统及配套辅材",
    src: "招标文件",
    ok: true,
  },
  {
    id: "cf4",
    label: "交货地点",
    value: "某省公司中心机房",
    src: "招标文件",
    ok: true,
  },
  { id: "cf5", label: "交货期（日）", value: "90", src: "招标文件", ok: true },
  {
    id: "cf6",
    label: "验收标准",
    value: "按技术规格书验收",
    src: "招标文件",
    ok: false,
  },
  { id: "cf7", label: "质保期（年）", value: "3", src: "招标文件", ok: true },
  {
    id: "cf8",
    label: "违约条款",
    value: "按合同金额的 0.5%/天计算违约金",
    src: "招标文件",
    ok: false,
  },
];

export function ContractFieldConfirmationPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [fields, setFields] = useState(CONTRACT_BASIC_FIELDS);
  const pending = fields.filter((f) => !f.ok).length;

  function confirm(id: string) {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ok: true } : f)));
  }

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="基础字段确认" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">合同基础字段确认</h1>
              <p className="mt-1 text-[13px] text-slate-500">
                {pending > 0 ? `${pending} 个字段待确认` : "所有字段已确认，可进入合同要素确认"}
              </p>
            </div>
            <button
              onClick={() => {
                advanceStage("contract", "fields_confirmed");
                navigate("contract-element-confirmation");
              }}
              disabled={pending > 0}
              className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              进入要素确认 →
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[860px]">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-[1.2fr_1.5fr_120px_90px] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs text-slate-500">
            <span>字段名称</span>
            <span>提取值</span>
            <span>来源</span>
            <span>状态</span>
          </div>
          {fields.map((f) => (
            <div
              key={f.id}
              className="grid grid-cols-[1.2fr_1.5fr_120px_90px] items-center gap-4 border-t border-slate-100 px-5 py-4 text-[13px]"
            >
              <span className="font-medium text-slate-800">{f.label}</span>
              <span className="text-slate-700">{f.value}</span>
              <span className="text-slate-400 text-[12px]">{f.src}</span>
              {f.ok ? (
                <span className="text-[12px] text-[#116B46] font-medium">已确认</span>
              ) : (
                <button
                  onClick={() => confirm(f.id)}
                  className="h-7 rounded-lg bg-[#FFF7E6] border border-[#F0C070] px-2 text-[11px] font-medium text-[#8B520B] hover:bg-[#F0C070]"
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

// ─── Element Confirmation (Full Form) ─────────────────────────────────────────

interface PaymentRow {
  id: string;
  node: string;
  pct: number;
  amount: number;
  trigger: string;
}

const DEFAULT_PAYMENT_ROWS: PaymentRow[] = [
  {
    id: "p1",
    node: "合同签署后",
    pct: 30,
    amount: 0,
    trigger: "双方签署后 5 个工作日内",
  },
  {
    id: "p2",
    node: "设备到货验收",
    pct: 60,
    amount: 0,
    trigger: "设备到货验收合格后 10 个工作日内",
  },
  {
    id: "p3",
    node: "项目竣工验收",
    pct: 10,
    amount: 0,
    trigger: "竣工验收合格后 30 个工作日内",
  },
];

export function ContractElementConfirmationPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [partyA] = useState("某省通信有限公司");
  const [partyB, setPartyB] = useState("");
  const [subject] = useState("数据中心精密空调节能改造");
  const [scope, setScope] = useState(
    "提供并安装精密空调系统（8 套，额定冷量 50 kW/套）及配套 EC 风机、群控系统和封闭冷通道材料",
  );
  const [finalAmount, setFinalAmount] = useState(0);
  const [finalAmountStr, setFinalAmountStr] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [taxInclusive, setTaxInclusive] = useState(true);
  const [period, setPeriod] = useState("90");
  const [delivery, setDelivery] = useState("某省公司中心机房");
  const [acceptance, setAcceptance] = useState(
    "按技术规格书验收，安装调试完成后进行功能性验收测试",
  );
  const [warranty, setWarranty] = useState("3");
  const [penalty, setPenalty] = useState(
    "逾期每日按合同金额的 0.5‰ 计算违约金，累计不超过合同金额的 10%",
  );
  const [effective, setEffective] = useState("双方授权代表签字并盖章后生效");
  const [rows, setRows] = useState<PaymentRow[]>(DEFAULT_PAYMENT_ROWS);
  const [saveToast, setSaveToast] = useState(false);

  const totalPct = rows.reduce((s, r) => s + (Number(r.pct) || 0), 0);
  const totalAmt = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const amtMatch = finalAmount > 0 && Math.abs(totalAmt - finalAmount) < 1;
  const pctMatch = totalPct === 100;

  function applyAmount(raw: string) {
    const n = parseFloat(raw.replace(/,/g, ""));
    if (!isNaN(n) && n > 0) {
      setFinalAmount(n);
      setRows((rs) => rs.map((r) => ({ ...r, amount: Math.round((n * r.pct) / 100) })));
    } else {
      setFinalAmount(0);
    }
  }

  function updateRow(id: string, key: keyof PaymentRow, val: string | number) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: val } : r)));
  }

  function updateRowPct(id: string, val: string) {
    const n = Number(val) || 0;
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        return {
          ...r,
          pct: n,
          amount: finalAmount > 0 ? Math.round((finalAmount * n) / 100) : r.amount,
        };
      }),
    );
  }

  function addRow() {
    setRows((rs) => [...rs, { id: `p${Date.now()}`, node: "", pct: 0, amount: 0, trigger: "" }]);
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  const canSignReady =
    partyB.trim() !== "" &&
    finalAmount > 0 &&
    taxRate !== "" &&
    rows.length > 0 &&
    amtMatch &&
    pctMatch;
  const contractGrade = canSignReady ? "签约准备" : "预草案";
  const canProceed =
    partyB.trim() !== "" && finalAmount > 0 && taxRate !== "" && amtMatch && pctMatch;

  function handleSave() {
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 bg-white px-6 py-4 xl:px-8 shrink-0">
        <Crumb navigate={navigate} current="合同要素确认" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">合同要素确认</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              确认甲乙双方信息、合同条件及付款计划，付款合计须与合同金额一致方可生成合同。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSave}
              className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]"
            >
              保存草稿
            </button>
            <button
              onClick={() => {
                advanceStage("contract", "template_selected");
                navigate("contract-generation-setup");
              }}
              disabled={!canProceed}
              className="h-9 rounded-lg bg-[#2E5495] px-4 text-sm font-medium text-white hover:bg-[#24457C] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              进入合同生成 →
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F6F8FB] px-6 py-6 xl:px-8">
        <div className="mx-auto max-w-[1200px] grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
          {/* Main form */}
          <div className="space-y-5">
            {/* Parties */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-[#F2F6FC] text-[12px] font-bold text-[#2E5495]">
                  1
                </span>
                甲乙双方信息
              </h3>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-2">
                    甲方（采购方）
                  </label>
                  <input
                    value={partyA}
                    readOnly
                    className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 cursor-not-allowed"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">来源：项目资料（只读）</p>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-2">
                    乙方（供应商）<span className="text-[#C2414B]">*</span>
                  </label>
                  <input
                    value={partyB}
                    onChange={(e) => setPartyB(e.target.value)}
                    placeholder="输入供应商全称（以营业执照为准）"
                    className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#2E5495]/20"
                  />
                  {!partyB && (
                    <p className="mt-1 text-[11px] text-[#A8323C]">必填：需在此阶段确认乙方</p>
                  )}
                </div>
              </div>
            </div>

            {/* Contract subject and scope */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-[#F2F6FC] text-[12px] font-bold text-[#2E5495]">
                  2
                </span>
                合同标的与范围
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-2">
                    合同标的
                  </label>
                  <input
                    value={subject}
                    readOnly
                    className="w-full h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 cursor-not-allowed"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">来源：招标文件（只读）</p>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-2">
                    本合同范围
                  </label>
                  <textarea
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#2E5495]/20"
                  />
                </div>
              </div>
            </div>

            {/* Financial terms */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-[#F2F6FC] text-[12px] font-bold text-[#2E5495]">
                  3
                </span>
                合同金额与税务
              </h3>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-2">
                    最终合同金额（元）<span className="text-[#C2414B]">*</span>
                  </label>
                  <input
                    value={finalAmountStr}
                    onChange={(e) => setFinalAmountStr(e.target.value)}
                    onBlur={(e) => applyAmount(e.target.value)}
                    placeholder="输入最终合同金额，必须独立确认"
                    className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#2E5495]/20"
                  />
                  <p className="mt-1 text-[11px] text-[#A86512]">
                    此字段必须独立确认，不得直接引用招标预算或最高限价
                  </p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[13px] font-medium text-slate-700 mb-2">
                      税率<span className="text-[#C2414B]">*</span>
                    </label>
                    <select
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#2E5495] focus:outline-none"
                    >
                      <option value="">请选择</option>
                      <option value="13">13%（增值税一般税率）</option>
                      <option value="9">9%（建筑安装服务）</option>
                      <option value="6">6%（服务类）</option>
                      <option value="0">0%（免税）</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-[13px] font-medium text-slate-700">含税价格</label>
                    <button
                      onClick={() => setTaxInclusive(!taxInclusive)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                        taxInclusive ? "bg-[#2E5495]" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          taxInclusive ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                    <span className="text-[12px] text-slate-500">
                      {taxInclusive ? "含税" : "不含税"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Delivery and terms */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-[#F2F6FC] text-[12px] font-bold text-[#2E5495]">
                  4
                </span>
                履行期限与交付
              </h3>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-2">
                    履行期限（天）
                  </label>
                  <input
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#2E5495]/20"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-2">
                    交付地点
                  </label>
                  <input
                    value={delivery}
                    onChange={(e) => setDelivery(e.target.value)}
                    className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#2E5495]/20"
                  />
                </div>
              </div>
            </div>

            {/* Payment schedule */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-[#F2F6FC] text-[12px] font-bold text-[#2E5495]">
                    5
                  </span>
                  付款计划
                </h3>
                <button
                  onClick={addRow}
                  className="flex items-center gap-1 h-8 rounded-lg border border-slate-300 px-3 text-[12px] text-slate-600 hover:border-[#2E5495]"
                >
                  <Icon name="plus" size={14} />
                  增加节点
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-xs text-slate-500">
                      <th className="px-4 py-3 text-left font-medium">付款节点</th>
                      <th className="px-4 py-3 text-right font-medium w-28">比例 (%)</th>
                      <th className="px-4 py-3 text-right font-medium w-36">金额 (元)</th>
                      <th className="px-4 py-3 text-left font-medium">触发条件</th>
                      <th className="px-4 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100 last:border-0 ${
                          i % 2 === 0 ? "" : "bg-slate-50/40"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <input
                            value={row.node}
                            onChange={(e) => updateRow(row.id, "node", e.target.value)}
                            placeholder="节点名称"
                            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-slate-700 hover:border-slate-300 focus:border-[#2E5495] focus:outline-none focus:bg-white"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              value={row.pct}
                              onChange={(e) => updateRowPct(row.id, e.target.value)}
                              type="number"
                              min={0}
                              max={100}
                              className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-slate-700 hover:border-slate-300 focus:border-[#2E5495] focus:outline-none focus:bg-white"
                            />
                            <span className="text-slate-400">%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                          {row.amount > 0 ? row.amount.toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            value={row.trigger}
                            onChange={(e) => updateRow(row.id, "trigger", e.target.value)}
                            placeholder="触发条件"
                            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-slate-600 hover:border-slate-300 focus:border-[#2E5495] focus:outline-none focus:bg-white text-[12px]"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => removeRow(row.id)}
                            className="text-slate-300 hover:text-red-500"
                          >
                            <Icon name="x-circle" size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-4 py-3 text-slate-700">合计</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`${pctMatch ? "text-[#116B46]" : "text-[#A8323C]"}`}>
                          {totalPct}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <span
                          className={`${
                            amtMatch
                              ? "text-[#116B46]"
                              : finalAmount > 0
                                ? "text-[#A8323C]"
                                : "text-slate-400"
                          }`}
                        >
                          {totalAmt > 0 ? totalAmt.toLocaleString() : "—"}
                        </span>
                      </td>
                      <td colSpan={2} className="px-4 py-3">
                        {!pctMatch && (
                          <span className="text-[12px] text-[#A8323C]">
                            比例合计应为 100%，当前 {totalPct}%
                          </span>
                        )}
                        {pctMatch && finalAmount > 0 && !amtMatch && (
                          <span className="text-[12px] text-[#A8323C]">
                            金额合计 {totalAmt.toLocaleString()} ≠ 合同金额{" "}
                            {finalAmount.toLocaleString()}
                          </span>
                        )}
                        {amtMatch && pctMatch && (
                          <span className="text-[12px] text-[#116B46]">
                            ✓ 付款合计与合同金额一致
                          </span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Acceptance, Warranty, Penalty, Effective */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-[#F2F6FC] text-[12px] font-bold text-[#2E5495]">
                  6
                </span>
                验收、质保与违约
              </h3>
              {[
                {
                  label: "验收标准",
                  val: acceptance,
                  set: setAcceptance,
                  ph: "描述验收方式、标准和验收流程…",
                },
                {
                  label: "质保期（年）",
                  val: warranty,
                  set: setWarranty,
                  ph: "例如：3",
                },
                {
                  label: "违约条款",
                  val: penalty,
                  set: setPenalty,
                  ph: "描述违约金计算方式和上限…",
                },
                {
                  label: "生效条件",
                  val: effective,
                  set: setEffective,
                  ph: "描述合同生效所需条件…",
                },
              ].map((f) => (
                <div key={f.label}>
                  <label className="block text-[13px] font-medium text-slate-700 mb-2">
                    {f.label}
                  </label>
                  <textarea
                    value={f.val}
                    onChange={(e) => f.set(e.target.value)}
                    placeholder={f.ph}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-slate-300 p-3 text-sm focus:border-[#2E5495] focus:outline-none focus:ring-2 focus:ring-[#2E5495]/20"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Right column: references + grade */}
          <div className="space-y-4">
            {/* Reference values (read-only) */}
            <div className="rounded-xl border border-[#DCE7F7] bg-[#F2F6FC] p-5">
              <p className="text-[12px] font-semibold text-[#2E5495] uppercase tracking-wide mb-3">
                参考金额（只读）
              </p>
              <p className="text-[11px] text-[#24457C]/60 mb-3 leading-4">
                以下金额仅供参考，最终合同金额须由人工独立确认，不得自动沿用。
              </p>
              {[
                { label: "可研总投资", value: "¥12,800,000" },
                { label: "招标预算", value: "¥9,800,000" },
                { label: "招标最高限价", value: "¥9,500,000" },
              ].map((r) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between py-2 border-b border-[#DCE7F7] last:border-0"
                >
                  <span className="text-[12px] text-[#24457C]/70">{r.label}</span>
                  <span className="font-mono text-[13px] font-semibold text-[#24457C]">
                    {r.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Contract grade */}
            <div
              className={`rounded-xl border p-5 ${
                contractGrade === "签约准备"
                  ? "border-[#C3E8D5] bg-[#ECF8F2]"
                  : "border-slate-200 bg-white"
              }`}
            >
              <p className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
                合同等级
              </p>
              <div className="flex items-center gap-3 mb-3">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    contractGrade === "签约准备"
                      ? "bg-[#116B46] text-white"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {contractGrade}
                </span>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "乙方信息", ok: partyB.trim() !== "" },
                  { label: "最终合同金额", ok: finalAmount > 0 },
                  { label: "税率", ok: taxRate !== "" },
                  { label: "付款安排完整", ok: amtMatch && pctMatch },
                ].map((c) => (
                  <div key={c.label} className="flex items-center gap-2 text-[12px]">
                    <span className={c.ok ? "text-[#116B46]" : "text-slate-400"}>
                      <Icon name={c.ok ? "check-circle" : "circle"} size={13} />
                    </span>
                    <span className={c.ok ? "text-slate-700" : "text-slate-400"}>{c.label}</span>
                  </div>
                ))}
              </div>
              {contractGrade === "预草案" && (
                <p className="mt-3 text-[11px] text-slate-400 leading-4">
                  缺少以上任一项时，合同仅能生成为预草案。
                </p>
              )}
            </div>

            {/* Validation summary */}
            {!canProceed && (
              <div className="rounded-xl border border-[#FECDD0] bg-[#FEF1F2] p-4">
                <p className="text-[12px] font-semibold text-[#A8323C] mb-2">无法进入合同生成</p>
                <ul className="space-y-1 text-[11px] text-[#A8323C]">
                  {!partyB.trim() && <li>• 未填写乙方信息</li>}
                  {finalAmount <= 0 && <li>• 未填写最终合同金额</li>}
                  {!taxRate && <li>• 未选择税率</li>}
                  {!pctMatch && <li>• 付款比例合计须为 100%</li>}
                  {finalAmount > 0 && !amtMatch && <li>• 付款金额合计须与合同金额一致</li>}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
      {saveToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-[#C3E8D5] bg-[#ECF8F2] px-4 py-3 shadow-lg text-[13px] text-[#116B46]">
          <Icon name="check-circle" size={15} />
          草稿已保存
        </div>
      )}
    </div>
  );
}

// ─── Template Selection ────────────────────────────────────────────────────────

const CONTRACT_TEMPLATES = [
  {
    id: "ct1",
    name: "货物采购及安装合同范本",
    type: "货物类",
    version: "V2.0",
    match: "推荐",
    updated: "2026-09-01",
  },
  {
    id: "ct2",
    name: "设备采购合同通用范本",
    type: "设备类",
    version: "V1.5",
    match: "适用",
    updated: "2026-08-01",
  },
  {
    id: "ct3",
    name: "工程建设合同范本",
    type: "工程建设",
    version: "V3.1",
    match: "不适用",
    updated: "2026-07-01",
  },
];

export function ContractTemplateSelectionPage({ navigate }: { navigate: (p: Page) => void }) {
  const { setTemplate } = useMockStore();
  const [selected, setSelected] = useState("");

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="选择合同模板" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">选择合同模板</h1>
              <p className="mt-1 text-[13px] text-slate-500">请选择本次合同使用的正式模板。</p>
            </div>
            <button
              onClick={() => {
                const t = CONTRACT_TEMPLATES.find((t) => t.id === selected);
                if (t) {
                  setTemplate("contract", t.id, t.name);
                  navigate("contract-generation-setup");
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
        {CONTRACT_TEMPLATES.map((t) => (
          <label
            key={t.id}
            className={`flex items-center gap-5 rounded-xl border-2 bg-white p-5 cursor-pointer transition-all ${
              selected === t.id
                ? "border-[#2E5495]"
                : t.match === "不适用"
                  ? "border-slate-200 opacity-60"
                  : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input
              type="radio"
              name="ctmpl"
              value={t.id}
              checked={selected === t.id}
              onChange={() => t.match !== "不适用" && setSelected(t.id)}
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
                {t.match === "不适用" && (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    不适用
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-slate-500">
                适用：{t.type} · {t.version} · {t.updated}
              </p>
            </div>
          </label>
        ))}
      </div>
    </Shell>
  );
}

// ─── Generation Setup ──────────────────────────────────────────────────────────

export function ContractGenerationSetupPage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, setGenerating } = useMockStore();
  const tplName = state.contract.selectedTemplateName || "货物采购及安装合同范本";

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="配置生成" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">配置合同生成</h1>
              <p className="mt-1 text-[13px] text-slate-500">模板：{tplName}</p>
            </div>
            <button
              onClick={() => {
                setGenerating("contract");
                navigate("contract-generation-progress");
              }}
              className="h-9 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C] shrink-0"
            >
              开始生成 →
            </button>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[640px]">
        <div className="rounded-xl border border-[#DCE7F7] bg-[#F2F6FC] p-5 text-[13px] text-[#24457C]">
          <p className="font-medium mb-2">生成前确认</p>
          <ul className="space-y-1.5 text-[12px]">
            {[
              "合同要素全部已确认",
              "付款计划完整且金额一致",
              "合同等级：签约准备",
              `模板：${tplName}`,
            ].map((c) => (
              <li key={c} className="flex items-center gap-2">
                <span className="text-[#116B46]">✓</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Shell>
  );
}

// ─── Generation Progress ───────────────────────────────────────────────────────

export function ContractGenerationProgressPage({ navigate }: { navigate: (p: Page) => void }) {
  const { advanceStage } = useMockStore();
  const [step, setStep] = useState(0);
  const steps = ["加载合同要素", "套入模板结构", "生成商务条款", "生成附件清单", "生成文档包"];

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => timers.push(setTimeout(() => setStep(i + 1), (i + 1) * 900)));
    timers.push(
      setTimeout(
        () => {
          advanceStage("contract", "generated");
          navigate("contract-document-workspace");
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
          <h1 className="text-xl font-semibold text-slate-800">合同文档生成中</h1>
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

const CONTRACT_SECTIONS = [
  {
    id: "c1",
    title: "第一条　合同标的",
    content:
      "甲方向乙方采购数据中心精密空调节能改造项目所需的精密空调系统及相关服务，包括设备供货、安装调试、人员培训及保修服务。",
  },
  {
    id: "c2",
    title: "第二条　合同范围",
    content:
      "乙方提供并安装精密空调系统 8 套（额定冷量 50 kW/套），配套 EC 变频风机、智能群控系统以及封闭冷通道所需辅助材料，工程地点为某省公司中心机房。",
  },
  {
    id: "c3",
    title: "第三条　合同价款",
    content:
      "合同总价款为人民币 [最终合同金额] 元（大写：[大写金额]），含增值税率 [税率]。价格为固定总价，合同执行期间不作调整。",
  },
  {
    id: "c4",
    title: "第四条　付款方式",
    content:
      "合同签署后 5 个工作日内支付合同总额的 30%，设备到货验收合格后 10 个工作日内支付 60%，竣工验收合格后 30 个工作日内支付剩余 10%。",
  },
  {
    id: "c5",
    title: "第五条　履行期限",
    content: "自合同签署之日起 90 日内完成设备到货、安装调试及验收，并提交竣工验收申请。",
  },
];

export function ContractDocumentWorkspacePage({ navigate }: { navigate: (p: Page) => void }) {
  const { state, finalizeStage } = useMockStore();
  const [active, setActive] = useState("c1");
  const [showDialog, setShowDialog] = useState(false);
  const [finalized, setFinalized] = useState(state.contract.status === "finalized");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");

  function doFinalize() {
    finalizeStage("contract", "合同草案 V1.0");
    setFinalized(true);
    setShowDialog(false);
  }

  if (finalized) {
    return (
      <Shell
        header={
          <>
            <Crumb navigate={navigate} current="已定稿" />
            <h1 className="text-xl font-semibold text-slate-800">合同文档已定稿</h1>
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
                <p className="font-semibold text-[#116B46] text-lg">合同草案 V1.0 已定稿</p>
                <p className="text-[12px] text-[#116B46]/70 mt-0.5">合同等级：签约准备</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => navigate("contract-export")}
              className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]"
            >
              导出合同
            </button>
            <button
              onClick={() => navigate("contract-finalized")}
              className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
            >
              查看定稿详情 →
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
              onClick={() => navigate("contract-validation")}
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
        <h1 className="text-base font-semibold text-slate-800 mt-1">合同草案 V0.1 审校</h1>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-52 shrink-0 border-r border-slate-200 bg-white overflow-y-auto p-3">
          <p className="px-3 pb-2 text-[11px] font-semibold text-slate-500 uppercase">条款目录</p>
          {CONTRACT_SECTIONS.map((s) => (
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
            {CONTRACT_SECTIONS.map((s) => (
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
            <h2 className="text-lg font-semibold text-slate-800">确认定稿合同</h2>
            <p className="mt-2 text-[13px] text-slate-500">
              合同将以 V1.0 定稿，等级为"签约准备"，所有合同要素将被锁定。
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

export function ContractValidationPage({ navigate }: { navigate: (p: Page) => void }) {
  const checks = [
    {
      id: "g1",
      name: "要素完整性",
      items: [
        { label: "甲乙双方信息已确认", ok: true },
        { label: "合同金额已确认", ok: true },
        { label: "付款计划完整", ok: true },
      ],
    },
    {
      id: "g2",
      name: "金额一致性",
      items: [
        { label: "付款合计与合同金额一致", ok: true },
        { label: "付款比例合计为 100%", ok: true },
      ],
    },
    {
      id: "g3",
      name: "期限合理性",
      items: [
        { label: "交货期未超过合同履行期", ok: true },
        { label: "日期先后顺序合理", ok: true },
      ],
    },
    {
      id: "g4",
      name: "条款完整性",
      items: [
        { label: "验收标准已确认", ok: true },
        { label: "质保条款已确认", ok: true },
        { label: "违约条款已确认", ok: true },
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
              <h1 className="text-xl font-semibold text-slate-800">合同校验报告</h1>
              <p className="mt-1 text-[13px] text-slate-500">V0.1 · 2026-09-05</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => navigate("contract-document-workspace")}
                className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495]"
              >
                返回文档
              </button>
              <button
                onClick={() => navigate("contract-document-workspace")}
                className="h-9 rounded-lg bg-[#116B46] px-4 text-sm font-medium text-white hover:bg-[#0E5838]"
              >
                进入定稿 →
              </button>
            </div>
          </div>
        </>
      }
    >
      <div className="mx-auto max-w-[760px] space-y-4">
        <div className="rounded-xl border border-[#C3E8D5] bg-[#ECF8F2] p-5">
          <p className="font-semibold text-[#116B46] text-base">校验通过</p>
          <p className="mt-1 text-[13px] text-[#116B46]/80">
            所有 P0 检查项通过，合同要素完整，可进行定稿。
          </p>
        </div>
        {checks.map((g) => (
          <div key={g.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5">
              <span className="text-[#116B46]">
                <Icon name="check-circle" size={15} />
              </span>
              <span className="text-sm font-semibold text-slate-800">{g.name}</span>
            </div>
            <div className="border-t border-slate-100">
              {g.items.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0 text-[13px]"
                >
                  <span className="text-[#116B46]">
                    <Icon name="check-circle" size={14} />
                  </span>
                  <span className="text-slate-700">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ─── Finalized ─────────────────────────────────────────────────────────────────

export function ContractFinalizedPage({ navigate }: { navigate: (p: Page) => void }) {
  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="已定稿" />
          <h1 className="text-xl font-semibold text-slate-800">合同已定稿</h1>
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
              <p className="font-semibold text-[#116B46] text-lg">合同草案 V1.0 已定稿</p>
              <p className="text-[12px] text-[#116B46]/70 mt-0.5">
                合同等级：签约准备 · 2026-09-05
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            {[
              ["甲方", "某省通信有限公司"],
              ["合同等级", "签约准备"],
              ["模板", "货物采购及安装合同范本 V2.0"],
              ["付款节点", "3 个"],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-[#116B46]/60">{k}</p>
                <p className="font-medium text-[#116B46] mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => navigate("contract-export")}
            className="h-10 rounded-lg border border-slate-300 px-5 text-sm text-slate-600 hover:border-[#2E5495]"
          >
            导出合同
          </button>
          <button
            onClick={() => navigate("project-detail")}
            className="h-10 rounded-lg bg-[#2E5495] px-5 text-sm font-medium text-white hover:bg-[#24457C]"
          >
            返回项目详情
          </button>
        </div>
      </div>
    </Shell>
  );
}

// ─── Export ────────────────────────────────────────────────────────────────────

export function ContractExportPage({ navigate }: { navigate: (p: Page) => void }) {
  const [exporting, setExporting] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function handleExport(format: string) {
    setExporting(format);
    setDone(null);
    setTimeout(() => {
      setExporting(null);
      setDone(format);
    }, 1800);
  }

  return (
    <Shell
      header={
        <>
          <Crumb navigate={navigate} current="导出合同" />
          <h1 className="text-xl font-semibold text-slate-800">导出合同文档</h1>
        </>
      }
    >
      <div className="mx-auto max-w-[600px] space-y-4">
        {[
          { fmt: "DOCX", desc: "可编辑的 Word 文档，适合进一步修订和签署。" },
          { fmt: "PDF", desc: "不可编辑的 PDF，适合正式存档和提交。" },
        ].map((opt) => (
          <div
            key={opt.fmt}
            className="rounded-xl border border-slate-200 bg-white p-5 flex items-center justify-between gap-4"
          >
            <div>
              <p className="font-semibold text-slate-800">{opt.fmt} 格式</p>
              <p className="text-[13px] text-slate-500 mt-0.5">{opt.desc}</p>
            </div>
            <button
              onClick={() => handleExport(opt.fmt)}
              disabled={exporting === opt.fmt}
              className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-600 hover:border-[#2E5495] disabled:opacity-60 shrink-0 min-w-[100px]"
            >
              {exporting === opt.fmt
                ? "导出中…"
                : done === opt.fmt
                  ? "✓ 已导出"
                  : `导出 ${opt.fmt}`}
            </button>
          </div>
        ))}
        <div className="flex justify-between pt-2">
          <button
            onClick={() => navigate("contract-finalized")}
            className="text-sm text-[#2E5495] hover:underline"
          >
            ← 返回定稿详情
          </button>
          <button
            onClick={() => navigate("project-detail")}
            className="text-sm text-[#2E5495] hover:underline"
          >
            返回项目详情 →
          </button>
        </div>
      </div>
    </Shell>
  );
}
