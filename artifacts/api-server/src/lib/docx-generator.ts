/**
 * Word Document Generator
 * Generates properly formatted RTL Arabic .docx files from OCR results.
 *
 * Supports:
 *  - Plain Arabic / mixed text paragraphs
 *  - Markdown tables (| col | col |) → real Word tables
 *  - Image description tags ([صورة: …]) → styled italic captions
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageOrientation,
  SectionType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from "docx";

export interface DocxGenerateOptions {
  title: string;
  filename: string;
  text: string;
  confidenceScore: number;
  qualityLevel: string;
  processedAt: Date;
}

// ---------------------------------------------------------------------------
// Content block types
// ---------------------------------------------------------------------------

type TextBlock   = { kind: "text";  lines: string[] };
type TableBlock  = { kind: "table"; headers: string[]; rows: string[][] };
type ImageBlock  = { kind: "image"; description: string };

type ContentBlock = TextBlock | TableBlock | ImageBlock;

// ---------------------------------------------------------------------------
// Parser: text → structured blocks
// ---------------------------------------------------------------------------

/**
 * Parse Markdown table row into cells.
 * "| خلية 1 | خلية 2 |" → ["خلية 1", "خلية 2"]
 */
function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")   // strip leading |
    .replace(/\|$/, "")   // strip trailing |
    .split("|")
    .map((c) => c.trim());
}

/** Return true if line is a Markdown table separator row (|---|---| etc.) */
function isTableSeparator(line: string): boolean {
  return /^\|[-:\s|]+\|$/.test(line.trim());
}

/** Return true if line is a Markdown table data/header row */
function isTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

