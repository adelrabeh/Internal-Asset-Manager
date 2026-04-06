import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, usersTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { enqueueJob } from "../lib/job-queue";
import { logAction } from "../lib/audit";
import {
  CreateJobBody,
  GetJobParams,
  ListJobsQueryParams,
  DeleteJobParams,
  RetryJobParams,
  ProcessJobParams,
} from "@workspace/api-zod";

const router: Router = Router();

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

export default router;
