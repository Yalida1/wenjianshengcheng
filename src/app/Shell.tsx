import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BrandIdentity } from "../components/BrandIdentity";
import { useAuth } from "./Auth";

type NavLeaf = {
  to: string;
  label: string;
  end?: boolean;
  /** When set, used instead of pathname-only matching for nested active state. */
  isActive?: (pathname: string, search: string) => boolean;
};
type NavGroup = { label: string; children: readonly NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

function projectKindFromSearch(search: string): "managed" | "adhoc" {
  const kind = new URLSearchParams(search).get("kind");
  return kind === "adhoc" ? "adhoc" : "managed";
}

const navItems: readonly NavEntry[] = [
  { to: "/workbench", label: "工作台", end: true },
  {
    label: "项目空间",
    children: [
      {
        to: "/projects?kind=managed",
        label: "正式项目",
        isActive: (pathname, search) =>
          pathname === "/projects" && projectKindFromSearch(search) === "managed",
      },
      {
        to: "/projects?kind=adhoc",
        label: "临时编标",
        isActive: (pathname, search) =>
          pathname === "/projects" && projectKindFromSearch(search) === "adhoc",
      },
    ],
  },
  {
    label: "运营配置",
    children: [
      { to: "/admin/project-form", label: "项目单配置" },
      { to: "/admin/approvals", label: "申请审批" },
      { to: "/admin/stage-display", label: "阶段展示" },
      { to: "/templates", label: "模板中心" },
      { to: "/field-dictionary", label: "动态字段提取" },
    ],
  },
  { to: "/admin/users", label: "系统管理" },
];

const opsPaths = (
  navItems.find((item): item is NavGroup => isNavGroup(item) && item.label === "运营配置")?.children ??
  []
).map((item) => item.to);

function pathMatches(pathname: string, to: string, end?: boolean) {
  const pathOnly = to.split("?")[0] ?? to;
  if (end) return pathname === pathOnly || pathname === `${pathOnly}/`;
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

function isSystemAdminPath(pathname: string) {
  return (
    pathname.startsWith("/admin/") &&
    !opsPaths.some((to) => pathMatches(pathname, to))
  );
}

function groupIsActive(entry: NavGroup, pathname: string) {
  if (entry.label === "项目空间") return pathname.startsWith("/projects");
  return entry.children.some((child) => pathMatches(pathname, child.to));
}

function resolveTitle(pathname: string, search = ""): string {
  if (pathname.startsWith("/workbench")) return "工作台";
  if (pathname === "/projects") {
    return projectKindFromSearch(search) === "adhoc" ? "临时编标" : "正式项目";
  }
  if (pathname.startsWith("/projects")) return "项目空间";
  if (pathname.startsWith("/templates")) return "模板中心";
  if (pathname.startsWith("/field-dictionary")) return "动态字段提取";
  if (pathname.startsWith("/admin/project-form")) return "项目单配置";
  if (pathname.startsWith("/admin/approvals")) return "申请审批";
  if (pathname.startsWith("/admin/stage-display")) return "阶段展示";
  if (pathname.startsWith("/admin/branding")) return "品牌设置";
  if (pathname.startsWith("/admin/models")) return "模型配置";
  return "系统管理";
}

function linkClass(active: boolean, nested = false) {
  const base = nested
    ? "block rounded-lg px-4 py-2.5 text-sm"
    : "block rounded-lg px-4 py-3 text-sm";
  return `${base} ${active ? "bg-white text-[#12345B]" : "text-blue-100 hover:bg-white/10"}`;
}

export function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const title = resolveTitle(location.pathname, location.search);
  const activeGroupLabels = useMemo(
    () =>
      Object.fromEntries(
        navItems
          .filter(isNavGroup)
          .map((entry) => [entry.label, groupIsActive(entry, location.pathname)])
      ),
    [location.pathname]
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => activeGroupLabels);

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [label, active] of Object.entries(activeGroupLabels)) {
        if (active && !next[label]) {
          next[label] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeGroupLabels]);

  return (
    <div className="flex min-h-screen bg-[#F6F8FB] text-slate-700">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-[#12345B] text-white lg:flex">
        <div className="border-b border-white/10 px-6 py-6">
          <BrandIdentity />
        </div>
        <nav className="flex-1 space-y-1 p-4" aria-label="主导航">
          {navItems.map((entry) => {
            if (isNavGroup(entry)) {
              const open = Boolean(openGroups[entry.label]);
              const active = Boolean(activeGroupLabels[entry.label]);
              return (
                <div key={entry.label} className="space-y-1">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenGroups((prev) => ({ ...prev, [entry.label]: !prev[entry.label] }))
                    }
                    className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-sm ${
                      active ? "bg-white/15 text-white" : "text-blue-100 hover:bg-white/10"
                    }`}
                  >
                    <span>{entry.label}</span>
                    <span className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}>
                      ›
                    </span>
                  </button>
                  {open && (
                    <div className="ml-2 space-y-1 border-l border-white/15 pl-2">
                      {entry.children.map((child) => {
                        const childActive = child.isActive
                          ? child.isActive(location.pathname, location.search)
                          : pathMatches(location.pathname, child.to, child.end);
                        return (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            aria-current={childActive ? "page" : false}
                            className={() => linkClass(childActive, true)}
                          >
                            {child.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const systemActive =
              entry.to === "/admin/users" ? isSystemAdminPath(location.pathname) : undefined;

            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.end}
                aria-current={
                  entry.to === "/admin/users" ? (systemActive ? "page" : false) : undefined
                }
                className={({ isActive }) =>
                  linkClass(systemActive === undefined ? isActive : Boolean(systemActive))
                }
              >
                {entry.label}
              </NavLink>
            );
          })}
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
  approved: "已通过",
  rejected: "已驳回",
  running: "处理中",
  retrying: "重试中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  generated: "生成完成",
  draft: "草稿",
  reviewing: "审阅中",
  validation_failed: "校验失败",
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
    status === "published" ||
    status === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed" ||
          status === "stale" ||
          status === "validation_failed" ||
          status === "rejected"
        ? "bg-red-50 text-red-700"
        : "bg-blue-50 text-blue-700";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}
