import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useGetDashboardSummary, useGetRecentActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText, CheckCircle, XCircle, ClipboardCheck,
  FolderOpen, ArrowLeft, Plus, Activity, AlertTriangle, RefreshCw,
  TrendingUp, Award, Users,
} from "lucide-react";
import { StatusBadge } from "@/lib/status-config";
import { useAuth } from "@/lib/auth-context";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProjectOverview {
  id: number;
  name: string;
  description: string | null;
  status: "active" | "completed" | "archived";
  folderPath: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  jobs: {
    total: number;
    pending: number;
    processing: number;
    ocrComplete: number;
    reviewed: number;
    approved: number;
    rejected: number;
    failed: number;
  };
  quality: {
    avgConfidence: number;
    highCount: number;
    medCount: number;
    lowCount: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-emerald-100 text-emerald-700" },
  completed: { label: "مكتمل", cls: "bg-blue-100 text-blue-700" },
  archived: { label: "مؤرشف", cls: "bg-gray-100 text-gray-500" },
};

// Stacked job-status progress bar
function JobProgressBar({ jobs }: { jobs: ProjectOverview["jobs"] }) {
  const total = jobs.total;
  if (total === 0) return <div className="h-2.5 rounded-full bg-muted w-full" />;

  const segments = [
    { key: "approved",   value: jobs.approved,   color: "bg-emerald-500", label: "معتمد" },
    { key: "reviewed",   value: jobs.reviewed,   color: "bg-violet-500",  label: "بانتظار الاعتماد" },
    { key: "ocrComplete",value: jobs.ocrComplete, color: "bg-blue-500",    label: "بانتظار المراجعة" },
    { key: "processing", value: jobs.processing,  color: "bg-amber-400",   label: "قيد المعالجة" },
    { key: "pending",    value: jobs.pending,     color: "bg-slate-300",   label: "في الانتظار" },
    { key: "rejected",   value: jobs.rejected,    color: "bg-orange-400",  label: "مرفوض" },
    { key: "failed",     value: jobs.failed,      color: "bg-red-500",     label: "فشل" },
  ].filter((s) => s.value > 0);

  return (
    <div>
      <div className="h-2.5 rounded-full overflow-hidden flex w-full bg-muted">
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={`inline-block w-2 h-2 rounded-full ${s.color}`} />
            {s.label} ({s.value})
          </span>
        ))}
      </div>
    </div>
  );
}

