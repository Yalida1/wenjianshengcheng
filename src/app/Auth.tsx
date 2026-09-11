import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type PropsWithChildren } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { BrandIdentity } from "../components/BrandIdentity";
import { useBranding } from "../config/BrandingProvider";
import { api, apiError, type User } from "../api/client";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/auth/me");
      if (result.error) {
        if (result.response.status === 401) return null;
        throw apiError(result.error, result.response);
      }
      return result.data;
    },
    retry: false,
    staleTime: 60_000,
  });
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/auth/logout");
      if (result.error) throw apiError(result.error, result.response);
    },
    onSettled: () => queryClient.setQueryData(["session"], null),
  });
  return (
    <AuthContext.Provider
      value={{
        user: session.data ?? null,
        loading: session.isLoading,
        logout: () => logoutMutation.mutate(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function ProtectedRoute({ children }: PropsWithChildren) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) {
    return <FullPageMessage title="正在验证会话" detail="请稍候" />;
  }
  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

const loginSchema = z.object({
  email: z.string().trim().min(3, "请输入账号"),
  password: z.string().min(1, "请输入密码"),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { branding } = useBranding();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "admin", password: "" },
  });
  const login = useMutation({
    mutationFn: async (values: LoginValues) => {
      const result = await api.POST("/api/v1/auth/login", { body: values });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: (session) => {
      queryClient.setQueryData(["session"], session.user);
      const from = (location.state as { from?: string } | null)?.from ?? "/projects?kind=managed";
      navigate(from, { replace: true });
    },
  });
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl md:grid-cols-[1.1fr_1fr]">
        <section className="hidden bg-[#12345B] p-12 text-white md:block">
          <BrandIdentity variant="login" className="mb-16" />
          <h1 className="text-3xl font-semibold leading-tight">从需求到合同的受控文件链</h1>
          <p className="mt-6 max-w-md leading-7 text-blue-100">
            字段来源、人工确认、模板版本、生成记录和定稿门禁在同一项目空间内留痕。
          </p>
          <div className="mt-12 border-t border-blue-300/30 pt-6 text-sm text-blue-100">
            当前仓库默认启用明确标记的 Demo Provider；模板按正式来源和适配性质分级展示。
          </div>
        </section>
        <section className="p-8 sm:p-12">
          <h2 className="text-2xl font-semibold text-slate-900">登录{branding.name}</h2>
          <p className="mt-2 text-sm text-slate-500">使用组织账号继续</p>
          <form
            className="mt-8 space-y-5"
            onSubmit={form.handleSubmit((values) => login.mutate(values))}
          >
            <label className="block text-sm font-medium text-slate-700">
              账号
              <input
                className="form-input mt-2"
                autoComplete="username"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <span className="field-error">{form.formState.errors.email.message}</span>
              )}
            </label>
            <label className="block text-sm font-medium text-slate-700">
              密码
              <input
                className="form-input mt-2"
                type="password"
                autoComplete="current-password"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <span className="field-error">{form.formState.errors.password.message}</span>
              )}
            </label>
            {login.error && <ErrorNotice error={login.error} />}
            <button className="primary-button w-full" type="submit" disabled={login.isPending}>
              {login.isPending ? "正在登录" : "登录"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "请求失败";
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}

export function FullPageMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-center">
      <div>
        <div className="text-lg font-medium text-slate-800">{title}</div>
        {detail && <div className="mt-2 text-sm text-slate-500">{detail}</div>}
      </div>
    </div>
  );
}
