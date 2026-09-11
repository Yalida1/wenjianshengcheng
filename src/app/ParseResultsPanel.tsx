import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  apiError,
  type FieldDefinition,
  type FieldValue,
  type FileRecord,
} from "../api/client";
import { fieldHasEvidence } from "../lib/tenderWorkflow";
import { ErrorNotice } from "./Auth";
import { Card, StatusBadge } from "./Shell";

type ParseJob = {
  id: string;
  status: string;
  needs_ocr: boolean;
  error: string | null;
  file_version_id: string;
};

type ParseBlock = {
  id: string;
  sequence: number;
  kind: string;
  text: string;
  page_number: number | null;
  section_path: string | null;
  locator: unknown;
};

type ParseTable = {
  id: string;
  sequence: number;
  rows: unknown;
  locator: unknown;
};

type ParseResultPayload = {
  parse_job_id: string;
  status: string;
  needs_ocr: boolean;
  parsed_document_id: string | null;
  metadata: Record<string, unknown>;
  blocks: ParseBlock[];
  tables: ParseTable[];
};

const FIELD_ORDER: Record<string, string[]> = {
  demand: ["project_name", "project_owner", "construction_scope", "project_period", "project_location"],
  requirement: ["project_name", "project_owner", "construction_scope", "project_period", "project_location"],
  feasibility: ["project_name", "construction_scope", "project_period", "total_investment", "project_location"],
  tender: ["project_name", "procurement_scope", "procurement_budget", "maximum_price"],
  contract: ["party_a", "party_b", "contract_subject", "final_contract_amount"],
};

const CRITICALITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

const VALUE_STATUSES = new Set([
  "extracted",
  "ai_suggested",
  "user_confirmed",
  "system_authoritative",
  "template_default",
]);

function asTableRows(rows: unknown): string[][] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (Array.isArray(row)) return row.map((cell) => String(cell ?? ""));
    if (row && typeof row === "object") {
      return Object.values(row as Record<string, unknown>).map((cell) => String(cell ?? ""));
    }
    return [String(row ?? "")];
  });
}

