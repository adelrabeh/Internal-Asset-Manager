/**
 * Server-Sent Events (SSE) notification system.
 * Broadcasts job status change events to connected clients.
 */

import type { Response } from "express";
import { logger } from "./logger";

interface SseClient {
  userId: number;
  role: string;
  permissions: string[];
  res: Response;
}

const clients = new Map<string, SseClient>();

export function addSseClient(clientId: string, client: SseClient): void {
  clients.set(clientId, client);
  logger.info({ clientId, userId: client.userId }, "SSE client connected");
}

export function removeSseClient(clientId: string): void {
  clients.delete(clientId);
  logger.info({ clientId }, "SSE client disconnected");
}

export interface SseEvent {
  type: "job_ready_for_review" | "job_ready_for_approval" | "job_approved" | "job_rejected" | "job_completed";
  jobId: number;
  filename: string;
  message: string;
}

export function broadcastToRole(event: SseEvent, filter: (client: SseClient) => boolean): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const [id, client] of clients) {
    if (filter(client)) {
      try {
        client.res.write(`event: notification\n${payload}`);
      } catch {
        clients.delete(id);
      }
    }
  }
}

export function notifyJobOcrComplete(jobId: number, filename: string): void {
  broadcastToRole(
    {
      type: "job_ready_for_review",
      jobId,
      filename,
      message: `مهمة جاهزة للمراجعة: ${filename}`,
    },
    (c) => c.role === "admin" || c.permissions.includes("review"),
  );
}

export function notifyJobReviewed(jobId: number, filename: string): void {
  broadcastToRole(
    {
      type: "job_ready_for_approval",
      jobId,
      filename,
      message: `مهمة جاهزة للاعتماد: ${filename}`,
    },
    (c) => c.role === "admin" || c.permissions.includes("approve"),
  );
}

export function notifyJobFinalised(jobId: number, filename: string, approved: boolean): void {
  broadcastToRole(
    {
      type: approved ? "job_approved" : "job_rejected",
      jobId,
      filename,
      message: approved ? `تم اعتماد المهمة: ${filename}` : `تم رفض المهمة: ${filename}`,
    },
    () => true,
  );
}
