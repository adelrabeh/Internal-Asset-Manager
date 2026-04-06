/**
 * OCR Engine Module
 * 
 * Self-contained local OCR processing engine with:
 * - Multi-pass processing simulation
 * - Confidence scoring per word
 * - Arabic text normalization
 * - Auto QA and spell correction heuristics
 * 
 * Architecture: Designed as a pluggable module. 
 * Replace processOcr() with a real PaddleOCR Python service call when available.
 */

import { logger } from "./logger";

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

// Arabic common words dictionary for spell-check heuristics
const ARABIC_COMMON_WORDS = new Set([
  "في", "من", "إلى", "على", "عن", "مع", "هذا", "هذه", "ذلك", "التي", "الذي",
  "كان", "كانت", "يكون", "هو", "هي", "هم", "نحن", "أنت", "أنا", "لكن",
  "أو", "و", "ثم", "أن", "إن", "لا", "لم", "لن", "قد", "ما", "ليس",
  "كل", "بعض", "جميع", "أكثر", "أقل", "كبير", "صغير", "جديد", "قديم",
  "الجمهورية", "الحكومة", "الوطني", "المجلس", "الوزير", "الرئيس",
  "المواطن", "الدولة", "القانون", "الأمن", "المدير", "الإدارة",
]);

// Common OCR errors in Arabic handwriting
const ARABIC_CORRECTIONS: Record<string, string> = {
  "ا": "أ",
  "ه": "ة",
  "ي": "ى",
  "لألأ": "للا",
  "ﻻ": "لا",
};

/**
 * Normalize Arabic text — handle common OCR artifacts
 */
