import path from "node:path";
import { expect, test } from "@playwright/test";
import { api, login } from "./helpers";

test("核心路由刷新、三种桌面宽度与基础可访问性通过", async ({ page }) => {
  await login(page);
  const projectName = "路由与响应式巡检项目";
  const project = await api<{ id: string; code: string }>(page, "POST", "/api/v1/projects", {
    code: `ROUTE-${Date.now()}`,
    name: projectName,
    project_type: "government_investment",
  });
  const stageRoutes = ["tender", "contract"].flatMap((stage) =>
    ["", "source", "files", "fields", "templates", "generation"].map(
      (suffix) => `/projects/${project.id}/stages/${stage}${suffix ? `/${suffix}` : ""}`,
    ),
  );
  const hiddenStageRoutes = ["requirement", "feasibility"].flatMap((stage) =>
    ["", "source", "files"].map(
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

  for (const route of hiddenStageRoutes) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}$`));
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  }

  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "从成品文件提取模板" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传并智能提取" })).toBeDisabled();
  await expect(page.getByText("程序解析 + 质量门禁 + 确认发布", { exact: true })).toBeVisible();
  const templates = await api<Array<{ stage: string; source_kind: string }>>(
    page,
    "GET",
    "/api/v1/templates",
  );
  for (const [sourceKind, category] of [
    ["national_official_text", "国家正式文本"],
    ["adapted_from_official_outline", "依据正式大纲适配"],
    ["platform_reference_template", "平台参考模板"],
    ["other_official_template", "其他正式模板"],
  ]) {
    const hasVisibleTemplates = templates.some(
      (template) =>
        template.source_kind === sourceKind && ["tender", "contract"].includes(template.stage),
    );
    const heading = page.getByRole("heading", { name: category, exact: true });
    if (hasVisibleTemplates) await expect(heading).toBeVisible();
    else await expect(heading).toHaveCount(0);
  }
  await expect(
    page.getByText("政府投资项目可行性研究报告编写通用大纲（2023年版）", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("政府投资项目可研报告适配模板（2023年大纲）", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("仅供查阅核对", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("可用于生成", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "版本", exact: true })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "阶段", exact: true })).toHaveCount(0);
  const adaptedCategory = page
    .getByRole("heading", { name: "依据正式大纲适配", exact: true })
    .locator("xpath=ancestor::section[1]");
  const adaptedStageLabels = await adaptedCategory
    .locator("tbody > tr.bg-slate-50\\/80 td span.font-semibold")
    .allTextContents();
  expect(adaptedStageLabels).toEqual(["招标文件", "合同"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: path.resolve("artifacts/qa/ui/templates-1440.png"),
    fullPage: true,
  });

  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
    await expect(page.getByText("进行中", { exact: true })).toBeVisible();
    await expect(page.getByText("未开始", { exact: true })).toHaveCount(2);
    for (const stageName of ["招标文件", "合同"]) {
      await expect(page.getByRole("heading", { name: stageName, exact: true })).toBeVisible();
    }
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

  await page.goto("/projects");
  const projectCard = page.locator("main section").filter({ hasText: project.code }).first();
  await projectCard.getByRole("button", { name: "删除项目" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "确认删除项目" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "确认删除" }).click();
  await expect(deleteDialog).toBeHidden();
  await expect(page.getByText(project.code, { exact: true })).toHaveCount(0);
});
