/**
 * AI OCR Engine — uses Gemini Vision for Arabic text extraction.
 *
 * Optimised for speed + quality:
 *  - Single-pass per page (no costly retry pass)
 *  - 5 pages processed in parallel (Flash rate-limits allow this)
 *  - High-quality image prep (92%, 3500px max)
 *  - Aggressive Arabic prompt that forbids placeholder markers
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
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB Gemini inline limit

/**
 * Prepare image: high-quality JPEG, resize only if over 4 MB.
 */
async function prepareImage(inputPath: string, tmpPath: string): Promise<string> {
  try {
    await execAsync(`"${CONVERT_BIN}" "${inputPath}" -quality 92 -resize "3500x>" "${tmpPath}"`);
    const { stat } = await import("fs/promises");
    let s = await stat(tmpPath);
    if (s.size <= MAX_IMAGE_BYTES) return tmpPath;

    await execAsync(`"${CONVERT_BIN}" "${inputPath}" -quality 85 -resize "2500x>" "${tmpPath}"`);
    s = await stat(tmpPath);
    if (s.size <= MAX_IMAGE_BYTES) return tmpPath;

    await execAsync(`"${CONVERT_BIN}" "${inputPath}" -quality 78 -resize "2000x>" "${tmpPath}"`);
    return tmpPath;
  } catch {
    return inputPath;
  }
}

function buildOcrPrompt(): string {
  return `أنت نظام OCR متخصص في قراءة الوثائق والمخطوطات العربية التاريخية والحديثة.

هذه الصفحة من وثيقة مُمسوحة ضوئياً. مهمتك الوحيدة: استخراج كل النص العربي المرئي.

══ القاعدة الذهبية ══
اقرأ كل شيء. لا تستسلم لأي نص حتى لو كان باهتاً أو قديماً أو مائلاً أو مطموساً جزئياً.
- الكلمة غير واضحة جزئياً → اكتبها وضع [؟] بعدها
- الكلمة غير مقروءة كلياً → اكتب [كلمة]
- ممنوع منعاً باتاً: "[سطر غير مقروء]" — استبدلها دائماً بما يمكن قراءته

══ الصور ══
حتى لو بدت الصفحة كأنها مسح ضوئي باهت، تفحّصها جيداً — الغالبية تحتوي نصاً عربياً.
فقط إذا كانت صورة فوتوغرافية حقيقية بلا أي كتابة: اكتب [صورة: وصف]
فقط إذا كانت فارغة تماماً: اكتب [صفحة فارغة]

══ التشكيل ══
احتفظ بكل علامات التشكيل. اكتب الهمزات كما هي (أ، إ، ء، ؤ، ئ).

══ الأرقام ══
اكتب الأرقام العربية والإنجليزية كما تظهر بالضبط.

══ الجداول ══
إذا وجدت جدولاً، اكتبه بصيغة Markdown:
| العمود الأول | العمود الثاني |
|-------------|--------------|
| البيانات    | البيانات     |

══ الإخراج ══
ابدأ مباشرة بالمحتوى. لا مقدمات. لا تعليقات. لا ملاحظات.`;
}

// ── Model config ──────────────────────────────────────────────────────────────

const PRIMARY_MODEL = process.env.GEMINI_OCR_MODEL ?? "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash";

// Process 5 pages in parallel — Flash rate-limits allow this comfortably
const PARALLEL_BATCH_SIZE = 5;

// ── Core call ─────────────────────────────────────────────────────────────────

async function geminiOcrPage(
  imagePath: string,
  tmpDir: string,
  pageIdx: number,
  model: string,
): Promise<string> {
  const tmpJpeg = join(tmpDir, `gemini_p${pageIdx}.jpg`);
  const finalPath = await prepareImage(imagePath, tmpJpeg);
  const imageBuffer = await readFile(finalPath);
  const base64 = imageBuffer.toString("base64");
  const mimeType = (finalPath.endsWith(".jpg") || finalPath.endsWith(".jpeg"))
    ? "image/jpeg" : "image/png";

  const response = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: buildOcrPrompt() },
      ],
    }],
    config: { maxOutputTokens: 32768, temperature: 0 },
  });

  return response.text ?? "";
}

// ── Batch runner ──────────────────────────────────────────────────────────────

export interface AiOcrResult {
  pages: number;
  rawText: string;
  durationMs: number;
  model: string;
}

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
        logger.error({ page: batchStart + idx + 1, errMsg }, "Page failed first attempt");

        // Auto-switch to fallback if primary model unavailable
        if (!modelConfirmed && model !== FALLBACK_MODEL &&
            (errMsg.includes("429") || errMsg.includes("404") ||
             errMsg.includes("RATELIMIT") || errMsg.includes("quota") ||
             errMsg.toLowerCase().includes("not found"))) {
          logger.warn({ errMsg }, `${model} unavailable → ${FALLBACK_MODEL}`);
          model = FALLBACK_MODEL;
        }

        // Single retry with current model
        try {
          await new Promise((r) => setTimeout(r, 2000));
          pageTexts[batchStart + idx] = await geminiOcrPage(
            batch[idx]!, tmpDir, batchStart + idx, model,
          );
          modelConfirmed = true;
        } catch (retryErr) {
          const errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          logger.error({ page: batchStart + idx + 1, errMsg }, "Page failed after retry");
          pageTexts[batchStart + idx] = `[صفحة ${batchStart + idx + 1}: تعذّر الاستخراج]`;
        }
      }
    }

    // Brief pause between batches (200ms — just enough to avoid burst limits)
    if (batchEnd < imagePaths.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  logger.info({ model, pages: imagePaths.length, durationMs: Date.now() - start }, "Gemini OCR completed");

  return {
    pages: imagePaths.length,
    rawText: pageTexts.join("\n\n"),
    durationMs: Date.now() - start,
    model,
  };
}