function normalizeArabicText(text: string): string {
  let normalized = text;
  // Normalize Arabic presentation forms to base characters
  // Remove Zero Width Non-Joiners/Joiners
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Normalize different forms of Alef
  normalized = normalized.replace(/[\u0622\u0623\u0625]/g, "\u0627");
  // Remove extra spaces
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

/**
 * Simulate per-word confidence scoring
 */
function scoreWords(text: string): OcrWord[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return words.map((word, index) => {
    let confidence = 0.75 + Math.random() * 0.24; // base 75–99%
    
    // Known Arabic words get higher confidence
    if (ARABIC_COMMON_WORDS.has(word)) {
      confidence = Math.min(confidence + 0.1, 0.99);
    }
    
    // Short words or unusual chars get lower confidence
    if (word.length === 1 || /[^\u0600-\u06FF\s\w]/.test(word)) {
      confidence = Math.max(confidence - 0.15, 0.4);
    }
    
    // Numeric sequences are reliable
    if (/^\d+$/.test(word)) {
      confidence = 0.95 + Math.random() * 0.04;
    }

    return { word, confidence: Math.round(confidence * 100) / 100, position: index };
  });
}

/**
 * Auto-correct text using heuristics
 */
function autoCorrect(text: string): string {
  let corrected = text;
  for (const [wrong, right] of Object.entries(ARABIC_CORRECTIONS)) {
    corrected = corrected.replaceAll(wrong, right);
  }
  return corrected;
}

/**
 * Simulate multiple OCR passes with varying preprocessing strategies
 * In production, each pass would call PaddleOCR with different params:
 * - Pass 1: Standard preprocessing
 * - Pass 2: Noise removal + binarization
 * - Pass 3: Contrast enhancement + deskew
 */
function runOcrPasses(filename: string): OcrPassResult[] {
  // Sample texts representing different quality levels of handwritten OCR
  const sampleTexts = [
    `بسم الله الرحمن الرحيم
    
وزارة الداخلية - إدارة الشؤون المدنية
رقم الوثيقة: ${Math.floor(Math.random() * 900000) + 100000}

يُشهد بأن السيد / ${["محمد أحمد العلي", "عبدالله سالم المنصوري", "فاطمة عمر الراشدي"][Math.floor(Math.random() * 3)]}
المولود بتاريخ ${Math.floor(Math.random() * 28) + 1}/${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 30) + 1975}

قد استوفى جميع الشروط المطلوبة وفقاً للأنظمة والتعليمات المعمول بها.

المدير العام
التوقيع: _______________
التاريخ: ${new Date().toLocaleDateString("ar-SA")}`,

    `جمهورية مصر العربية
محافظة القاهرة
مديرية الصحة

شهادة طبية رقم ${Math.floor(Math.random() * 99999)}

بناءً على الكشف الطبي الذي أجري على المريض
الاسم: ${["أحمد محمد السيد", "سارة علي حسن", "عمر خالد يوسف"][Math.floor(Math.random() * 3)]}
تاريخ الفحص: ${new Date().toLocaleDateString("ar-EG")}

يتمتع بصحة جيدة ولا يعاني من أي أمراض مزمنة أو معدية.
صالح للعمل في جميع البيئات المكتبية.

الطبيب المعالج
الدكتور / محمود إبراهيم
رقم القيد: ١٢٣٤٥`,

    `دولة الإمارات العربية المتحدة
وزارة الموارد البشرية والتوطين

طلب تصريح عمل

بيانات صاحب العمل:
اسم الشركة: ${["شركة التقنية المتقدمة", "مجموعة الخليج للاستثمار", "شركة الإمارات للخدمات"][Math.floor(Math.random() * 3)]}
رقم السجل التجاري: ${Math.floor(Math.random() * 9000000) + 1000000}
النشاط التجاري: تقنية المعلومات والاتصالات

بيانات الموظف المطلوب:
المسمى الوظيفي: مهندس برمجيات أول
المؤهل المطلوب: بكالوريوس تقنية المعلومات

التوقيع المفوّض: _______________
الختم الرسمي: ◻`,
  ];

  const baseText = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
  
  // Simulate 3 passes with slight variations
  const passes: OcrPassResult[] = [];
  for (let i = 0; i < 3; i++) {
    // Introduce slight noise per pass to simulate different preprocessing
    const noiseLevel = i === 1 ? 0.02 : 0.01;
    const words = scoreWords(baseText);
    
    // Reduce noise on later passes (better preprocessing)
    const adjustedWords = words.map((w) => ({
      ...w,
      confidence: Math.min(w.confidence + i * 0.03 - noiseLevel, 0.99),
    }));

    const avgConfidence =
      adjustedWords.reduce((sum, w) => sum + w.confidence, 0) / adjustedWords.length;

    passes.push({
      text: baseText,
      words: adjustedWords,
      avgConfidence,
    });
  }

  return passes;
}

/**
 * Aggregate results from multiple passes using confidence voting
 */
function aggregatePasses(passes: OcrPassResult[]): {
  text: string;
  words: OcrWord[];
  avgConfidence: number;
} {
  // Use the best pass as primary (highest avg confidence)
  const bestPass = passes.reduce((best, current) =>
    current.avgConfidence > best.avgConfidence ? current : best,
  );

  // Average confidence scores across passes per position
  const aggregatedWords = bestPass.words.map((word, index) => {
    const confidences = passes.map(
      (p) => p.words[index]?.confidence ?? word.confidence,
    );
    const avgConf = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    return { ...word, confidence: Math.round(avgConf * 100) / 100 };
  });

  const avgConfidence =
    aggregatedWords.reduce((sum, w) => sum + w.confidence, 0) /
    aggregatedWords.length;

  return { text: bestPass.text, words: aggregatedWords, avgConfidence };
}

/**
 * Main OCR processing function
 * 
 * @param filename - The stored filename to process
 * @returns Full OCR result with confidence scoring
 */
export async function processOcr(filename: string): Promise<OcrEngineResult> {
  const startTime = Date.now();
  
  logger.info({ filename }, "Starting OCR processing");

  // Simulate processing time (2-5 seconds for realistic feel)
  await new Promise((resolve) =>
    setTimeout(resolve, 2000 + Math.random() * 3000),
  );

  // Run multi-pass OCR
  const passes = runOcrPasses(filename);
  const { text: rawText, words, avgConfidence } = aggregatePasses(passes);

  // Apply auto-correction
  const normalizedText = normalizeArabicText(rawText);
  const correctedText = autoCorrect(normalizedText);

  // Identify low-confidence words (below 80%)
  const LOW_CONFIDENCE_THRESHOLD = 0.80;
  const lowConfidenceWords = words
    .filter((w) => w.confidence < LOW_CONFIDENCE_THRESHOLD)
    .slice(0, 20); // Cap at 20 flagged words

  const confidenceScore = Math.round(avgConfidence * 100);
  
  // Classify quality
  let qualityLevel: "high" | "medium" | "low";
  let processingNotes: string;
  
  if (confidenceScore >= 85) {
    qualityLevel = "high";
    processingNotes = "اكتملت المعالجة بنجاح. جودة عالية للنص المستخرج.";
  } else if (confidenceScore >= 65) {
    qualityLevel = "medium";
    processingNotes = `تم رصد ${lowConfidenceWords.length} كلمة بمستوى ثقة منخفض. يُنصح بمراجعة النص المُعلَّم.`;
  } else {
    qualityLevel = "low";
    processingNotes = "جودة الصورة منخفضة. يُنصح بإعادة المسح الضوئي بدقة أعلى.";
  }

  const processingDurationMs = Date.now() - startTime;

  logger.info(
    { filename, confidenceScore, qualityLevel, processingDurationMs },
    "OCR processing completed",
  );

  return {
    rawText,
    refinedText: correctedText,
    confidenceScore,
    qualityLevel,
    wordCount: words.length,
    lowConfidenceWords,
    passCount: passes.length,
    processingNotes,
    processingDurationMs,
  };
}
