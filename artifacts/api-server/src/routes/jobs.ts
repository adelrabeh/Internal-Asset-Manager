import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, ocrResultsTable } from "@workspace/db";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { join } from "path";
import { requireAuth, requirePermission } from "../lib/auth";
import { enqueueJob } from "../lib/job-queue";
import { logAction } from "../lib/audit";
import { notifyJobReviewed, notifyJobFinalised } from "../lib/sse";
import archiver from "archiver";
import { generateDocx } from "../lib/docx-generator";

import {
  CreateJobBody,
  GetJobParams,
  ListJobsQueryParams,
  DeleteJobParams,
  RetryJobParams,
  ProcessJobParams,
} from "@workspace/api-zod";

const router: Router = Router();
const UPLOADS_DIR_CONST = process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");

router.get("/jobs", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListJobsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { status, page = 1, limit = 20 } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) {
    conditions.push(eq(jobsTable.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [jobs, countResult] = await Promise.all([
    db
      .select()
      .from(jobsTable)
      .where(whereClause)
      .orderBy(desc(jobsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  res.json({ jobs, total, page, limit });
});

router.post("/jobs", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.session.user!.id;

  const [job] = await db
    .insert(jobsTable)
    .values({
      userId,
      filename: parsed.data.filename,
      originalFilename: parsed.data.originalFilename,
      fileType: parsed.data.fileType,
      fileSize: parsed.data.fileSize,
      status: "pending",
    })
    .returning();

  await logAction(req, "JOB_CREATED", "job", job.id, `Job created: ${parsed.data.originalFilename}`);

  // Immediately enqueue for processing
  enqueueJob(job.id);

  res.status(201).json(job);
});

router.get("/jobs/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, params.data.id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "المهمة غير موجودة." });
    return;
  }

  res.json(job);
});

router.delete("/jobs/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db
    .delete(jobsTable)
    .where(eq(jobsTable.id, params.data.id))
    .returning();

  if (!job) {
    res.status(404).json({ error: "المهمة غير موجودة." });
    return;
  }

  await logAction(req, "JOB_DELETED", "job", params.data.id, `Job deleted: ${job.originalFilename}`);

  res.sendStatus(204);
});

router.post("/jobs/:id/retry", requireAuth, async (req, res): Promise<void> => {
  const params = RetryJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, params.data.id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "المهمة غير موجودة." });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({ status: "pending", errorMessage: null, retryCount: job.retryCount + 1 })
    .where(eq(jobsTable.id, params.data.id))
    .returning();

  enqueueJob(params.data.id);

  await logAction(req, "JOB_RETRIED", "job", params.data.id, `Job queued for retry #${job.retryCount + 1}`);

  res.json(updated);
});

router.post("/jobs/:id/process", requireAuth, async (req, res): Promise<void> => {
  const params = ProcessJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, params.data.id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "المهمة غير موجودة." });
    return;
  }

  if (job.status === "processing") {
    res.status(409).json({ error: "المهمة قيد المعالجة حالياً." });
    return;
  }

  // Reset to pending and enqueue
  const [updated] = await db
    .update(jobsTable)
    .set({ status: "pending", completedAt: null, startedAt: null, errorMessage: null })
    .where(eq(jobsTable.id, params.data.id))
    .returning();

  enqueueJob(params.data.id);

  await logAction(req, "JOB_PROCESSED", "job", params.data.id, `Job queued for processing: ${job.originalFilename}`);

  res.json(updated);
});

// ── Quality Review Routes ─────────────────────────────────────────────────────

router.post(
  "/jobs/:id/review",
  requireAuth,
  requirePermission("review"),
  async (req, res): Promise<void> => {
    const jobId = parseInt(req.params.id, 10);
    if (isNaN(jobId) || jobId <= 0) {
      res.status(400).json({ error: "معرّف المهمة غير صالح." });
      return;
    }

    const { action, notes } = req.body as { action?: string; notes?: string };
    if (action !== "approve" && action !== "reject") {
      res.status(400).json({ error: "الإجراء يجب أن يكون 'approve' أو 'reject'." });
      return;
    }
    if (notes && notes.length > 1000) {
      res.status(400).json({ error: "الملاحظات يجب أن تكون أقل من 1000 حرف." });
      return;
    }

    const [job] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);

    if (!job) {
      res.status(404).json({ error: "المهمة غير موجودة." });
      return;
    }

    if (job.status !== "ocr_complete") {
      res.status(409).json({
        error: `لا يمكن مراجعة مهمة بحالة "${job.status}". يجب أن تكون المهمة في مرحلة "بانتظار المراجعة".`,
      });
      return;
    }

    const newStatus = action === "approve" ? "reviewed" : "rejected";
    const reviewerId = req.session.user!.id;

    const [updated] = await db
      .update(jobsTable)
      .set({
        status: newStatus,
        reviewerId,
        reviewedAt: new Date(),
        reviewNotes: notes ?? null,
      })
      .where(eq(jobsTable.id, jobId))
      .returning();

    const actionLabel = newStatus === "reviewed" ? "JOB_REVIEWED" : "JOB_REJECTED_BY_REVIEWER";
    await logAction(
      req,
      actionLabel,
      "job",
      jobId,
      `Job ${newStatus}: ${job.originalFilename}${notes ? ` — ${notes}` : ""}`,
    );

    // Notify approvers via SSE when job is reviewed (ready for final approval)
    if (newStatus === "reviewed") {
      notifyJobReviewed(jobId, job.originalFilename);
    }

    res.json(updated);
  },
);

