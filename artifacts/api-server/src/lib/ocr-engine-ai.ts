/**
 * AI OCR Engine — uses Gemini Vision for Arabic text extraction.
 *
 * Strategy:
 *  1. Convert each PDF page to high-quality JPEG.
 *  2. Send to Gemini with primary prompt.
 *  3. If result has too many [سطر غير مقروء] / [صورة] tags → retry with enhanced image + aggressive prompt.
 *  4. Return concatenated page text + aggregate stats.
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
 * Standard preparation: high quality JPEG, up to 3500px wide.
 */
async function prepareImageForGemini(inputPath: string, tmpPath: string): Promise<string> {
  try {
    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" -quality 92 -resize "3500x>" "${tmpPath}"`,
    );
    const fs = await import("fs/promises");
    let stat = await fs.stat(tmpPath);
    if (stat.size <= MAX_IMAGE_BYTES) return tmpPath;

    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" -quality 88 -resize "2500x>" "${tmpPath}"`,
    );
    stat = await fs.stat(tmpPath);
    if (stat.size <= MAX_IMAGE_BYTES) return tmpPath;

    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" -quality 80 -resize "2000x>" "${tmpPath}"`,
    );
    return tmpPath;
  } catch {
    return inputPath;
  }
}

/**
 * Enhanced preparation for retry pass:
 * Applies contrast stretch + sharpening to improve legibility of faded/blurry text.
 */
async function prepareImageEnhanced(inputPath: string, tmpPath: string): Promise<string> {
  try {
    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" ` +
      `-normalize ` +
      `-contrast-stretch 2%x2% ` +
      `-sharpen 0x1.5 ` +
      `-quality 95 -resize "4000x>" "${tmpPath}"`,
    );
    const fs = await import("fs/promises");
    let stat = await fs.stat(tmpPath);
    if (stat.size <= MAX_IMAGE_BYTES) return tmpPath;

    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" ` +
      `-normalize -contrast-stretch 2%x2% -sharpen 0x1.5 ` +
      `-quality 90 -resize "3000x>" "${tmpPath}"`,
    );
    return tmpPath;
  } catch {
    return prepareImageForGemini(inputPath, tmpPath);
  }
}

// ── Prompts ────────────────────────────────────────────────────────────────

/**
 * Primary OCR prompt — focused, clear instructions.
 * IMPORTANT: [سطر غير مقروء] is intentionally removed — model should always try.
 */
function buildOcrPrompt(): string {
  return `أنت نظام OCR متخصص في قراءة الوثائق والمخطوطات العربية التاريخية والحديثة.

هذه الصفحة من وثيقة مُمسوحة ضوئياً. مهمتك الوحيدة: استخراج كل النص العربي المرئي.

══ القاعدة الذهبية ══
اقرأ كل شيء. لا تستسلم لأي نص حتى لو كان:
- باهتاً أو ضعيف التباين
- قديماً أو مكتوباً بخط يد
- مائلاً أو مشوهاً أو مطموساً جزئياً
- صغيراً جداً في الهامش أو الذيل

══ عند صعوبة القراءة ══
- الكلمة غير واضحة جزئياً → اكتبها وضع [؟] بعدها مباشرة
- الكلمة غير مقروءة كلياً → اكتب [كلمة]
- لا تترك سطراً فارغاً بدل نص — دائماً أكتب شيئاً

══ تعامل مع الصورة كنص دائماً ══
حتى لو بدت الصفحة كأنها صورة أو مسح ضوئي باهت:
تفحّصها جيداً — الغالبية العظمى من هذه الوثائق تحتوي نصاً عربياً.
اكتب النص الذي تراه أو تستطيع استنتاجه.
فقط إذا كانت الصفحة فارغة تماماً بلا أي حرف: اكتب [صفحة فارغة]
فقط إذا كانت صورة فوتوغرافية حقيقية (وجوه، مناظر طبيعية): اكتب [صورة: وصف]

══ التشكيل والحركات ══
- احتفظ بكل علامات التشكيل: فتحة، ضمة، كسرة، شدة، سكون، تنوين
- اكتب الهمزات كما هي (أ، إ، ء، ؤ، ئ)

══ الأرقام والتواريخ ══
- اكتب الأرقام العربية (١٢٣) والإنجليزية (123) كما تظهر بالضبط

══ الجداول ══
إذا وجدت جدولاً، اكتبه بصيغة Markdown:
| العمود الأول | العمود الثاني |
|-------------|--------------|
| البيانات    | البيانات     |

══ تنسيق الإخراج ══
- احتفظ بترتيب الأسطر كما في الصفحة
- ابدأ مباشرة بالمحتوى بدون مقدمات أو تعليقات`;
}

/**
 * Aggressive retry prompt — used when first pass returns too many [؟] or failures.
 * More forceful language to push the model harder.
 */
function buildRetryPrompt(): string {
  return `أنت خبير في قراءة المخطوطات العربية القديمة والوثائق التاريخية الصعبة القراءة.

المحاولة الأولى لقراءة هذه الصفحة لم تكن كافية. أحتاج منك جهداً أكبر.

تعليمات صارمة:
1. افحص الصورة بعناية شديدة من أعلى اليمين لأسفل اليسار
2. اقرأ كل حرف يمكن رؤيته أو تخمينه
3. الخط الباهت أو المتآكل: اقرأه وضع [؟] بعد الكلمة المشكوك فيها
4. لا تكتب [سطر غير مقروء] — هذا مرفوض تماماً. اكتب ما تراه مهما كان ناقصاً
5. لا تكتب [صورة] إلا إذا كانت الصفحة صورة فوتوغرافية حقيقية بلا أي كتابة

اكتب الآن كل النص الموجود في الصفحة:`;
}