/** Return true if line is an image description tag */
function isImageLine(line: string): boolean {
  return /^\[صورة:/.test(line.trim());
}

/**
 * Parse the full text into a sequence of content blocks:
 *  - Consecutive table rows → one TableBlock
 *  - [صورة: …] lines → ImageBlock
 *  - Everything else → TextBlock (consecutive non-table lines)
 */
function parseContentBlocks(text: string): ContentBlock[] {
  const rawLines = text.split("\n");
  const blocks: ContentBlock[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // ── Image description ─────────────────────────────────────────────────
    if (isImageLine(line)) {
      const match = line.trim().match(/^\[صورة:\s*(.+)\]$/);
      const description = match ? match[1].trim() : line.trim().replace(/^\[صورة:\s*/, "").replace(/\]$/, "");
      blocks.push({ kind: "image", description });
      i++;
      continue;
    }

    // ── Markdown table ────────────────────────────────────────────────────
    if (isTableRow(line)) {
      const tableLines: string[] = [];
      while (i < rawLines.length && (isTableRow(rawLines[i]) || isTableSeparator(rawLines[i]))) {
        tableLines.push(rawLines[i]);
        i++;
      }

      // First non-separator row = header, rest = data rows
      const nonSepLines = tableLines.filter((l) => !isTableSeparator(l));
      if (nonSepLines.length >= 1) {
        const [headerLine, ...dataLines] = nonSepLines;
        blocks.push({
          kind: "table",
          headers: parseTableRow(headerLine),
          rows: dataLines.map(parseTableRow),
        });
      }
      continue;
    }

    // ── Plain text ────────────────────────────────────────────────────────
    const textLines: string[] = [];
    while (
      i < rawLines.length &&
      !isTableRow(rawLines[i]) &&
      !isImageLine(rawLines[i])
    ) {
      textLines.push(rawLines[i]);
      i++;
    }
    if (textLines.some((l) => l.trim().length > 0)) {
      blocks.push({ kind: "text", lines: textLines });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// DOCX element builders
// ---------------------------------------------------------------------------

const FONT = "Arial";
const RTL_PARA_PROPS = {
  alignment: AlignmentType.RIGHT,
  bidirectional: true,
};

/** Shared thin border for table cells */
const THIN_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "AAAAAA",
};

const TABLE_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideH: THIN_BORDER,
  insideV: THIN_BORDER,
};

/**
 * Build a Word Table from parsed headers + data rows.
 * Columns are distributed equally; RTL direction preserved.
 */
function buildWordTable(headers: string[], rows: string[][]): Table {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  const colWidthPct = Math.floor(100 / colCount);

  const makeCell = (text: string, isHeader = false): TableCell =>
    new TableCell({
      width: { size: colWidthPct, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      shading: isHeader
        ? { type: ShadingType.CLEAR, fill: "E8F0FE" }
        : { type: ShadingType.CLEAR, fill: "FFFFFF" },
      children: [
        new Paragraph({
          ...RTL_PARA_PROPS,
          children: [
            new TextRun({
              text: text || "",
              font: FONT,
              size: 22,
              rtl: true,
              bold: isHeader,
            }),
          ],
        }),
      ],
    });

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => makeCell(h, true)),
  });

  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: Array.from({ length: colCount }, (_, ci) =>
          makeCell(row[ci] ?? ""),
        ),
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

/**
 * Build an image caption paragraph.
 * Styled as italic, subdued colour with a camera icon prefix.
 */
function buildImageCaption(description: string): Paragraph {
  return new Paragraph({
    ...RTL_PARA_PROPS,
    children: [
      new TextRun({
        text: `📷 ${description}`,
        font: FONT,
        size: 20,
        rtl: true,
        italics: true,
        color: "555577",
      }),
    ],
  });
}

/**
 * Convert a TextBlock into Word Paragraph elements.
 */
function buildTextParagraphs(lines: string[]): Paragraph[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(
      (line) =>
        new Paragraph({
          ...RTL_PARA_PROPS,
          children: [
            new TextRun({
              text: line,
              font: FONT,
              size: 24,
              rtl: true,
            }),
          ],
        }),
    );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateDocx(options: DocxGenerateOptions): Promise<Buffer> {
  const { title, filename, text, confidenceScore, qualityLevel, processedAt } = options;

  // Parse structured content
  const blocks = parseContentBlocks(text);

  // Build DOCX children
  const bodyChildren: (Paragraph | Table)[] = [];

  for (const block of blocks) {
    if (block.kind === "text") {
      bodyChildren.push(...buildTextParagraphs(block.lines));
    } else if (block.kind === "table") {
      // Add a small spacing paragraph before table
      bodyChildren.push(new Paragraph({ children: [] }));
      bodyChildren.push(buildWordTable(block.headers, block.rows));
      bodyChildren.push(new Paragraph({ children: [] }));
    } else if (block.kind === "image") {
      bodyChildren.push(buildImageCaption(block.description));
    }
  }

  const qualityLabel =
    qualityLevel === "high" ? "عالية" : qualityLevel === "medium" ? "متوسطة" : "منخفضة";

  const doc = new Document({
    creator: "منظومة رقمنة الوثائق",
    title,
    description: `وثيقة مستخرجة بنظام التعرف الضوئي على الحروف - درجة الثقة: ${confidenceScore}%`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 24, rtl: true },
        },
      },
    },
    sections: [
      {
        properties: {
          type: SectionType.CONTINUOUS,
          page: { size: { orientation: PageOrientation.PORTRAIT } },
        },
        children: [
          // ── Header ─────────────────────────────────────────────────────
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({ text: "وثيقة مُرقمَّنة", bold: true, size: 32, rtl: true, font: FONT }),
            ],
          }),

          // ── Metadata ───────────────────────────────────────────────────
          new Paragraph({
            ...RTL_PARA_PROPS,
            children: [
              new TextRun({ text: `اسم الملف: ${filename}`, size: 20, rtl: true, font: FONT, color: "666666" }),
            ],
          }),
          new Paragraph({
            ...RTL_PARA_PROPS,
            children: [
              new TextRun({
                text: `تاريخ المعالجة: ${processedAt.toLocaleDateString("ar-SA")}`,
                size: 20, rtl: true, font: FONT, color: "666666",
              }),
            ],
          }),
          new Paragraph({
            ...RTL_PARA_PROPS,
            children: [
              new TextRun({
                text: `درجة الثقة: ${confidenceScore}% | مستوى الجودة: ${qualityLabel}`,
                size: 20, rtl: true, font: FONT, color: "444444", bold: true,
              }),
            ],
          }),

          // ── Divider ────────────────────────────────────────────────────
          new Paragraph({
            children: [new TextRun({ text: "─".repeat(60), color: "CCCCCC" })],
          }),
          new Paragraph({ children: [] }),

          // ── Main content ───────────────────────────────────────────────
          ...bodyChildren,

          // ── Footer ─────────────────────────────────────────────────────
          new Paragraph({ children: [] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({
                text: "تم إنتاج هذه الوثيقة بواسطة منظومة رقمنة الوثائق الداخلية",
                size: 16, italics: true, color: "999999", rtl: true, font: FONT,
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
