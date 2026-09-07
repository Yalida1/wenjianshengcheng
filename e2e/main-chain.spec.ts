import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  api,
  chooseStageSource,
  confirmStageFields,
  generateReviewFinalize,
  login,
  type StageKey,
} from "./helpers";

test("四阶段文件链可登录、生成、校验、定稿并导出", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "新建项目" }).click();
  const projectCode = `E2E-${Date.now()}`;
  await page.getByLabel("项目编号").fill(projectCode);
  await page.getByLabel("项目名称").fill("宁夏数字政务协同平台 E2E 项目");
  await page.getByLabel("项目说明").fill("自动化四阶段主链路验证项目");
  await page.getByRole("button", { name: "保存项目" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  const projectId = page.url().split("/").at(-1)!;

  await page.goto(`/projects/${projectId}/stages/requirement/files`);
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("golden_cases/demo_001/需求说明样例.docx"));
  await page.getByRole("button", { name: "上传并解析" }).click();
  await expect(page.getByText("需求说明样例.docx")).toBeVisible();
  await expect
    .poll(
      async () => {
        const files = await api<Array<{ original_name: string; status: string }>>(
          page,
          "GET",
          `/api/v1/files?project_id=${projectId}&stage=requirement`,
        );
        return files.find((file) => file.original_name === "需求说明样例.docx")?.status;
      },
      { timeout: 90_000 },
    )
    .toBe("parsed");
  await page.reload();
  await expect(page.getByText("解析完成", { exact: true })).toBeVisible();

  const stages: StageKey[] = ["requirement", "feasibility", "tender", "contract"];
  for (const stage of stages) {
    await chooseStageSource(page, projectId, stage);
    await confirmStageFields(page, projectId, stage);
    await generateReviewFinalize(
      page,
      projectId,
      stage,
      stage === "tender" || stage === "contract",
    );
  }

  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText("已定稿", { exact: true })).toHaveCount(4);
});