// ── Core OCR call ──────────────────────────────────────────────────────────

const PRIMARY_MODEL = process.env.GEMINI_OCR_MODEL ?? "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash";

/** Count how many "bad" markers are in extracted text (signals poor extraction). */
function countBadMarkers(text: string): number {
  const matches = text.match(/\[سطر غير مقروء\]|\[كلمة\]|\[صورة/g);
  return matches?.length ?? 0;
}

/** Return true if the page result looks like a failed extraction. */
function isPagePoorlyExtracted(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return true;
  const badCount = countBadMarkers(text);
  // If more than 40% of lines are bad markers, consider it poorly extracted
  return badCount / Math.max(lines.length, 1) > 0.4;
}

async function callGemini(
  imagePath: string,
  prompt: string,
  model: string,
): Promise<string> {
  const imageBuffer = await readFile(imagePath);
  const base64 = imageBuffer.toString("base64");
  const mimeType = (imagePath.endsWith(".jpg") || imagePath.endsWith(".jpeg"))
    ? "image/jpeg" : "image/png";

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: prompt },
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

async function geminiOcrPage(
  imagePath: string,
  tmpDir: string,
  pageIdx: number,
  model: string,
): Promise<string> {
  // Pass 1: standard quality
  const tmpJpeg = join(tmpDir, `gemini_p${pageIdx}_pass1.jpg`);
  const pass1Path = await prepareImageForGemini(imagePath, tmpJpeg);
  let text = await callGemini(pass1Path, buildOcrPrompt(), model);

  // Pass 2: if pass 1 was poor, retry with enhanced image + aggressive prompt
  if (isPagePoorlyExtracted(text)) {
    logger.info(
      { page: pageIdx + 1, badMarkers: countBadMarkers(text) },
      "OCR pass 1 poor — retrying with enhanced image",
    );
    try {
      const tmpEnhanced = join(tmpDir, `gemini_p${pageIdx}_pass2.jpg`);
      const pass2Path = await prepareImageEnhanced(imagePath, tmpEnhanced);
      const retryText = await callGemini(pass2Path, buildRetryPrompt(), model);

      // Keep whichever result is better (fewer bad markers, more actual text)
      const retryBad = countBadMarkers(retryText);
      const pass1Bad = countBadMarkers(text);
      if (retryBad < pass1Bad || retryText.trim().length > text.trim().length) {
        logger.info({ page: pageIdx + 1, pass1Bad, retryBad }, "Using retry result (better quality)");
        text = retryText;
      }
    } catch (retryErr) {
      logger.warn({ retryErr, page: pageIdx + 1 }, "Enhanced retry failed, keeping pass 1 result");
    }
  }

  return text;
}

// ── Batch runner ───────────────────────────────────────────────────────────

export interface AiOcrResult {
  pages: number;
  rawText: string;
  durationMs: number;
  model: string;
}

const PARALLEL_BATCH_SIZE = 3;

export async function runGeminiOcr(
  imagePaths: string[],
  tmpDir: string,
): Promise<AiOcrResult> {
  const start = Date.now();
  const pageTexts: string[] = new Array(imagePaths.length).fill("");
  let model = PRIMARY_MODEL;
  let modelConfirmed = false;

  for (let batchStart = 0; batchStart < imagePaths.length; batchStart += PARALLEL_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE, imagePaths.length);
    const batch = imagePaths.slice(batchStart, batchEnd);

    logger.info(
      { model, batchStart: batchStart + 1, batchEnd, total: imagePaths.length },
      "Gemini OCR batch",
    );

    const results = await Promise.allSettled(
      batch.map((imgPath, idx) => geminiOcrPage(imgPath, tmpDir, batchStart + idx, model)),
    );

    for (let idx = 0; idx < results.length; idx++) {
      const result = results[idx];
      if (result.status === "fulfilled") {
        pageTexts[batchStart + idx] = result.value;
        modelConfirmed = true;
      } else {
        const err = result.reason as Error;
        const errMsg = err?.message ?? "";

        // Switch to fallback if primary model is unavailable
        if (!modelConfirmed && model !== FALLBACK_MODEL &&
            (errMsg.includes("429") || errMsg.includes("404") ||
             errMsg.includes("RATELIMIT") || errMsg.includes("quota") ||
             errMsg.toLowerCase().includes("not found"))) {
          logger.warn({ errMsg }, `${model} unavailable → switching to ${FALLBACK_MODEL}`);
          model = FALLBACK_MODEL;
        }

        // Retry once
        try {
          await new Promise((r) => setTimeout(r, 2000));
          pageTexts[batchStart + idx] = await geminiOcrPage(
            batch[idx]!, tmpDir, batchStart + idx, model,
          );
          modelConfirmed = true;
        } catch (retryErr) {
          logger.warn({ page: batchStart + idx + 1, retryErr }, "Gemini page failed after retry");
          pageTexts[batchStart + idx] = `[صفحة ${batchStart + idx + 1}: تعذّر الاستخراج]`;
        }
      }
    }

    if (batchEnd < imagePaths.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  logger.info({ model, pages: imagePaths.length }, "Gemini OCR completed");

  return {
    pages: imagePaths.length,
    rawText: pageTexts.join("\n\n"),
    durationMs: Date.now() - start,
    model,
  };
}
