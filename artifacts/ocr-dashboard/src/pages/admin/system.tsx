import { useListJobs, useRetryJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, RefreshCw, AlertTriangle, Activity, Server, Database, BarChart3, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface UserStat {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  uploaded: number;
  reviewed: number;
  approved: number;
  avgProcessingSeconds: number | null;
}

async function fetchUserStats(): Promise<UserStat[]> {
  const r = await fetch(`${BASE}/api/admin/stats/users`, { credentials: "include" });
  if (!r.ok) throw new Error("فشل تحميل إحصائيات المستخدمين");
  return r.json();
}

export default function AdminSystemPage() {
  const { data: failedJobsData, isLoading: failedLoading } = useListJobs({ status: "failed" });
  const { data: pendingJobsData } = useListJobs({ status: "pending" });
  const { data: processingJobsData } = useListJobs({ status: "processing" });
  const { data: userStats, isLoading: statsLoading } = useQuery({ queryKey: ["user-stats"], queryFn: fetchUserStats });
  const retryMutation = useRetryJob();
  const qc = useQueryClient();
  const { toast } = useToast();

  const handleRetryAll = async () => {
    if (!failedJobsData?.jobs?.length) return;
    for (const job of failedJobsData.jobs) {
      await retryMutation.mutateAsync({ id: job.id });
    }
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
    toast({ title: "تم", description: `تمت إعادة معالجة ${failedJobsData.jobs.length} مهمة` });
  };

  const failedJobs = failedJobsData?.jobs ?? [];
  const pendingCount = pendingJobsData?.total ?? 0;
  const processingCount = processingJobsData?.total ?? 0;

  return (
    <div className="space-y-4" dir="rtl">
      {/* System Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Server className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">حالة الخادم</p>
                <p className="font-semibold text-emerald-600 mt-0.5">يعمل بشكل طبيعي</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">قائمة الانتظار</p>
                <p className="font-semibold mt-0.5">{pendingCount} في الانتظار، {processingCount} قيد المعالجة</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <Database className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">قاعدة البيانات</p>
                <p className="font-semibold text-emerald-600 mt-0.5">متصلة</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Performance Stats */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            إحصائيات أداء المستخدمين
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {statsLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (userStats ?? []).length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">لا توجد بيانات</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">المستخدم</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">الدور</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">المرفوعة</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">المراجَعة</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">المعتمَدة</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">متوسط الوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(userStats ?? []).map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-xs font-bold text-primary">{u.username.charAt(0).toUpperCase()}</span>
                          </div>
                          <span className="font-medium">{u.username}</span>
                          {!u.isActive && <span className="text-xs bg-red-100 text-red-700 px-1.5 rounded">غير نشط</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {u.role === "admin" ? "مشرف" : "مستخدم"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-blue-600">{u.uploaded}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-violet-600">{u.reviewed}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-green-600">{u.approved}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground text-xs">
                        {u.avgProcessingSeconds != null ? `${u.avgProcessingSeconds}ث` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Failed Jobs */}
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              المهام الفاشلة ({failedJobsData?.total ?? 0})
            </CardTitle>
            {failedJobs.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleRetryAll}
                disabled={retryMutation.isPending}
                data-testid="button-retry-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                إعادة معالجة الكل
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {failedLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : failedJobs.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Settings className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد مهام فاشلة</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {failedJobs.map((job) => (
                <div key={job.id} data-testid={`row-failed-${job.id}`} className="flex items-center justify-between px-4 py-3 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{job.originalFilename}</p>
                    {job.errorMessage && (
                      <p className="text-xs text-destructive mt-0.5 truncate">{job.errorMessage}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      محاولة {job.retryCount} — {new Date(job.createdAt).toLocaleDateString("ar-SA")}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={async () => {
                      await retryMutation.mutateAsync({ id: job.id });
                      qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
                      toast({ title: "إعادة المحاولة", description: "ستبدأ المعالجة قريباً" });
                    }}
                    disabled={retryMutation.isPending}
                    data-testid={`button-retry-failed-${job.id}`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    إعادة
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* System Info */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            معلومات النظام
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {[
              { label: "محرك التعرف الضوئي", value: "Gemini Vision AI + Tesseract (احتياطي)" },
              { label: "حماية Brute Force", value: "قفل بعد 5 محاولات لمدة 15 دقيقة" },
              { label: "الحد الأقصى للملف", value: "50 ميغابايت" },
              { label: "الأنواع المدعومة", value: "JPG، PNG، PDF، TIF" },
              { label: "عدد العمال المتوازيين", value: "2 عمال" },
              { label: "حد إعادة المحاولة", value: "3 محاولات" },
              { label: "رؤوس الأمان", value: "Helmet (CSP, HSTS, X-Frame, ...)" },
              { label: "صلاحية الجلسة", value: "8 ساعات" },
              { label: "حد الطلبات (API)", value: "300 طلب/دقيقة — 20 دخول/15 دقيقة" },
              { label: "تشفير كلمات المرور", value: "bcrypt (cost factor 12)" },
            ].map((item) => (
              <div key={item.label} className="flex justify-between gap-4 py-2 border-b border-border/50">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium text-left text-xs">{item.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