function metadataSummaryLine(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  for (const key of ["summary", "document_summary", "llm_summary", "title"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function blockKindLabel(kind: string): string {
  const map: Record<string, string> = {
    heading: "标题",
    title: "标题",
    paragraph: "段落",
    list: "列表",
    list_item: "列表项",
    table: "表格",
    caption: "题注",
    footnote: "脚注",
    header: "页眉",
    footer: "页脚",
  };
  return map[kind] || kind || "正文";
}

type OutlineContentItem =
  | { type: "block"; block: ParseBlock }
  | { type: "table"; table: ParseTable; index: number; blockId?: string };

type OutlineNode = {
  id: string;
  level: number;
  title: string;
  headingBlock?: ParseBlock;
  children: OutlineNode[];
  content: OutlineContentItem[];
};

type FocusTarget = {
  blockId?: string | null;
  excerpt?: string | null;
  valueText?: string | null;
  sectionPath?: string | null;
  nonce: number;
};

type EvidenceRef = {
  document_block_id?: string | null;
  excerpt?: string | null;
  section_path?: string | null;
  source_file_id?: string | null;
  page_number?: number | null;
};

function readLocator(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function headingLevel(block: ParseBlock): number | null {
  if (block.kind === "heading" || block.kind === "title") {
    const locator = readLocator(block.locator);
    const raw = locator.heading_level;
    const level = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(level) && level > 0) return Math.min(Math.floor(level), 6);
    if (block.section_path) {
      const depth = block.section_path.split("/").filter(Boolean).length;
      return Math.max(1, Math.min(depth || 1, 6));
    }
    return 1;
  }
  return inferredStructuralLevel(block.text);
}

/** Display-only: promote common Chinese/numbered chapter lines into outline headings. */
function inferredStructuralLevel(text: string): number | null {
  const line = text.trim();
  if (!line || line.length > 80 || line.includes("\n")) return null;
  if (/^第[一二三四五六七八九十百千零〇0-9]+章\b/.test(line)) return 1;
  if (/^第[一二三四五六七八九十百千零〇0-9]+节\b/.test(line)) return 2;
  if (/^第[一二三四五六七八九十百千零〇0-9]+条\b/.test(line)) return 3;
  if (/^[一二三四五六七八九十]+[、．.]\s*\S/.test(line)) return 2;
  if (/^（[一二三四五六七八九十]+）\s*\S/.test(line) || /^\([一二三四五六七八九十]+\)\s*\S/.test(line)) {
    return 3;
  }
  if (/^\d+(\.\d+){2,}\s+\S/.test(line)) return 3;
  if (/^\d+\.\d+\s+\S/.test(line)) return 2;
  if (/^\d+[\s、．.]\s*\S/.test(line) && !/^\d+[年月日]/.test(line)) return 1;
  return null;
}

function matchTableForBlock(
  block: ParseBlock,
  tables: ParseTable[],
  used: Set<string>,
): ParseTable | undefined {
  const locator = readLocator(block.locator);
  const tableId = typeof locator.table_id === "string" ? locator.table_id : null;
  if (tableId) {
    const byLocator = tables.find((table) => {
      if (used.has(table.id)) return false;
      const tableLocator = readLocator(table.locator);
      return tableLocator.table_id === tableId || tableLocator.block_id === locator.block_id;
    });
    if (byLocator) return byLocator;
  }
  const bySequence = tables.find((table) => !used.has(table.id) && table.sequence === block.sequence);
  if (bySequence) return bySequence;
  return undefined;
}

function buildDocumentOutline(blocks: ParseBlock[], tables: ParseTable[]): OutlineNode {
  const root: OutlineNode = {
    id: "root",
    level: 0,
    title: "全文",
    children: [],
    content: [],
  };
  const stack: OutlineNode[] = [root];
  const usedTables = new Set<string>();
  let tableIndex = 0;

  for (const block of blocks) {
    const level = headingLevel(block);
    if (level != null) {
      while (stack.length > 1 && stack[stack.length - 1]!.level >= level) {
        stack.pop();
      }
      const node: OutlineNode = {
        id: block.id,
        level,
        title: block.text.trim() || "未命名章节",
        headingBlock: block,
        children: [],
        content: [],
      };
      stack[stack.length - 1]!.children.push(node);
      stack.push(node);
      continue;
    }

    const current = stack[stack.length - 1]!;
    if (block.kind === "table") {
      const matched = matchTableForBlock(block, tables, usedTables);
      if (matched) {
        usedTables.add(matched.id);
        tableIndex += 1;
        current.content.push({
          type: "table",
          table: matched,
          index: tableIndex,
          blockId: block.id,
        });
      } else if (block.text.trim()) {
        current.content.push({ type: "block", block });
      }
      continue;
    }
    current.content.push({ type: "block", block });
  }

  for (const table of tables) {
    if (usedTables.has(table.id)) continue;
    tableIndex += 1;
    root.content.push({ type: "table", table, index: tableIndex });
  }

  return root;
}

function collectOutlineEntries(
  node: OutlineNode,
  acc: Array<{ id: string; title: string; level: number }> = [],
): Array<{ id: string; title: string; level: number }> {
  for (const child of node.children) {
    acc.push({ id: child.id, title: child.title, level: child.level });
    collectOutlineEntries(child, acc);
  }
  return acc;
}

function countOutlineBlocks(node: OutlineNode): number {
  let total = node.content.length;
  for (const child of node.children) total += countOutlineBlocks(child);
  return total;
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").trim().toLowerCase();
}

function resolveBlockIdFromFocus(
  blocks: ParseBlock[],
  focus: FocusTarget | null,
): string | null {
  if (!focus) return null;
  if (focus.blockId && blocks.some((block) => block.id === focus.blockId)) {
    return focus.blockId;
  }

  const excerpt = normalizeMatchText(focus.excerpt);
  if (excerpt) {
    const exact = blocks.find((block) => normalizeMatchText(block.text) === excerpt);
    if (exact) return exact.id;
    const partial = blocks.find((block) => {
      const text = normalizeMatchText(block.text);
      return text.includes(excerpt) || excerpt.includes(text);
    });
    if (partial) return partial.id;
  }

  const valueText = normalizeMatchText(focus.valueText);
  if (valueText && valueText.length >= 2) {
    const hit = blocks.find((block) => normalizeMatchText(block.text).includes(valueText));
    if (hit) return hit.id;
  }

  const sectionPath = (focus.sectionPath ?? "").trim();
  if (sectionPath) {
    const leaf = sectionPath.split("/").filter(Boolean).at(-1);
    if (leaf) {
      const heading = blocks.find(
        (block) =>
          (block.kind === "heading" || block.kind === "title") &&
          normalizeMatchText(block.text) === normalizeMatchText(leaf),
      );
      if (heading) return heading.id;
      const byPath = blocks.find((block) => block.section_path === sectionPath);
      if (byPath) return byPath.id;
    }
  }

  return null;
}

function findBlockAncestors(
  node: OutlineNode,
  blockId: string,
  trail: string[] = [],
): string[] | null {
  if (node.headingBlock?.id === blockId) {
    return node.level === 0 ? [] : [...trail, node.id];
  }
  for (const item of node.content) {
    if (item.type === "block" && item.block.id === blockId) {
      return trail;
    }
    if (item.type === "table" && (item.blockId === blockId || item.table.id === blockId)) {
      return trail;
    }
  }
  for (const child of node.children) {
    const childTrail = node.level === 0 ? [] : [...trail, node.id];
    const found = findBlockAncestors(child, blockId, childTrail);
    if (found) return found;
  }
  return null;
}

function collectSectionIdsToExpand(outline: OutlineNode, blockId: string): string[] {
  return findBlockAncestors(outline, blockId) ?? [];
}

function TableBlockView({
  table,
  index,
  blockId,
  highlighted,
}: {
  table: ParseTable;
  index: number;
  blockId?: string;
  highlighted?: boolean;
}) {
  const rows = asTableRows(table.rows);
  return (
    <div
      id={blockId ? `parse-block-${blockId}` : `parse-table-${table.id}`}
      className={`my-4 scroll-mt-28 overflow-x-auto rounded-lg border transition ${
        highlighted
          ? "border-amber-400 bg-amber-50 ring-2 ring-amber-300"
          : "border-slate-200"
      }`}
    >
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
        表格 {index}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-500">表格无可用行数据</div>
      ) : (
        <table className="min-w-full text-left text-sm">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${table.id}-${rowIndex}`} className="border-t border-slate-100">
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${table.id}-${rowIndex}-${cellIndex}`}
                    className={`px-3 py-2 align-top text-slate-800 ${
                      rowIndex === 0 ? "bg-slate-50/80 font-medium text-slate-900" : ""
                    }`}
                  >
                    {cell || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OutlineSection({
  node,
  collapsed,
  onToggle,
  highlightedBlockId,
}: {
  node: OutlineNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  highlightedBlockId: string | null;
}) {
  if (node.level === 0) {
    return (
      <div className="space-y-6">
        {node.content.length > 0 && (
          <section className="space-y-3 border-b border-slate-100 pb-6">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">文首</h4>
            <OutlineContent items={node.content} highlightedBlockId={highlightedBlockId} />
          </section>
        )}
        {node.children.map((child) => (
          <OutlineSection
            key={child.id}
            node={child}
            collapsed={collapsed}
            onToggle={onToggle}
            highlightedBlockId={highlightedBlockId}
          />
        ))}
      </div>
    );
  }

  const isCollapsed = collapsed.has(node.id);
  const childCount = countOutlineBlocks(node);
  const headingHighlighted = Boolean(
    highlightedBlockId && node.headingBlock?.id === highlightedBlockId,
  );
  const headingClass =
    node.level <= 1
      ? "text-xl font-semibold text-slate-900"
      : node.level === 2
        ? "text-lg font-semibold text-slate-900"
        : "text-base font-semibold text-slate-800";

  return (
    <section
      id={`parse-section-${node.id}`}
      className={`scroll-mt-24 rounded-lg ${
        headingHighlighted ? "bg-amber-50 ring-2 ring-amber-300" : ""
      }`}
      style={{ marginLeft: Math.max(0, node.level - 1) * 12 }}
    >
      <div
        id={node.headingBlock ? `parse-block-${node.headingBlock.id}` : undefined}
        className="flex items-start gap-2 border-b border-slate-100 pb-2"
      >
        <button
          type="button"
          className="mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-expanded={!isCollapsed}
          aria-controls={`parse-section-body-${node.id}`}
          title={isCollapsed ? "展开章节" : "折叠章节"}
          onClick={() => onToggle(node.id)}
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`size-4 transition ${isCollapsed ? "-rotate-90" : ""}`}
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h4 className={headingClass}>{node.title}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>第 {node.level} 级标题</span>
            {typeof node.headingBlock?.page_number === "number" && (
              <span>第 {node.headingBlock.page_number} 页</span>
            )}
            <span>{childCount} 项内容</span>
          </div>
        </div>
      </div>
      {!isCollapsed && (
        <div id={`parse-section-body-${node.id}`} className="mt-3 space-y-4">
          <OutlineContent items={node.content} highlightedBlockId={highlightedBlockId} />
          {node.children.map((child) => (
            <OutlineSection
              key={child.id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              highlightedBlockId={highlightedBlockId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function OutlineContent({
  items,
  highlightedBlockId,
}: {
  items: OutlineContentItem[];
  highlightedBlockId: string | null;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => {
        if (item.type === "table") {
          return (
            <TableBlockView
              key={item.table.id}
              table={item.table}
              index={item.index}
              blockId={item.blockId}
              highlighted={Boolean(
                highlightedBlockId &&
                  (item.blockId === highlightedBlockId || item.table.id === highlightedBlockId),
              )}
            />
          );
        }
        const { block } = item;
        const highlighted = highlightedBlockId === block.id;
        return (
          <div
            key={block.id}
            id={`parse-block-${block.id}`}
            className={`group scroll-mt-28 rounded-md px-2 py-1 transition ${
              highlighted ? "bg-amber-50 ring-2 ring-amber-300" : ""
            }`}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 opacity-0 transition group-hover:opacity-100">
              <span>{blockKindLabel(block.kind)}</span>
              {typeof block.page_number === "number" && <span>第 {block.page_number} 页</span>}
            </div>
            <p
              className={`whitespace-pre-wrap text-sm leading-7 text-slate-800 ${
                block.kind === "list" || block.kind === "list_item" ? "pl-3" : ""
              }`}
            >
              {block.text || "（空）"}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function DocumentStructureView({
  blocks,
  tables,
  focusTarget,
}: {
  blocks: ParseBlock[];
  tables: ParseTable[];
  focusTarget: FocusTarget | null;
}) {
  const outline = useMemo(() => buildDocumentOutline(blocks, tables), [blocks, tables]);
  const toc = useMemo(() => collectOutlineEntries(outline), [outline]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [tocOpen, setTocOpen] = useState(true);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    // Deep sections (level >= 3) start collapsed to keep long documents scannable.
    const initial = new Set<string>();
    for (const entry of collectOutlineEntries(outline)) {
      if (entry.level >= 3) initial.add(entry.id);
    }
    setCollapsed(initial);
    setTocOpen(toc.length > 0);
    initializedRef.current = true;
  }, [outline, toc.length]);

  useEffect(() => {
    if (!focusTarget || !initializedRef.current) return;
    const blockId = resolveBlockIdFromFocus(blocks, focusTarget);
    if (!blockId) return;

    const ancestors = collectSectionIdsToExpand(outline, blockId);
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const id of ancestors) next.delete(id);
      // Also expand the section itself if the target is nested content under a collapsed node
      // ancestors already includes section chain to the content parent.
      return next;
    });
    setHighlightedBlockId(blockId);

    const timer = window.setTimeout(() => {
      const el =
        document.getElementById(`parse-block-${blockId}`) ??
        document.getElementById(`parse-section-${blockId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);

    const clearHighlight = window.setTimeout(() => {
      setHighlightedBlockId((current) => (current === blockId ? null : current));
    }, 4200);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearHighlight);
    };
  }, [blocks, focusTarget, outline]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseDeep = () => {
    const next = new Set<string>();
    for (const entry of toc) {
      if (entry.level >= 2) next.add(entry.id);
    }
    setCollapsed(next);
  };

  if (toc.length === 0 && outline.content.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 space-y-4">
      {toc.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <button
              type="button"
              className="text-sm font-medium text-slate-800"
              onClick={() => setTocOpen((open) => !open)}
            >
              文件目录（{toc.length}）
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="secondary-button !min-h-8 !px-3 !py-1 text-xs" onClick={expandAll}>
                全部展开
              </button>
              <button
                type="button"
                className="secondary-button !min-h-8 !px-3 !py-1 text-xs"
                onClick={collapseDeep}
              >
                仅看大节
              </button>
            </div>
          </div>
          {tocOpen && (
            <nav aria-label="解析结果目录" className="max-h-64 overflow-y-auto px-2 py-2">
              <ul className="space-y-0.5">
                {toc.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#parse-section-${entry.id}`}
                      className="block rounded-md px-2 py-1.5 text-sm text-slate-700 transition hover:bg-white hover:text-[#12345B]"
                      style={{ paddingLeft: 8 + (entry.level - 1) * 14 }}
                    >
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 sm:px-6">
        <OutlineSection
          node={outline}
          collapsed={collapsed}
          onToggle={toggle}
          highlightedBlockId={highlightedBlockId}
        />
      </div>
    </div>
  );
}

function formatFieldDisplayValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => formatFieldDisplayValue(item))
      .filter(Boolean)
      .join("、");
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function fieldStatusMeta(status: string | undefined, hasValue: boolean) {
  if (!hasValue || !status || status === "missing" || status === "not_applicable") {
    return { label: "未识别", className: "bg-slate-100 text-slate-500" };
  }
  if (status === "user_confirmed" || status === "system_authoritative") {
    return { label: "已确认", className: "bg-emerald-50 text-emerald-700" };
  }
  if (status === "ai_suggested") {
    return { label: "AI 建议", className: "bg-violet-50 text-violet-700" };
  }
  if (status === "conflict" || status === "invalid") {
    return { label: status === "conflict" ? "有冲突" : "需复核", className: "bg-amber-50 text-amber-800" };
  }
  if (status === "extracted" || status === "template_default" || status === "reference_only") {
    return { label: "已提取", className: "bg-blue-50 text-blue-700" };
  }
  return { label: status, className: "bg-slate-100 text-slate-600" };
}

function criticalityBadge(criticality: string, required: boolean) {
  if (criticality === "P0" || required) {
    return { label: "必需", className: "bg-red-50 text-red-700" };
  }
  if (criticality === "P1") {
    return { label: "重要", className: "bg-amber-50 text-amber-800" };
  }
  return { label: "参考", className: "bg-slate-100 text-slate-600" };
}

function pickPreferredValue(
  values: FieldValue[],
  fieldKey: string,
  selectedFileId: string,
): FieldValue | undefined {
  const matched = values.filter((item) => item.field_key === fieldKey);
  if (matched.length === 0) return undefined;
  const withValue = matched.filter(
    (item) =>
      VALUE_STATUSES.has(item.status) &&
      formatFieldDisplayValue(item.normalized_value ?? item.value),
  );
  const pool = withValue.length > 0 ? withValue : matched;
  if (selectedFileId) {
    const fromFile = pool.find((item) =>
      item.evidence?.some((evidence) => evidence.source_file_id === selectedFileId),
    );
    if (fromFile) return fromFile;
  }
  return (
    pool.find((item) => item.status === "user_confirmed") ??
    pool.find((item) => item.status === "extracted" || item.status === "ai_suggested") ??
    pool[0]
  );
}

function FieldSummaryPanel({
  projectId,
  stage,
  selectedFileId,
  canExtract,
  onLocateEvidence,
}: {
  projectId: string;
  stage: string;
  selectedFileId: string;
  canExtract: boolean;
  onLocateEvidence?: (payload: {
    evidence?: EvidenceRef;
    display: string;
  }) => void;
}) {
  const queryClient = useQueryClient();
  const definitions = useQuery({
    queryKey: ["field-definitions", stage, false],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-definitions", {
        params: { query: { stage, include_inactive: false } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as FieldDefinition[];
    },
  });
  const fieldValues = useQuery({
    queryKey: ["field-values", projectId, stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/field-values", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as FieldValue[];
    },
  });

  const extractCandidates = useMutation({
    mutationFn: async (fileId: string) => {
      const result = await api.POST("/api/v1/files/{file_id}/field-candidates", {
        params: { path: { file_id: fileId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["field-values", projectId, stage] });
    },
  });

  const orderedDefinitions = useMemo(() => {
    const order = FIELD_ORDER[stage] ?? [];
    return [...(definitions.data ?? [])].sort((left, right) => {
      const leftOrder = order.indexOf(left.field_key);
      const rightOrder = order.indexOf(right.field_key);
      const leftRank = leftOrder < 0 ? 999 : leftOrder;
      const rightRank = rightOrder < 0 ? 999 : rightOrder;
      if (leftRank !== rightRank) return leftRank - rightRank;
      const critDiff =
        (CRITICALITY_RANK[left.criticality] ?? 9) - (CRITICALITY_RANK[right.criticality] ?? 9);
      if (critDiff !== 0) return critDiff;
      return left.field_label.localeCompare(right.field_label, "zh-CN");
    });
  }, [definitions.data, stage]);

  const rows = useMemo(
    () =>
      orderedDefinitions.map((definition) => {
        const value = pickPreferredValue(fieldValues.data ?? [], definition.field_key, selectedFileId);
        const display = formatFieldDisplayValue(value?.normalized_value ?? value?.value);
        const fromSelectedFile = Boolean(
          selectedFileId &&
            value?.evidence?.some((evidence) => evidence.source_file_id === selectedFileId),
        );
        const evidenceList = value?.evidence ?? [];
        const evidence =
          evidenceList.find(
            (item) =>
              (!selectedFileId || item.source_file_id === selectedFileId) &&
              (item.document_block_id || item.excerpt || item.section_path),
          ) ??
          evidenceList.find((item) => item.document_block_id || item.excerpt || item.section_path) ??
          (fieldHasEvidence(value) ? evidenceList[0] : undefined);
        const canLocate = Boolean(
          display &&
            (evidence?.document_block_id ||
              evidence?.excerpt ||
              evidence?.section_path ||
              display.length >= 2),
        );
        return { definition, value, display, fromSelectedFile, evidence, canLocate };
      }),
    [fieldValues.data, orderedDefinitions, selectedFileId],
  );

  const filledCount = rows.filter((row) => row.display).length;
  const requiredMissing = rows.filter((row) => row.definition.required && !row.display).length;

  return (
    <Card className="flex max-h-[calc(100vh-7.5rem)] flex-col overflow-hidden p-0 shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <h3 className="text-base font-semibold text-slate-900">关键字段摘要</h3>
              {orderedDefinitions.length > 0 && (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    已识别
                    <span className="tabular-nums text-slate-900">
                      {filledCount}/{orderedDefinitions.length}
                    </span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      requiredMissing > 0
                        ? "bg-amber-50 text-amber-800"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    必需待补
                    <span className="tabular-nums">{requiredMissing}</span>
                  </span>
                </>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              点击已提取字段，可在左侧解析结果中定位对应正文位置。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canExtract || !selectedFileId || extractCandidates.isPending}
              title="按当前材料重新提取字段，不会覆盖人工确认值"
              onClick={() => selectedFileId && extractCandidates.mutate(selectedFileId)}
            >
              {extractCandidates.isPending ? "提取中…" : "重新提取"}
            </button>
            <Link
              to="/field-dictionary"
              className="rounded-md px-2 py-1 text-xs font-medium text-[#2E5495] transition hover:bg-slate-50"
              title="打开动态字段提取"
            >
              管理字段
            </Link>
          </div>
        </div>
        {extractCandidates.error && (
          <div className="mt-3">
            <ErrorNotice error={extractCandidates.error} />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {(definitions.isLoading || fieldValues.isLoading) && (
          <div className="py-8 text-center text-sm text-slate-500">正在汇总字段…</div>
        )}
        {(definitions.error || fieldValues.error) && (
          <ErrorNotice error={definitions.error || fieldValues.error} />
        )}

        {!definitions.isLoading && !definitions.error && orderedDefinitions.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center">
            <p className="text-sm text-slate-600">本阶段还没有启用中的动态字段。</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              在「动态字段提取」配置或恢复基础字段后，解析命中的项目名称、建设范围等关键内容会显示在这里。
            </p>
            <Link className="primary-button mt-4 inline-flex" to="/field-dictionary">
              去配置动态字段
            </Link>
          </div>
        )}

        {rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map(({ definition, value, display, fromSelectedFile, evidence, canLocate }) => {
              const status = fieldStatusMeta(value?.status, Boolean(display));
              const level = criticalityBadge(definition.criticality, definition.required);
              const body = (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-900">{definition.field_label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${level.className}`}>
                      {level.label}
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}>
                      {status.label}
                    </span>
                    {fromSelectedFile && (
                      <span className="rounded-full bg-[#12345B]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#12345B]">
                        当前材料
                      </span>
                    )}
                    {canLocate && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        可定位
                      </span>
                    )}
                  </div>
                  {display ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                      {display}
                      {definition.unit ? (
                        <span className="ml-1 text-xs text-slate-400">{definition.unit}</span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">正文中尚未识别到该字段</p>
                  )}
                  {evidence?.excerpt && evidence.excerpt.trim() !== display.trim() && (
                    <blockquote className="mt-2 border-l-2 border-slate-200 pl-2 text-xs leading-5 text-slate-500">
                      {evidence.excerpt}
                    </blockquote>
                  )}
                </>
              );

              return (
                <li key={definition.id}>
                  {canLocate ? (
                    <button
                      type="button"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-[#155AA8] hover:bg-blue-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#155AA8]"
                      title="在解析结果中定位出处"
                      onClick={() =>
                        onLocateEvidence?.({
                          evidence,
                          display,
                        })
                      }
                    >
                      {body}
                    </button>
                  ) : (
                    <div
                      className={`rounded-xl border px-3 py-3 ${
                        display
                          ? "border-slate-200 bg-white"
                          : "border-dashed border-slate-200 bg-slate-50/70"
                      }`}
                    >
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function ParseResultsPanel({ projectId, stage }: { projectId: string; stage: string }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileIdFromQuery = searchParams.get("fileId") || "";
  const [selectedFileId, setSelectedFileId] = useState(fileIdFromQuery);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const focusNonce = useRef(0);

  const files = useQuery({
    queryKey: ["files", projectId, stage],
    queryFn: async () => {
      const result = await api.GET("/api/v1/files", {
        params: { query: { project_id: projectId, stage } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as FileRecord[];
    },
  });

  const parsedFiles = useMemo(
    () => (files.data ?? []).filter((file) => file.status === "parsed" || file.status === "needs_ocr"),
    [files.data],
  );

  useEffect(() => {
    if (parsedFiles.length === 0) {
      setSelectedFileId("");
      return;
    }
    if (fileIdFromQuery && parsedFiles.some((file) => file.id === fileIdFromQuery)) {
      setSelectedFileId(fileIdFromQuery);
      return;
    }
    if (selectedFileId && parsedFiles.some((file) => file.id === selectedFileId)) return;
    setSelectedFileId(parsedFiles[0].id);
  }, [fileIdFromQuery, parsedFiles, selectedFileId]);

  const selectFile = (fileId: string) => {
    setSelectedFileId(fileId);
    const next = new URLSearchParams(searchParams);
    if (fileId) next.set("fileId", fileId);
    else next.delete("fileId");
    setSearchParams(next, { replace: true });
  };

  const locateEvidence = (payload: { evidence?: EvidenceRef; display: string }) => {
    const evidence = payload.evidence;
    if (evidence?.source_file_id && evidence.source_file_id !== selectedFileId) {
      const exists = parsedFiles.some((file) => file.id === evidence.source_file_id);
      if (exists) selectFile(evidence.source_file_id);
    }
    focusNonce.current += 1;
    setFocusTarget({
      blockId: evidence?.document_block_id ?? null,
      excerpt: evidence?.excerpt ?? null,
      valueText: payload.display || null,
      sectionPath: evidence?.section_path ?? null,
      nonce: focusNonce.current,
    });
  };

  const parseJobs = useQuery({
    queryKey: ["parse-jobs", selectedFileId],
    enabled: Boolean(selectedFileId),
    queryFn: async () => {
      const result = await api.GET("/api/v1/files/{file_id}/parse-jobs", {
        params: { path: { file_id: selectedFileId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data as ParseJob[];
    },
  });

  const latestJob = useMemo(() => {
    const jobs = parseJobs.data ?? [];
    const ready = jobs.find((job) => job.status === "succeeded" || job.status === "needs_ocr");
    return ready ?? jobs[0] ?? null;
  }, [parseJobs.data]);

  const parseResult = useQuery({
    queryKey: ["parse-result", latestJob?.id],
    enabled: Boolean(latestJob && (latestJob.status === "succeeded" || latestJob.status === "needs_ocr")),
    queryFn: async () => {
      const result = await api.GET("/api/v1/parse-jobs/{parse_job_id}/result", {
        params: { path: { parse_job_id: latestJob!.id } },
      });
      if (result.error) throw apiError(result.error, result.response);
      const data = result.data as ParseResultPayload;
      return {
        ...data,
        blocks: Array.isArray(data.blocks) ? data.blocks : [],
        tables: Array.isArray(data.tables) ? data.tables : [],
        metadata: (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<
          string,
          unknown
        >,
      };
    },
  });

  const retry = useMutation({
    mutationFn: async (parseJobId: string) => {
      const result = await api.POST("/api/v1/parse-jobs/{parse_job_id}/retry", {
        params: { path: { parse_job_id: parseJobId } },
      });
      if (result.error) throw apiError(result.error, result.response);
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parse-jobs", selectedFileId] });
      void queryClient.invalidateQueries({ queryKey: ["parse-result"] });
      void queryClient.invalidateQueries({ queryKey: ["files", projectId, stage] });
    },
  });

  const selectedFile = parsedFiles.find((file) => file.id === selectedFileId);
  const blocks = [...(parseResult.data?.blocks ?? [])].sort((a, b) => a.sequence - b.sequence);
  const tables = [...(parseResult.data?.tables ?? [])].sort((a, b) => a.sequence - b.sequence);
  const summaryLine = metadataSummaryLine(parseResult.data?.metadata);
  const parseReady = Boolean(
    latestJob && (latestJob.status === "succeeded" || latestJob.status === "needs_ocr") && parseResult.data,
  );

  if (files.isLoading) {
    return (
      <Card>
        <div className="text-sm text-slate-500">正在加载解析结果…</div>
      </Card>
    );
  }

  if (files.error) {
    return (
      <Card>
        <ErrorNotice error={files.error} />
      </Card>
    );
  }

  if (parsedFiles.length === 0) {
    return (
      <Card>
        <h3 className="section-title">解析结果</h3>
        <p className="section-description mt-2">
          本阶段还没有已解析的材料。请先在「文件材料」上传并完成解析，再回来查看提取出的正文与表格。
        </p>
        <Link className="primary-button mt-5 inline-flex" to={`/projects/${projectId}/stages/${stage}/files`}>
          前往文件材料
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="section-title">解析结果</h3>
            <p className="section-description mt-1">
              按文件标题层级查看解析正文与表格；可用目录跳转章节。右侧汇总「动态字段提取」对应的关键内容。
            </p>
            {parsedFiles.length > 1 ? (
              <label className="form-label mt-4 block max-w-xl">
                选择材料
                <select
                  className="form-input mt-2"
                  value={selectedFileId}
                  onChange={(event) => selectFile(event.target.value)}
                >
                  {parsedFiles.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.original_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="mt-3 text-sm text-slate-700">
                当前文件：<span className="font-medium text-slate-900">{selectedFile?.original_name}</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {latestJob && <StatusBadge status={latestJob.status} />}
            {parseResult.data?.needs_ocr && (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">需 OCR 复核</span>
            )}
            <Link className="secondary-button" to={`/projects/${projectId}/stages/${stage}/files`}>
              返回文件材料
            </Link>
          </div>
        </div>

        {(parseJobs.isLoading || parseResult.isLoading) && (
          <div className="mt-5 text-sm text-slate-500">正在加载解析正文…</div>
        )}
        {(parseJobs.error || parseResult.error || retry.error) && (
          <div className="mt-4">
            <ErrorNotice error={parseJobs.error || parseResult.error || retry.error} />
          </div>
        )}

        {latestJob && latestJob.status !== "succeeded" && latestJob.status !== "needs_ocr" && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            当前解析任务状态为「{latestJob.status}」
            {latestJob.error ? `：${latestJob.error}` : "。"}
            {(latestJob.status === "failed" || latestJob.status === "needs_ocr") && (
              <button
                type="button"
                className="secondary-button mt-3"
                disabled={retry.isPending}
                onClick={() => retry.mutate(latestJob.id)}
              >
                {retry.isPending ? "正在重试…" : "重试解析"}
              </button>
            )}
          </div>
        )}

        {parseResult.data && (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                [
                  "章节/标题",
                  blocks.filter((block) => headingLevel(block) != null).length,
                ],
                [
                  "正文块",
                  blocks.filter(
                    (block) => headingLevel(block) == null && block.kind !== "table",
                  ).length,
                ],
                ["表格", tables.length || blocks.filter((block) => block.kind === "table").length],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">{label}</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
                </div>
              ))}
            </div>

            {summaryLine && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                <div className="text-xs font-medium text-slate-500">摘要</div>
                <p className="mt-1 whitespace-pre-wrap">{summaryLine}</p>
              </div>
            )}

            {blocks.length === 0 && tables.length === 0 ? (
              <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                已完成解析任务，但未提取到可见正文块。可能是扫描件需 OCR，或版式未能识别。可返回文件材料重试解析。
                {latestJob && (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(latestJob.id)}
                    >
                      {retry.isPending ? "正在重试…" : "重试解析"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <DocumentStructureView blocks={blocks} tables={tables} focusTarget={focusTarget} />
            )}
          </>
        )}
      </Card>

      <aside className="lg:sticky lg:top-20">
        <FieldSummaryPanel
          projectId={projectId}
          stage={stage}
          selectedFileId={selectedFileId}
          canExtract={parseReady}
          onLocateEvidence={locateEvidence}
        />
      </aside>
    </div>
  );
}
