import { Card, PageHeader, StatusBadge } from "./Shell";

const states = [
  ["loading", "加载中", "后台正在读取最新状态。"],
  ["empty", "空状态", "当前范围没有可显示的记录。"],
  ["failed", "请求失败", "显示 request ID，并提供可执行的重试入口。"],
  ["forbidden", "无权限", "服务端对象级权限拒绝当前操作。"],
  ["stale", "上游已变化", "下游保持原版本，等待用户选择是否创建修订。"],
  ["revision_conflict", "并发冲突", "重新加载服务端版本后再合并修改。"],
] as const;

export function UIStatesPage() {
  return (
    <>
      <PageHeader
        title="界面状态校验"
        description="仅在开发模式提供，用于核对正式交付界面的异常与边界状态。"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {states.map(([status, title, detail]) => (
          <Card key={status}>
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-slate-900">{title}</h3>
              <StatusBadge status={status} />
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">{detail}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
