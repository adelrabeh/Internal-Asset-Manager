import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, requireAuth } from "../lib/auth";
import { logAction } from "../lib/audit";
import {
  LoginBody,
  GetMeResponse,
} from "@workspace/api-zod";

const router: Router = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await logAction(req, "LOGIN_FAILED", "auth", user.id, `Failed login attempt for user ${username}`);
    res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    return;
  }

  // Update last login
  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, user.id));

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role as "user" | "admin",
    permissions: user.permissions ?? [],
    isActive: user.isActive,
  };

  await logAction(req, "LOGIN_SUCCESS", "auth", user.id, `User ${username} logged in`);

  res.json({
    user: GetMeResponse.parse({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    }),
    message: "تم تسجيل الدخول بنجاح.",
  });
});

router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  await logAction(req, "LOGOUT", "auth", req.session.user?.id, `User ${req.session.user?.username} logged out`);
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "فشل تسجيل الخروج." });
      return;
    }
    res.json({ message: "تم تسجيل الخروج بنجاح." });
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.session.user!;

  const [dbUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);

  if (!dbUser || !dbUser.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "الجلسة منتهية." });
    return;
  }

  res.json(
    GetMeResponse.parse({
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      role: dbUser.role,
      isActive: dbUser.isActive,
      createdAt: dbUser.createdAt,
      lastLoginAt: dbUser.lastLoginAt,
    }),
  );
});

export default router;
