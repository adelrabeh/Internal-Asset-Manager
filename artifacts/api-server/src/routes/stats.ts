import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, usersTable } from "@workspace/db";
import { eq, count, avg, and, isNotNull, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router: Router = Router();

router.get("/admin/stats/users", requireAdmin, async (req, res): Promise<void> => {
  // Per-user: jobs uploaded
  const uploadsPerUser = await db
    .select({
      userId: jobsTable.userId,
      uploaded: count(),
    })
    .from(jobsTable)
    .groupBy(jobsTable.userId);

  // Per-user: jobs reviewed (as reviewer)
  const reviewedPerUser = await db
    .select({
      userId: jobsTable.reviewerId,
      reviewed: count(),
    })
    .from(jobsTable)
    .where(isNotNull(jobsTable.reviewerId))
    .groupBy(jobsTable.reviewerId);

  // Per-user: jobs approved (as approver)
  const approvedPerUser = await db
    .select({
      userId: jobsTable.approverId,
      approved: count(),
    })
    .from(jobsTable)
    .where(isNotNull(jobsTable.approverId))
    .groupBy(jobsTable.approverId);

  // Average processing time per uploader
  const avgTimePerUser = await db
    .select({
      userId: jobsTable.userId,
      avgMs: avg(jobsTable.processingDurationMs),
    })
    .from(jobsTable)
    .where(isNotNull(jobsTable.processingDurationMs))
    .groupBy(jobsTable.userId);

  // All users
  const users = await db
    .select({ id: usersTable.id, username: usersTable.username, role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable)
    .orderBy(usersTable.createdAt);

  const uploadMap = new Map(uploadsPerUser.map((r) => [r.userId, Number(r.uploaded)]));
  const reviewMap = new Map(reviewedPerUser.map((r) => [r.userId, Number(r.reviewed)]));
  const approveMap = new Map(approvedPerUser.map((r) => [r.userId, Number(r.approved)]));
  const avgMap = new Map(avgTimePerUser.map((r) => [r.userId, r.avgMs ? Math.round(Number(r.avgMs) / 1000) : null]));

  const result = users.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    isActive: u.isActive,
    uploaded: uploadMap.get(u.id) ?? 0,
    reviewed: reviewMap.get(u.id) ?? 0,
    approved: approveMap.get(u.id) ?? 0,
    avgProcessingSeconds: avgMap.get(u.id) ?? null,
  }));

  res.json(result);
});

export default router;
