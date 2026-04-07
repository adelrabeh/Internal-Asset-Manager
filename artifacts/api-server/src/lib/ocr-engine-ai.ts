/**
 * AI OCR Engine — uses Gemini 2.5 Flash vision for Arabic text extraction.
 *
 * Strategy:
 *  1. Convert each PDF page (or direct image) to a compressed JPEG (≤ 4 MB).
 *  2. Send to Gemini with a structured prompt (image + system instructions).
 *  3. Return concatenated page text + aggregate stats.
 */

import { ai } from "@workspace/integrations-gemini-ai";
import { readFile } from "fs/promises";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { logger } from "./logger";

const execAsync = promisify(exec);

/**
 * Resolve the absolute path of a CLI binary.
 * Tries `which` with the server PATH, then with supplemental Nix profile
 * directories (for deployment environments that may have a narrower PATH).
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

  return found ?? name;
}

const CONVERT_BIN = resolveToolPath("convert");

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

async function ensureImageSize(inputPath: string, tmpPath: string): Promise<string> {
  try {
    await execAsync(`"${CONVERT_BIN}" "${inputPath}" -quality 85 -resize "2000x>" "${tmpPath}"`);
    const stat = await import("fs").then(
      (m) => new Promise<{ size: number }>((res, rej) =>
        m.stat(tmpPath, (e, s) => (e ? rej(e) : res(s))),
      ),
    );
    if (stat.size > MAX_IMAGE_BYTES) {
      await execAsync(`"${CONVERT_BIN}" "${inputPath}" -quality 60 -resize "1500x>" "${tmpPath}"`);
    }
    return tmpPath;
  } catch {
    return inputPath;
  }
}

function buildOcrPrompt(): string {
  return `أنت نظام OCR متخصص في استخراج المحتوى من الوثائق العربية.

══ قاعدة أولى ومطلقة: الجداول ══
قبل أي شيء، ابحث في الصورة عن أي تخطيط يشبه الجدول:
- خطوط أفقية وعمودية تشكّل مربعات أو خانات
- صفوف وأعمدة واضحة حتى لو بدون خطوط كاملة
- قوائم بأرقام أو تواريخ منظمة في عمودين أو أكثر
- أي محتوى مقسّم في عمودين أو أكثر جنباً إلى جنب

إذا وجدت جدولاً، يجب أن تكتبه بصيغة Markdown الدقيقة:

مثال على جدول بسيط:
| رقم | الكتاب | المالك | التاريخ |
|-----|--------|--------|---------|
| ١ | روضة الناظر | ابن عطوة | ٩٤٨هـ |
| ٢ | شرح الروضة | مكتبة آل عبيد | القرن الثالث عشر |

مثال على جدول بصف عنوان (خلفية ملونة أو نص مدمج):
| رقم | الكتاب | المالك | التاريخ |
|-----|--------|--------|---------|
| **الاقتناء والتملك** | | | |
| ١٦ | روضة الناظر | مكتبة آل أباحسين | ١١٢٣هـ |
| **الوقف** | | | |
| ٢٢ | روضة الناظر | ابن عطوة النجدي | ٩٤٨هـ |

قواعد صارمة للجدول:
- كل صف يبدأ وينتهي بـ |
- الصف الثاني دائماً |---|---|---| بعدد الأعمدة
- صفوف العناوين الملونة: اكتبها في العمود الأول وأترك بقية الأعمدة فارغة
- الخلايا الفارغة تُكتب كـ | |
- لا تحذف أي صف ولا أي عمود من الجدول
- حتى لو كان النص في الخلية طويلاً، ضعه داخل خانة الجدول

██ مهم جداً: إذا كانت الصفحة تحتوي جدولاً، لا تكتب المحتوى كفقرات نثرية - اكتبه كجدول Markdown حتماً ██

══ النصوص العادية ══
- انسخ كل النص الموجود حرفياً بدون تعديل أو تفسير
- احتفظ بعلامات التشكيل (فتحة، كسرة، ضمة، شدة، سكون، تنوين)
- احتفظ بترتيب الأسطر والفقرات والعناوين
- النص الإنجليزي: اكتبه كما هو

══ الصور والرسوم ══
إذا وجدت صورة أو رسماً بيانياً أو مخططاً أو ختماً أو توقيعاً (ليس نصاً):
اكتب فقط: [IMAGE]

══ تنبيهات ══
- لا تكتب أي شيء من عندك
- لا تكتب مقدمات أو خواتم  
- ابدأ مباشرة بالمحتوى المستخرج
- إذا كانت الصفحة خالية أو غير قابلة للقراءة، اكتب فقط: [صفحة فارغة]`;
}

async function geminiOcrPage(imagePath: string, tmpDir: string, pageIdx: number): Promise<string> {
  const tmpJpeg = join(tmpDir, `gemini_page_${pageIdx}.jpg`);
  const finalPath = await ensureImageSize(imagePath, tmpJpeg);
  const imageBuffer = await readFile(finalPath);
  const base64 = imageBuffer.toString("base64");
  const mimeType = (finalPath.endsWith(".jpg") || finalPath.endsWith(".jpeg"))
    ? "image/jpeg" : "image/png";

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
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
      maxOutputTokens: 16384,
      temperature: 0,
    },
  });

  return response.text ?? "";
}

export interface AiOcrResult {
  pages: number;
  rawText: string;
  durationMs: number;
}

const PARALLEL_BATCH_SIZE = 4;

export async function runGeminiOcr(
  imagePaths: string[],
  tmpDir: string,
): Promise<AiOcrResult> {
  const start = Date.now();
  const pageTexts: string[] = new Array(imagePaths.length).fill("");

  // Process pages in parallel batches to maximise throughput while
  // staying within Gemini's rate limits.
  for (let batchStart = 0; batchStart < imagePaths.length; batchStart += PARALLEL_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE, imagePaths.length);
    const batch = imagePaths.slice(batchStart, batchEnd);

    logger.info(
      { batchStart: batchStart + 1, batchEnd, total: imagePaths.length },
      "Gemini OCR batch — processing pages in parallel",
    );

    const results = await Promise.allSettled(
      batch.map((imgPath, idx) => geminiOcrPage(imgPath, tmpDir, batchStart + idx)),
    );

    for (let idx = 0; idx < results.length; idx++) {
      const result = results[idx];
      if (result.status === "fulfilled") {
        pageTexts[batchStart + idx] = result.value;
      } else {
        logger.warn({ err: result.reason, page: batchStart + idx + 1 }, "Gemini OCR page failed");
        pageTexts[batchStart + idx] = "";
      }
    }

    // Short pause between batches only (not between individual pages)
    if (batchEnd < imagePaths.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return {
    pages: imagePaths.length,
    rawText: pageTexts.join("\n\n"),
    durationMs: Date.now() - start,
  };
}
