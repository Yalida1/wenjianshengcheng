import { useEffect, useMemo, useState } from "react";

export type TaskProgressStage = {
  key: string;
  label: string;
  detail?: string;
  status: "done" | "active" | "waiting" | "failed";
};

type TaskProgressPanelProps = {
  title: string;
  description: string;
  stages: TaskProgressStage[];
  status?: "active" | "success" | "failed";
  completed?: number;
  total?: number;
  progressLabel?: string;
  outcome: string;
  facts?: Array<{ label: string; value: string }>;
  compact?: boolean;
  startedAt?: string | Date | null;
  className?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function elapsedLabel(startedAt?: string | Date | null) {
  if (!startedAt) return null;
  const started = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const seconds = Math.max(0, Math.floor((Date.now() - started.getTime()) / 1_000));
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return `已用时 ${seconds} 秒`;
  return `已用时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function StageIcon({ status }: { status: TaskProgressStage["status"] }) {
  if (status === "done") {
    return (
      <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden="true">
        <path d="m5 10.2 3.1 3.1L15.4 6" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden="true">
        <path d="m6 6 8 8m0-8-8 8" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <span
      className={status === "active" ? "task-progress-dot" : "size-1.5 rounded-full bg-slate-300"}
    />
  );
}

export function TaskProgressPanel({
  title,
  description,
  stages,
  status = "active",
  completed,
  total,
  progressLabel,
  outcome,
  facts = [],
  compact = false,
  startedAt,
  className = "",
}: TaskProgressPanelProps) {
  const [clockTick, setClockTick] = useState(0);
  const isActive = status === "active";
  const exactProgress = typeof completed === "number" && typeof total === "number" && total > 0;
  const safeCompleted = exactProgress ? clamp(completed, 0, total) : 0;
  const percent = exactProgress ? Math.round((safeCompleted / total) * 100) : null;
  const activeStage = stages.find((stage) => stage.status === "active");
  const doneStages = stages.filter((stage) => stage.status === "done").length;
  const elapsed = useMemo(() => elapsedLabel(startedAt), [startedAt, clockTick]);

  useEffect(() => {
    if (!isActive || !startedAt) return;
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [isActive, startedAt]);

  const tone =
    status === "failed"
      ? "border-red-200 bg-red-50/80"
      : status === "success"
        ? "border-emerald-200 bg-emerald-50/70"
        : "border-blue-200 bg-[linear-gradient(135deg,#F7FAFF_0%,#FFFFFF_52%,#F2F7FD_100%)]";

  return (
    <section
      className={`relative overflow-hidden rounded-xl border ${tone} ${compact ? "p-3" : "p-5"} ${className}`}
      aria-live="polite"
      data-testid="task-progress-panel"
    >
      {isActive && <div className="task-progress-ambient" aria-hidden="true" />}
      <div className={`relative flex ${compact ? "gap-3" : "gap-4"}`}>
        <div
          className={`task-progress-document shrink-0 ${compact ? "size-10" : "size-14"}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 36 36" className={compact ? "size-5" : "size-7"} fill="none">
            <path
              d="M10 5.5h10l6 6V30H10z"
              fill="white"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M20 5.5v6h6M14 17h8M14 21h8M14 25h5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {isActive && <span className="task-progress-scan" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={`${compact ? "text-sm" : "text-base"} font-semibold text-slate-900`}>
                  {title}
                </h3>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    status === "failed"
                      ? "bg-red-100 text-red-700"
                      : status === "success"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {status === "failed"
                    ? "需要处理"
                    : status === "success"
                      ? "处理完成"
                      : "实时处理中"}
                </span>
              </div>
              <p
                className={`${compact ? "mt-1 text-xs" : "mt-1.5 text-sm"} leading-6 text-slate-600`}
              >
                {description}
              </p>
            </div>
            {(elapsed || exactProgress) && (
              <div className="shrink-0 text-right text-xs text-slate-500">
                {exactProgress && (
                  <div className="font-semibold text-slate-700">
                    {progressLabel ? `${progressLabel} ` : ""}
                    {safeCompleted}/{total}
                  </div>
                )}
                {elapsed && <div className="mt-1">{elapsed}</div>}
              </div>
            )}
          </div>

          <div
            className={`relative overflow-hidden rounded-full bg-slate-200/80 ${compact ? "mt-3 h-1.5" : "mt-4 h-2"}`}
            role="progressbar"
            aria-label={progressLabel ?? title}
            aria-valuemin={0}
            aria-valuemax={exactProgress ? total : stages.length}
            aria-valuenow={exactProgress ? safeCompleted : doneStages}
            aria-valuetext={
              exactProgress
                ? `${progressLabel ?? "已完成"} ${safeCompleted}/${total}`
                : (activeStage?.label ?? (status === "success" ? "全部完成" : "等待处理"))
            }
          >
            <div
              className={`h-full rounded-full transition-[width] duration-700 ${
                status === "failed" ? "bg-red-500" : "bg-[#155AA8]"
              }`}
              style={{
                width: exactProgress
                  ? `${percent}%`
                  : `${stages.length ? (doneStages / stages.length) * 100 : 0}%`,
              }}
            />
            {isActive && <span className="task-progress-runner" aria-hidden="true" />}
          </div>

          {!compact && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {stages.map((stage) => (
                <div
                  key={stage.key}
                  className={`rounded-lg border px-3 py-2.5 ${
                    stage.status === "active"
                      ? "border-blue-200 bg-white shadow-sm"
                      : stage.status === "done"
                        ? "border-emerald-100 bg-emerald-50/70"
                        : stage.status === "failed"
                          ? "border-red-200 bg-red-50"
                          : "border-slate-200/80 bg-white/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                        stage.status === "done"
                          ? "bg-emerald-600 text-white"
                          : stage.status === "active"
                            ? "bg-blue-100 text-blue-700"
                            : stage.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      <StageIcon status={stage.status} />
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        stage.status === "waiting" ? "text-slate-400" : "text-slate-700"
                      }`}
                    >
                      {stage.label}
                    </span>
                  </div>
                  {stage.detail && (
                    <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{stage.detail}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {(facts.length > 0 || outcome) && (
            <div
              className={`${compact ? "mt-2" : "mt-4"} flex flex-wrap items-center gap-x-4 gap-y-2`}
            >
              {facts.map((fact) => (
                <span key={fact.label} className="text-xs text-slate-500">
                  {fact.label}：<strong className="font-medium text-slate-700">{fact.value}</strong>
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 text-xs text-blue-800">
                <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden="true">
                  <path
                    d="M10 2.5 12 7l4.5 2-4.5 2-2 4.5L8 11 3.5 9 8 7z"
                    fill="currentColor"
                    opacity=".8"
                  />
                </svg>
                {outcome}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
