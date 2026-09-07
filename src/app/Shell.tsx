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
      {status}
    </span>
  );
}
