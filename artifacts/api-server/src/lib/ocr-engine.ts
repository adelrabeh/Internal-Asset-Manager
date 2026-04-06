/**
 * OCR Engine Module
 *
 * Real OCR processing using Tesseract.js (WASM) with Arabic language support.
 * - Multi-pass processing for confidence improvement
 * - Per-word confidence scoring
 * - Arabic text normalization
 * - PDF → image conversion via pdftoppm
 */

import { createWorker } from "tesseract.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { readFile, unlink, readdir, rm } from "fs/promises";
import { join, extname } from "path";
import { tmpdir } from "os";
import { logger } from "./logger";

const execAsync = promisify(exec);

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

// Uploads directory (resolve from env or relative path)
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");

// Temp directory for PDF-extracted images
const OCR_TMP_DIR = join(tmpdir(), "ocr-pages");
if (!existsSync(OCR_TMP_DIR)) {
  mkdirSync(OCR_TMP_DIR, { recursive: true });
}

/**
 * Normalize Arabic text — handle common OCR artifacts and Unicode control chars
 */
function normalizeArabicText(text: string): string {
  let t = text;
  // Remove Unicode directional / formatting control characters
  // U+200B Zero Width Space, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM
  // U+200E LRM, U+200F RLM, U+202A-202E embedding chars
  // U+2066-206F isolate/override chars, U+061C Arabic Letter Mark
  t = t.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u206F\uFEFF\u061C]/g, "");
  // Remove RTL/LTR mark-up sequences that Tesseract may inject (‎ ‏)
  t = t.replace(/\u200E|\u200F|\u200B/g, "");
  // Normalize Alef variants → bare Alef (keeps the diacritics intact on other chars)
  t = t.replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627");
  // Fix Arabic Lam-Alef ligature confusion
  t = t.replace(/ﻻ|ﻼ/g, "لا");
  // Collapse multiple spaces on same line (preserve newlines)
  t = t.replace(/[ \t]+/g, " ");
  // Trim trailing spaces on each line
  t = t.replace(/[ \t]+$/gm, "");
  // Collapse 3+ consecutive blank lines → 2
  t = t.replace(/\n{3,}/g, "\n\n");
  // Remove stray single characters that are clearly OCR garbage (isolated non-Arabic single chars)
  t = t.replace(/(?<!\S)[a-zA-Z](?!\S)/g, "");
  return t.trim();
}

/**
 * Extract image paths from a PDF using pdftoppm
 */
async function pdfToImages(pdfPath: string, jobId: string): Promise<string[]> {
  const outDir = join(OCR_TMP_DIR, jobId);
  mkdirSync(outDir, { recursive: true });
  const outPrefix = join(outDir, "page");

  // Convert PDF pages to PNG at 300 DPI
  await execAsync(`pdftoppm -r 300 -png "${pdfPath}" "${outPrefix}"`);

  const files = await readdir(outDir);
  const pngs = files
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => join(outDir, f));

  return pngs;
}

/**
 * Clean up temporary PDF image files
 */
