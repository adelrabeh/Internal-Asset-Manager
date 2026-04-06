/**
 * OCR Engine Module
 *
 * Real OCR processing using Tesseract.js (WASM) with Arabic language support.
 * - Pre-processing: ImageMagick denoising + binarization + deskew
 * - Tesseract PSM 6 (uniform block) + LSTM engine (OEM 1)
 * - Arabic post-processing: repairs Alef-Lam splits and common OCR artifacts
 */

import { createWorker } from "tesseract.js";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { readdir, rm } from "fs/promises";
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
    "convert",
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
  await execAsync(`pdftoppm -r 300 -png "${pdfPath}" "${outPrefix}"`);

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

/**
 * Fix the most common Tesseract Arabic OCR errors.
 *
 * Patterns observed in real output:
 *  • "| ل"  → "ال"   (Alef written as pipe, then separated from Lam)
 *  • "| ا"  → "ال"   (same but with a bare Alef following)
 *  • "وا ل" → "وال"  (Waw-Alef split from Lam)
 *  • "فى"   → "في"   (old spelling)
 *  • Isolated Latin letters that are OCR noise
 *  • Stray numbers in Arabic lines (page references mixed in)
 */
function fixArabicOcrErrors(text: string): string {
  let t = text;

  // ── Unicode control / directional marks ──────────────────────────────────
  t = t.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u206F\uFEFF\u061C]/g, "");

  // ── Alef-Lam repairs ─────────────────────────────────────────────────────
  // "| ل"  →  "ال"  (pipe + space + any variant of lam)
  t = t.replace(/\|\s+ل/g, "ال");
  // "| ا"  →  "ال"  (pipe + space + alef → alef-lam)
  t = t.replace(/\|\s+ا/g, "ال");
  // lone pipe that remains → alef
  t = t.replace(/(?<=\s)\|(?=\s)/g, "ا");
  t = t.replace(/^\|(?=\s)/gm, "ا");

  // "ا ل"  →  "ال"  (alef separated from lam — very common)
  t = t.replace(/ا\s+ل(?=[^\s])/g, "ال");

  // "| لـ" patterns with Arabic letters immediately after the lam
  t = t.replace(/\|\s+لـ/g, "الـ");

  // Waw prefix splits: "وا ل" → "وال"
  t = t.replace(/وا\s+ل(?=[^\s])/g, "وال");
  // "فا ل" → "فال"
  t = t.replace(/فا\s+ل(?=[^\s])/g, "فال");
  // "با ل" → "بال"
  t = t.replace(/با\s+ل(?=[^\s])/g, "بال");
  // "كا ل" → "كال"
  t = t.replace(/كا\s+ل(?=[^\s])/g, "كال");

  // ── Alef variants → plain Alef (normalise) ───────────────────────────────
  t = t.replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627"); // آ أ إ ٱ → ا

  // ── Lam-Alef ligature fixes ──────────────────────────────────────────────
  t = t.replace(/[ﻻﻼ]/g, "لا");
  t = t.replace(/[ﻷﻸ]/g, "لأ");
  t = t.replace(/[ﻹﻺ]/g, "لإ");

  // ── Common whole-word substitutions ──────────────────────────────────────
  // These are patterns where Tesseract reliably produces wrong output
  const WORD_FIXES: Array<[RegExp, string]> = [
    [/\bfى\b/g, "في"],
    [/\bفى\b/g, "في"],
    [/\bإلى\b/g, "إلى"],
    [/\bى\b/g, ""],          // lone tailed ya at word boundary is usually noise
    [/\bSpall\b/gi, ""],
    [/\bLeast\b/gi, ""],
    [/\b[a-zA-Z]\b/g, ""],   // isolated single Latin letters (OCR noise)
  ];
  for (const [pattern, replacement] of WORD_FIXES) {
    t = t.replace(pattern, replacement);
  }

  // ── Whitespace normalisation ──────────────────────────────────────────────
  t = t.replace(/[ \t]+/g, " ");           // multiple spaces → single
  t = t.replace(/[ \t]+$/gm, "");          // trailing spaces per line
  t = t.replace(/\n{3,}/g, "\n\n");        // max 2 blank lines

  return t.trim();
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
      // Limit to 10 pages to avoid timeouts
      rawImagePaths = rawImagePaths.slice(0, 10);
    } else {
      rawImagePaths = [filePath];
      cleanupNeeded = false;
    }

    logger.info({ filename, pages: rawImagePaths.length }, "Pre-processing images");

    // ── Step 2: Pre-process images (binarise / deskew) ────────────────────
    const prepDir = join(OCR_TMP_DIR, jobId, "prep");
    mkdirSync(prepDir, { recursive: true });
    cleanupNeeded = true;

    const processedPaths: string[] = [];
    for (let i = 0; i < rawImagePaths.length; i++) {
      const rawPath = rawImagePaths[i];
      const outPath = join(prepDir, `page_${String(i).padStart(4, "0")}.png`);
      await preprocessImage(rawPath, outPath);
      processedPaths.push(outPath);
    }

    logger.info({ filename, pages: processedPaths.length }, "Running Tesseract OCR");

    // ── Step 3: OCR each pre-processed image ──────────────────────────────
    const pageResults: Array<{ text: string; words: OcrWord[]; avgConfidence: number }> = [];
    for (const imgPath of processedPaths) {
      const result = await ocrImage(imgPath);
      pageResults.push(result);
    }

    // ── Step 4: Combine pages ─────────────────────────────────────────────
    const combinedRaw = pageResults.map((p) => p.text).join("\n\n");
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

    // ── Step 5: Post-process ──────────────────────────────────────────────
    const rawText = combinedRaw;
    const refinedText = fixArabicOcrErrors(combinedRaw);

    // ── Step 6: Quality assessment ────────────────────────────────────────
    const LOW_CONF_THRESHOLD = 0.75;
    const lowConfidenceWords = allWords
      .filter((w) => w.confidence < LOW_CONF_THRESHOLD && w.word.length > 1)
      .slice(0, 20);

    const confidenceScore = Math.round(avgConfidence * 100);

    let qualityLevel: "high" | "medium" | "low";
    let processingNotes: string;

    if (confidenceScore >= 80) {
      qualityLevel = "high";
      processingNotes = "اكتملت المعالجة بجودة عالية. تمت معالجة الصورة وتحسينها قبل التعرّف.";
    } else if (confidenceScore >= 55) {
      qualityLevel = "medium";
      processingNotes = `تم رصد ${lowConfidenceWords.length} كلمة بمستوى ثقة منخفض. يُنصح بمراجعة النص المُعلَّم.`;
    } else {
      qualityLevel = "low";
      processingNotes =
        "جودة الصورة منخفضة أو الخط يدوي بصعوبة عالية. يُنصح بإعادة المسح الضوئي بدقة أعلى (600 DPI) أو استخدام نسخة نصية من الملف.";
    }

    const processingDurationMs = Date.now() - startTime;

    logger.info(
      {
        filename,
        confidenceScore,
        qualityLevel,
        wordCount: allWords.length,
        pages: processedPaths.length,
        processingDurationMs,
      },
      "OCR processing completed",
    );

    return {
      rawText,
      refinedText,
      confidenceScore,
      qualityLevel,
      wordCount: allWords.length,
      lowConfidenceWords,
      passCount: pageResults.length,
      processingNotes,
      processingDurationMs,
    };
  } finally {
    if (cleanupNeeded) {
      await cleanupTmpDir(jobId);
    }
  }
}
