import type { PropsWithChildren } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./Auth";

const navItems = [
  ["/projects", "项目空间"],
  ["/templates", "模板中心"],
  ["/field-dictionary", "字段字典"],
  ["/admin/users", "系统管理"],
] as const;

export function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const title = location.pathname.startsWith("/projects")
    ? "项目空间"
    : location.pathname.startsWith("/templates")
      ? "模板中心"
      : location.pathname.startsWith("/field-dictionary")
        ? "字段字典"
        : "系统管理";
  return (
    <div className="flex min-h-screen bg-[#F6F8FB] text-slate-700">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-[#12345B] text-white lg:flex">
        <div className="border-b border-white/10 px-6 py-6">
          <div className="text-lg font-semibold">项目文件链</div>
          <div className="mt-1 text-xs text-blue-200">受控生成与定稿平台</div>
        </div>
        <nav className="flex-1 space-y-1 p-4" aria-label="主导航">
          {navItems.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block rounded-lg px-4 py-3 text-sm ${
                  isActive ? "bg-white text-[#12345B]" : "text-blue-100 hover:bg-white/10"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4 text-sm">
          <div className="truncate font-medium">{user?.display_name}</div>
          <div className="truncate text-xs text-blue-200">{user?.email}</div>
          <button
            className="mt-3 text-xs text-blue-100 underline underline-offset-4"
            onClick={logout}
          >
            退出登录
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1 lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-8">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          <div className="text-sm text-slate-500">{user?.display_name}</div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

const STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  archived: "已归档",
  not_started: "未开始",
  source_ready: "来源已确认",
  source_selected: "来源已选择",
  uploaded: "已上传",
  parsing: "解析中",
  parsed: "解析完成",
  parse_failed: "解析失败",
  needs_ocr: "需要文字识别",
  template_extract_queued: "模板提取排队中",
  template_review: "待人工确认",
  template_candidate_confirmed: "模板已确认",
  template_extract_failed: "模板提取失败",
  review_required: "待人工确认",
  confirmed: "已确认",
  fields_confirmed: "字段已确认",
  template_selected: "模板已选择",
  queued: "排队中",
  pending: "待处理",
  running: "处理中",
  retrying: "重试中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  generated: "生成完成",
  draft: "草稿",
  reviewing: "审阅中",
  ready_to_finalize: "可定稿",
  finalized: "已定稿",
  superseded: "已被新版本替代",
  published: "已发布",
  passed: "校验通过",
  open: "待处理",
  resolved: "已解决",
  stale: "上游已变化",
  loading: "加载中",
  empty: "暂无数据",
  forbidden: "无权限",
  revision_conflict: "并发冲突",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "finalized" ||
    status === "succeeded" ||
    status === "passed" ||
    status === "published"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed" || status === "stale"
        ? "bg-red-50 text-red-700"
        : "bg-blue-50 text-blue-700";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}
