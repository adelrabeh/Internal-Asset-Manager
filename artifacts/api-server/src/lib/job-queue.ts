/**
 * In-memory job queue
 * Processes OCR jobs asynchronously with retry support
 * 
 * Production replacement: Swap with Celery (Python) or BullMQ (Redis)
 */

import { db } from "@workspace/db";
import { jobsTable, ocrResultsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { processOcr } from "./ocr-engine";
import { logger } from "./logger";

const MAX_RETRIES = 3;
const CONCURRENT_WORKERS = 2;

let activeWorkers = 0;
const jobQueue: number[] = [];

async function processJobById(jobId: number): Promise<void> {
  const startTime = Date.now();

  try {
    // Mark as processing
    const [job] = await db
      .update(jobsTable)
      .set({ status: "processing", startedAt: new Date() })
      .where(eq(jobsTable.id, jobId))
      .returning();

    if (!job) {
      logger.warn({ jobId }, "Job not found for processing");
      return;
    }

    logger.info({ jobId, filename: job.filename }, "Processing OCR job");

    // Run OCR engine
    const result = await processOcr(job.filename);

    // Delete any previous result for this job (e.g. when retrying)
    await db.delete(ocrResultsTable).where(eq(ocrResultsTable.jobId, jobId));

    // Save result
    await db.insert(ocrResultsTable).values({
      jobId,
      rawText: result.rawText,
      refinedText: result.refinedText,
      confidenceScore: result.confidenceScore,
      qualityLevel: result.qualityLevel,
      wordCount: result.wordCount,
      lowConfidenceWords: result.lowConfidenceWords,
      passCount: result.passCount,
      processingNotes: result.processingNotes,
    });

    // Mark OCR as complete — awaiting quality review
    const processingDurationMs = Date.now() - startTime;
    await db
      .update(jobsTable)
      .set({
        status: "ocr_complete",
        completedAt: new Date(),
        processingDurationMs,
      })
      .where(eq(jobsTable.id, jobId));

    logger.info(
      { jobId, processingDurationMs, confidenceScore: result.confidenceScore },
      "OCR completed — awaiting quality review",
    );
  } catch (err) {
    logger.error({ err, jobId }, "Job processing failed");

    // Get current retry count
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);

    if (job && job.retryCount < MAX_RETRIES) {
      // Re-queue for retry
      await db
        .update(jobsTable)
        .set({
          status: "pending",
          retryCount: job.retryCount + 1,
          errorMessage: `محاولة ${job.retryCount + 1}: ${(err as Error).message}`,
        })
        .where(eq(jobsTable.id, jobId));

      // Add back to queue with delay
      setTimeout(() => enqueueJob(jobId), 5000 * (job.retryCount + 1));
    } else {
      // Mark as permanently failed
      await db
        .update(jobsTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: (err as Error).message,
        })
        .where(eq(jobsTable.id, jobId));
    }
  }
}

async function runWorker(): Promise<void> {
  if (activeWorkers >= CONCURRENT_WORKERS) return;
  if (jobQueue.length === 0) return;

  const jobId = jobQueue.shift();
  if (!jobId) return;

  activeWorkers++;
  try {
    await processJobById(jobId);
  } finally {
    activeWorkers--;
    // Process next job if any
    if (jobQueue.length > 0) {
      void runWorker();
    }
  }
}

export function enqueueJob(jobId: number): void {
  logger.info({ jobId }, "Enqueuing job for processing");
  jobQueue.push(jobId);
  void runWorker();
}

export function getQueueStatus(): { queueLength: number; activeWorkers: number } {
  return { queueLength: jobQueue.length, activeWorkers };
}

/**
 * On startup, pick up any jobs that were left in "pending" or "processing" state
 * (e.g. after a server restart) and re-enqueue them.
 */
export async function resumePendingJobs(): Promise<void> {
  try {
    const pending = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        // Re-queue pending and stuck-processing jobs
        eq(jobsTable.status, "pending"),
      );

    if (pending.length > 0) {
      logger.info({ count: pending.length }, "Resuming pending jobs on startup");
      for (const row of pending) {
        enqueueJob(row.id);
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to resume pending jobs on startup");
  }
}
