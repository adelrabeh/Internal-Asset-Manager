import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, requireAuth } from "../lib/auth";
import { logAction } from "../lib/audit";
import { authLimiter } from "../lib/rate-limiter";
import {
  LoginBody,
  GetMeResponse,
} from "@workspace/api-zod";

const router: Router = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

router.post("/auth/login", authLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات الدخول غير صالحة." });
    return;
  }

  const { username, password } = parsed.data;

  // Sanitize input lengths
  if (username.length > 64 || password.length > 128) {
    res.status(400).json({ error: "بيانات الدخول غير صالحة." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    return;
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    await logAction(req, "ACCOUNT_LOCKED_ATTEMPT", "auth", user.id, `Locked account login attempt: ${username}`);
    res.status(423).json({
      error: `الحساب مقفل بسبب محاولات متكررة. حاول مرة أخرى بعد ${minutesLeft} دقيقة.`,
    });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const newAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
    await db
      .update(usersTable)
      .set({
        failedLoginAttempts: newAttempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      })
      .where(eq(usersTable.id, user.id));

    if (shouldLock) {
      await logAction(req, "ACCOUNT_LOCKED", "auth", user.id, `Account locked after ${newAttempts} failed attempts: ${username}`);
      res.status(423).json({ error: "تم قفل الحساب بسبب محاولات دخول متكررة. حاول مرة أخرى بعد 15 دقيقة." });
    } else {
      await logAction(req, "LOGIN_FAILED", "auth", user.id, `Failed login attempt ${newAttempts}/${MAX_FAILED_ATTEMPTS} for: ${username}`);
      res.status(401).json({
        error: `اسم المستخدم أو كلمة المرور غير صحيحة. (${MAX_FAILED_ATTEMPTS - newAttempts} محاولات متبقية)`,
      });
    }
    return;
  }

  // Reset failed attempts on successful login
  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null })
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
    res.clearCookie("sid");
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
