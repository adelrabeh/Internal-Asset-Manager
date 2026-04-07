import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, projectMembersTable, usersTable, jobsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logAction } from "../lib/audit";

const router: Router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

function isAdmin(req: Express.Request): boolean {
  return req.session?.user?.role === "admin";
}

/** Return project IDs visible to the current user */
async function getAccessibleProjectIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ projectId: projectMembersTable.projectId })
    .from(projectMembersTable)
    .where(eq(projectMembersTable.userId, userId));
  return rows.map((r) => r.projectId);
}

// ── List Projects ──────────────────────────────────────────────────────────────

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const user = req.session.user!;

  let projects;
  if (user.role === "admin") {
    projects = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        description: projectsTable.description,
        status: projectsTable.status,
        folderPath: projectsTable.folderPath,
        createdBy: projectsTable.createdBy,
        createdAt: projectsTable.createdAt,
        updatedAt: projectsTable.updatedAt,
        memberCount: sql<number>`(
          SELECT count(*)::int FROM project_members pm WHERE pm.project_id = ${projectsTable.id}
        )`,
        jobCount: sql<number>`(
          SELECT count(*)::int FROM jobs j WHERE j.project_id = ${projectsTable.id}
        )`,
      })
      .from(projectsTable)
      .orderBy(desc(projectsTable.createdAt));
  } else {
    const memberRows = await db
      .select({ projectId: projectMembersTable.projectId, role: projectMembersTable.role })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.userId, user.id));

    if (memberRows.length === 0) {
      res.json([]);
      return;
    }

    const projectIds = memberRows.map((r) => r.projectId);
    const memberRoleMap = new Map(memberRows.map((r) => [r.projectId, r.role]));

    const rows = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        description: projectsTable.description,
        status: projectsTable.status,
        folderPath: projectsTable.folderPath,
        createdBy: projectsTable.createdBy,
        createdAt: projectsTable.createdAt,
        updatedAt: projectsTable.updatedAt,
        memberCount: sql<number>`(
          SELECT count(*)::int FROM project_members pm WHERE pm.project_id = ${projectsTable.id}
        )`,
        jobCount: sql<number>`(
          SELECT count(*)::int FROM jobs j WHERE j.project_id = ${projectsTable.id}
        )`,
      })
      .from(projectsTable)
      .where(inArray(projectsTable.id, projectIds))
      .orderBy(desc(projectsTable.createdAt));

    projects = rows.map((p) => ({ ...p, myRole: memberRoleMap.get(p.id) }));
  }

  res.json(projects ?? []);
});

// ── Get Single Project ─────────────────────────────────────────────────────────

router.get("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "معرف المشروع غير صالح." }); return; }

  const user = req.session.user!;

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) { res.status(404).json({ error: "المشروع غير موجود." }); return; }

  if (user.role !== "admin") {
    const [membership] = await db
      .select()
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, user.id)))
      .limit(1);
    if (!membership) { res.status(403).json({ error: "ليس لديك صلاحية للوصول إلى هذا المشروع." }); return; }
  }

  const members = await db
    .select({
      id: projectMembersTable.id,
      userId: projectMembersTable.userId,
      role: projectMembersTable.role,
      canUpload: projectMembersTable.canUpload,
      canReview: projectMembersTable.canReview,
      canApprove: projectMembersTable.canApprove,
      createdAt: projectMembersTable.createdAt,
      username: usersTable.username,
      email: usersTable.email,
    })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.projectId, projectId));

  res.json({ ...project, members });
});

// ── Create Project ─────────────────────────────────────────────────────────────

router.post("/projects", requireAuth, async (req, res): Promise<void> => {
  if (!isAdmin(req as any)) { res.status(403).json({ error: "هذه العملية للمشرفين فقط." }); return; }

  const { name, description, folderPath } = req.body ?? {};
  if (!name || typeof name !== "string" || name.trim().length < 2 || name.length > 120) {
    res.status(400).json({ error: "اسم المشروع مطلوب (2-120 حرفاً)." }); return;
  }
  const parsed = { data: { name: (name as string).trim(), description: description?.trim() || undefined, folderPath: folderPath?.trim() || undefined } };

  const user = req.session.user!;
  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, createdBy: user.id })
    .returning();

  await logAction(req as any, "PROJECT_CREATED", "project", project.id, `Project created: ${project.name}`);

  res.status(201).json(project);
});

// ── Update Project ─────────────────────────────────────────────────────────────

