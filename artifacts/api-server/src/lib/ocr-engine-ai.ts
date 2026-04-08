/**
 * AI OCR Engine — uses Gemini Vision for Arabic text extraction.
 *
 * Strategy:
 *  1. Convert each PDF page (or direct image) to high-quality JPEG (≤ 4 MB).
 *  2. Send to Gemini with a detailed Arabic manuscript prompt.
 *  3. Return concatenated page text + aggregate stats.
 *
 * Model priority:
 *  - gemini-2.5-pro  → highest accuracy for Arabic manuscripts (primary)
 *  - gemini-2.5-flash → fallback if pro is unavailable or rate-limited
 */

import { ai } from "@workspace/integrations-gemini-ai";
import { readFile } from "fs/promises";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { logger } from "./logger";

const execAsync = promisify(exec);

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

  return found ?? name;
}

const CONVERT_BIN = resolveToolPath("convert");

// 4 MB hard limit per image (Gemini inline data limit)
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Prepare image for Gemini:
 * - High quality JPEG (92%) at original resolution first
 * - Only reduce size/quality if over 4 MB
 * - Never go below 2000px wide (keeps fine Arabic script readable)
 */
async function prepareImageForGemini(inputPath: string, tmpPath: string): Promise<string> {
  try {
    // First pass: high quality, up to 3500px wide (300 DPI letter page ≈ 2480px)
    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" -quality 92 -resize "3500x>" "${tmpPath}"`,
    );

    const fs = await import("fs/promises");
    let stat = await fs.stat(tmpPath);

    if (stat.size <= MAX_IMAGE_BYTES) return tmpPath;

    // Second pass: still high quality but narrower
    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" -quality 88 -resize "2500x>" "${tmpPath}"`,
    );
    stat = await fs.stat(tmpPath);

    if (stat.size <= MAX_IMAGE_BYTES) return tmpPath;

    // Third pass: last resort — still 2000px to preserve legibility
    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" -quality 80 -resize "2000x>" "${tmpPath}"`,
    );

    return tmpPath;
  } catch {
    return inputPath;
  }
}

function buildOcrPrompt(): string {
  return `أنت نظام OCR متخصص في قراءة الوثائق والمخطوطات العربية التاريخية والحديثة.

هذه الصفحة من وثيقة مُمسوحة ضوئياً. مهمتك استخراج كل النص المرئي فيها بدقة تامة.

══ قاعدة أساسية: اقرأ كل شيء ══
- حتى لو كان الخط صعباً أو باهتاً أو مائلاً، حاول قراءته
- النص القديم أو المخطوط: اقرأه كما هو دون تحديث أو تصحيح
- إذا كانت كلمة غير واضحة جزئياً: اكتبها مع وضع [؟] بعدها
- إذا كان سطر غير مقروء تماماً: اكتب [سطر غير مقروء]
- لا تترك أي نص دون استخراج حتى لو كان صغيراً جداً

══ التشكيل والحركات ══
- احتفظ بكل علامات التشكيل: فتحة، ضمة، كسرة، شدة، سكون، تنوين
- لا تحذف أي حركة حتى لو بدت زائدة
- اكتب الهمزات كما هي (أ، إ، ء، ؤ، ئ)

══ الأرقام والتواريخ ══
- اكتب الأرقام العربية (١٢٣) كما تظهر بالضبط
- اكتب الأرقام الإنجليزية (123) كما تظهر بالضبط
- لا تحوّل بين النوعين

══ الجداول — قاعدة حاسمة ══
إذا وجدت جدولاً (خطوط، أعمدة، صفوف)، اكتبه بصيغة Markdown:

| العمود الأول | العمود الثاني | العمود الثالث |
|-------------|--------------|--------------|
| البيانات    | البيانات     | البيانات     |

قواعد الجدول:
- كل صف يبدأ وينتهي بـ |
- الصف الثاني دائماً |---|---|
- الخلايا الفارغة تُكتب كـ | |
- لا تحذف أي صف أو عمود

██ إذا كانت الصفحة تحتوي جدولاً، لا تكتب محتواه كفقرات — اكتبه كجدول Markdown حتماً ██

══ الصور والرسوم ══
فقط إذا كان المحتوى رسماً بيانياً أو صورة فوتوغرافية حقيقية (ليس نصاً مكتوباً):
اكتب: [صورة: وصف مختصر لما تراه]

══ تنسيق الإخراج ══
- احتفظ بترتيب الأسطر كما في الصفحة
- الفقرات تُفصل بسطر فارغ
- العناوين: اتركها على سطر مستقل
- ابدأ مباشرة بالمحتوى بدون مقدمات
- إذا كانت الصفحة خالية تماماً: اكتب [صفحة فارغة]`;
}

