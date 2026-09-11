import { expect, test } from "@playwright/test";
import {
  SINGLE_EQUIPMENT_SOURCE_FIXTURE,
  api,
  chooseStageSource,
  confirmStageFields,
  ensureSingleEquipmentSourceFixture,
  generateReviewFinalize,
  login,
  type StageKey,
  waitForProcurementPlan,
} from "./helpers";

test.beforeAll(() => {
  ensureSingleEquipmentSourceFixture();
});

test("两阶段文件链可登录、生成、校验、定稿并导出", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill("宁夏数字政务协同平台 E2E 项目");
  await page.getByRole("button", { name: "保存项目" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  const projectId = page.url().split("/").at(-1)!;

  await page.goto(`/projects/${projectId}/stages/tender/files`);
  await page.locator('input[type="file"]').setInputFiles(SINGLE_EQUIPMENT_SOURCE_FIXTURE);
  await page.getByRole("button", { name: "上传并解析" }).click();
  await expect(page.getByText("单一设备采购需求说明样例.docx")).toBeVisible();
  await expect
    .poll(
      async () => {
        const files = await api<Array<{ original_name: string; status: string }>>(
          page,
          "GET",
          `/api/v1/files?project_id=${projectId}&stage=tender`,
        );
        return files.find((file) => file.original_name === "单一设备采购需求说明样例.docx")?.status;
      },
      { timeout: 90_000 },
    )
    .toBe("parsed");
  await waitForProcurementPlan(page, projectId);
  await page.reload();
  await expect(page.getByText("解析完成", { exact: true })).toBeVisible();

  const stages: StageKey[] = ["tender", "contract"];
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
  await expect(page.getByText("已定稿", { exact: true })).toHaveCount(2);
});
