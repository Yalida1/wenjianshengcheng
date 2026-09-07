import path from "node:path";
import { expect, test } from "@playwright/test";
import { api, login } from "./helpers";

test("核心路由刷新、三种桌面宽度与基础可访问性通过", async ({ page }) => {
  await login(page);
  const projectName = "路由与响应式巡检项目";
  const project = await api<{ id: string }>(page, "POST", "/api/v1/projects", {
    code: `ROUTE-${Date.now()}`,
    name: projectName,
    project_type: "government_investment",
  });
  const stageRoutes = ["requirement", "feasibility", "tender", "contract"].flatMap((stage) =>
    ["", "source", "files", "fields", "templates", "generation"].map(
      (suffix) => `/projects/${project.id}/stages/${stage}${suffix ? `/${suffix}` : ""}`,
    ),
  );
  const routes = [
    "/projects",
    `/projects/${project.id}`,
    ...stageRoutes,
    "/templates",
    "/field-dictionary",
    "/system/users",
    "/system/roles",
    "/system/audit-logs",
  ];

  for (const route of routes) {
    await page.goto(route);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("404", { exact: true })).toHaveCount(0);
    await expect(page.getByText("页面不存在", { exact: true })).toHaveCount(0);
  }

  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);
    await page.screenshot({
      path: path.resolve(`artifacts/qa/ui/project-${width}.png`),
      fullPage: true,
    });
  }

  const unnamedButtons = await page
    .locator("button")
    .evaluateAll((buttons) =>
      buttons
        .filter(
          (button) =>
            !(button.textContent ?? "").trim() &&
            !button.getAttribute("aria-label") &&
            !button.getAttribute("title"),
        )
        .map((button) => button.outerHTML),
    );
  expect(unnamedButtons).toEqual([]);
});
