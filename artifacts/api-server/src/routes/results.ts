import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, ocrResultsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { generateDocx } from "../lib/docx-generator";
import { logAction } from "../lib/audit";
import { GetJobResultParams, DownloadDocxParams, DownloadTextParams } from "@workspace/api-zod";

const router: Router = Router();

router.get("/jobs/:id/result", requireAuth, async (req, res): Promise<void> => {
  const params = GetJobResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db
    .select()
    .from(ocrResultsTable)
    .where(eq(ocrResultsTable.jobId, params.data.id))
    .limit(1);

  if (!result) {
    res.status(404).json({ error: "النتيجة غير متوفرة. قد تكون المهمة لا تزال قيد المعالجة." });
    return;
  }

  res.json(result);
});

router.get("/jobs/:id/download/docx", requireAuth, async (req, res): Promise<void> => {
  const params = DownloadDocxParams.safeParse(req.params);
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

  const [result] = await db
    .select()
    .from(ocrResultsTable)
    .where(eq(ocrResultsTable.jobId, params.data.id))
    .limit(1);

  if (!result) {
    res.status(404).json({ error: "نتيجة المعالجة غير متوفرة." });
    return;
  }

  const buffer = await generateDocx({
    title: job.originalFilename,
    filename: job.originalFilename,
    text: result.refinedText,
    confidenceScore: result.confidenceScore,
    qualityLevel: result.qualityLevel,
    processedAt: result.createdAt,
  });

  const safeFilename = encodeURIComponent(
    job.originalFilename.replace(/\.[^.]+$/, "") + "_ocr.docx",
  );

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeFilename}`);
  res.setHeader("Content-Length", buffer.length);

  await logAction(req, "DOWNLOAD_DOCX", "result", result.id, `Downloaded DOCX for job ${params.data.id}`);

  res.send(buffer);
});

router.get("/jobs/:id/download/text", requireAuth, async (req, res): Promise<void> => {
  const params = DownloadTextParams.safeParse(req.params);
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

  const [result] = await db
    .select()
    .from(ocrResultsTable)
    .where(eq(ocrResultsTable.jobId, params.data.id))
    .limit(1);

  if (!result) {
    res.status(404).json({ error: "نتيجة المعالجة غير متوفرة." });
    return;
  }

  const safeFilename = encodeURIComponent(
    job.originalFilename.replace(/\.[^.]+$/, "") + "_ocr.txt",
  );

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeFilename}`);

  await logAction(req, "DOWNLOAD_TEXT", "result", result.id, `Downloaded text for job ${params.data.id}`);

  res.send(result.refinedText);
});

export default router;