router.put("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  if (!isAdmin(req as any)) { res.status(403).json({ error: "هذه العملية للمشرفين فقط." }); return; }

  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "معرف المشروع غير صالح." }); return; }

  const { name, description, status, folderPath } = req.body ?? {};
  const validStatuses = ["active", "completed", "archived"];
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: "حالة غير صالحة." }); return;
  }

  const updateData: Record<string, unknown> = {};
  if (name && typeof name === "string") updateData.name = name.trim();
  if (description !== undefined) updateData.description = description?.trim() || null;
  if (status) updateData.status = status;
  if (folderPath !== undefined) updateData.folderPath = folderPath?.trim() || null;

  const [project] = await db
    .update(projectsTable)
    .set(updateData)
    .where(eq(projectsTable.id, projectId))
    .returning();

  if (!project) { res.status(404).json({ error: "المشروع غير موجود." }); return; }

  await logAction(req as any, "PROJECT_UPDATED", "project", project.id, `Project updated: ${project.name}`);

  res.json(project);
});

// ── Delete Project ─────────────────────────────────────────────────────────────

router.delete("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  if (!isAdmin(req as any)) { res.status(403).json({ error: "هذه العملية للمشرفين فقط." }); return; }

  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "معرف المشروع غير صالح." }); return; }

  const [project] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .returning();

  if (!project) { res.status(404).json({ error: "المشروع غير موجود." }); return; }

  await logAction(req as any, "PROJECT_DELETED", "project", projectId, `Project deleted: ${project.name}`);

  res.sendStatus(204);
});

// ── Add Member ─────────────────────────────────────────────────────────────────

router.post("/projects/:id/members", requireAuth, async (req, res): Promise<void> => {
  if (!isAdmin(req as any)) { res.status(403).json({ error: "هذه العملية للمشرفين فقط." }); return; }

  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "معرف المشروع غير صالح." }); return; }

  const { userId: rawUserId, role, canUpload, canReview, canApprove } = req.body ?? {};
  const userId = parseInt(rawUserId);
  const validRoles = ["uploader", "reviewer", "approver"];

  if (isNaN(userId) || userId <= 0) { res.status(400).json({ error: "معرف المستخدم غير صالح." }); return; }
  if (!role || !validRoles.includes(role)) { res.status(400).json({ error: "الدور غير صالح." }); return; }

  const memberData = {
    userId,
    role: role as "uploader" | "reviewer" | "approver",
    canUpload: Boolean(canUpload) || role === "uploader",
    canReview: Boolean(canReview) || role === "reviewer",
    canApprove: Boolean(canApprove) || role === "approver",
  };

  const adminUser = req.session.user!;

  const [existing] = await db
    .select()
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(projectMembersTable)
      .set({ role: memberData.role, canUpload: memberData.canUpload, canReview: memberData.canReview, canApprove: memberData.canApprove })
      .where(eq(projectMembersTable.id, existing.id))
      .returning();
    res.json(updated);
    return;
  }

  const [member] = await db
    .insert(projectMembersTable)
    .values({ projectId, ...memberData, addedBy: adminUser.id })
    .returning();

  await logAction(req as any, "PROJECT_MEMBER_ADDED", "project", projectId, `Member ${userId} added to project ${projectId} as ${role}`);

  res.status(201).json(member);
});

// ── Remove Member ──────────────────────────────────────────────────────────────

router.delete("/projects/:id/members/:userId", requireAuth, async (req, res): Promise<void> => {
  if (!isAdmin(req as any)) { res.status(403).json({ error: "هذه العملية للمشرفين فقط." }); return; }

  const projectId = parseInt(req.params.id);
  const userId = parseInt(req.params.userId);
  if (isNaN(projectId) || isNaN(userId)) { res.status(400).json({ error: "معرف غير صالح." }); return; }

  await db
    .delete(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)));

  await logAction(req as any, "PROJECT_MEMBER_REMOVED", "project", projectId, `Member ${userId} removed from project ${projectId}`);

  res.sendStatus(204);
});

// ── Project Jobs (scoped) ──────────────────────────────────────────────────────

router.get("/projects/:id/jobs", requireAuth, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "معرف المشروع غير صالح." }); return; }

  const user = req.session.user!;

  if (user.role !== "admin") {
    const [membership] = await db
      .select()
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, user.id)))
      .limit(1);
    if (!membership) { res.status(403).json({ error: "ليس لديك صلاحية." }); return; }
  }

  const { status, page = 1, limit = 50 } = req.query as { status?: string; page?: number; limit?: number };
  const offset = ((+page) - 1) * (+limit);

  const conditions = [eq(jobsTable.projectId, projectId)];
  if (status) conditions.push(eq(jobsTable.status, status as any));

  const [jobs, countResult] = await Promise.all([
    db.select().from(jobsTable).where(and(...conditions)).orderBy(desc(jobsTable.createdAt)).limit(+limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(jobsTable).where(and(...conditions)),
  ]);

  res.json({ jobs, total: countResult[0]?.count ?? 0, page: +page, limit: +limit });
});

export { router as projectsRouter, getAccessibleProjectIds };
