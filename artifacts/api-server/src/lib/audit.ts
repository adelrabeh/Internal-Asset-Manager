import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import { logger } from "./logger";
import type { Request } from "express";

export async function logAction(
  req: Request,
  action: string,
  resourceType: string,
  resourceId?: number,
  details?: string,
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      userId: req.session?.user?.id ?? null,
      username: req.session?.user?.username ?? null,
      action,
      resourceType,
      resourceId: resourceId ?? null,
      details: details ?? null,
      ipAddress: req.ip ?? null,
    });
  } catch (err) {
    logger.error({ err, action, resourceType }, "Failed to write audit log");
  }
}
