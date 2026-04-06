import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";

const router: Router = Router();

router.get("/audit-logs", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListAuditLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 50;
  const offset = (page - 1) * limit;

  const [logs, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogsTable),
  ]);

  const total = countResult[0]?.count ?? 0;

  res.json({ logs, total, page, limit });
});

export default router;