// OCR model — configurable via env var GEMINI_OCR_MODEL
// Options: "gemini-2.5-pro" (أدق لكن مدفوع) / "gemini-2.5-flash" (مجاني بحدود، كافٍ للغالبية)
const PRIMARY_MODEL = process.env.GEMINI_OCR_MODEL ?? "gemini-2.5-flash";
// Fallback model if primary is rate-limited or unavailable
const FALLBACK_MODEL = "gemini-2.5-flash";

async function geminiOcrPage(
  imagePath: string,
  tmpDir: string,
  pageIdx: number,
  model: string = PRIMARY_MODEL,
): Promise<string> {
  const tmpJpeg = join(tmpDir, `gemini_page_${pageIdx}.jpg`);
  const finalPath = await prepareImageForGemini(imagePath, tmpJpeg);
  const imageBuffer = await readFile(finalPath);
  const base64 = imageBuffer.toString("base64");
  const mimeType = (finalPath.endsWith(".jpg") || finalPath.endsWith(".jpeg"))
    ? "image/jpeg" : "image/png";

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: buildOcrPrompt() },
        ],
      },
    ],
    config: {
      maxOutputTokens: 32768,
      temperature: 0,
    },
  });

  return response.text ?? "";
}

export interface AiOcrResult {
  pages: number;
  rawText: string;
  durationMs: number;
  model: string;
}

// Process 3 pages in parallel (Pro has lower rate limits than Flash)
const PARALLEL_BATCH_SIZE = 3;

export async function runGeminiOcr(
  imagePaths: string[],
  tmpDir: string,
): Promise<AiOcrResult> {
  const start = Date.now();
  const pageTexts: string[] = new Array(imagePaths.length).fill("");

  // Detect which model to use — try Pro first
  let model = PRIMARY_MODEL;
  let testedModel = false;

  for (let batchStart = 0; batchStart < imagePaths.length; batchStart += PARALLEL_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE, imagePaths.length);
    const batch = imagePaths.slice(batchStart, batchEnd);

    logger.info(
      { model, batchStart: batchStart + 1, batchEnd, total: imagePaths.length },
      "Gemini OCR batch — processing pages in parallel",
    );

    const results = await Promise.allSettled(
      batch.map((imgPath, idx) => geminiOcrPage(imgPath, tmpDir, batchStart + idx, model)),
    );

    for (let idx = 0; idx < results.length; idx++) {
      const result = results[idx];
      if (result.status === "fulfilled") {
        pageTexts[batchStart + idx] = result.value;
        testedModel = true;
      } else {
        const err = result.reason as Error;
        const errMsg = err?.message ?? "";

        // If Pro is rate-limited or unavailable on first batch, switch to Flash
        if (!testedModel && model === PRIMARY_MODEL &&
            (errMsg.includes("429") || errMsg.includes("404") ||
             errMsg.includes("RATELIMIT") || errMsg.includes("quota") ||
             errMsg.toLowerCase().includes("not found"))) {
          logger.warn({ err: errMsg }, `${PRIMARY_MODEL} unavailable, switching to ${FALLBACK_MODEL}`);
          model = FALLBACK_MODEL;
          // Retry this page with fallback model
          try {
            pageTexts[batchStart + idx] = await geminiOcrPage(
              batch[idx]!, tmpDir, batchStart + idx, FALLBACK_MODEL,
            );
            testedModel = true;
          } catch (retryErr) {
            logger.warn({ err: retryErr, page: batchStart + idx + 1 }, "Gemini OCR page failed on fallback");
            pageTexts[batchStart + idx] = `[صفحة ${batchStart + idx + 1}: فشل في القراءة]`;
          }
        } else {
          // Retry once with same model before giving up
          logger.warn({ err: errMsg, page: batchStart + idx + 1 }, "Gemini OCR page failed — retrying");
          try {
            await new Promise((r) => setTimeout(r, 2000));
            pageTexts[batchStart + idx] = await geminiOcrPage(
              batch[idx]!, tmpDir, batchStart + idx, model,
            );
          } catch (retryErr) {
            logger.warn({ err: retryErr, page: batchStart + idx + 1 }, "Gemini OCR page retry also failed");
            pageTexts[batchStart + idx] = `[صفحة ${batchStart + idx + 1}: فشل في القراءة]`;
          }
        }
      }
    }

    // Pause between batches to respect rate limits
    if (batchEnd < imagePaths.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  logger.info({ model, pages: imagePaths.length }, "Gemini OCR completed for all pages");

  return {
    pages: imagePaths.length,
    rawText: pageTexts.join("\n\n"),
    durationMs: Date.now() - start,
    model,
  };
}
