import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { desc, sql, and, ilike } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router: Router = Router();

router.get("/audit-logs", requireAdmin, async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));
  const action = String(req.query["action"] ?? "").trim().slice(0, 64);
  const username = String(req.query["username"] ?? "").trim().slice(0, 64);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (action && action.length > 0) {
    conditions.push(ilike(auditLogsTable.action, `%${action}%`));
  }
  if (username && username.length > 0) {
    conditions.push(ilike(auditLogsTable.username, `%${username}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [logs, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogsTable)
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogsTable)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  res.json({ logs, total, page, limit });
});

export default router;
