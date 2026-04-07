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

// Resolve binary paths at startup
function resolveToolPath(name: string): string {
  try {
    return execSync(`which ${name}`, { encoding: "utf8" }).trim() || name;
  } catch {
    return name;
  }
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

export async function runGeminiOcr(
  imagePaths: string[],
  tmpDir: string,
): Promise<AiOcrResult> {
  const start = Date.now();
  const pageTexts: string[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    logger.info({ page: i + 1, total: imagePaths.length }, "Gemini OCR page");
    try {
      const text = await geminiOcrPage(imagePaths[i], tmpDir, i);
      pageTexts.push(text);
    } catch (err) {
      logger.warn({ err, page: i + 1 }, "Gemini OCR page failed, skipping");
      pageTexts.push("");
    }
    if (i < imagePaths.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return {
    pages: imagePaths.length,
    rawText: pageTexts.join("\n\n"),
    durationMs: Date.now() - start,
  };
}
