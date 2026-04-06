import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, ocrResultsTable } from "@workspace/db";
import { eq, ilike, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: Router = Router();

router.get("/search", requireAuth, async (req, res): Promise<void> => {
  const q = String(req.query["q"] ?? "").trim().slice(0, 200);
  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  if (!q || q.length < 2) {
    res.json({ results: [], total: 0, page, query: q });
    return;
  }

  const searchPattern = `%${q}%`;

  const rows = await db
    .select({
      jobId: jobsTable.id,
      originalFilename: jobsTable.originalFilename,
      status: jobsTable.status,
      createdAt: jobsTable.createdAt,
      refinedText: ocrResultsTable.refinedText,
      confidenceScore: ocrResultsTable.confidenceScore,
    })
    .from(ocrResultsTable)
    .innerJoin(jobsTable, eq(ocrResultsTable.jobId, jobsTable.id))
    .where(ilike(ocrResultsTable.refinedText, searchPattern))
    .orderBy(desc(jobsTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Count total
  const countRows = await db
    .select({ id: ocrResultsTable.id })
    .from(ocrResultsTable)
    .innerJoin(jobsTable, eq(ocrResultsTable.jobId, jobsTable.id))
    .where(ilike(ocrResultsTable.refinedText, searchPattern));

  const total = countRows.length;

  // Return a snippet of text with match highlighted context (100 chars around match)
  const results = rows.map((row) => {
    const text = row.refinedText ?? "";
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + q.length + 60);
    const snippet = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
    return {
      jobId: row.jobId,
      originalFilename: row.originalFilename,
      status: row.status,
      createdAt: row.createdAt,
      snippet,
      confidenceScore: row.confidenceScore,
    };
  });

  res.json({ results, total, page, query: q });
});

export default router;
