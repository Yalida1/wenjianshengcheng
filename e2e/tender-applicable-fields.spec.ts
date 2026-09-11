import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { api, login } from "./helpers";

const fixtureDir = path.resolve("test-results", "procurement-fixtures");
const fixturePath = path.join(fixtureDir, "适用字段切换样例.docx");

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
    "d.add_paragraph('项目名称：适用字段切换验收项目')",
    "d.add_paragraph('独立主招标文件：业务应用软件建设招标文件|应用软件建设范围|可独立交付与验收')",
    "d.add_paragraph('采购包：P1|应用软件采购包|业务应用软件开发、部署和培训')",
    "d.add_paragraph('独立主招标文件：基础设施设备采购招标文件|基础设施设备范围|设备可独立供货验收')",
    "d.add_paragraph('采购包：P2|基础设施设备包|服务器及网络设备供货')",
    "d.add_paragraph('总投资：330万元')",
    "d.save(sys.argv[1])",
  ].join(";");
  execFileSync(python, ["-c", script, fixturePath]);
});

test("字段确认页切换待编制文件后适用字段集合变化且远少于全量目录", async ({ page }) => {
  await login(page);
  const project = await api<{ id: string }>(page, "POST", "/api/v1/projects", {
    code: `AF-UI-${Date.now()}`,
    name: "适用字段切换验收项目",
    description: "脱敏合成材料，仅用于适用字段切换验收",
  });

  const catalog = await api<Array<{ field_key: string }>>(
    page,
    "GET",
    "/api/v1/field-definitions?stage=tender",
  );
  expect(catalog.length).toBeGreaterThan(20);

  await page.goto(`/projects/${project.id}/stages/tender/files`);
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.getByRole("button", { name: "上传并解析" }).click();
  await expect(page.getByText(/材料解析完成，已识别本项目需要编制/)).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByText(/需要编制 2 份文件/)).toBeVisible();

  const applicable = await api<{
    groups: Array<{
      document_group_id: string;
      profile: string;
      resolution_source: string;
      fields: Array<{ field_key: string; required: boolean; label: string }>;
    }>;
  }>(page, "GET", `/api/v1/projects/${project.id}/stages/tender/applicable-fields`);
  expect(applicable.groups.length).toBe(2);
  const [groupA, groupB] = applicable.groups;
  const keysA = new Set(groupA.fields.map((item) => item.field_key));
  const keysB = new Set(groupB.fields.map((item) => item.field_key));
  expect(keysA.size).toBeLessThan(catalog.length);
  expect(keysB.size).toBeLessThan(catalog.length);
  expect(keysA.size).toBeLessThan(35);
  expect(keysB.size).toBeLessThan(35);
  expect([...keysA].sort().join(",")).not.toEqual([...keysB].sort().join(","));

  await page.getByRole("link", { name: "前往字段确认" }).click();
  const select = page.getByLabel("待编制文件");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveCount(2);

  await select.selectOption({ index: 0 });
  await expect(page.getByText(/需要确认 \d+ 项/)).toBeVisible();
  const keysShownA = await page.locator(".divide-y .text-xs.text-slate-400").allTextContents();
  expect(keysShownA.length).toBe(groupA.fields.length);
  expect(keysShownA.length).toBeLessThan(catalog.length);

  await select.selectOption({ index: 1 });
  await expect(page.getByText(/需要确认 \d+ 项/)).toBeVisible();
  const keysShownB = await page.locator(".divide-y .text-xs.text-slate-400").allTextContents();
  expect(keysShownB.length).toBe(groupB.fields.length);
  expect(keysShownA.join("|")).not.toEqual(keysShownB.join("|"));

  // Confirm only B's required applicable fields via API; UI status for B becomes 已完成, A does not.
  const definitions = await api<
    Array<{
      field_key: string;
      field_label: string;
      data_type: string;
      unit: string | null;
      criticality: "P0" | "P1" | "P2";
    }>
  >(page, "GET", "/api/v1/field-definitions?stage=tender");
  const definitionByKey = new Map(definitions.map((item) => [item.field_key, item]));
  const tenderValues: Record<string, unknown> = {
    project_name: "适用字段切换验收项目",
    package_number: "P2",
    procurement_scope: "基础设施设备供货",
    procurement_budget: 1_000_000,
    maximum_price: 950_000,
    procurement_list: "服务器与交换机",
    technical_specifications: "满足招标技术规格",
    delivery_period: "60日历天",
    delivery_location: "银川市",
    installation_requirements: "完成安装调试",
    acceptance_criteria: "到货验收合格",
    warranty_requirements: "质保36个月",
    qualification_requirements: "依法设立",
    bid_bond: "本项目不要求投标保证金",
    data_security_requirements: "按等保要求实施",
    payment_terms: "到货后支付",
  };
  for (const field of groupB.fields.filter((item) => item.required)) {
    const definition = definitionByKey.get(field.field_key);
    if (!definition) continue;
    const value = tenderValues[field.field_key] ?? `确认-${field.field_key}`;
    const targetKey = `doc::${groupB.document_group_id}::${field.field_key}`;
    const evidence =
      field.field_key === "bid_bond"
        ? {
            excerpt: "采购方案明确本包不收取投标保证金",
            extraction_method: "manual",
            section_path: "投标保证金确认依据",
          }
        : null;
    const created = await api<{ id: string; revision: number }>(
      page,
      "POST",
      `/api/v1/field-values?project_id=${project.id}&stage=tender`,
      {
        field_key: targetKey,
        field_label: field.label || definition.field_label,
        data_type: definition.data_type,
        value,
        normalized_value: value,
        unit: definition.unit,
        criticality: definition.criticality,
        status: "missing",
        source_type: "user_input",
        confidence: null,
        evidence,
      },
    );
    await api(page, "POST", `/api/v1/field-values/${created.id}/confirm`, {
      revision: created.revision,
      evidence_acknowledged: false,
    });
  }

  await page.reload();
  await expect(select).toBeVisible();
  await expect(select.locator(`option[value="${groupB.document_group_id}"]`)).toContainText(
    "已完成",
  );
  await expect(select.locator(`option[value="${groupA.document_group_id}"]`)).not.toContainText(
    "已完成",
  );
  await expect(page.getByText("1/2")).toBeVisible();
});
