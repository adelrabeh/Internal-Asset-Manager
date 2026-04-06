import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, ocrResultsTable, usersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { GetRecentActivityQueryParams } from "@workspace/api-zod";

const router: Router = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const [jobStats] = await db
    .select({
      totalJobs: sql<number>`count(*)::int`,
      completedJobs: sql<number>`count(*) filter (where status = 'completed')::int`,
      pendingJobs: sql<number>`count(*) filter (where status = 'pending')::int`,
      processingJobs: sql<number>`count(*) filter (where status = 'processing')::int`,
      failedJobs: sql<number>`count(*) filter (where status = 'failed')::int`,
      avgProcessingTimeMs: sql<number>`coalesce(avg(processing_duration_ms) filter (where status = 'completed'), 0)`,
    })
    .from(jobsTable);

  const [qualityStats] = await db
    .select({
      avgConfidenceScore: sql<number>`coalesce(avg(confidence_score), 0)`,
      highQualityCount: sql<number>`count(*) filter (where quality_level = 'high')::int`,
      mediumQualityCount: sql<number>`count(*) filter (where quality_level = 'medium')::int`,
      lowQualityCount: sql<number>`count(*) filter (where quality_level = 'low')::int`,
    })
    .from(ocrResultsTable);

  const [userCount] = await db
    .select({ totalUsers: sql<number>`count(*)::int` })
    .from(usersTable);

  res.json({
    totalJobs: jobStats?.totalJobs ?? 0,
    completedJobs: jobStats?.completedJobs ?? 0,
    pendingJobs: jobStats?.pendingJobs ?? 0,
    processingJobs: jobStats?.processingJobs ?? 0,
    failedJobs: jobStats?.failedJobs ?? 0,
    avgProcessingTimeMs: Math.round(jobStats?.avgProcessingTimeMs ?? 0),
    avgConfidenceScore: Math.round(qualityStats?.avgConfidenceScore ?? 0),
    highQualityCount: qualityStats?.highQualityCount ?? 0,
    mediumQualityCount: qualityStats?.mediumQualityCount ?? 0,
    lowQualityCount: qualityStats?.lowQualityCount ?? 0,
    totalUsers: userCount?.totalUsers ?? 0,
  });
});

router.get("/dashboard/recent-activity", requireAuth, async (req, res): Promise<void> => {
  const parsed = GetRecentActivityQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 10) : 10;

  const activity = await db
    .select({
      id: jobsTable.id,
      jobId: jobsTable.id,
      filename: jobsTable.originalFilename,
      status: jobsTable.status,
      confidenceScore: ocrResultsTable.confidenceScore,
      qualityLevel: ocrResultsTable.qualityLevel,
      createdAt: jobsTable.createdAt,
      username: usersTable.username,
    })
    .from(jobsTable)
    .leftJoin(ocrResultsTable, eq(ocrResultsTable.jobId, jobsTable.id))
    .leftJoin(usersTable, eq(usersTable.id, jobsTable.userId))
    .orderBy(desc(jobsTable.createdAt))
    .limit(limit);

  res.json(activity);
});

router.get("/dashboard/quality-metrics", requireAuth, async (req, res): Promise<void> => {
  const [metrics] = await db
    .select({
      avgConfidence: sql<number>`coalesce(avg(confidence_score), 0)`,
      highQualityPct: sql<number>`coalesce(count(*) filter (where quality_level = 'high') * 100.0 / nullif(count(*), 0), 0)`,
      mediumQualityPct: sql<number>`coalesce(count(*) filter (where quality_level = 'medium') * 100.0 / nullif(count(*), 0), 0)`,
      lowQualityPct: sql<number>`coalesce(count(*) filter (where quality_level = 'low') * 100.0 / nullif(count(*), 0), 0)`,
      totalProcessed: sql<number>`count(*)::int`,
      avgWordsPerDoc: sql<number>`coalesce(avg(word_count), 0)`,
    })
    .from(ocrResultsTable);

  res.json({
    avgConfidence: Math.round((metrics?.avgConfidence ?? 0) * 10) / 10,
    highQualityPct: Math.round((metrics?.highQualityPct ?? 0) * 10) / 10,
    mediumQualityPct: Math.round((metrics?.mediumQualityPct ?? 0) * 10) / 10,
    lowQualityPct: Math.round((metrics?.lowQualityPct ?? 0) * 10) / 10,
    totalProcessed: metrics?.totalProcessed ?? 0,
    avgWordsPerDoc: Math.round(metrics?.avgWordsPerDoc ?? 0),
  });
});

export default router;
