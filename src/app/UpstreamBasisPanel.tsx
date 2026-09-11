import { Link } from "react-router-dom";
import type {
  UpstreamBasisReport,
  UpstreamQualityIssue,
  UpstreamReferenceRow,
} from "../lib/upstreamBasis";
import { Card } from "./Shell";

function cardTone(status: string) {
  if (status === "finalized" || status === "has_candidates") {
    return "border-emerald-200 bg-emerald-50/50";
  }
  if (status === "stale") return "border-amber-200 bg-amber-50/70";
  if (status === "uploaded") return "border-blue-200 bg-blue-50/40";
  return "border-slate-200 bg-slate-50";
}

function issueTone(severity: UpstreamQualityIssue["severity"]) {
  if (severity === "critical") return "border-red-200 bg-red-50 text-red-950";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-blue-200 bg-blue-50 text-blue-950";
}

function ReferenceTable({
  title,
  rows,
  onFocusTenderField,
}: {
  title: string;
  rows: UpstreamReferenceRow[];
  onFocusTenderField: (fieldKey: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
        {title}：暂无可用数据。
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800">
        {title}
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[1.1fr_1fr_1fr_auto]"
          >
            <div>
              <div className="font-medium text-slate-900">
                {row.sourceStageName} · {row.sourceLabel}
              </div>
              <div className="mt-1 text-xs text-slate-500">{row.detail}</div>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-400">上游值</div>
              <div className="mt-0.5 truncate text-slate-800">{row.valueText || "—"}</div>
              <div className="mt-1 text-xs text-slate-400">
                {row.hasEvidence ? "有证据" : "缺证据"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">对应招标字段</div>
              <div className="mt-0.5 text-slate-800">{row.tenderLabel}</div>
              <div className="mt-1 text-xs font-medium text-slate-600">{row.actionLabel}</div>
            </div>
            <div className="flex items-start">
              <button
                type="button"
                className="secondary-button !px-2.5 !py-1 text-xs"
                onClick={() => onFocusTenderField(row.tenderFieldKey)}
              >
                {row.action === "forbidden_map" ? "去手工填写" : "定位招标字段"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UpstreamBasisPanel({
  projectId,
  report,
  loading,
  onFocusTenderField,
}: {
  projectId: string;
  report: UpstreamBasisReport;
  loading?: boolean;
  onFocusTenderField: (fieldKey: string) => void;
}) {
  const directRows = report.referenceRows.filter((row) => row.group === "direct");
  const forbiddenRows = report.referenceRows.filter((row) => row.group === "forbidden");

  return (
    <Card>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="section-title">上游依据汇入</h3>
          <p className="section-description">
            招投标基础数据主要来自项目需求、建议书与可研的解析结果。以下先做分析与质量检查，再进入字段确认；禁止映射项只作参考。
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          就绪 {report.analysisSummary.readyStageCount}/{report.analysisSummary.totalStageCount} ·
          质检 {report.analysisSummary.qualityIssueCount}
        </div>
      </div>

      <div
        className={`mt-4 rounded-xl border p-4 text-sm leading-6 ${
          report.analysisSummary.criticalQualityCount > 0
            ? "border-amber-200 bg-amber-50 text-amber-950"
            : report.analysisSummary.readyStageCount > 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-slate-200 bg-slate-50 text-slate-700"
        }`}
      >
        <strong className="font-semibold">{report.analysisSummary.headline}</strong>
        <p className="mt-1">{report.analysisSummary.body}</p>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">正在加载上游依据…</p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {report.basisCards.map((card) => (
              <div
                key={card.stage}
                className={`rounded-xl border p-4 ${cardTone(card.status)}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-slate-900">{card.name}</div>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {card.statusLabel}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{card.hint}</p>
                <div className="mt-3 text-xs text-slate-500">
                  文件 {card.fileCount}（已解析 {card.parsedFileCount}） · 字段 {card.fieldCount}
                </div>
                {card.missingCriticalHint && (
                  <div className="mt-2 text-xs text-amber-800">{card.missingCriticalHint}</div>
                )}
                <Link className="secondary-button mt-3 inline-flex !px-2.5 !py-1 text-xs" to={card.href}>
                  查看依据阶段
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            <ReferenceTable
              title="可直接参考（同名字段，确认前仍是候选）"
              rows={directRows}
              onFocusTenderField={onFocusTenderField}
            />
            <ReferenceTable
              title="仅供参考 · 禁止直映"
              rows={forbiddenRows}
              onFocusTenderField={onFocusTenderField}
            />
          </div>

          <div className="mt-5">
            <h4 className="text-sm font-semibold text-slate-900">质量检查</h4>
            {report.qualityIssues.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">未发现上游依据质检问题。</p>
            ) : (
              <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {report.qualityIssues.map((issue) => (
                  <li
                    key={issue.id}
                    className={`rounded-lg border px-3 py-2 text-sm leading-5 ${issueTone(issue.severity)}`}
                  >
                    <div className="font-medium">{issue.title}</div>
                    <div className="mt-0.5 text-xs opacity-80">{issue.detail}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {issue.tenderFieldKey && (
                        <button
                          type="button"
                          className="secondary-button !px-2.5 !py-1 text-xs"
                          onClick={() => onFocusTenderField(issue.tenderFieldKey!)}
                        >
                          定位招标字段
                        </button>
                      )}
                      {issue.basisHref && (
                        <Link
                          className="secondary-button !px-2.5 !py-1 text-xs"
                          to={issue.basisHref}
                        >
                          回看依据
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <p className="mt-4 text-xs leading-5 text-slate-400">
        项目 ID {projectId} · 上游变化不会静默覆盖已确认招标字段。
      </p>
    </Card>
  );
}
