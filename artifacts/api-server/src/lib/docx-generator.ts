/**
 * Word Document Generator
 * Generates properly formatted RTL Arabic .docx files from OCR results
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageOrientation,
  SectionType,
} from "docx";

export interface DocxGenerateOptions {
  title: string;
  filename: string;
  text: string;
  confidenceScore: number;
  qualityLevel: string;
  processedAt: Date;
}

export async function generateDocx(options: DocxGenerateOptions): Promise<Buffer> {
  const { title, filename, text, confidenceScore, qualityLevel, processedAt } = options;

  const paragraphs = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const doc = new Document({
    creator: "منظومة رقمنة الوثائق",
    title: title,
    description: `وثيقة مستخرجة بنظام التعرف الضوئي على الحروف - درجة الثقة: ${confidenceScore}%`,
    styles: {
      default: {
        document: {
          run: {
            font: "Arial",
            size: 24,
            rtl: true,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          type: SectionType.CONTINUOUS,
          page: {
            size: {
              orientation: PageOrientation.PORTRAIT,
            },
          },
        },
        children: [
          // Header
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({
                text: "وثيقة مُرقمَّنة",
                bold: true,
                size: 32,
                rtl: true,
                font: "Arial",
              }),
            ],
          }),

          // Metadata section
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            bidirectional: true,
            children: [
              new TextRun({
                text: `اسم الملف: ${filename}`,
                size: 20,
                rtl: true,
                font: "Arial",
                color: "666666",
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            bidirectional: true,
            children: [
              new TextRun({
                text: `تاريخ المعالجة: ${processedAt.toLocaleDateString("ar-SA")}`,
                size: 20,
                rtl: true,
                font: "Arial",
                color: "666666",
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            bidirectional: true,
            children: [
              new TextRun({
                text: `درجة الثقة: ${confidenceScore}% | مستوى الجودة: ${
                  qualityLevel === "high"
                    ? "عالية"
                    : qualityLevel === "medium"
                      ? "متوسطة"
                      : "منخفضة"
                }`,
                size: 20,
                rtl: true,
                font: "Arial",
                color: "444444",
                bold: true,
              }),
            ],
          }),

          // Divider
          new Paragraph({
            children: [new TextRun({ text: "─".repeat(60), color: "CCCCCC" })],
          }),

          // Empty line
          new Paragraph({ children: [] }),

          // Main content
          ...paragraphs.map(
            (line) =>
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                bidirectional: true,
                children: [
                  new TextRun({
                    text: line,
                    size: 24,
                    rtl: true,
                    font: "Arial",
                  }),
                ],
              }),
          ),

          // Footer
          new Paragraph({ children: [] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({
                text: "تم إنتاج هذه الوثيقة بواسطة منظومة رقمنة الوثائق الداخلية",
                size: 16,
                italics: true,
                color: "999999",
                rtl: true,
                font: "Arial",
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}
