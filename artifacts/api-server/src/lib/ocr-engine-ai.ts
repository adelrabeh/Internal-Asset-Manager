/**
 * AI OCR Engine — uses Gemini 2.5 Flash vision for Arabic text extraction.
 *
 * Strategy:
 *  1. Convert each PDF page (or direct image) to a compressed JPEG (≤ 4 MB).
 *  2. Send to Gemini with a clear prompt:
 *       - Extract Arabic/English text accurately
 *       - Preserve tables as Markdown (| col | col |)
 *       - Mark non-text image regions with [IMAGE] — do NOT describe them as text
 *  3. Return concatenated page text + aggregate stats.
 */

import { ai } from "@workspace/integrations-gemini-ai";
import { readFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { logger } from "./logger";

const execAsync = promisify(exec);

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * The OCR prompt is split into two parts and sent as a structured message
 * so that Gemini clearly distinguishes the task description from the request.
 */
function buildOcrPrompt(): string {
  return `أنت نظام OCR متخصص. مهمتك استخراج المحتوى من هذه الصورة بالقواعد التالية:

══ النصوص ══
- انسخ كل النص الموجود حرفياً بدون تعديل أو تفسير أو إضافة.
- احتفظ بعلامات التشكيل (فتحة، كسرة، ضمة، شدة، سكون، تنوين).
- احتفظ بترتيب الأسطر والفقرات والعناوين.
- النص الإنجليزي: اكتبه كما هو.

══ الجداول ══
إذا وجدت جدولاً، اكتبه بهذه الصيغة الدقيقة:
| رأس1 | رأس2 | رأس3 |
|------|------|------|
| بيانات | بيانات | بيانات |

قواعد الجدول:
- كل صف يبدأ وينتهي بـ |
- الصف الثاني دائماً |---|---|---| (عدد الشرطات يساوي عدد الأعمدة)
- الخلايا الفارغة تُكتب كـ | |
- لا تُدمج صفوف أو أعمدة
- لا تضع فراغات قبل | أو بعدها إلا فراغ واحد

══ الصور والرسوم ══
إذا وجدت صورة أو رسماً بيانياً أو مخططاً أو ختماً أو توقيعاً:
اكتب فقط: [IMAGE]
لا تكتب أي وصف، فقط [IMAGE]

══ مهم ══
- لا تكتب أي شيء من عندك
- لا تكتب مقدمات أو خواتم
- ابدأ مباشرة بالمحتوى المستخرج`;
}

async function ensureImageSize(inputPath: string, tmpPath: string): Promise<string> {
  try {
    await execAsync(`convert "${inputPath}" -quality 85 -resize "2000x>" "${tmpPath}"`);
    const { size } = await import("fs").then(
      (m) => new Promise<{ size: number }>((res, rej) =>
        m.stat(tmpPath, (e, s) => (e ? rej(e) : res(s))),
      ),
    );
    if (size > MAX_IMAGE_BYTES) {
      await execAsync(`convert "${inputPath}" -quality 60 -resize "1500x>" "${tmpPath}"`);
    }
    return tmpPath;
  } catch {
    return inputPath;
  }
}

async function geminiOcrPage(imagePath: string, tmpDir: string, pageIdx: number): Promise<string> {
  const tmpJpeg = join(tmpDir, `gemini_page_${pageIdx}.jpg`);
  const finalPath = await ensureImageSize(imagePath, tmpJpeg);
  const imageBuffer = await readFile(finalPath);
  const base64 = imageBuffer.toString("base64");
  const mimeType = (finalPath.endsWith(".jpg") || finalPath.endsWith(".jpeg"))
    ? "image/jpeg" : "image/png";

  const prompt = buildOcrPrompt();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
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