// Project card component
function ProjectCard({ p }: { p: ProjectOverview }) {
  const st = PROJECT_STATUS[p.status] ?? PROJECT_STATUS.active;
  const approvedPct = p.jobs.total > 0 ? Math.round((p.jobs.approved / p.jobs.total) * 100) : 0;
  const pendingAction = p.jobs.ocrComplete + p.jobs.reviewed;

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <CardContent className="pt-4 pb-3 flex flex-col gap-3 flex-1">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FolderOpen className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight truncate">{p.name}</h3>
              {p.description && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{p.description}</p>
              )}
            </div>
          </div>
          <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>
            {st.label}
          </span>
        </div>

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>{p.jobs.total} وثيقة</span>
            <span className="text-emerald-600 font-medium">{approvedPct}% معتمد</span>
          </div>
          <JobProgressBar jobs={p.jobs} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="text-center">
            <p className="text-xl font-bold text-emerald-600">{p.jobs.approved}</p>
            <p className="text-[10px] text-muted-foreground">معتمد</p>
          </div>
          <div className="text-center border-x border-border">
            <p className={`text-xl font-bold ${pendingAction > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
              {pendingAction}
            </p>
            <p className="text-[10px] text-muted-foreground">بحاجة إجراء</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold">
              {p.quality.avgConfidence > 0 ? `${p.quality.avgConfidence}%` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">متوسط الدقة</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border mt-auto">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {p.memberCount} عضو
            </span>
            <span>{formatDate(p.updatedAt)}</span>
          </div>
          <Link href={`/projects/${p.id}`}>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-2">
              فتح
              <ArrowLeft className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({ limit: 6 });

  const [projects, setProjects] = useState<ProjectOverview[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/dashboard/projects-overview`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, []);

  const isAdmin = user?.role === "admin";

  // Top-level aggregate stats
  const projectsTotalJobs = projects.reduce((s, p) => s + p.jobs.total, 0);
  const projectsTotalApproved = projects.reduce((s, p) => s + p.jobs.approved, 0);
  const projectsPendingAction = projects.reduce((s, p) => s + p.jobs.ocrComplete + p.jobs.reviewed, 0);

  const topCards = [
    {
      label: "إجمالي الوثائق",
      value: isAdmin ? (summary?.totalJobs ?? 0) : projectsTotalJobs,
      icon: FileText, color: "text-blue-500", bg: "bg-blue-50",
    },
    {
      label: "معتمدة",
      value: isAdmin ? ((summary as any)?.approvedJobs ?? 0) : projectsTotalApproved,
      icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-50",
    },
    {
      label: "بانتظار الإجراء",
      value: isAdmin ? ((summary as any)?.ocrCompleteJobs ?? 0) : projectsPendingAction,
      icon: ClipboardCheck, color: "text-violet-500", bg: "bg-violet-50",
    },
    {
      label: isAdmin ? "فشلت / مرفوضة" : "مشاريعي",
      value: isAdmin
        ? ((summary?.failedJobs ?? 0) + ((summary as any)?.rejectedJobs ?? 0))
        : projects.length,
      icon: isAdmin ? XCircle : FolderOpen,
      color: isAdmin ? "text-red-500" : "text-primary",
      bg: isAdmin ? "bg-red-50" : "bg-primary/10",
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">

      {/* ── Global stats row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(summaryLoading && isAdmin) || (projectsLoading && !isAdmin)
          ? [...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          : topCards.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label} className="shadow-sm">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">{stat.label}</p>
                        <p className="text-3xl font-bold mt-1">
                          {stat.value.toLocaleString("ar-SA")}
                        </p>
                      </div>
                      <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center shrink-0`}>
                        <Icon className={`w-4 h-4 ${stat.color}`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* ── Projects overview ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-primary" />
            {isAdmin ? "نظرة عامة على المشاريع" : "مشاريعي"}
          </h2>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link href="/projects">
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  مشروع جديد
                </Button>
              </Link>
            )}
            <Link href="/projects">
              <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-muted-foreground">
                عرض الكل
                <ArrowLeft className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        </div>

        {projectsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
          </div>
        ) : projects.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="py-16 text-center">
              <FolderOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm mb-4">
                {isAdmin
                  ? "لا توجد مشاريع بعد. أنشئ أول مشروع لبدء تنظيم الوثائق."
                  : "لم يتم تعيينك في أي مشروع حتى الآن."}
              </p>
              {isAdmin && (
                <Link href="/projects">
                  <Button size="sm" className="gap-2">
                    <Plus className="w-3.5 h-3.5" />
                    إنشاء مشروع
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.map((p) => <ProjectCard key={p.id} p={p} />)}
          </div>
        )}
      </div>

      {/* ── Bottom row: Activity + Side panel ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recent activity – 2/3 width */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              آخر النشاطات
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {activityLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="divide-y divide-border">
                {activity.map((item) => (
                  <Link key={item.id} href={`/jobs/${item.id}`}>
                    <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.filename}</p>
                          <p className="text-xs text-muted-foreground">{item.username}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.qualityLevel && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            item.qualityLevel === "high" ? "bg-emerald-100 text-emerald-700" :
                            item.qualityLevel === "medium" ? "bg-amber-100 text-amber-700" :
                            "bg-red-100 text-red-700"
                          }`}>
                            {item.qualityLevel === "high" ? "عالية" :
                             item.qualityLevel === "medium" ? "متوسطة" : "منخفضة"}
                          </span>
                        )}
                        <StatusBadge status={item.status} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground text-sm">
                لم تتم معالجة أي مهام بعد
              </div>
            )}
          </CardContent>
        </Card>

        {/* Side panel – 1/3 width */}
        <div className="flex flex-col gap-4">

          {/* Quick upload */}
          <Card className="shadow-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">رفع وثيقة</p>
                  <p className="text-xs text-muted-foreground">ابدأ رقمنة جديدة</p>
                </div>
              </div>
              <Link href="/upload">
                <Button className="w-full" size="sm">رفع ملف جديد</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Processing quality */}
          {summary && (summary.highQualityCount + summary.mediumQualityCount + summary.lowQualityCount) > 0 && (
            <Card className="shadow-sm">
              <CardContent className="pt-5 pb-4 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Award className="w-4 h-4 text-primary" />
                  جودة المعالجة
                </p>
                {[
                  { label: "عالية",    count: summary.highQualityCount,   color: "bg-emerald-500" },
                  { label: "متوسطة",   count: summary.mediumQualityCount,  color: "bg-amber-400" },
                  { label: "منخفضة",   count: summary.lowQualityCount,    color: "bg-red-500" },
                ].map((q) => {
                  const total = (summary.highQualityCount + summary.mediumQualityCount + summary.lowQualityCount) || 1;
                  return (
                    <div key={q.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{q.label}</span>
                        <span className="font-medium">{q.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`${q.color} h-full rounded-full`}
                          style={{ width: `${(q.count / total) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground text-center pt-1">
                  متوسط الدقة: {summary.avgConfidenceScore}%
                </p>
              </CardContent>
            </Card>
          )}

          {/* Failed jobs alert */}
          {(summary?.failedJobs ?? 0) > 0 && (
            <Card className="shadow-sm border-red-200 bg-red-50/50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-red-700">
                      {summary?.failedJobs} مهمة فاشلة
                    </p>
                    <p className="text-xs text-red-600/80 mb-2">تحتاج إلى إعادة معالجة</p>
                    <Link href="/admin/system">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-red-200 text-red-700 hover:bg-red-100 gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        معالجة الآن
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
