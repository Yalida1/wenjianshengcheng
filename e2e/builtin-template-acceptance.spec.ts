import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  BUILTIN_ACCEPTANCE_FIELD_VALUES,
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

test.setTimeout(600_000);

test.beforeAll(() => {
  ensureSingleEquipmentSourceFixture();
});

test("内置模板固定数据两阶段 UI 主链路", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill("测试项目—区域绿色数据中心节能改造");
  await page.getByRole("button", { name: "保存项目" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  const projectId = page.url().split("/").at(-1)!;

  await page.goto(`/projects/${projectId}/stages/tender/files`);
  await page.locator('input[type="file"]').setInputFiles(SINGLE_EQUIPMENT_SOURCE_FIXTURE);
  await page.getByRole("button", { name: "上传并解析" }).click();
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

  const stages: StageKey[] = ["tender", "contract"];
  for (const stage of stages) {
    await chooseStageSource(page, projectId, stage);
    await confirmStageFields(page, projectId, stage, BUILTIN_ACCEPTANCE_FIELD_VALUES);
    await generateReviewFinalize(page, projectId, stage, true);
    if (stage === "tender") {
      for (const heading of [
        "1 招标公告",
        "2 投标人须知",
        "3 评标办法",
        "4 合同条款及格式",
        "5 供货或服务要求",
        "6 投标文件格式",
      ]) {
        await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
      }
      await expect(page.getByText("投标人须知前附表", { exact: true }).last()).toBeVisible();
      await expect(page.getByText("商务、技术和报价评审因素表", { exact: true })).toBeVisible();
      await expect(
        page.getByText(/项目资金来源、落实情况和采购审批结论应以来源文件为准/),
      ).toBeVisible();
    }
    await page.screenshot({
      path: path.resolve(`artifacts/builtin_template_acceptance/screenshots/ui-${stage}.png`),
      fullPage: true,
    });
  }

  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText("已定稿", { exact: true })).toHaveCount(2);
  await page.screenshot({
    path: path.resolve(
      "artifacts/builtin_template_acceptance/screenshots/ui-two-stage-finalized.png",
    ),
    fullPage: true,
  });
});
