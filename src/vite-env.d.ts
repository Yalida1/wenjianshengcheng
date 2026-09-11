/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BRAND_NAME?: string;
  readonly VITE_BRAND_SUBTITLE?: string;
  readonly VITE_BRAND_LOGO_URL?: string;
  readonly VITE_BRAND_MARK?: string;
  readonly VITE_BRAND_DOCUMENT_TITLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
