import { useState, useEffect, useCallback } from "react";
import { Link, useRoute } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FolderOpen,
  Users,
  FileText,
  Plus,
  Trash2,
  ArrowRight,
  Loader2,
  UserPlus,
  CheckCircle,
  Clock,
  XCircle,
  Eye,
} from "lucide-react";
import { StatusBadge } from "@/lib/status-config";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface ProjectMember {
  id: number;
  userId: number;
  role: string;
  canUpload: boolean;
  canReview: boolean;
  canApprove: boolean;
  createdAt: string;
  username: string;
  email: string;
}

interface Project {
  id: number;
  name: string;
  description: string | null;
  status: "active" | "completed" | "archived";
  folderPath: string | null;
  createdBy: number;
  createdAt: string;
  members: ProjectMember[];
}

interface Job {
  id: number;
  originalFilename: string;
  fileType: string;
  fileSize: number;
  status: string;
  createdAt: string;
  userId: number;
}

interface SystemUser {
  id: number;
  username: string;
  email: string;
  role: string;
}

const roleLabel: Record<string, string> = {
  uploader: "رافع ملفات",
  reviewer: "مراجع",
  approver: "معتمد",
};

const statusBg: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border border-green-500/30",
  completed: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  archived: "bg-gray-500/15 text-gray-400 border border-gray-500/30",
};

function formatSize(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function ProjectDetailPage() {
  const [, params] = useRoute("/projects/:id");
  const projectId = params?.id;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [project, setProject] = useState<Project | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [allUsers, setAllUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [memberForm, setMemberForm] = useState({
    userId: "",
    role: "uploader",
    canUpload: false,
    canReview: false,
    canApprove: false,
  });
  const [memberError, setMemberError] = useState("");

  const fetchProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, jobData] = await Promise.all([
        fetch(`${BASE}/api/projects/${projectId}`, { credentials: "include" }).then((r) => r.json()),
        fetch(`${BASE}/api/projects/${projectId}/jobs?limit=100`, { credentials: "include" }).then((r) => r.json()),
      ]);
      setProject(proj);
      setJobs(jobData.jobs ?? []);
    } catch {
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await fetch(`${BASE}/api/users`, { credentials: "include" }).then((r) => r.json());
      setAllUsers(data.users ?? data ?? []);
    } catch {
      setAllUsers([]);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchProject();
    fetchUsers();
  }, [fetchProject, fetchUsers]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberForm.userId) { setMemberError("اختر المستخدم."); return; }
    setAddingMember(true);
    setMemberError("");
    try {
      const res = await fetch(`${BASE}/api/projects/${projectId}/members`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: parseInt(memberForm.userId),
          role: memberForm.role,
          canUpload: memberForm.role === "uploader" || memberForm.canUpload,
          canReview: memberForm.role === "reviewer" || memberForm.canReview,
          canApprove: memberForm.role === "approver" || memberForm.canApprove,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setMemberError(d.error ?? "فشل إضافة العضو.");
        return;
      }
      setShowAddMember(false);
      setMemberForm({ userId: "", role: "uploader", canUpload: false, canReview: false, canApprove: false });
      fetchProject();
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!confirm("هل تريد إزالة هذا العضو من المشروع؟")) return;
    await fetch(`${BASE}/api/projects/${projectId}/members/${userId}`, {
      method: "DELETE",
      credentials: "include",
    });
    fetchProject();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-16 text-muted-foreground" dir="rtl">
        <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
        <p>المشروع غير موجود أو ليس لديك صلاحية الوصول.</p>
        <Link href="/projects">
          <Button variant="outline" className="mt-4 gap-2">
            <ArrowRight className="w-4 h-4" />
            العودة للمشاريع
          </Button>
        </Link>
      </div>
    );
  }

  const nonMembers = allUsers.filter((u) => !project.members.some((m) => m.userId === u.id));

  return (
    <div className="space-y-6" dir="rtl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground transition-colors">المشاريع</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{project.name}</span>
      </div>

      {/* Project Header */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <FolderOpen className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-foreground">{project.name}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBg[project.status]}`}>
                  {project.status === "active" ? "نشط" : project.status === "completed" ? "مكتمل" : "مؤرشف"}
                </span>
              </div>
              {project.description && (
                <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
              )}
              {project.folderPath && (
                <p className="text-xs font-mono text-muted-foreground/60 mt-1 bg-muted/40 rounded px-2 py-0.5 inline-block">
                  {project.folderPath}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-3 py-1.5">
              <Users className="w-3.5 h-3.5" />
              {project.members.length} عضو
            </span>
            <span className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-3 py-1.5">
              <FileText className="w-3.5 h-3.5" />
              {jobs.length} ملف
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Members Panel */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              أعضاء المشروع
            </h2>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-7"
                onClick={() => setShowAddMember(true)}
              >
                <UserPlus className="w-3.5 h-3.5" />
                إضافة
              </Button>
            )}
          </div>

          {project.members.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
              لا يوجد أعضاء بعد
            </div>
          ) : (
            <div className="space-y-2">
              {project.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-lg bg-card border border-border"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{member.username}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{roleLabel[member.role] ?? member.role}</span>
                      {member.canUpload && <span className="text-xs text-primary/70">• رفع</span>}
                      {member.canReview && <span className="text-xs text-violet-400/70">• مراجعة</span>}
                      {member.canApprove && <span className="text-xs text-green-400/70">• اعتماد</span>}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveMember(member.userId)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Jobs Panel */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              ملفات المشروع
            </h2>
            <Link href={`/upload?project=${project.id}`}>
              <Button size="sm" className="gap-1.5 text-xs h-7">
                <Plus className="w-3.5 h-3.5" />
                رفع ملف
              </Button>
            </Link>
          </div>

          {jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا توجد ملفات في هذا المشروع بعد</p>
              <Link href={`/upload?project=${project.id}`}>
                <Button variant="outline" size="sm" className="mt-4 gap-2">
                  <Plus className="w-3.5 h-3.5" />
                  رفع أول ملف
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border hover:border-primary/30 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{job.originalFilename}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span className="uppercase font-mono text-primary/70">{job.fileType}</span>
                      <span>·</span>
                      <span>{formatSize(job.fileSize)}</span>
                      <span>·</span>
                      <span>{new Date(job.createdAt).toLocaleDateString("ar-SA")}</span>
                    </div>
                  </div>
                  <StatusBadge status={job.status} />
                  <Link href={`/jobs/${job.id}`}>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Member Dialog */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة عضو للمشروع</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="space-y-1.5">
              <Label>المستخدم</Label>
              <Select value={memberForm.userId} onValueChange={(v) => setMemberForm((f) => ({ ...f, userId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر مستخدماً..." />
                </SelectTrigger>
                <SelectContent>
                  {nonMembers.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.username} — {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>الدور في المشروع</Label>
              <Select value={memberForm.role} onValueChange={(v) => setMemberForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="uploader">رافع ملفات — يرفع الملفات فقط</SelectItem>
                  <SelectItem value="reviewer">مراجع — يراجع نتائج OCR</SelectItem>
                  <SelectItem value="approver">معتمد — يعتمد الوثائق</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {memberError && <p className="text-sm text-destructive">{memberError}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddMember(false)}>إلغاء</Button>
              <Button type="submit" disabled={addingMember}>
                {addingMember && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                إضافة
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