// ── Final Approval Route ──────────────────────────────────────────────────────

router.post(
  "/jobs/:id/approve",
  requireAuth,
  requirePermission("approve"),
  async (req, res): Promise<void> => {
    const jobId = parseInt(req.params.id, 10);
    if (isNaN(jobId) || jobId <= 0) {
      res.status(400).json({ error: "معرّف المهمة غير صالح." });
      return;
    }

    const { action, notes } = req.body as { action?: string; notes?: string };
    if (action !== "approve" && action !== "reject") {
      res.status(400).json({ error: "الإجراء يجب أن يكون 'approve' أو 'reject'." });
      return;
    }
    if (notes && notes.length > 1000) {
      res.status(400).json({ error: "الملاحظات يجب أن تكون أقل من 1000 حرف." });
      return;
    }

    const [job] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);

    if (!job) {
      res.status(404).json({ error: "المهمة غير موجودة." });
      return;
    }

    if (job.status !== "reviewed") {
      res.status(409).json({
        error: `لا يمكن اعتماد مهمة بحالة "${job.status}". يجب أن تكون المهمة في مرحلة "تمت المراجعة".`,
      });
      return;
    }

    const newStatus = action === "approve" ? "approved" : "rejected";
    const approverId = req.session.user!.id;

    const [updated] = await db
      .update(jobsTable)
      .set({
        status: newStatus,
        approverId,
        approvedAt: new Date(),
        approveNotes: notes ?? null,
      })
      .where(eq(jobsTable.id, jobId))
      .returning();

    const actionLabel = newStatus === "approved" ? "JOB_APPROVED" : "JOB_REJECTED_BY_APPROVER";
    await logAction(
      req,
      actionLabel,
      "job",
      jobId,
      `Job ${newStatus} (final): ${job.originalFilename}${notes ? ` — ${notes}` : ""}`,
    );

    // Notify all users via SSE
    notifyJobFinalised(jobId, job.originalFilename, newStatus === "approved");

    res.json(updated);
  },
);

// ── Preview (serve original uploaded file) ────────────────────────────────────

router.get("/jobs/:id/preview", requireAuth, async (req, res): Promise<void> => {
  const jobId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(jobId)) {
    res.status(400).json({ error: "معرّف غير صالح." });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (!job) {
    res.status(404).json({ error: "المهمة غير موجودة." });
    return;
  }

  const fs = await import("node:fs");
  const path = await import("node:path");
  const uploadsDir = process.env["UPLOADS_DIR"] ?? "./uploads";
  const filePath = path.join(uploadsDir, job.filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "الملف غير موجود على الخادم." });
    return;
  }

  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    pdf: "application/pdf",
  };
  const ext = job.filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = mimeTypes[ext] ?? "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  fs.createReadStream(filePath).pipe(res);
});

// ── Bulk Export as ZIP ────────────────────────────────────────────────────────

router.post("/jobs/bulk-export", requireAuth, async (req, res): Promise<void> => {
  const rawIds = req.body?.jobIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 50) {
    res.status(400).json({ error: "يجب تحديد ما بين 1 و 50 مهمة للتصدير." });
    return;
  }

  const jobIds: number[] = rawIds.map(Number).filter((n) => !isNaN(n) && n > 0);
  if (jobIds.length === 0) {
    res.status(400).json({ error: "معرّفات المهام غير صالحة." });
    return;
  }

  // Fetch jobs with OCR results
  const rows = await db
    .select({
      job: jobsTable,
      result: ocrResultsTable,
    })
    .from(jobsTable)
    .innerJoin(ocrResultsTable, eq(ocrResultsTable.jobId, jobsTable.id))
    .where(inArray(jobsTable.id, jobIds));

  if (rows.length === 0) {
    res.status(404).json({ error: "لا توجد مهام بنتائج OCR للتصدير." });
    return;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="ocr-export-${Date.now()}.zip"`);

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(res);

  for (const { job, result } of rows) {
    try {
      const sourceFilePath = job.filename
        ? join(UPLOADS_DIR_CONST, job.filename)
        : undefined;
      const docxBuffer = await generateDocx({
        title: job.originalFilename,
        filename: job.originalFilename,
        text: result.refinedText,
        confidenceScore: result.confidenceScore,
        qualityLevel: result.qualityLevel,
        processedAt: result.createdAt,
        sourceFilePath,
      });
      const safeName = job.originalFilename.replace(/[^a-zA-Z0-9\u0600-\u06FF._-]/g, "_");
      const entryName = `${job.id}_${safeName.replace(/\.[^.]+$/, "")}.docx`;
      archive.append(docxBuffer, { name: entryName });
    } catch {
      // Skip files that fail to generate
    }
  }

  await logAction(req, "BULK_EXPORT", "job", undefined, `Bulk export: ${rows.length} jobs`);

  await archive.finalize();
});

export default router;
