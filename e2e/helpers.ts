import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export type StageKey = "requirement" | "feasibility" | "tender" | "contract";

export const FIELD_VALUES: Record<StageKey, Record<string, unknown>> = {
  requirement: {
    project_name: "宁夏数字政务协同平台 E2E 项目",
    project_owner: "宁夏示例政务服务中心",
    construction_scope: "建设统一事项管理、协同办理和运行分析能力",
    project_period: 18,
  },
  feasibility: {
    project_name: "宁夏数字政务协同平台 E2E 项目",
    total_investment: 12_800_000,
    construction_scope: "建设基础支撑、事项管理、协同办理、数据治理和安全运维体系",
    project_period: 18,
  },
  tender: {
    project_name: "宁夏数字政务协同平台 E2E 项目",
    procurement_budget: 9_800_000,
    maximum_price: 9_500_000,
    procurement_scope: "采购事项管理、协同办理、数据治理软件及实施服务",
  },
  contract: {
    party_a: "宁夏示例政务服务中心",
    party_b: "示例数字科技有限公司",
    contract_subject: "数字政务协同平台软件及实施服务",
    contract_scope: "交付事项管理、协同办理和数据治理软件，完成部署、培训及验收支持",
    final_contract_amount: 9_260_000,
    tax_rate: 6,
    tax_inclusion: "含税总价",
    contract_duration: "合同生效后 12 个月",
    delivery_location: "宁夏回族自治区银川市甲方指定地点",
    payment_plan: [
      { label: "预付款", ratio: 30, amount: 2_778_000, trigger: "合同生效并收到合规发票" },
      { label: "初验款", ratio: 40, amount: 3_704_000, trigger: "系统完成初验" },
      { label: "终验款", ratio: 30, amount: 2_778_000, trigger: "系统完成终验" },
    ],
    acceptance: "按照合同范围、技术要求和双方确认的验收方案组织初验与终验",
    warranty: "终验合格之日起提供十二个月免费质保服务",
    breach: "违约责任按照双方确认的合同条款承担",
    effective_conditions: "双方法定代表人或授权代表签字并加盖公章后生效",
  },
};

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("admin@example.com");
  await page.getByLabel("密码").fill("ChangeMe123!");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

export async function api<T>(
  page: Page,
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ method, path, body, requestId }) => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("docchain_csrf="))
        ?.split("=")[1];
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
          "X-Request-ID": requestId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const parsed = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(`${response.status} ${parsed?.error?.code ?? "request_failed"}: ${text}`);
      }
      return parsed;
    },
    { method, path, body, requestId: randomUUID() },
  );
}

export async function confirmStageFields(page: Page, projectId: string, stage: StageKey) {
  const definitions = await api<
    Array<{
      field_key: string;
      field_label: string;
      data_type: string;
      unit: string | null;
      criticality: "P0" | "P1" | "P2";
    }>
  >(page, "GET", `/api/v1/field-definitions?stage=${stage}`);
  const values = FIELD_VALUES[stage];
  for (const definition of definitions) {
    const value = values[definition.field_key];
    const field = await api<{ id: string; revision: number }>(
      page,
      "POST",
      `/api/v1/field-values?project_id=${projectId}&stage=${stage}`,
      {
        field_key: definition.field_key,
        field_label: definition.field_label,
        data_type: definition.data_type,
        value,
        normalized_value: value,
        unit: definition.unit,
        criticality: definition.criticality,
        status: "missing",
        source_type: "user_input",
        confidence: null,
        evidence: null,
      },
    );
    await api(page, "POST", `/api/v1/field-values/${field.id}/confirm`, {
      revision: field.revision,
      evidence_acknowledged: false,
    });
  }
}

export async function chooseStageSource(page: Page, projectId: string, stage: StageKey) {
  await page.goto(`/projects/${projectId}/stages/${stage}/source`);
  if (stage !== "requirement") {
    await page.getByText("使用上一阶段定稿文件").click();
  }
  const options = page.getByLabel("可用来源版本").locator("option");
  await expect(options).toHaveCount(2, { timeout: 30_000 });
  await page.getByLabel("可用来源版本").selectOption({ index: 1 });
  await page.getByRole("button", { name: "保存来源" }).click();
  await expect(page.getByText("当前来源：")).toBeVisible();
}

export async function generateReviewFinalize(
  page: Page,
  projectId: string,
  stage: StageKey,
  exportFormats: boolean,
) {
  await page.goto(`/projects/${projectId}/stages/${stage}/generation`);
  await page.getByLabel("已发布模板").selectOption({ index: 1 });
  await page.getByRole("button", { name: "创建生成任务" }).click();
  await expect(page.getByText("succeeded", { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "打开文档工作台" }).click();

  const pendingReview = page.getByRole("button", { name: "确认内容并标记已审阅" });
  await expect(pendingReview.first()).toBeVisible({ timeout: 30_000 });
  let remaining = await pendingReview.count();
  while (remaining > 0) {
    await pendingReview.first().click();
    remaining -= 1;
    await expect(pendingReview).toHaveCount(remaining, { timeout: 30_000 });
  }

  await page.getByRole("link", { name: "校验中心" }).click();
  await page.getByRole("button", { name: "运行校验" }).click();
  await expect(page.getByText("未发现阻断问题")).toBeVisible();
  await page.getByRole("button", { name: "确认定稿" }).click();
  await expect(page.getByRole("button", { name: "已定稿" })).toBeVisible();

  if (exportFormats) {
    await page.getByRole("link", { name: "文档编辑" }).click();
    await page.getByRole("button", { name: "DOCX" }).click();
    await page.getByRole("button", { name: "PDF" }).click();
    await expect(page.getByRole("link", { name: /下载 DOCX/ })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("link", { name: /下载 PDF/ })).toBeVisible({ timeout: 90_000 });
  }
}
