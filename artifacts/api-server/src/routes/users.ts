import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, hashPassword } from "../lib/auth";
import { logAction } from "../lib/audit";
import {
  CreateUserBody,
  GetUserParams,
  UpdateUserParams,
  UpdateUserBody,
  DeleteUserParams,
} from "@workspace/api-zod";

const router: Router = Router();

function sanitizeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _, ...safe } = user;
  return safe;
}

router.get("/users", requireAdmin, async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  res.json(users.map(sanitizeUser));
});

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, email, password, role } = parsed.data;
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(usersTable)
    .values({ username, email, passwordHash, role, isActive: true })
    .returning();

  await logAction(req, "USER_CREATED", "user", user.id, `User created: ${username} (${role})`);

  res.status(201).json(sanitizeUser(user));
});

router.get("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود." });
    return;
  }

  res.json(sanitizeUser(user));
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.password !== undefined) {
    updates.passwordHash = await hashPassword(parsed.data.password);
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "المستخدم غير موجود." });
    return;
  }

  await logAction(req, "USER_UPDATED", "user", params.data.id, `User updated: ${updated.username}`);

  res.json(sanitizeUser(updated));
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Prevent deleting yourself
  if (params.data.id === req.session.user?.id) {
    res.status(400).json({ error: "لا يمكنك حذف حسابك الخاص." });
    return;
  }

  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "المستخدم غير موجود." });
    return;
  }

  await logAction(req, "USER_DELETED", "user", params.data.id, `User deleted: ${deleted.username}`);

  res.sendStatus(204);
});

export default router;
