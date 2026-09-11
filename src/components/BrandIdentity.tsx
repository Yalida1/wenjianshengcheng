import { useEffect, useState } from "react";
import { useBranding } from "../config/BrandingProvider";

type BrandIdentityProps = {
  /** sidebar：深色侧栏；login：登录页品牌块 */
  variant?: "sidebar" | "login";
  className?: string;
};

export function BrandIdentity({ variant = "sidebar", className = "" }: BrandIdentityProps) {
  const { branding } = useBranding();
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [branding.logoUrl, branding.revision]);

  const showLogo = Boolean(branding.logoUrl) && !logoFailed;
  const mark = branding.mark || branding.name.slice(0, 1) || "智";

  if (variant === "login") {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <BrandMark
          logoUrl={branding.logoUrl}
          name={branding.name}
          showLogo={showLogo}
          mark={mark}
          onLogoError={() => setLogoFailed(true)}
          size="lg"
        />
        <div>
          <div className="text-sm font-semibold tracking-[0.2em] text-blue-200">{branding.name}</div>
          <div className="mt-1 text-xs text-blue-100/80">{branding.subtitle}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <BrandMark
        logoUrl={branding.logoUrl}
        name={branding.name}
        showLogo={showLogo}
        mark={mark}
        onLogoError={() => setLogoFailed(true)}
        size="md"
      />
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold leading-tight">{branding.name}</div>
        <div className="mt-1 truncate text-xs text-blue-200">{branding.subtitle}</div>
      </div>
    </div>
  );
}

function BrandMark({
  logoUrl,
  name,
  showLogo,
  mark,
  onLogoError,
  size,
}: {
  logoUrl: string;
  name: string;
  showLogo: boolean;
  mark: string;
  onLogoError: () => void;
  size: "md" | "lg";
}) {
  const box = size === "lg" ? "size-12 text-lg" : "size-10 text-base";
  if (showLogo) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={`${box} shrink-0 rounded-lg object-contain bg-white/10 p-1.5`}
        onError={onLogoError}
      />
    );
  }
  return (
    <div
      className={`flex ${box} shrink-0 items-center justify-center rounded-lg bg-white/15 font-semibold text-white`}
      aria-hidden="true"
    >
      {mark}
    </div>
  );
}
