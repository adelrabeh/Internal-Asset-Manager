/**
 * Word Document Generator
 * Generates properly formatted RTL Arabic .docx files from OCR results.
 *
 * Supports:
 *  - Plain Arabic / mixed text paragraphs
 *  - Markdown tables (| col | col |) → real Word tables
 *  - [IMAGE] markers → actual embedded images extracted from the source file
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
  ImageRun,
} from "docx";
import { readFile, mkdtemp, rm, readdir } from "fs/promises";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { join, extname } from "path";
import { tmpdir } from "os";
import { logger } from "./logger";

const execAsync = promisify(exec);

// Resolve tool paths once at startup so they work regardless of which PATH
// the workflow runner injects into the Node process.
function resolveToolPath(name: string): string {
  try {
    return execSync(`which ${name}`, { encoding: "utf8" }).trim() || name;
  } catch {
    return name;
  }
}

const PDFTOPPM_BIN = resolveToolPath("pdftoppm");
const CONVERT_BIN  = resolveToolPath("convert");
const IDENTIFY_BIN = resolveToolPath("identify");

logger.info({ PDFTOPPM_BIN, CONVERT_BIN, IDENTIFY_BIN }, "docx-generator: resolved tool paths");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocxGenerateOptions {
  title: string;
  filename: string;
  text: string;
  confidenceScore: number;
  qualityLevel: string;
  processedAt: Date;
  /** Full path to the original uploaded file (optional — enables image embedding) */
  sourceFilePath?: string;
}

// ---------------------------------------------------------------------------
// Image extraction helpers
// ---------------------------------------------------------------------------

interface PageImage {
  buffer: Buffer;
  width: number;
  height: number;
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"]);
const PDF_EXT   = ".pdf";

/**
 * Get image dimensions via ImageMagick `identify`.
 * Falls back to a default A4-like aspect ratio (595 × 842 pt).
 */
async function getImageDims(
  path: string,
): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execAsync(`"${IDENTIFY_BIN}" -format "%w %h" "${path}[0]"`);
    const [w, h] = stdout.trim().split(" ").map(Number);
    if (w > 0 && h > 0) return { width: w, height: h };
  } catch {
    // ignore — use default
  }
  return { width: 595, height: 842 };
}

/** Scale (origW × origH) so that width ≤ maxPx. */
function scaleToFit(
  origW: number,
  origH: number,
  maxPx = 520,
): { width: number; height: number } {
  if (origW <= maxPx) return { width: origW, height: origH };
  const ratio = maxPx / origW;
  return { width: maxPx, height: Math.round(origH * ratio) };
}

/**
 * Extract page images from the source file.
 * Returns an array of PageImage objects (one per page / one for image files).
 */
