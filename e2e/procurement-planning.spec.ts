import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { api, login, waitForProcurementPlan } from "./helpers";

const fixtureDir = path.resolve("test-results", "procurement-fixtures");
const fixturePath = path.join(fixtureDir, "采购方案可研脱敏样例.docx");

test.beforeAll(() => {
  mkdirSync(fixtureDir, { recursive: true });
  const python =
    process.env.E2E_PYTHON ??
    (process.platform === "win32" ? path.resolve(".venv", "Scripts", "python.exe") : "python");
  const script = [
    "from docx import Document",
    "import sys",
    "d=Document()",
    "d.add_heading('可行性研究报告', level=1)",
    "d.add_paragraph('项目名称：采购方案端到端测试项目')",
    "d.add_paragraph('独立主招标文件：业务应用软件建设招标文件|应用软件建设范围|可独立交付与验收')",
    "d.add_paragraph('采购包：P1|应用软件采购包|业务应用软件开发、部署和培训')",
    "d.add_paragraph('独立主招标文件：基础设施设备采购招标文件|基础设施设备范围|设备可独立供货验收')",
    "d.add_paragraph('采购包：P2|基础设施设备包|服务器及网络设备供货')",
    "d.add_paragraph('总投资：1280万元')",
    "d.save(sys.argv[1])",
  ].join(";");
  execFileSync(python, ["-c", script, fixturePath]);
});

test("上传并解析后识别待编制文件，并在字段确认页切换确认", async ({ page }) => {
  await login(page);
  const project = await api<{ id: string }>(page, "POST", "/api/v1/projects", {
    code: `PROC-E2E-${Date.now()}`,
    name: "采购方案端到端测试项目",
    description: "脱敏合成材料，仅用于招标流程端到端测试",
  });

  await page.goto(`/projects/${project.id}/stages/tender/files`);
  await expect(page.getByRole("tab", { name: "采购方案分析与确认" })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(5);

  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.getByRole("button", { name: "上传并解析" }).click();
  await expect(page.getByText(/材料解析完成，已识别本项目需要编制/)).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByText(/需要编制 2 份文件/)).toBeVisible();
  await waitForProcurementPlan(page, project.id);

  await page.getByRole("link", { name: "前往字段确认" }).click();
  await expect(page.getByLabel("待编制文件")).toBeVisible();
  const select = page.getByLabel("待编制文件");
  await expect(select.locator("option")).toHaveCount(2);
  await expect(select.locator("option").nth(0)).toContainText("业务应用软件建设招标文件");
  await expect(select.locator("option").nth(1)).toContainText("基础设施设备采购招标文件");

  await page.goto(`/projects/${project.id}/stages/tender/procurement`);
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/stages/tender/files`));

  await page.goto(`/projects/${project.id}/stages/tender/generation`);
  await expect(page.getByRole("heading", { name: "先生成目录，再按章生成正文" })).toBeVisible();
  await expect(page.getByLabel("待编制招标文件").locator("option")).toHaveCount(2);

  // Reading the outline does not create reviewable body, even when a different document exists.
  await page.getByRole("button", { name: /生成文档目录|重新生成目录/ }).click();
  const documentGroup = await page.getByLabel("待编制招标文件").inputValue();
  const templateId = await page.getByLabel("生成模板").inputValue();
  const templates = await api<Array<{ id: string; current_version: number }>>(
    page,
    "GET",
    `/api/v1/templates?stage=tender&generation_only=true&project_id=${project.id}`,
  );
  const template = templates.find((item) => item.id === templateId)!;
  const sections = await api<
    Array<{ key: string; title: string; id: string; parent_id: string | null }>
  >(page, "GET", `/api/v1/templates/${templateId}/versions/${template.current_version}/sections`);
  const leaf = sections.find(
    (section) => section.parent_id && !sections.some((item) => item.parent_id === section.id),
  )!;
  const sibling = sections.find(
    (section) => section.parent_id === leaf.parent_id && section.id !== leaf.id,
  )!;
  const parent = sections.find((section) => section.id === leaf.parent_id)!;
  await expect(
    page.getByRole("checkbox", { name: `选择${leaf.title}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: `选择${parent.title}`, exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: `选择${sibling.title}`, exact: true }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: `选择${sibling.title}`, exact: true }).uncheck();
  await expect(
    page.getByRole("checkbox", { name: `选择${sibling.title}`, exact: true }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: "全选", exact: true }).check();
  await page.getByRole("checkbox", { name: "全选", exact: true }).uncheck();
  await page.getByRole("tab", { name: "文档确认", exact: true }).click();
  await expect(page.getByRole("heading", { name: "尚无可确认的文档" })).toBeVisible();
  await expect(page.locator(".document-paper")).toHaveCount(0);
  await page.getByRole("tab", { name: "文档生成", exact: true }).click();

  await page.getByRole("checkbox", { name: `选择${leaf.title}`, exact: true }).check();
  const preview = page.getByRole("region", { name: "章节正文预览" });
  await expect(preview.getByRole("heading", { level: 3 })).toContainText(leaf.title);
  await expect(preview).toContainText("正文尚未生成");
  await page.getByRole("checkbox", { name: /我已核对采购制度|本次范围同时识别到/ }).check();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/generation-jobs",
  );
  await page.getByRole("button", { name: "生成所选 1 个章节", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(202);
  expect(response.request().postDataJSON()).toMatchObject({
    selected_section_keys: [leaf.key],
    include_descendants: false,
  });
  await expect(preview).toContainText("已生成正文", { timeout: 90_000 });
  const documents = await api<Array<{ id: string; procurement_document_group_id: string }>>(
    page,
    "GET",
    `/api/v1/documents?project_id=${project.id}`,
  );
  const generatedDocument = documents.find(
    (item) => item.procurement_document_group_id === documentGroup,
  )!;
  const detail = await api<{ versions: Array<{ id: string }> }>(
    page,
    "GET",
    `/api/v1/documents/${generatedDocument.id}`,
  );
  const version = await api<{ sections: Array<{ key: string; blocks: unknown[] }> }>(
    page,
    "GET",
    `/api/v1/documents/versions/${detail.versions[0].id}`,
  );
  expect(
    version.sections.filter((section) => section.blocks.length > 0).map((section) => section.key),
  ).toEqual([leaf.key]);
  await page.screenshot({
    path: path.resolve("artifacts/qa/ui/chapter-selection.png"),
    fullPage: true,
  });
  await page.getByRole("button").filter({ hasText: sibling.title }).click();
  await expect(preview.getByRole("heading", { level: 3 })).toContainText(sibling.title);
  await expect(preview).toContainText("正文尚未生成");
  await expect(page.getByRole("button", { name: "生成所选 1 个章节", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "文档确认", exact: true }).click();
  await expect(page.locator(".document-paper")).toBeVisible();
  const confirmationSelector = page.getByLabel("待确认招标文件");
  const otherGroup = await confirmationSelector
    .locator("option")
    .evaluateAll(
      (options, current) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .find((value) => value !== current),
      documentGroup,
    );
  await confirmationSelector.selectOption(otherGroup!);
  await expect(page.getByRole("heading", { name: "尚无可确认的文档" })).toBeVisible();
  await expect(page.locator(".document-paper")).toHaveCount(0);
  await page.screenshot({
    path: path.resolve("artifacts/qa/ui/ungenerated-confirmation.png"),
    fullPage: true,
  });
  await page.goto(`/projects/${project.id}/stages/contract/confirmation`);
  await expect(page.getByRole("heading", { name: "尚无可确认的文档" })).toBeVisible();
  await expect(page.getByLabel("待确认招标文件")).toHaveCount(0);
});
