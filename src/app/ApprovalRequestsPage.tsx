import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, apiError, type ApprovalRequest } from "../api/client";
import { ErrorNotice, FullPageMessage } from "./Auth";
import { Card, PageHeader, StatusBadge } from "./Shell";

type StatusFilter = "pending" | "all";

const REQUEST_TYPE_LABELS: Record<string, string> = {
  project_delete: "项目删除",
};

export function ApprovalRequestsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  const requests = useQuery({
    queryKey: ["approval-requests", statusFilter],
    queryFn: async () => {
      const result = await api.GET("/api/v1/approval-requests", {
        params: {
          query: {
            page: 1,
            page_size: 100,
            ...(statusFilter === "pending" ? { status: "pending" } : {}),
          },
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data.items as ApprovalRequest[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (item: ApprovalRequest) => {
      const result = await api.POST("/api/v1/approval-requests/{request_id}/approve", {
        params: { path: { request_id: item.id } },
        body: { revision: item.revision, comment: "同意删除" },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: async (item) => {
      await queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (item.target_id) {
        queryClient.removeQueries({ queryKey: ["project", item.target_id] });
        queryClient.removeQueries({ queryKey: ["stages", item.target_id] });
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ item, comment }: { item: ApprovalRequest; comment: string }) => {
      const result = await api.POST("/api/v1/approval-requests/{request_id}/reject", {
        params: { path: { request_id: item.id } },
        body: { revision: item.revision, comment },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: async () => {
      setRejectingId(null);
      setRejectComment("");
      await queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
    },
  });

  const pendingCount = useMemo(
    () => (requests.data ?? []).filter((item) => item.status === "pending").length,
    [requests.data],
  );

  const actionError = approveMutation.error || rejectMutation.error;

  return (
    <>
      <PageHeader
        title="申请审批"
        description="处理项目删除等运营类申请。通过后系统才会执行实际删除。"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              className={statusFilter === "pending" ? "primary-button" : "secondary-button"}
              onClick={() => setStatusFilter("pending")}
            >
              待审批{statusFilter === "pending" && requests.data ? `（${pendingCount}）` : ""}
            </button>
            <button
              type="button"
              className={statusFilter === "all" ? "primary-button" : "secondary-button"}
              onClick={() => setStatusFilter("all")}
            >
              全部
            </button>
          </div>
        }
      />

      {requests.isLoading && <FullPageMessage title="正在加载审批申请" />}
      {requests.error && <ErrorNotice error={requests.error} />}
      {actionError && (
        <div className="mb-4">
          <ErrorNotice error={actionError} />
        </div>
      )}

      {requests.data?.length === 0 && (
        <Card>
          <p className="text-sm text-slate-500">
            {statusFilter === "pending" ? "当前没有待审批申请。" : "暂无审批记录。"}
          </p>
        </Card>
      )}

      <div className="grid gap-4">
        {requests.data?.map((item) => {
          const busy =
            (approveMutation.isPending && approveMutation.variables?.id === item.id) ||
            (rejectMutation.isPending && rejectMutation.variables?.item.id === item.id);
          return (
            <Card key={item.id}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {REQUEST_TYPE_LABELS[item.request_type] ?? item.request_type}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-sm leading-6 text-slate-600">申请原因：{item.reason}</p>
                  <div className="text-xs leading-5 text-slate-400">
                    <div>
                      目标：{item.target_name}
                      {item.target_code ? `（${item.target_code}）` : ""}
                    </div>
                    <div>
                      申请人：{item.requester_name ?? "未知"} ·{" "}
                      {new Date(item.created_at).toLocaleString("zh-CN")}
                    </div>
                    {item.reviewed_at && (
                      <div>
                        审批人：{item.reviewer_name ?? "未知"} ·{" "}
                        {new Date(item.reviewed_at).toLocaleString("zh-CN")}
                        {item.review_comment ? ` · ${item.review_comment}` : ""}
                      </div>
                    )}
                  </div>
                </div>

                {item.status === "pending" && (
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setRejectingId(item.id);
                        setRejectComment("");
                        rejectMutation.reset();
                        approveMutation.reset();
                      }}
                    >
                      驳回
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-10 items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        setRejectingId(null);
                        approveMutation.mutate(item);
                      }}
                    >
                      {approveMutation.isPending && approveMutation.variables?.id === item.id
                        ? "通过并删除中…"
                        : "通过并删除"}
                    </button>
                  </div>
                )}
              </div>

              {rejectingId === item.id && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <label className="form-label">
                    驳回原因
                    <textarea
                      className="form-input mt-2 min-h-24"
                      value={rejectComment}
                      onChange={(event) => setRejectComment(event.target.value)}
                      placeholder="请说明驳回原因"
                    />
                  </label>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={rejectMutation.isPending}
                      onClick={() => setRejectingId(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={rejectMutation.isPending || rejectComment.trim().length < 2}
                      onClick={() =>
                        rejectMutation.mutate({ item, comment: rejectComment.trim() })
                      }
                    >
                      {rejectMutation.isPending ? "提交中…" : "确认驳回"}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
