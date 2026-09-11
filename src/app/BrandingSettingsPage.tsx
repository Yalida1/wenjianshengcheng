import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, apiError } from "../api/client";
import { useBranding } from "../config/BrandingProvider";
import { ErrorNotice } from "./Auth";
import { Card } from "./Shell";

export function BrandingSettingsPage() {
  const queryClient = useQueryClient();
  const { branding, loading } = useBranding();
  const [name, setName] = useState(branding.name);
  const [subtitle, setSubtitle] = useState(branding.subtitle);
  const [mark, setMark] = useState(branding.mark);
  const [logoFile, setLogoFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    setName(branding.name);
    setSubtitle(branding.subtitle);
    setMark(branding.mark);
  }, [branding.name, branding.subtitle, branding.mark, branding.revision]);

  useEffect(() => {
    if (!logoFile) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const result = await api.PATCH("/api/v1/branding", {
        body: {
          name: name.trim(),
          subtitle: subtitle.trim(),
          mark: mark.trim() || name.trim().slice(0, 1),
          clear_logo: false,
          revision: branding.revision,
        },
      });
      if (result.error) throw apiError(result.error, result.response);
      let next = result.data;
      if (logoFile) {
        const uploaded = await api.POST("/api/v1/branding/logo", {
          params: { query: { revision: next.revision } },
          body: { upload: logoFile as unknown as string },
          bodySerializer() {
            const body = new FormData();
            body.set("upload", logoFile);
            return body;
          },
        });
        if (uploaded.error) throw apiError(uploaded.error, uploaded.response);
        next = uploaded.data;
      }
      return next;
    },
    onSuccess: async () => {
      setLogoFile(undefined);
      setMessage("品牌设置已保存，侧栏与登录页将立即更新。");
      await queryClient.invalidateQueries({ queryKey: ["branding"] });
    },
  });

  const clearLogoMutation = useMutation({
    mutationFn: async () => {
      const result = await api.PATCH("/api/v1/branding", {
        body: { clear_logo: true, revision: branding.revision },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: async () => {
      setLogoFile(undefined);
      setMessage("已恢复默认 Logo。");
      await queryClient.invalidateQueries({ queryKey: ["branding"] });
    },
  });

  const error = saveMutation.error || clearLogoMutation.error;
  const currentLogo = previewUrl || branding.logoUrl;

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="text-base font-semibold text-slate-900">品牌设置</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          修改后将同步到侧栏品牌区、登录页与浏览器标题。需要系统管理员权限。
        </p>
        {loading ? (
          <p className="mt-6 text-sm text-slate-500">正在加载品牌配置…</p>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
            <div className="rounded-xl bg-[#12345B] p-5 text-white">
              <div className="flex items-center gap-3">
                <img
                  src={currentLogo}
                  alt={name || branding.name}
                  className="size-12 rounded-lg bg-white/10 object-contain p-1.5"
                  onError={(event) => {
                    (event.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold">{name || "项目名称"}</div>
                  <div className="mt-1 truncate text-xs text-blue-200">
                    {subtitle || "副标题"}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-xs text-blue-100/80">侧栏预览</p>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                项目名称
                <input
                  className="form-input mt-2"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：智能招标管理"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                副标题
                <input
                  className="form-input mt-2"
                  value={subtitle}
                  maxLength={200}
                  onChange={(event) => setSubtitle(event.target.value)}
                  placeholder="例如：受控生成与定稿平台"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                无 Logo 时的徽标字
                <input
                  className="form-input mt-2 max-w-[8rem]"
                  value={mark}
                  maxLength={8}
                  onChange={(event) => setMark(event.target.value)}
                  placeholder="智"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Logo 图片
                <input
                  className="form-input mt-2"
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                  onChange={(event) => setLogoFile(event.target.files?.[0])}
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  支持 PNG / JPG / SVG，不超过 2MB。不选择则保留当前 Logo。
                </span>
              </label>
              {error && <ErrorNotice error={error} />}
              {message && !error && (
                <p className="text-sm text-emerald-700">{message}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    saveMutation.isPending ||
                    !name.trim() ||
                    !subtitle.trim() ||
                    (name === branding.name &&
                      subtitle === branding.subtitle &&
                      mark === branding.mark &&
                      !logoFile)
                  }
                  onClick={() => {
                    setMessage(undefined);
                    saveMutation.mutate();
                  }}
                >
                  {saveMutation.isPending ? "保存中…" : "保存品牌设置"}
                </button>
                {(branding.hasCustomLogo || logoFile) && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={clearLogoMutation.isPending || Boolean(logoFile)}
                    onClick={() => {
                      setMessage(undefined);
                      clearLogoMutation.mutate();
                    }}
                  >
                    {clearLogoMutation.isPending ? "处理中…" : "恢复默认 Logo"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
