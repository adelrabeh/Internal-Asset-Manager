import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FolderOpen,
  Plus,
  Users,
  FileText,
  Calendar,
  ChevronLeft,
  Loader2,
} from "lucide-react";

interface Project {
  id: number;
  name: string;
  description: string | null;
  status: "active" | "completed" | "archived";
  folderPath: string | null;
  createdBy: number;
  createdAt: string;
  memberCount: number;
  jobCount: number;
  myRole?: string;
}

const statusLabel: Record<string, { label: string; class: string }> = {
  active: { label: "نشط", class: "bg-green-500/15 text-green-400 border-green-500/30" },
  completed: { label: "مكتمل", class: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  archived: { label: "مؤرشف", class: "bg-gray-500/15 text-gray-400 border-gray-500/30" },
};

const roleLabel: Record<string, string> = {
  uploader: "رافع ملفات",
  reviewer: "مراجع",
  approver: "معتمد",
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", folderPath: "" });
  const [error, setError] = useState("");

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${BASE}/api/projects`, { credentials: "include" });
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("اسم المشروع مطلوب."); return; }
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/projects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          folderPath: form.folderPath.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "فشل إنشاء المشروع.");
        return;
      }
      setShowCreate(false);
      setForm({ name: "", description: "", folderPath: "" });
      fetchProjects();
    } catch {
      setError("فشل إنشاء المشروع.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">المشاريع</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {user?.role === "admin"
              ? "جميع مشاريع المنظومة"
              : "مشاريعك المُعيَّنة"}
          </p>
        </div>
        {user?.role === "admin" && (
          <Button
            onClick={() => setShowCreate(true)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            مشروع جديد
          </Button>
        )}
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border border-dashed border-border text-center px-4">
          <FolderOpen className="w-12 h-12 text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground font-medium">لا توجد مشاريع</p>
          {user?.role === "admin" && (
            <p className="text-sm text-muted-foreground/60 mt-1">
              ابدأ بإنشاء مشروع جديد وإضافة الموظفين إليه
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => {
            const st = statusLabel[project.status] ?? statusLabel.active;
            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <div className="group rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all cursor-pointer p-5 space-y-4">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <FolderOpen className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{project.name}</p>
                        {project.myRole && (
                          <p className="text-xs text-muted-foreground">{roleLabel[project.myRole] ?? project.myRole}</p>
                        )}
                      </div>
                    </div>
                    <Badge className={`text-xs border shrink-0 ${st.class}`}>{st.label}</Badge>
                  </div>

                  {/* Description */}
                  {project.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                  )}

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {project.memberCount} عضو
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" />
                      {project.jobCount} ملف
                    </span>
                    <span className="flex items-center gap-1 mr-auto">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(project.createdAt).toLocaleDateString("ar-SA")}
                    </span>
                    <ChevronLeft className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Create Project Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إنشاء مشروع جديد</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label>اسم المشروع *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثال: مشروع رقمنة وثائق الأراضي"
                maxLength={120}
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>الوصف</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="وصف مختصر للمشروع..."
                maxLength={500}
                rows={3}
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>مسار المجلد (اختياري)</Label>
              <Input
                value={form.folderPath}
                onChange={(e) => setForm((f) => ({ ...f, folderPath: e.target.value }))}
                placeholder="/data/projects/project-name"
                dir="ltr"
                className="text-left"
              />
              <p className="text-xs text-muted-foreground">مسار المجلد على السيرفر لاستيراد الملفات منه</p>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                إلغاء
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                إنشاء المشروع
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
