/**
 * OCR Engine Module
 *
 * Real OCR processing using Tesseract.js (WASM) with Arabic language support.
 * - Pre-processing: ImageMagick denoising + binarization + deskew
 * - Tesseract PSM 6 (uniform block) + LSTM engine (OEM 1)
 * - Arabic post-processing: repairs Alef-Lam splits and common OCR artifacts
 */

import { createWorker } from "tesseract.js";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { readdir, rm } from "fs/promises";
import { join, extname, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { logger } from "./logger";
import { runGeminiOcr } from "./ocr-engine-ai";
import { runAzureOcr, isAzureConfigured } from "./ocr-engine-azure";

// OCR_ENGINE env var:
//   "gemini"  → Gemini Vision (الافتراضي)
//   "azure"   → Azure OpenAI GPT-4o
const OCR_ENGINE = process.env.OCR_ENGINE ?? "gemini";
logger.info({ OCR_ENGINE }, "ocr-engine: selected AI engine");

const execAsync = promisify(exec);

/**
 * Resolve the absolute path of a CLI binary.
 * Strategy:
 *   1. Try `which` with the server's current PATH.
 *   2. Retry with supplemental Nix profile directories appended to PATH
 *      (covers deployments where /run/current-system/sw/bin isn't in PATH).
 *   3. Fall back to the bare name (last resort).
 */
function resolveToolPath(name: string): string {
  const tryWhich = (env: NodeJS.ProcessEnv): string | null => {
    try {
      const result = execSync(`which ${name}`, { encoding: "utf8", env }).trim();
      return result || null;
    } catch {
      return null;
    }
  };

  const found = tryWhich(process.env as NodeJS.ProcessEnv)
    ?? tryWhich({
      ...process.env,
      PATH: [
        "/run/current-system/sw/bin",
        "/home/runner/.nix-profile/bin",
        "/nix/var/nix/profiles/default/bin",
        process.env.PATH ?? "",
      ].join(":"),
    });

  if (!found) {
    logger.warn({ name }, "resolveToolPath: binary not found via which — falling back to bare name");
  }
  return found ?? name;
}

const PDFTOPPM_BIN = resolveToolPath("pdftoppm");
const CONVERT_BIN  = resolveToolPath("convert");

logger.info({ PDFTOPPM_BIN, CONVERT_BIN }, "ocr-engine: resolved tool paths");

export interface OcrWord {
  word: string;
  confidence: number;
  position: number;
}

export interface OcrPassResult {
  text: string;
  words: OcrWord[];
  avgConfidence: number;
}

export interface OcrEngineResult {
  rawText: string;
  refinedText: string;
  confidenceScore: number;
  qualityLevel: "high" | "medium" | "low";
  wordCount: number;
  lowConfidenceWords: OcrWord[];
  passCount: number;
  processingNotes: string;
  processingDurationMs: number;
}

// Absolute path to this package's root (works regardless of process.cwd())
// import.meta.url resolves to the bundle file (dist/index.mjs) at runtime.
const __packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Uploads directory — always an absolute path so it's CWD-independent
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(__packageRoot, "uploads");

logger.info({ UPLOADS_DIR }, "ocr-engine: uploads directory");

// Temp directory for PDF-extracted and preprocessed images
const OCR_TMP_DIR = join(tmpdir(), "ocr-pages");
if (!existsSync(OCR_TMP_DIR)) {
  mkdirSync(OCR_TMP_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Image pre-processing (ImageMagick)
// ---------------------------------------------------------------------------

/**
 * Pre-process an image to maximise OCR accuracy:
 * 1. Convert to grayscale
 * 2. Apply unsharp-mask to recover fine strokes
 * 3. Adaptive threshold (binarise) → crisp black text on white
 * 4. Deskew up to ±5°
 * 5. Output at 300 DPI
 */
async function preprocessImage(inputPath: string, outputPath: string): Promise<void> {
  // Build ImageMagick command
  // -colorspace Gray        → greyscale
  // -contrast-stretch 0     → normalize intensity range
  // -unsharp 0x1            → sharpen strokes
  // -threshold 50%          → hard binarize
  // -deskew 40%             → auto-deskew up to ±10°
  // -density 300            → set DPI metadata
  const cmd = [
    `"${CONVERT_BIN}"`,
    `"${inputPath}"`,
    "-colorspace", "Gray",
    "-contrast-stretch", "0",
    "-unsharp", "0x1",
    "-threshold", "50%",
    "-deskew", "40%",
    "+repage",
    "-density", "300",
    `"${outputPath}"`,
  ].join(" ");

  try {
    await execAsync(cmd);
  } catch (err) {
    // If preprocessing fails fall back to original image
    logger.warn({ err, inputPath }, "Image preprocessing failed, using original");
    await execAsync(`cp "${inputPath}" "${outputPath}"`);
  }
}

// ---------------------------------------------------------------------------
// PDF → images
// ---------------------------------------------------------------------------

async function pdfToImages(pdfPath: string, jobId: string): Promise<string[]> {
  const outDir = join(OCR_TMP_DIR, jobId, "raw");
  mkdirSync(outDir, { recursive: true });
  const outPrefix = join(outDir, "page");

  // 300 DPI PNG
  await execAsync(`"${PDFTOPPM_BIN}" -r 300 -png "${pdfPath}" "${outPrefix}"`);

  const files = await readdir(outDir);
  const pngs = files
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => join(outDir, f));

  return pngs;
}

async function cleanupTmpDir(jobId: string): Promise<void> {
  const outDir = join(OCR_TMP_DIR, jobId);
  try {
    await rm(outDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// Arabic post-processing
// ---------------------------------------------------------------------------

// Arabic Unicode ranges for detection
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Return fraction of characters that are Arabic in a given string.
 */
function arabicRatio(str: string): number {
  if (!str.length) return 0;
  let count = 0;
  for (const ch of str) {
    if (ARABIC_RE.test(ch)) count++;
  }
  return count / str.length;
}

/**
 * For a line that is predominantly Arabic (ratio > threshold), strip any
 * Latin letter sequences that are NOT part of a recognisable English word
 * context (i.e. surrounded by Arabic characters).
 *
 * This removes diacritics that Tesseract mis-reads as Latin letters when
 * the ara+eng model is active.
 */
function cleanArabicLine(line: string, threshold = 0.4): string {
  const ratio = arabicRatio(line);
  if (ratio < threshold) {
    // Line is mostly Latin/mixed — keep as-is (e.g. English abstract)
    return line;
  }

  let result = line;

  // Remove RTL/LTR embedding marks and their Latin payload
  // e.g. ‎Gh‏ ‎Soll‏ (Tesseract wraps mis-read Arabic in bidi marks)
  result = result.replace(/[\u200E\u200F\u202A-\u202E][^\u200E\u200F\u202A-\u202E\n]{0,25}[\u200E\u200F\u202A-\u202E]/g, "");

  // Remove remaining bidi / directional marks
  result = result.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u206F\uFEFF\u061C]/g, "");

  // Strip Latin sequences (1–8 chars) that appear WITHIN Arabic context:
  // i.e. preceded OR followed by an Arabic character (directly or across a space)
  // These are tashkeel / diacritics being read as Latin letters.
  result = result.replace(
    /(?<=[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s])[a-zA-Z]{1,8}(?=[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s.,;:!؟،؛])/g,
    "",
  );

  return result;
}

/**
 * Returns true when a line is part of a Markdown table (starts with "|")
 * or is a Markdown table separator (e.g. "|---|---|").
 * Also returns true for image description lines "[صورة: ...]".
 * These lines must NOT be modified by Arabic OCR error-fixing routines.
 */
function isStructuredLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("|") ||                       // table row
    /^\|[-:| ]+\|$/.test(trimmed) ||                // separator row
    /^\[صورة:/.test(trimmed)                         // image description
  );
}

/**
 * Fix the most common Tesseract Arabic OCR errors.
 *
 * Patterns:
 *  • Bidi marks wrapping Latin noise (Tesseract diacritic mis-read) → removed
 *  • Latin letters embedded in Arabic lines (tashkeel read as Latin) → removed
 *  • "| ل"  → "ال"   (Alef written as pipe, then separated from Lam)
 *  • "وا ل" → "وال"  (Waw-Alef split from Lam)
 *  • Alef variant normalisation
 *
 * NOTE: Lines that are Markdown table rows or image descriptions are skipped
 * entirely so that the "|" characters and structured tags are preserved.
 */
function fixArabicOcrErrors(text: string): string {
  // ── Step 1: Process line-by-line to remove Arabic-context Latin noise ────
  // Skip lines that are table rows or image descriptions.
  const lines = text.split("\n");
  const cleanedLines = lines.map((line) =>
    isStructuredLine(line) ? line : cleanArabicLine(line),
  );
  let t = cleanedLines.join("\n");

  // ── Step 2: Remaining Unicode control / directional marks ────────────────
  // Apply only to non-structured lines to preserve | in tables.
  t = t
    .split("\n")
    .map((line) => {
      if (isStructuredLine(line)) return line;
      return line.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u206F\uFEFF\u061C]/g, "");
    })
    .join("\n");

  // ── Step 3: Alef-Lam repairs (Tesseract artifact) ─────────────────────────
  // Only apply to lines that are NOT table rows (pipe is a cell separator there).
  t = t
    .split("\n")
    .map((line) => {
      if (isStructuredLine(line)) return line;
      let l = line;
      l = l.replace(/\|\s+ل/g, "ال");   // "| ل"  →  "ال"
      l = l.replace(/\|\s+ا/g, "ال");   // "| ا"  →  "ال"
      l = l.replace(/(?<=\s)\|(?=\s)/g, "ا");  // lone pipe → alef
      l = l.replace(/^\|(?=\s)/g, "ا");         // pipe at start → alef
      l = l.replace(/ا\s+ل(?=[^\s])/g, "ال");  // "ا ل"  →  "ال"
      l = l.replace(/\|\s+لـ/g, "الـ");         // "| لـ" → "الـ"
      return l;
    })
    .join("\n");

  // ── Step 4: Prefix particle splits ───────────────────────────────────────
  t = t
    .split("\n")
    .map((line) => {
      if (isStructuredLine(line)) return line;
      let l = line;
      l = l.replace(/وا\s+ل(?=[^\s])/g, "وال");
      l = l.replace(/فا\s+ل(?=[^\s])/g, "فال");
      l = l.replace(/با\s+ل(?=[^\s])/g, "بال");
      l = l.replace(/كا\s+ل(?=[^\s])/g, "كال");
      return l;
    })
    .join("\n");

  // ── Step 5: Lam-Alef ligature fixes ──────────────────────────────────────
  t = t.replace(/[ﻻﻼ]/g, "لا");
  t = t.replace(/[ﻷﻸ]/g, "لأ");
  t = t.replace(/[ﻹﻺ]/g, "لإ");

  // ── Step 6: Common whole-word noise removal ───────────────────────────────
  // Only remove on lines that are primarily Arabic; skip structured lines.
  t = t
    .split("\n")
    .map((line) => {
      if (isStructuredLine(line)) return line;
      if (arabicRatio(line) < 0.3) return line;
      // Remove isolated single Latin letters left after previous pass
      return line.replace(/(?<![a-zA-Z])[a-zA-Z](?![a-zA-Z])/g, "").replace(/\s{2,}/g, " ");
    })
    .join("\n");

  // ── Step 7: Whitespace normalisation ─────────────────────────────────────
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/[ \t]+$/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}

