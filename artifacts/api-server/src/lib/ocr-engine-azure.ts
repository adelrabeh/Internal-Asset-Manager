/**
 * Azure OpenAI OCR Engine — uses GPT-4o Vision for Arabic text extraction.
 *
 * المتطلبات (متغيرات البيئة):
 *   AZURE_OPENAI_ENDPOINT   — e.g. https://myresource.openai.azure.com
 *   AZURE_OPENAI_KEY        — مفتاح API من Azure Portal
 *   AZURE_OPENAI_DEPLOYMENT — اسم النموذج المنشور، e.g. gpt-4o
 *   AZURE_OPENAI_API_VERSION — e.g. 2024-02-01 (اختياري، الافتراضي: 2024-12-01-preview)
 */

import OpenAI, { AzureOpenAI } from "openai";
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
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // GPT-4o supports up to 20 MB

function getAzureClient(): AzureOpenAI {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY;

  if (!endpoint || !apiKey) {
    throw new Error(
      "Azure OpenAI غير مُهيّأ. يجب ضبط AZURE_OPENAI_ENDPOINT و AZURE_OPENAI_KEY في متغيرات البيئة.",
    );
  }

  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";

  return new AzureOpenAI({ endpoint, apiKey, apiVersion });
}

const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o";

async function prepareImageForGpt4o(inputPath: string, tmpPath: string): Promise<string> {
  try {
    // High quality JPEG — GPT-4o handles up to 20 MB so we can be generous
    await execAsync(
      `"${CONVERT_BIN}" "${inputPath}" -quality 95 -resize "4000x>" "${tmpPath}"`,
    );
    const { stat } = await import("fs/promises");
    const s = await stat(tmpPath);
    if (s.size > MAX_IMAGE_BYTES) {
      await execAsync(
        `"${CONVERT_BIN}" "${inputPath}" -quality 88 -resize "3000x>" "${tmpPath}"`,
      );
    }
    return tmpPath;
  } catch {
    return inputPath;
  }
}

function buildAzureOcrPrompt(): string {
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
- اكتب الهمزات كما هي (أ، إ، ء، ؤ، ئ)

══ الأرقام والتواريخ ══
- اكتب الأرقام العربية (١٢٣) كما تظهر بالضبط
- اكتب الأرقام الإنجليزية (123) كما تظهر بالضبط

══ الجداول — قاعدة حاسمة ══
إذا وجدت جدولاً (خطوط، أعمدة، صفوف)، اكتبه بصيغة Markdown:

| العمود الأول | العمود الثاني |
|-------------|--------------|
| البيانات    | البيانات     |

قواعد: كل صف يبدأ وينتهي بـ |  ·  الصف الثاني دائماً |---|  ·  الخلايا الفارغة | |

══ الصور والرسوم ══
فقط إذا كان المحتوى رسماً بيانياً أو صورة فوتوغرافية حقيقية:
اكتب: [صورة: وصف مختصر]

══ تنسيق الإخراج ══
- احتفظ بترتيب الأسطر كما في الصفحة
- ابدأ مباشرة بالمحتوى بدون مقدمات
- إذا كانت الصفحة خالية تماماً: اكتب [صفحة فارغة]`;
}

async function gpt4oOcrPage(
  imagePath: string,
  tmpDir: string,
  pageIdx: number,
  client: AzureOpenAI,
): Promise<string> {
  const tmpJpeg = join(tmpDir, `azure_page_${pageIdx}.jpg`);
  const finalPath = await prepareImageForGpt4o(imagePath, tmpJpeg);
  const imageBuffer = await readFile(finalPath);
  const base64 = imageBuffer.toString("base64");
  const mimeType = (finalPath.endsWith(".jpg") || finalPath.endsWith(".jpeg"))
    ? "image/jpeg" : "image/png";

  const response = await client.chat.completions.create({
    model: DEPLOYMENT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" },
          },
          { type: "text", text: buildAzureOcrPrompt() },
        ],
      },
    ],
    max_tokens: 16384,
    temperature: 0,
  });

  return response.choices[0]?.message?.content ?? "";
}

export interface AzureOcrResult {
  pages: number;
  rawText: string;
  durationMs: number;
  model: string;
}

// GPT-4o is billed per token — process 2 pages in parallel to control costs
const PARALLEL_BATCH_SIZE = 2;

export async function runAzureOcr(
  imagePaths: string[],
  tmpDir: string,
): Promise<AzureOcrResult> {
  const start = Date.now();
  const client = getAzureClient();
  const pageTexts: string[] = new Array(imagePaths.length).fill("");

  for (let batchStart = 0; batchStart < imagePaths.length; batchStart += PARALLEL_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE, imagePaths.length);
    const batch = imagePaths.slice(batchStart, batchEnd);

    logger.info(
      { deployment: DEPLOYMENT, batchStart: batchStart + 1, batchEnd, total: imagePaths.length },
      "Azure GPT-4o OCR batch — processing pages in parallel",
    );

    const results = await Promise.allSettled(
      batch.map((imgPath, idx) => gpt4oOcrPage(imgPath, tmpDir, batchStart + idx, client)),
    );

    for (let idx = 0; idx < results.length; idx++) {
      const result = results[idx];
      if (result.status === "fulfilled") {
        pageTexts[batchStart + idx] = result.value;
      } else {
        const err = result.reason as Error;
        logger.warn({ err: err?.message, page: batchStart + idx + 1 }, "Azure GPT-4o page failed — retrying");
        // Retry once
        try {
          await new Promise((r) => setTimeout(r, 3000));
          pageTexts[batchStart + idx] = await gpt4oOcrPage(
            batch[idx]!, tmpDir, batchStart + idx, client,
          );
        } catch (retryErr) {
          logger.warn({ err: retryErr, page: batchStart + idx + 1 }, "Azure GPT-4o retry failed");
          pageTexts[batchStart + idx] = `[صفحة ${batchStart + idx + 1}: فشل في القراءة]`;
        }
      }
    }

    // Pause between batches to respect rate limits
    if (batchEnd < imagePaths.length) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  logger.info({ deployment: DEPLOYMENT, pages: imagePaths.length }, "Azure GPT-4o OCR completed");

  return {
    pages: imagePaths.length,
    rawText: pageTexts.join("\n\n"),
    durationMs: Date.now() - start,
    model: `azure:${DEPLOYMENT}`,
  };
}

/**
 * Check if Azure OpenAI is configured (all required env vars are set).
 */
export function isAzureConfigured(): boolean {
  return !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY);
}
