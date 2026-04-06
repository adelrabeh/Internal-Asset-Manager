import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../lib/auth";
import { addSseClient, removeSseClient } from "../lib/sse";

const router: Router = Router();

router.get("/notifications/stream", requireAuth, (req, res): void => {
  const user = req.session.user!;
  const clientId = uuidv4();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send a ping immediately to confirm connection
  res.write(`event: connected\ndata: {"clientId":"${clientId}"}\n\n`);

  addSseClient(clientId, {
    userId: user.id,
    role: user.role,
    permissions: user.permissions ?? [],
    res,
  });

  // Heartbeat every 25s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSseClient(clientId);
  });
});

export default router;
