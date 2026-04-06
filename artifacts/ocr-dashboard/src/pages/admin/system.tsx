import { useListJobs, useRetryJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, RefreshCw, AlertTriangle, Activity, Server, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminSystemPage() {
  const { data: failedJobsData, isLoading: failedLoading } = useListJobs({ status: "failed" });
  const { data: pendingJobsData } = useListJobs({ status: "pending" });
  const { data: processingJobsData } = useListJobs({ status: "processing" });
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
              { label: "محرك التعرف الضوئي", value: "OCR Engine (محلي - بدون اتصال خارجي)" },
              { label: "عدد مرات المسح", value: "3 مرات لكل مستند" },
              { label: "الحد الأقصى للملف", value: "50 ميغابايت" },
              { label: "الأنواع المدعومة", value: "JPG، PNG، PDF" },
              { label: "عدد العمال المتوازيين", value: "2 عمال" },
              { label: "حد إعادة المحاولة", value: "3 محاولات" },
              { label: "تشفير البيانات", value: "TLS في النقل، AES في التخزين" },
              { label: "صلاحية الجلسة", value: "24 ساعة" },
            ].map((item) => (
              <div key={item.label} className="flex justify-between gap-4 py-2 border-b border-border/50">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium text-left">{item.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
