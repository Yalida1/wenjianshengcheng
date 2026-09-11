import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type PropsWithChildren } from "react";
import { api, apiError } from "../api/client";
import {
  applyDocumentBranding,
  DEFAULT_BRANDING,
  type BrandingConfig,
} from "../config/branding";

type BrandingContextValue = {
  branding: BrandingConfig;
  loading: boolean;
  refresh: () => void;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

function mapBranding(data: {
  name: string;
  subtitle: string;
  mark: string;
  document_title: string;
  has_custom_logo: boolean;
  logo_url?: string | null;
  revision: number;
}): BrandingConfig {
  return {
    name: data.name || DEFAULT_BRANDING.name,
    subtitle: data.subtitle || DEFAULT_BRANDING.subtitle,
    mark: data.mark || DEFAULT_BRANDING.mark,
    documentTitle: data.document_title || data.name || DEFAULT_BRANDING.documentTitle,
    hasCustomLogo: Boolean(data.has_custom_logo),
    logoUrl: data.logo_url || DEFAULT_BRANDING.logoUrl,
    revision: data.revision,
  };
}

export function BrandingProvider({ children }: PropsWithChildren) {
  const query = useQuery({
    queryKey: ["branding"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/branding");
      if (result.error) throw apiError(result.error, result.response);
      return mapBranding(result.data);
    },
    staleTime: 60_000,
    retry: 1,
  });

  const branding = query.data ?? DEFAULT_BRANDING;

  useEffect(() => {
    applyDocumentBranding(branding);
  }, [branding]);

  return (
    <BrandingContext.Provider
      value={{
        branding,
        loading: query.isLoading,
        refresh: () => {
          void query.refetch();
        },
      }}
    >
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const value = useContext(BrandingContext);
  if (!value) {
    return {
      branding: DEFAULT_BRANDING,
      loading: false,
      refresh: () => undefined,
    };
  }
  return value;
}
