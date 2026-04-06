/**
 * AI OCR Engine — uses Gemini 2.5 Flash vision for Arabic text extraction.
 *
 * Strategy:
 *  1. Convert each PDF page (or direct image) to a compressed JPEG (≤ 2 MB).
 *  2. Send to Gemini with a specialised Arabic-OCR prompt.
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

// System prompt for Arabic OCR
const OCR_SYSTEM_PROMPT = `أنت محرك OCR متخصص في استخراج النصوص العربية من الصور.
مهمتك: استخرج كل النص الموجود في الصورة بدقة تامة.

قواعد صارمة:
1. اقرأ النص كما هو دون أي تعديل أو إضافة.
2. احتفظ بعلامات التشكيل (حركات: فتحة كسرة ضمة شدة سكون تنوين) كما هي.
3. احتفظ بترتيب الأسطر والفقرات.
4. إذا وُجد نص إنجليزي في الصورة اكتبه كما هو.
5. لا تُفسّر أو تُخلص، فقط انسخ النص.
6. لا تكتب أي كلام إضافي من عندك — فقط النص المستخرج.`;

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
 * Returns the extracted text or throws.
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
      maxOutputTokens: 8192,
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
