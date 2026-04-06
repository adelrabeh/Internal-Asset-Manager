import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

export const ocrResultsTable = pgTable("ocr_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id).unique(),
  rawText: text("raw_text").notNull(),
  refinedText: text("refined_text").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  qualityLevel: text("quality_level", { enum: ["high", "medium", "low"] }).notNull(),
  wordCount: integer("word_count").notNull(),
  lowConfidenceWords: jsonb("low_confidence_words").notNull().$type<Array<{ word: string; confidence: number; position: number }>>(),
  passCount: integer("pass_count").notNull().default(3),
  processingNotes: text("processing_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOcrResultSchema = createInsertSchema(ocrResultsTable).omit({ id: true, createdAt: true });
export type InsertOcrResult = z.infer<typeof insertOcrResultSchema>;
export type OcrResult = typeof ocrResultsTable.$inferSelect;
