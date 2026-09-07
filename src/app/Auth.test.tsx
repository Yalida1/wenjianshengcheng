import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    api: { POST: post },
  };
});

import { LoginPage } from "./Auth";

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/projects" element={<div>项目首页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => post.mockReset());

  it("validates the login form before calling the API", async () => {
    renderLogin();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("邮箱"));
    await user.type(screen.getByLabelText("邮箱"), "bad-address");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("请输入有效邮箱")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("stores the session and enters the project route after a successful login", async () => {
    post.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          organization_id: "org-1",
          email: "admin@example.com",
          display_name: "管理员",
          is_active: true,
          revision: 1,
        },
        csrf_token: "csrf",
        expires_at: 1,
      },
      response: new Response(null, { status: 200 }),
    });
    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("密码"), "ChangeMe123!");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("项目首页")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/v1/auth/login", {
      body: { email: "admin@example.com", password: "ChangeMe123!" },
    });
  });
});
