import { Link } from "react-router-dom";
import { Card, StatusBadge, statusLabel } from "./Shell";
import type { LifecycleNode } from "./projectLifecycle";
import { lifecycleProgress, resolveNodeHref } from "./projectLifecycle";

function phaseTone(phase: LifecycleNode["phase"]) {
  if (phase === "done") return "done";
  if (phase === "current") return "current";
  return "upcoming";
}

function railCaption(node: LifecycleNode) {
  if (node.role === "tender_basis") return node.statusLabel;
  if (node.phase === "done") return "已完成";
  if (node.phase === "current") return "正在推进";
  return "待进入";
}

export function ProjectStageFlow({
  projectId,
  nodes,
  adhoc,
}: {
  projectId: string;
  nodes: LifecycleNode[];
  adhoc?: boolean;
}) {
  const progress = lifecycleProgress(nodes);
  const current = nodes.find((node) => node.phase === "current");
  const basisCount = nodes.filter((node) => node.role === "tender_basis").length;
  const basisDone = nodes.filter((node) => node.role === "tender_basis" && node.phase === "done").length;

  if (!nodes.length) {
    return (
      <Card>
        <p className="text-sm text-slate-500">当前展示范围内暂无阶段，请调整上方「展示范围」。</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <section className="stage-flow-board overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="stage-flow-board-head relative overflow-hidden px-5 py-5 sm:px-6">
          <div className="stage-flow-board-sheen" aria-hidden />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-[#12345B] ring-1 ring-[#12345B]/10">
                <span className="stage-flow-live-dot" />
                依据汇入 · 逐步定稿
              </div>
              <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {current ? (
                  <>
                    当前推进至
                    <span className="text-[#155AA8]">「{current.name}」</span>
                  </>
                ) : (
                  "项目链路已走完"
                )}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                已完成 {progress.doneCount}/{progress.total} 步 · 进度 {progress.percent}%
                {basisCount > 0 ? ` · 招标依据 ${basisDone}/${basisCount} 项就绪` : ""}
                {adhoc ? " · 临时编标可直接进入招投标" : ""}
              </p>
            </div>
            <div className="w-full max-w-xs">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>链路完成度</span>
                <span className="font-semibold text-slate-800">{progress.percent}%</span>
              </div>
              <div className="stage-flow-meter">
                <div className="stage-flow-meter-fill" style={{ width: `${progress.percent}%` }}>
                  <span className="stage-flow-meter-glow" />
                </div>
              </div>
              {current && resolveNodeHref(current, projectId) && (
                <Link
                  className="primary-button mt-3 w-full"
                  to={resolveNodeHref(current, projectId)!}
                >
                  {current.actionLabel ?? `继续推进「${current.name}」`}
                </Link>
              )}
            </div>
          </div>
        </div>

        <ol className="stage-flow-rail" aria-label="项目阶段流程轴">
          {nodes.map((node, index) => {
            const tone = phaseTone(node.phase);
            const isLast = index === nodes.length - 1;
            return (
              <li
                key={node.key}
                className={`stage-flow-step is-${tone}`}
                style={{ animationDelay: `${index * 45}ms` }}
              >
                {!isLast && (
                  <span
                    className={`stage-flow-connector is-${
                      node.phase === "done" ? "done" : node.phase === "current" ? "active" : "idle"
                    }`}
                    aria-hidden
                  >
                    <span className="stage-flow-connector-run" />
                  </span>
                )}
                <span className={`stage-flow-dot is-${tone}`} aria-hidden>
                  {node.phase === "done" ? (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <div className="stage-flow-step-label">
                  <strong>{node.name}</strong>
                  <small>{railCaption(node)}</small>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <ol className="stage-flow-timeline" aria-label="阶段推进清单">
        {nodes.map((node, index) => {
          const tone = phaseTone(node.phase);
          const href = resolveNodeHref(node, projectId);
          const isLast = index === nodes.length - 1;
          return (
            <li
              key={node.key}
              className={`stage-flow-timeline-item is-${tone}`}
              style={{ animationDelay: `${120 + index * 55}ms` }}
            >
              <div className="stage-flow-timeline-rail" aria-hidden>
                <span className={`stage-flow-dot is-${tone}`}>
                  {node.phase === "done" ? "✓" : index + 1}
                </span>
                {!isLast && (
                  <span
                    className={`stage-flow-timeline-line is-${
                      node.phase === "done" ? "done" : node.phase === "current" ? "active" : "idle"
                    }`}
                  />
                )}
              </div>

              <article className={`stage-flow-panel is-${tone}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-slate-900">{node.name}</h4>
                      {node.backendStage ? (
                        <StatusBadge status={node.backendStage.status} />
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            tone === "done"
                              ? "bg-emerald-50 text-emerald-700"
                              : tone === "current"
                                ? "bg-blue-50 text-blue-700"
                                : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {railCaption(node)}
                        </span>
                      )}
                      {tone === "current" && (
                        <span className="stage-flow-now-badge">
                          <span />
                          当前步骤
                        </span>
                      )}
                      {node.role === "tender_basis" && (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-[#155AA8]">
                          上传解析
                        </span>
                      )}
                      {node.key === "tender" && (
                        <span className="rounded-full bg-[#12345B]/5 px-2.5 py-1 text-[11px] font-medium text-[#12345B]">
                          汇入上游依据
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-slate-500">{node.detail}</p>
                    {node.tenderBasisHint && (
                      <p className="mt-2 text-xs leading-5 text-[#155AA8]/90">{node.tenderBasisHint}</p>
                    )}
                    {node.key === "tender" && (
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        可引用前序已解析的项目需求、建议书、可研材料作为采购依据；本阶段才进入招标文件编制与定稿。
                      </p>
                    )}
                    {node.staleReason && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        {node.staleReason}
                      </div>
                    )}
                    {tone === "upcoming" && node.role !== "tender_basis" && (
                      <p className="mt-2 text-xs text-slate-400">
                        建议完成上游依据与前序编制后再进入，以保持定稿可追溯。
                      </p>
                    )}
                    {node.backendStage && node.backendStage.status !== "not_started" && (
                      <p className="mt-2 text-xs text-slate-400">
                        阶段状态：{statusLabel(node.backendStage.status)}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {href && node.actionLabel ? (
                      <Link
                        className={tone === "current" ? "primary-button" : "secondary-button"}
                        to={href}
                      >
                        {node.actionLabel}
                      </Link>
                    ) : (
                      <span className="secondary-button cursor-default opacity-65">
                        {tone === "upcoming" ? "尚未解锁" : "筹备中"}
                      </span>
                    )}
                    {node.backendStage?.finalized_document_version_id && (
                      <span className="secondary-button cursor-default">
                        {node.role === "tender_basis" ? "已可作定稿依据" : "已有定稿"}
                      </span>
                    )}
                  </div>
                </div>

                {tone === "current" && (
                  <div className="stage-flow-panel-progress mt-4">
                    <div className="stage-flow-panel-progress-track">
                      <span className="stage-flow-panel-progress-run" />
                    </div>
                    <span className="text-xs text-slate-500">本阶段推进中…</span>
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
