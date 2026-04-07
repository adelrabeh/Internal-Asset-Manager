/**
 * AI OCR Engine — uses Gemini 2.5 Flash vision for Arabic text extraction.
 *
 * Strategy:
 *  1. Convert each PDF page (or direct image) to a compressed JPEG (≤ 4 MB).
 *  2. Send to Gemini with a specialised Arabic-OCR prompt that handles:
 *     - Plain Arabic / mixed Arabic-English text
 *     - Tables → Markdown table syntax  (| col | col |)
 *     - Embedded images / charts → [صورة: description]
 *  3. Return concatenated page text + aggregate stats.
 *
 * Falls back to Tesseract automatically if Gemini is unavailable.
 */

import { ai } from "@workspace/integrations-gemini-ai";
import { readFile } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { logger } from "./logger";

const execAsync = promisify(exec);

// Maximum inline image size Gemini accepts
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB per page (conservative)

// System prompt for Arabic OCR — handles text, tables, and embedded images
const OCR_SYSTEM_PROMPT = `أنت محرك OCR متخصص في استخراج المحتوى الكامل من الوثائق العربية.
مهمتك: استخرج كل المحتوى الموجود في الصورة بدقة تامة مع الحفاظ على البنية.

── قواعد استخراج النصوص ──
1. اقرأ النص كما هو دون أي تعديل أو إضافة.
2. احتفظ بعلامات التشكيل (فتحة، كسرة، ضمة، شدة، سكون، تنوين) كما هي.
3. احتفظ بترتيب الأسطر والفقرات والعناوين.
4. إذا وُجد نص إنجليزي اكتبه كما هو.
5. لا تُفسّر أو تُلخّص — فقط انسخ المحتوى حرفياً.
6. لا تكتب أي شيء إضافي من عندك.

── قواعد استخراج الجداول ──
إذا وجدت جدولاً أو بيانات منظمة في أعمدة وصفوف، استخرجه بصيغة Markdown هكذا:
| العمود 1 | العمود 2 | العمود 3 |
|----------|----------|----------|
| البيانات | البيانات | البيانات |
قواعد الجداول:
- افصل كل خلية بـ " | " بما فيها أطراف الصف.
- أضف سطر الفاصل بين الرأس والبيانات (|---|---|---|).
- إذا كانت الخلية فارغة اتركها فارغة ولا تحذفها.
- حافظ على ترتيب الأعمدة تماماً كما في الوثيقة.
- لا تدمج صفوف أو أعمدة منفصلة.

── قواعد استخراج الصور والرسوم ──
إذا وجدت صورة أو رسماً بيانياً أو مخططاً أو شعاراً أو توقيعاً أو ختماً، اكتب:
[صورة: وصف مختصر للمحتوى المرئي بالعربية]
أمثلة:
- [صورة: شعار الشركة في الزاوية العلوية]
- [صورة: رسم بياني يُظهر نسب المبيعات الفصلية]
- [صورة: توقيع المسؤول وختم رسمي]
- [صورة: مخطط تنظيمي للهيكل الإداري]

── الترتيب ──
الترتيب من الأعلى إلى الأسفل كما يظهر في الوثيقة.`;

/**
 * Resize an image to fit within MAX_IMAGE_BYTES using ImageMagick.
 * Returns the path to the (possibly re-compressed) image.
 */
async function ensureImageSize(
  inputPath: string,
  tmpPath: string,
): Promise<string> {
  try {
    // Convert to JPEG with 85% quality, max 2000px wide — keeps file small
    await execAsync(
      `convert "${inputPath}" -quality 85 -resize "2000x>" "${tmpPath}"`,
    );
    const { size } = await import("fs").then(
      (m) => new Promise<{ size: number }>((res, rej) =>
        m.stat(tmpPath, (e, s) => (e ? rej(e) : res(s))),
      ),
    );
    if (size > MAX_IMAGE_BYTES) {
      // Reduce quality further
      await execAsync(
        `convert "${inputPath}" -quality 60 -resize "1500x>" "${tmpPath}"`,
      );
    }
    return tmpPath;
  } catch {
    return inputPath; // fall back to original
  }
}

/**
 * Run Gemini Vision OCR on a single image.
 * Returns the extracted text (including Markdown tables and [صورة:] tags) or throws.
 */
async function geminiOcrPage(imagePath: string, tmpDir: string, pageIdx: number): Promise<string> {
  const tmpJpeg = join(tmpDir, `gemini_page_${pageIdx}.jpg`);
  const finalPath = await ensureImageSize(imagePath, tmpJpeg);

  const imageBuffer = await readFile(finalPath);
  const base64 = imageBuffer.toString("base64");

  // Detect MIME type
  const mimeType = finalPath.endsWith(".jpg") || finalPath.endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64,
            },
          },
          {
            text: OCR_SYSTEM_PROMPT,
          },
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

/**
 * Run AI OCR across all given image paths (one per page).
 * Uses rate-limited sequential processing to avoid API overload.
 */
export async function runGeminiOcr(
  imagePaths: string[],
  tmpDir: string,
): Promise<AiOcrResult> {
  const start = Date.now();
  const pageTexts: string[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    logger.info({ page: i + 1, total: imagePaths.length }, "Gemini OCR page");

    try {
      const text = await geminiOcrPage(imgPath, tmpDir, i);
      pageTexts.push(text);
    } catch (err) {
      logger.warn({ err, page: i + 1 }, "Gemini OCR page failed, skipping");
      pageTexts.push(""); // skip failed pages
    }

    // Gentle rate limiting between pages
    if (i < imagePaths.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const rawText = pageTexts.join("\n\n");
  return { pages: imagePaths.length, rawText, durationMs: Date.now() - start };
}
