import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, ocrResultsTable, usersTable, projectsTable, projectMembersTable } from "@workspace/db";
import { eq, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { GetRecentActivityQueryParams } from "@workspace/api-zod";

const router: Router = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const [jobStats] = await db
    .select({
      totalJobs: sql<number>`count(*)::int`,
      completedJobs: sql<number>`count(*) filter (where status in ('approved','reviewed','ocr_complete'))::int`,
      approvedJobs: sql<number>`count(*) filter (where status = 'approved')::int`,
      reviewedJobs: sql<number>`count(*) filter (where status = 'reviewed')::int`,
      ocrCompleteJobs: sql<number>`count(*) filter (where status = 'ocr_complete')::int`,
      rejectedJobs: sql<number>`count(*) filter (where status = 'rejected')::int`,
      pendingJobs: sql<number>`count(*) filter (where status = 'pending')::int`,
      processingJobs: sql<number>`count(*) filter (where status = 'processing')::int`,
      failedJobs: sql<number>`count(*) filter (where status = 'failed')::int`,
      avgProcessingTimeMs: sql<number>`coalesce(avg(processing_duration_ms) filter (where status in ('approved','reviewed','ocr_complete')), 0)`,
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
    approvedJobs: jobStats?.approvedJobs ?? 0,
    reviewedJobs: jobStats?.reviewedJobs ?? 0,
    ocrCompleteJobs: jobStats?.ocrCompleteJobs ?? 0,
    rejectedJobs: jobStats?.rejectedJobs ?? 0,
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

// ── Projects Overview ─────────────────────────────────────────────────────────
// Returns per-project statistics for the dashboard.
// Admins see all projects; non-admins see only their member projects.

router.get("/dashboard/projects-overview", requireAuth, async (req, res): Promise<void> => {
  const user = req.session.user!;
  const isAdmin = user.role === "admin";

  // Determine visible project IDs
  let projectIds: number[] | null = null;
  if (!isAdmin) {
    const memberRows = await db
      .select({ projectId: projectMembersTable.projectId })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.userId, user.id));
    projectIds = memberRows.map((r) => r.projectId);
    if (projectIds.length === 0) {
      res.json([]);
      return;
    }
  }

  // Fetch projects
  const projects = projectIds
    ? await db.select().from(projectsTable).where(inArray(projectsTable.id, projectIds))
    : await db.select().from(projectsTable);

  if (projects.length === 0) {
    res.json([]);
    return;
  }

  const pIds = projects.map((p) => p.id);

  // Per-project job counts by status (raw SQL aggregation)
  const jobCounts = await db
    .select({
      projectId: jobsTable.projectId,
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
      processing: sql<number>`count(*) filter (where status = 'processing')::int`,
      ocrComplete: sql<number>`count(*) filter (where status = 'ocr_complete')::int`,
      reviewed: sql<number>`count(*) filter (where status = 'reviewed')::int`,
      approved: sql<number>`count(*) filter (where status = 'approved')::int`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    })
    .from(jobsTable)
    .where(inArray(jobsTable.projectId, pIds))
    .groupBy(jobsTable.projectId);

  // Per-project quality (join with ocr_results)
  const qualityData = await db
    .select({
      projectId: jobsTable.projectId,
      avgConfidence: sql<number>`coalesce(avg(${ocrResultsTable.confidenceScore}), 0)`,
      highCount: sql<number>`count(*) filter (where ${ocrResultsTable.qualityLevel} = 'high')::int`,
      medCount: sql<number>`count(*) filter (where ${ocrResultsTable.qualityLevel} = 'medium')::int`,
      lowCount: sql<number>`count(*) filter (where ${ocrResultsTable.qualityLevel} = 'low')::int`,
    })
    .from(ocrResultsTable)
    .innerJoin(jobsTable, eq(ocrResultsTable.jobId, jobsTable.id))
    .where(inArray(jobsTable.projectId, pIds))
    .groupBy(jobsTable.projectId);

  // Per-project member count
  const memberCounts = await db
    .select({
      projectId: projectMembersTable.projectId,
      memberCount: sql<number>`count(*)::int`,
    })
    .from(projectMembersTable)
    .where(inArray(projectMembersTable.projectId, pIds))
    .groupBy(projectMembersTable.projectId);

  // Build lookup maps
  const jobMap = new Map(jobCounts.map((r) => [r.projectId, r]));
  const qualityMap = new Map(qualityData.map((r) => [r.projectId, r]));
  const memberMap = new Map(memberCounts.map((r) => [r.projectId, r.memberCount]));

  const result = projects.map((p) => {
    const j = jobMap.get(p.id);
    const q = qualityMap.get(p.id);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      folderPath: p.folderPath,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      memberCount: memberMap.get(p.id) ?? 0,
      jobs: {
        total: j?.total ?? 0,
        pending: j?.pending ?? 0,
        processing: j?.processing ?? 0,
        ocrComplete: j?.ocrComplete ?? 0,
        reviewed: j?.reviewed ?? 0,
        approved: j?.approved ?? 0,
        rejected: j?.rejected ?? 0,
        failed: j?.failed ?? 0,
      },
      quality: {
        avgConfidence: Math.round((q?.avgConfidence ?? 0) * 10) / 10,
        highCount: q?.highCount ?? 0,
        medCount: q?.medCount ?? 0,
        lowCount: q?.lowCount ?? 0,
      },
    };
  });

  // Sort: active first, then by total jobs desc
  result.sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (b.status === "active" && a.status !== "active") return 1;
    return b.jobs.total - a.jobs.total;
  });

  res.json(result);
});

export default router;
