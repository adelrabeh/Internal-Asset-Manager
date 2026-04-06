import { Router } from "express";
import { db } from "@workspace/db";
import { apiKeysTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth, requireAdmin } from "../lib/auth";
import { logAction } from "../lib/audit";

const router: Router = Router();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateKey(): { raw: string; prefix: string; hash: string } {
  const raw = `ocr_${randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, 12);
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

// List API keys for current user (or all, if admin)
router.get("/api-keys", requireAuth, async (req, res): Promise<void> => {
  const user = req.session.user!;
  const rows = await db
    .select({
      id: apiKeysTable.id,
      userId: apiKeysTable.userId,
      name: apiKeysTable.name,
      prefix: apiKeysTable.prefix,
      isActive: apiKeysTable.isActive,
      lastUsedAt: apiKeysTable.lastUsedAt,
      createdAt: apiKeysTable.createdAt,
      expiresAt: apiKeysTable.expiresAt,
    })
    .from(apiKeysTable)
    .where(user.role === "admin" ? undefined : eq(apiKeysTable.userId, user.id))
    .orderBy(apiKeysTable.createdAt);

  res.json(rows);
});

// Create a new API key
router.post("/api-keys", requireAuth, async (req, res): Promise<void> => {
  const user = req.session.user!;
  const name = String(req.body?.name ?? "").trim().slice(0, 100);
  const expiresInDays = req.body?.expiresInDays ? Number(req.body.expiresInDays) : null;

  if (!name) {
    res.status(400).json({ error: "اسم المفتاح مطلوب." });
    return;
  }

  const { raw, prefix, hash } = generateKey();
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;

  const [created] = await db
    .insert(apiKeysTable)
    .values({
      userId: user.id,
      name,
      keyHash: hash,
      prefix,
      isActive: true,
      expiresAt,
    })
    .returning();

  await logAction(req, "API_KEY_CREATED", "api_key", created.id, `API key created: ${name} (prefix: ${prefix})`);

  // Return the raw key ONLY on creation — it will never be shown again
  res.status(201).json({
    id: created.id,
    name: created.name,
    prefix: created.prefix,
    key: raw,
    createdAt: created.createdAt,
    expiresAt: created.expiresAt,
    message: "احفظ هذا المفتاح الآن — لن يظهر مرة أخرى.",
  });
});

// Revoke (deactivate) an API key
router.delete("/api-keys/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.session.user!;
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "معرّف غير صالح." });
    return;
  }

  const [existing] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "المفتاح غير موجود." });
    return;
  }

  // Only owner or admin can revoke
  if (existing.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "غير مصرح لك بحذف هذا المفتاح." });
    return;
  }

  await db.update(apiKeysTable).set({ isActive: false }).where(eq(apiKeysTable.id, id));
  await logAction(req, "API_KEY_REVOKED", "api_key", id, `API key revoked: ${existing.name}`);

  res.json({ message: "تم إلغاء المفتاح." });
});

// Middleware: authenticate via API key (Bearer token)
export async function apiKeyAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ocr_")) {
    next();
    return;
  }

  const raw = authHeader.slice(7);
  const hash = hashKey(raw);

  const [keyRow] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.keyHash, hash), eq(apiKeysTable.isActive, true)))
    .limit(1);

  if (!keyRow) {
    res.status(401).json({ error: "مفتاح API غير صالح أو منتهي الصلاحية." });
    return;
  }

  if (keyRow.expiresAt && keyRow.expiresAt < new Date()) {
    res.status(401).json({ error: "مفتاح API منتهي الصلاحية." });
    return;
  }

  // Load user
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, keyRow.userId)).limit(1);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "مفتاح API غير صالح." });
    return;
  }

  // Inject user into session-like object so requireAuth works
  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role as "user" | "admin",
    permissions: user.permissions ?? [],
    isActive: user.isActive,
  };

  // Update last used timestamp (fire and forget)
  void db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, keyRow.id));

  next();
}

export default router;