// ---------------------------------------------------------------------------
// Minimal post-processing for Gemini output
// ---------------------------------------------------------------------------

/**
 * Light cleanup for Gemini OCR output.
 * Gemini produces clean text, Markdown tables and [IMAGE] markers.
 * We must NOT apply Tesseract-specific repairs (Alef-Lam, pipe→alef, etc.)
 * as those would corrupt the table format.
 *
 * Only safe operations:
 *  1. Remove invisible Unicode control / directional marks from non-structured lines
 *  2. Collapse excessive blank lines (≥3 → 2)
 *  3. Trim trailing spaces per line
 */
function fixGeminiOutput(text: string): string {
  const CONTROL_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u206F\uFEFF\u061C]/g;

  const cleaned = text
    .split("\n")
    .map((line) => {
      if (isStructuredLine(line)) return line;           // preserve table rows / [IMAGE]
      return line.replace(CONTROL_RE, "").trimEnd();     // safe cleanup only
    })
    .join("\n");

  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Tesseract worker (cached, serial)
// ---------------------------------------------------------------------------

let cachedWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let workerBusy = false;

async function getWorker() {
  if (!cachedWorker) {
    logger.info("Initialising Tesseract.js worker (Arabic + English, LSTM)");
    cachedWorker = await createWorker(["ara", "eng"], 1, {
      logger: () => {},
      langPath: process.env.TESSDATA_PREFIX ?? undefined,
    });

    // PSM 6 = Assume a single uniform block of text
    // OEM 1 = LSTM neural network only (most accurate)
    await cachedWorker.setParameters({
      tessedit_ocr_engine_mode: "1",   // OEM_LSTM_ONLY
      tessedit_pageseg_mode: "6",      // PSM_SINGLE_BLOCK
      preserve_interword_spaces: "0",  // collapse internal spaces
    });

    logger.info("Tesseract.js worker ready");
  }
  return cachedWorker;
}

