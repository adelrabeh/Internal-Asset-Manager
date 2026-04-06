/**
 * Authentication & Session Management
 */

import { type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export type Permission = "upload" | "review";

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  role: "user" | "admin";
  permissions: string[];
  isActive: boolean;
}

declare module "express-session" {
  interface SessionData {
    user: SessionUser;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session?.user) {
    res.status(401).json({ error: "غير مصرح. يرجى تسجيل الدخول." });
    return;
  }
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session?.user) {
    res.status(401).json({ error: "غير مصرح. يرجى تسجيل الدخول." });
    return;
  }
  if (req.session.user.role !== "admin") {
    res
      .status(403)
      .json({ error: "غير مسموح. هذه العملية تتطلب صلاحيات المشرف." });
    return;
  }
  next();
}

/** Check a specific workflow permission. Admins always pass. */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session?.user) {
      res.status(401).json({ error: "غير مصرح. يرجى تسجيل الدخول." });
      return;
    }
    const { role, permissions } = req.session.user;
    if (role === "admin" || (permissions ?? []).includes(permission)) {
      next();
      return;
    }
    const label = permission === "upload" ? "الرفع والمعالجة" : "مراجعة الجودة";
    res
      .status(403)
      .json({ error: `ليس لديك صلاحية ${label}. تواصل مع المشرف.` });
  };
}

export async function seedDefaultAdmin(): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, "admin"))
      .limit(1);

    if (existing.length === 0) {
      const passwordHash = await hashPassword("Admin@1234");
      await db.insert(usersTable).values({
        username: "admin",
        email: "admin@internal.local",
        passwordHash,
        role: "admin",
        permissions: ["upload", "review"],
        isActive: true,
      });
      logger.info("Default admin user created (admin / Admin@1234)");
    } else {
      // Ensure existing admin has both permissions
      await db
        .update(usersTable)
        .set({ permissions: ["upload", "review"] })
        .where(eq(usersTable.username, "admin"));
    }

    // Also seed a regular user (uploader only)
    const existingUser = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, "operator"))
      .limit(1);

    if (existingUser.length === 0) {
      const passwordHash = await hashPassword("Operator@1234");
      await db.insert(usersTable).values({
        username: "operator",
        email: "operator@internal.local",
        passwordHash,
        role: "user",
        permissions: ["upload"],
        isActive: true,
      });
      logger.info("Default operator user created (operator / Operator@1234)");
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed default admin user");
  }
}