async function extractPageImages(
  sourceFilePath: string,
  tmpDir: string,
): Promise<PageImage[]> {
  const ext = extname(sourceFilePath).toLowerCase();

  if (ext === PDF_EXT) {
    // Convert PDF pages to JPEG at 150 DPI
    const prefix = join(tmpDir, "page");
    await execAsync(
      `"${PDFTOPPM_BIN}" -r 150 -jpeg "${sourceFilePath}" "${prefix}"`,
    );
    // Collect output files using Node.js readdir (no shell ls dependency)
    const allFiles = await readdir(tmpDir);
    const names = allFiles
      .filter((f) => f.startsWith("page-") && (f.endsWith(".jpg") || f.endsWith(".jpeg")))
      .sort();
    const images: PageImage[] = [];
    for (const name of names) {
      const imgPath = join(tmpDir, name);
      const dims    = await getImageDims(imgPath);
      const scaled  = scaleToFit(dims.width, dims.height);
      const buffer  = await readFile(imgPath);
      images.push({ buffer, ...scaled });
    }
    return images;
  }

  if (IMAGE_EXTS.has(ext)) {
    // Single image file → ensure it's JPEG for broadest docx compatibility
    const outPath = join(tmpDir, "source.jpg");
    await execAsync(`"${CONVERT_BIN}" "${sourceFilePath}" -quality 85 "${outPath}"`);
    const dims   = await getImageDims(outPath);
    const scaled = scaleToFit(dims.width, dims.height);
    const buffer = await readFile(outPath);
    return [{ buffer, ...scaled }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Content block types
// ---------------------------------------------------------------------------

type TextBlock   = { kind: "text";  lines: string[] };
type TableBlock  = { kind: "table"; headers: string[]; rows: string[][] };
type ImageBlock  = { kind: "image" };

type ContentBlock = TextBlock | TableBlock | ImageBlock;

// ---------------------------------------------------------------------------
// Parser: text → structured blocks
// ---------------------------------------------------------------------------

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|[-:\s|]+\|$/.test(line.trim());
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|");
}

function isImageMarker(line: string): boolean {
  return line.trim() === "[IMAGE]" || /^\[صورة/.test(line.trim());
}

function parseContentBlocks(text: string): ContentBlock[] {
  const rawLines = text.split("\n");
  const blocks: ContentBlock[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // ── Image marker ──────────────────────────────────────────────────────
    if (isImageMarker(line)) {
      blocks.push({ kind: "image" });
      i++;
      continue;
    }

    // ── Markdown table ────────────────────────────────────────────────────
    if (isTableRow(line)) {
      const tableLines: string[] = [];
      while (
        i < rawLines.length &&
        (isTableRow(rawLines[i]) || isTableSeparator(rawLines[i]))
      ) {
        tableLines.push(rawLines[i]);
        i++;
      }

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
      !isImageMarker(rawLines[i])
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

function buildWordTable(headers: string[], rows: string[][]): Table {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
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

function buildTextParagraphs(lines: string[]): Paragraph[] {
  return lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(
      (line) =>
        new Paragraph({
          ...RTL_PARA_PROPS,
          children: [
            new TextRun({ text: line, font: FONT, size: 24, rtl: true }),
          ],
        }),
    );
}

function buildImageParagraph(img: PageImage): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        data: img.buffer,
        transformation: { width: img.width, height: img.height },
        type: "jpg",
      }),
    ],
  });
}

function buildImagePlaceholder(): Paragraph {
  return new Paragraph({
    ...RTL_PARA_PROPS,
    children: [
      new TextRun({
        text: "[ صورة ]",
        font: FONT,
        size: 20,
        italics: true,
        color: "888888",
        rtl: true,
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateDocx(options: DocxGenerateOptions): Promise<Buffer> {
  const { title, filename, text, confidenceScore, qualityLevel, processedAt, sourceFilePath } = options;

  // Extract page images if source file is available
  let pageImages: PageImage[] = [];
  let tmpDir: string | null = null;

  if (sourceFilePath) {
    tmpDir = await mkdtemp(join(tmpdir(), "docx-img-"));
    try {
      pageImages = await extractPageImages(sourceFilePath, tmpDir);
      logger.info({ count: pageImages.length }, "Extracted page images for DOCX");
    } catch (err) {
      logger.warn({ err }, "Failed to extract page images for DOCX; continuing without images");
    }
  }

  try {
    return await buildDoc(title, filename, text, confidenceScore, qualityLevel, processedAt, pageImages);
  } finally {
    if (tmpDir) {
      rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function buildDoc(
  title: string,
  filename: string,
  text: string,
  confidenceScore: number,
  qualityLevel: string,
  processedAt: Date,
  pageImages: PageImage[],
): Promise<Buffer> {
  const blocks = parseContentBlocks(text);
  const bodyChildren: (Paragraph | Table)[] = [];

  // Track which [IMAGE] block we're on to assign the right page image
  let imageIndex = 0;

  for (const block of blocks) {
    if (block.kind === "text") {
      bodyChildren.push(...buildTextParagraphs(block.lines));
    } else if (block.kind === "table") {
      bodyChildren.push(new Paragraph({ children: [] }));
      bodyChildren.push(buildWordTable(block.headers, block.rows));
      bodyChildren.push(new Paragraph({ children: [] }));
    } else if (block.kind === "image") {
      const img = pageImages[imageIndex];
      imageIndex++;
      if (img) {
        bodyChildren.push(buildImageParagraph(img));
      } else {
        bodyChildren.push(buildImagePlaceholder());
      }
    }
  }

  // If there are page images but no [IMAGE] markers in text, append all images at the end
  if (imageIndex === 0 && pageImages.length > 0) {
    bodyChildren.push(new Paragraph({ children: [] }));
    for (const img of pageImages) {
      bodyChildren.push(buildImageParagraph(img));
      bodyChildren.push(new Paragraph({ children: [] }));
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
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({ text: "وثيقة مُرقمَّنة", bold: true, size: 32, rtl: true, font: FONT }),
            ],
          }),

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

          new Paragraph({
            children: [new TextRun({ text: "─".repeat(60), color: "CCCCCC" })],
          }),
          new Paragraph({ children: [] }),

          ...bodyChildren,

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