async function ocrImage(
  imagePath: string,
): Promise<{ text: string; words: OcrWord[]; avgConfidence: number }> {
  while (workerBusy) {
    await new Promise((r) => setTimeout(r, 200));
  }
  workerBusy = true;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(imagePath);

    const text = data.text ?? "";

    const words: OcrWord[] = [];
    let posIdx = 0;

    if (data.words && data.words.length > 0) {
      for (const w of data.words) {
        if (w.text.trim()) {
          words.push({
            word: w.text.trim(),
            confidence: Math.round((w.confidence / 100) * 100) / 100,
            position: posIdx++,
          });
        }
      }
    } else {
      for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
        words.push({ word, confidence: data.confidence / 100, position: posIdx++ });
      }
    }

    const avgConfidence =
      words.length > 0
        ? words.reduce((s, w) => s + w.confidence, 0) / words.length
        : data.confidence / 100;

    return { text, words, avgConfidence };
  } finally {
    workerBusy = false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function processOcr(filename: string): Promise<OcrEngineResult> {
  const startTime = Date.now();
  const filePath = join(UPLOADS_DIR, filename);
  const ext = extname(filename).toLowerCase();
  const jobId = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9-]/g, "_")}`;

  logger.info({ filename, filePath }, "Starting OCR processing");

  if (!existsSync(filePath)) {
    throw new Error(`ملف الرفع غير موجود: ${filename}`);
  }

  let rawImagePaths: string[] = [];
  let cleanupNeeded = false;

  try {
    // ── Step 1: Resolve raw images ────────────────────────────────────────
    if (ext === ".pdf") {
      logger.info({ filename }, "Converting PDF pages to images at 300 DPI");
      rawImagePaths = await pdfToImages(filePath, jobId);
      cleanupNeeded = true;
      if (rawImagePaths.length === 0) {
        throw new Error("لم يتم استخراج أي صفحات من ملف PDF");
      }
      // Limit to 100 pages maximum
      rawImagePaths = rawImagePaths.slice(0, 100);
    } else {
      rawImagePaths = [filePath];
      cleanupNeeded = false;
    }

    // ── Step 2: Tmp dir for processed images ─────────────────────────────
    const prepDir = join(OCR_TMP_DIR, jobId, "prep");
    mkdirSync(prepDir, { recursive: true });
    cleanupNeeded = true;

    // ── Step 3: AI OCR (Gemini or Azure GPT-4o) ──────────────────────────
    let combinedRaw = "";
    let usedEngine: "gemini" | "azure" | "tesseract" = "gemini";
    let pageCount = rawImagePaths.length;
    let usedModel = "";

    const useAzure = OCR_ENGINE === "azure" && isAzureConfigured();

    try {
      if (useAzure) {
        logger.info({ filename, pages: rawImagePaths.length }, "Running Azure GPT-4o OCR");
        const aiResult = await runAzureOcr(rawImagePaths, prepDir);
        combinedRaw = aiResult.rawText;
        pageCount = aiResult.pages;
        usedModel = aiResult.model;
        usedEngine = "azure";
        logger.info({ filename, pages: pageCount, durationMs: aiResult.durationMs, model: aiResult.model }, "Azure GPT-4o OCR completed");
      } else {
        logger.info({ filename, pages: rawImagePaths.length }, "Running Gemini AI OCR");
        const aiResult = await runGeminiOcr(rawImagePaths, prepDir);
        combinedRaw = aiResult.rawText;
        pageCount = aiResult.pages;
        usedModel = aiResult.model;
        usedEngine = "gemini";
        logger.info({ filename, pages: pageCount, durationMs: aiResult.durationMs, model: aiResult.model }, "Gemini OCR completed");
      }
    } catch (aiErr) {
      // AI failed — fall back to Tesseract
      logger.warn({ aiErr, filename, engine: useAzure ? "azure" : "gemini" }, "AI OCR failed, falling back to Tesseract");
      usedEngine = "tesseract";

      const processedPaths: string[] = [];
      for (let i = 0; i < rawImagePaths.length; i++) {
        const outPath = join(prepDir, `page_${String(i).padStart(4, "0")}.png`);
        await preprocessImage(rawImagePaths[i], outPath);
        processedPaths.push(outPath);
      }

      const pageResults: Array<{ text: string; words: OcrWord[]; avgConfidence: number }> = [];
      for (const imgPath of processedPaths) {
        pageResults.push(await ocrImage(imgPath));
      }
      combinedRaw = pageResults.map((p) => p.text).join("\n\n");
      pageCount = processedPaths.length;
    }

    // ── Step 4: Post-process ──────────────────────────────────────────────
    // Gemini produces clean Arabic + Markdown tables — use minimal cleanup.
    // Tesseract needs full error-correction (Alef-Lam repairs, bidi strips, etc.)
    const rawText = combinedRaw;
    const isAiEngine = usedEngine === "gemini" || usedEngine === "azure";
    const refinedText = isAiEngine
      ? fixGeminiOutput(combinedRaw)
      : fixArabicOcrErrors(combinedRaw);

    // ── Step 5: Word list & confidence ────────────────────────────────────
    const wordList = refinedText
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((word, position): OcrWord => ({ word, confidence: 0.92, position }));

    // AI engines don't give per-word confidence; use 92 for AI, 75 for Tesseract
    const confidenceScore = isAiEngine ? 92 : 75;
    const lowConfidenceWords: OcrWord[] = [];

    // ── Step 6: Quality assessment ────────────────────────────────────────
    let qualityLevel: "high" | "medium" | "low";
    let processingNotes: string;

    if (usedEngine === "azure") {
      qualityLevel = "high";
      processingNotes = `تمت المعالجة بواسطة Azure OpenAI GPT-4o بدقة عالية — ${pageCount} صفحة.${pageCount >= 100 ? " (تم الوصول للحد الأقصى 100 صفحة)" : ""}`;
    } else if (usedEngine === "gemini") {
      qualityLevel = "high";
      processingNotes = `تمت المعالجة بواسطة الذكاء الاصطناعي (Gemini Vision) بدقة عالية — ${pageCount} صفحة.${pageCount >= 100 ? " (تم الوصول للحد الأقصى 100 صفحة)" : ""}`;
    } else if (confidenceScore >= 55) {
      qualityLevel = "medium";
      processingNotes = "تمت المعالجة بـ Tesseract (احتياطي). يُنصح بمراجعة النص.";
    } else {
      qualityLevel = "low";
      processingNotes = "جودة الصورة منخفضة. يُنصح بإعادة المسح بدقة أعلى (600 DPI).";
    }

    const processingDurationMs = Date.now() - startTime;

    logger.info(
      { filename, confidenceScore, qualityLevel, wordCount: wordList.length, pages: pageCount, engine: usedEngine, processingDurationMs },
      "OCR processing completed",
    );

    return {
      rawText,
      refinedText,
      confidenceScore,
      qualityLevel,
      wordCount: wordList.length,
      lowConfidenceWords,
      passCount: pageCount,
      processingNotes,
      processingDurationMs,
    };
  } finally {
    if (cleanupNeeded) {
      await cleanupTmpDir(jobId);
    }
  }
}