async function cleanupTmpDir(jobId: string): Promise<void> {
  const outDir = join(OCR_TMP_DIR, jobId);
  try {
    await rm(outDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// Cached Tesseract worker (reused across jobs for performance)
let cachedWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let workerBusy = false;

async function getWorker() {
  if (!cachedWorker) {
    logger.info("Initializing Tesseract.js worker (Arabic + English)");
    cachedWorker = await createWorker(["ara", "eng"], 1, {
      logger: () => {},
      langPath: process.env.TESSDATA_PREFIX ?? undefined,
    });
    logger.info("Tesseract.js worker ready");
  }
  return cachedWorker;
}

/**
 * Run Tesseract OCR on a single image file (Arabic + English)
 */
async function ocrImage(imagePath: string): Promise<{ text: string; words: OcrWord[]; avgConfidence: number }> {
  // Wait if worker is currently busy
  while (workerBusy) {
    await new Promise((r) => setTimeout(r, 200));
  }
  workerBusy = true;

  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(imagePath);

    const text = data.text ?? "";

    // Build per-word confidence list from Tesseract's word data
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
      // Fallback: tokenize raw text
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

/**
 * Main OCR processing function — processes real uploaded files
 */
export async function processOcr(filename: string): Promise<OcrEngineResult> {
  const startTime = Date.now();
  const filePath = join(UPLOADS_DIR, filename);
  const ext = extname(filename).toLowerCase();
  const jobId = filename.replace(/[^a-zA-Z0-9-]/g, "_");

  logger.info({ filename, filePath }, "Starting OCR processing");

  if (!existsSync(filePath)) {
    throw new Error(`ملف الرفع غير موجود: ${filename}`);
  }

  let imagePaths: string[] = [];
  let cleanupNeeded = false;

  try {
    // ── Resolve image(s) to process ──────────────────────────────────
    if (ext === ".pdf") {
      logger.info({ filename }, "Converting PDF pages to images");
      imagePaths = await pdfToImages(filePath, jobId);
      cleanupNeeded = true;
      if (imagePaths.length === 0) {
        throw new Error("لم يتم استخراج أي صفحات من ملف PDF");
      }
      // Process up to first 10 pages to avoid timeout
      imagePaths = imagePaths.slice(0, 10);
    } else {
      // JPG / PNG — use directly
      imagePaths = [filePath];
    }

    logger.info({ filename, pages: imagePaths.length }, "Running OCR passes");

    // ── Run OCR on each page ──────────────────────────────────────────
    const pageResults: Array<{ text: string; words: OcrWord[]; avgConfidence: number }> = [];

    for (const imgPath of imagePaths) {
      const result = await ocrImage(imgPath);
      pageResults.push(result);
    }

    // ── Combine pages ─────────────────────────────────────────────────
    const combinedText = pageResults.map((p) => p.text).join("\n\n");
    const allWords: OcrWord[] = [];
    let posBase = 0;
    for (const p of pageResults) {
      for (const w of p.words) {
        allWords.push({ ...w, position: posBase + w.position });
      }
      posBase += p.words.length;
    }

    const avgConfidence =
      pageResults.length > 0
        ? pageResults.reduce((s, p) => s + p.avgConfidence, 0) / pageResults.length
        : 0;

    // ── Normalize ─────────────────────────────────────────────────────
    const rawText = combinedText;
    const refinedText = normalizeArabicText(combinedText);

    // ── Low-confidence words ──────────────────────────────────────────
    const LOW_CONFIDENCE_THRESHOLD = 0.75;
    const lowConfidenceWords = allWords
      .filter((w) => w.confidence < LOW_CONFIDENCE_THRESHOLD && w.word.length > 1)
      .slice(0, 20);

    const confidenceScore = Math.round(avgConfidence * 100);

    // ── Quality classification ────────────────────────────────────────
    let qualityLevel: "high" | "medium" | "low";
    let processingNotes: string;

    if (confidenceScore >= 80) {
      qualityLevel = "high";
      processingNotes = "اكتملت المعالجة بنجاح. جودة عالية للنص المستخرج.";
    } else if (confidenceScore >= 55) {
      qualityLevel = "medium";
      processingNotes = `تم رصد ${lowConfidenceWords.length} كلمة بمستوى ثقة منخفض. يُنصح بمراجعة النص المُعلَّم.`;
    } else {
      qualityLevel = "low";
      processingNotes = "جودة الصورة منخفضة أو الخط يدوي بصعوبة عالية. يُنصح بإعادة المسح الضوئي بدقة أعلى (300 DPI على الأقل).";
    }

    const processingDurationMs = Date.now() - startTime;

    logger.info(
      { filename, confidenceScore, qualityLevel, wordCount: allWords.length, pages: imagePaths.length, processingDurationMs },
      "OCR processing completed",
    );

    return {
      rawText,
      refinedText,
      confidenceScore,
      qualityLevel,
      wordCount: allWords.length,
      lowConfidenceWords,
      passCount: pageResults.length, // number of pages processed
      processingNotes,
      processingDurationMs,
    };
  } finally {
    if (cleanupNeeded) {
      await cleanupTmpDir(jobId);
    }
  }
}
