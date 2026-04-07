/**
 * StructuredOcrText
 *
 * Renders OCR refined text that may contain:
 *  - Plain Arabic text paragraphs
 *  - Markdown tables (| col | col |) → styled HTML tables
 *  - Image description tags ([صورة: description]) → captioned image placeholders
 */

import React from "react";

// ── Helpers ────────────────────────────────────────────────────────────────

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

function isTableSeparator(line: string): boolean {
  return /^\|[-:|\s]+\|$/.test(line.trim());
}

function isImageLine(line: string): boolean {
  return /^\[صورة:/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

// ── Content block types ────────────────────────────────────────────────────

type TextBlock  = { kind: "text";  content: string };
type TableBlock = { kind: "table"; headers: string[]; rows: string[][] };
type ImageBlock = { kind: "image"; description: string };
type Block = TextBlock | TableBlock | ImageBlock;

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isImageLine(line)) {
      const m = line.trim().match(/^\[صورة:\s*(.+?)\]?$/);
      const desc = m ? m[1].replace(/\]$/, "").trim() : line.trim();
      blocks.push({ kind: "image", description: desc });
      i++;
      continue;
    }

    if (isTableRow(line) && !isTableSeparator(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && (isTableRow(lines[i]) || isTableSeparator(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      const nonSep = tableLines.filter((l) => !isTableSeparator(l));
      if (nonSep.length >= 1) {
        const [header, ...rest] = nonSep;
        blocks.push({ kind: "table", headers: parseTableRow(header), rows: rest.map(parseTableRow) });
      }
      continue;
    }

    // Accumulate plain text lines
    const textLines: string[] = [];
    while (
      i < lines.length &&
      !isImageLine(lines[i]) &&
      !(isTableRow(lines[i]) && !isTableSeparator(lines[i]))
    ) {
      textLines.push(lines[i]);
      i++;
    }
    const content = textLines.join("\n").trim();
    if (content) {
      blocks.push({ kind: "text", content });
    }
  }

  return blocks;
}

// ── Sub-renderers ─────────────────────────────────────────────────────────

function RenderTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));

  return (
    <div className="overflow-x-auto my-3" dir="rtl">
      <table className="w-full text-sm border-collapse border border-border rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-primary/10">
            {Array.from({ length: colCount }, (_, ci) => (
              <th
                key={ci}
                className="border border-border px-3 py-2 text-right font-semibold text-primary"
              >
                {headers[ci] ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-muted/20" : "bg-background"}>
              {Array.from({ length: colCount }, (_, ci) => (
                <td key={ci} className="border border-border px-3 py-1.5 text-right">
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenderImageCaption({ description }: { description: string }) {
  return (
    <div className="flex items-start gap-2 my-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800" dir="rtl">
      <span className="text-lg shrink-0">🖼️</span>
      <div>
        <p className="text-xs font-semibold text-amber-600 mb-0.5">صورة / رسم</p>
        <p className="text-sm leading-relaxed font-arabic">{description}</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  text: string;
  className?: string;
  highlightQuery?: string;
}

function highlightText(text: string, query?: string): string {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`(${escaped})`, "gi"),
    '<mark class="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">$1</mark>',
  );
}

export function StructuredOcrText({ text, className = "", highlightQuery }: Props) {
  const blocks = parseBlocks(text);

  return (
    <div className={`font-arabic leading-relaxed ${className}`} dir="rtl">
      {blocks.map((block, bi) => {
        if (block.kind === "table") {
          return <RenderTable key={bi} headers={block.headers} rows={block.rows} />;
        }
        if (block.kind === "image") {
          return <RenderImageCaption key={bi} description={block.description} />;
        }
        // Plain text — preserve whitespace, optionally highlight query
        return (
          <p
            key={bi}
            className="text-sm whitespace-pre-wrap mb-2 text-right"
            dangerouslySetInnerHTML={{
              __html: highlightText(
                block.content
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;"),
                highlightQuery,
              ),
            }}
          />
        );
      })}
    </div>
  );
}
