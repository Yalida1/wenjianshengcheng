/**
 * 产品品牌默认值与静态回退。
 * 运行时以 /api/v1/branding 为准，可在「系统管理 → 品牌设置」中修改。
 */
export type BrandingConfig = {
  name: string;
  subtitle: string;
  logoUrl: string;
  mark: string;
  documentTitle: string;
  hasCustomLogo: boolean;
  revision: number;
};

export const DEFAULT_BRANDING: BrandingConfig = {
  name: "智能招标管理",
  subtitle: "受控生成与定稿平台",
  logoUrl: "/brand-logo.svg",
  mark: "智",
  documentTitle: "智能招标管理",
  hasCustomLogo: false,
  revision: 1,
};

export function applyDocumentBranding(config: Pick<BrandingConfig, "name" | "subtitle" | "documentTitle">): void {
  if (typeof document === "undefined") return;
  document.title = config.documentTitle || config.name;
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute("content", `${config.name} · ${config.subtitle}`);
  }
}
