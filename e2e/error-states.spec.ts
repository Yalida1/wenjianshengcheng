import path from "node:path";
import { expect, test } from "@playwright/test";
import { api, login } from "./helpers";

test("上传签名错误在界面显示统一错误", async ({ page }) => {
  await login(page);
  const project = await api<{ id: string }>(page, "POST", "/api/v1/projects", {
    code: `BAD-${Date.now()}`,
    name: "错误状态验证项目",
    project_type: "government_investment",
  });
  await page.goto(`/projects/${project.id}/stages/requirement/files`);
  await page.locator('input[type="file"]').setInputFiles(path.resolve("e2e/fixtures/fake.pdf"));
  await page.getByRole("button", { name: "上传并解析" }).click();
  await expect(page.getByText("文件内容与扩展名不一致")).toBeVisible();
});

test("并发修改返回 revision_conflict 且退出后受保护路由跳回登录", async ({ page }) => {
  await login(page);
  const project = await api<{ id: string; revision: number }>(page, "POST", "/api/v1/projects", {
    code: `REV-${Date.now()}`,
    name: "并发冲突验证项目",
    project_type: "government_investment",
  });
  await api(page, "PATCH", `/api/v1/projects/${project.id}`, {
    name: "第一次修改",
    revision: project.revision,
  });
  await expect(
    api(page, "PATCH", `/api/v1/projects/${project.id}`, {
      name: "过期覆盖",
      revision: project.revision,
    }),
  ).rejects.toThrow(/409 revision_conflict/);

  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.goto(`/projects/${project.id}`);
  await expect(page).toHaveURL(/\/login$/);
});
