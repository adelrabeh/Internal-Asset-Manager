import { useRoute, Link } from "wouter";
import {
  useGetJob,
  useGetJobResult,
  useProcessJob,
  useRetryJob,
  getGetJobQueryKey,
  getGetJobResultQueryKey,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  ArrowRight,
  Download,
  RefreshCw,
  Play,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Award,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { cls: string; label: string; icon: React.ComponentType<{className?: string}> }> = {
    completed: { cls: "bg-emerald-100 text-emerald-700", label: "مكتمل", icon: CheckCircle },
    processing: { cls: "bg-blue-100 text-blue-700", label: "قيد المعالجة", icon: Clock },
    pending: { cls: "bg-amber-100 text-amber-700", label: "في الانتظار", icon: Clock },
    failed: { cls: "bg-red-100 text-red-700", label: "فشل", icon: XCircle },
  };
  const { cls, label, icon: Icon } = config[status] ?? { cls: "bg-gray-100 text-gray-700", label: status, icon: Clock };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${cls}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const id = params ? parseInt(params.id) : 0;
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: job, isLoading: jobLoading } = useGetJob(id, {
    query: { enabled: !!id, queryKey: getGetJobQueryKey(id), refetchInterval: 3000 },
  });

  const { data: result, isLoading: resultLoading } = useGetJobResult(id, {
    query: { enabled: job?.status === "completed", queryKey: getGetJobResultQueryKey(id) },
  });

  const processMutation = useProcessJob();
  const retryMutation = useRetryJob();

  const handleProcess = async () => {
    await processMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
    toast({ title: "بدء المعالجة", description: "تمت إضافة المهمة إلى قائمة المعالجة" });
  };

  const handleRetry = async () => {
    await retryMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
    toast({ title: "إعادة المحاولة", description: "ستبدأ المعالجة قريباً" });
  };

  if (jobLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">المهمة غير موجودة</p>
        <Link href="/jobs">
          <Button variant="outline" size="sm" className="mt-3">العودة للمهام</Button>
        </Link>
      </div>
    );
  }

  const qualityColor = result?.qualityLevel === "high" ? "text-emerald-600" :
    result?.qualityLevel === "medium" ? "text-amber-600" : "text-red-600";
  const qualityLabel = { high: "جودة عالية", medium: "جودة متوسطة", low: "جودة منخفضة" }[result?.qualityLevel ?? ""] ?? "";

  return (
    <div className="space-y-5" dir="rtl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/jobs" className="hover:text-foreground transition-colors">المهام</Link>
        <ArrowRight className="w-3.5 h-3.5 rotate-180" />
        <span className="text-foreground font-medium">{job.originalFilename}</span>
      </div>

      {/* Job Info Card */}
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg">{job.originalFilename}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">المهمة رقم #{job.id}</p>
            </div>
            <StatusBadge status={job.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">نوع الملف</p>
              <p className="font-mono font-bold uppercase mt-0.5">{job.fileType}</p>
            </div>
            <div>
              <p className="text-muted-foreground">الحجم</p>
              <p className="font-medium mt-0.5">{(job.fileSize / 1024).toFixed(1)} KB</p>
            </div>
            <div>
              <p className="text-muted-foreground">محاولات إعادة المعالجة</p>
              <p className="font-medium mt-0.5">{job.retryCount}</p>
            </div>
            {job.processingDurationMs && (
              <div>
                <p className="text-muted-foreground">مدة المعالجة</p>
                <p className="font-medium mt-0.5">{(job.processingDurationMs / 1000).toFixed(1)} ثانية</p>
              </div>
            )}
          </div>

          {job.errorMessage && (
            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2">
              <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{job.errorMessage}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-4">
            {job.status === "pending" && (
              <Button onClick={handleProcess} disabled={processMutation.isPending} className="gap-2" data-testid="button-process">
                <Play className="w-4 h-4" />
                بدء المعالجة
              </Button>
            )}
            {job.status === "failed" && (
              <Button variant="outline" onClick={handleRetry} disabled={retryMutation.isPending} className="gap-2" data-testid="button-retry">
                <RefreshCw className="w-4 h-4" />
                إعادة المحاولة
              </Button>
            )}
            {job.status === "completed" && (
              <>
                <a href={`/api/jobs/${job.id}/download/docx`} download>
                  <Button className="gap-2" data-testid="button-download-docx">
                    <Download className="w-4 h-4" />
                    تحميل Word
                  </Button>
                </a>
                <a href={`/api/jobs/${job.id}/download/text`} download>
                  <Button variant="outline" className="gap-2" data-testid="button-download-text">
                    <FileText className="w-4 h-4" />
                    تحميل نص
                  </Button>
                </a>
              </>
            )}
            {job.status === "processing" && (
              <div className="flex items-center gap-3 text-sm text-blue-600">
                <RefreshCw className="w-4 h-4 animate-spin" />
                جاري المعالجة...
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* OCR Result */}
      {job.status === "completed" && (
        <>
          {resultLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : result ? (
            <>
              {/* Quality Score Card */}
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Award className="w-4 h-4 text-primary" />
                    تقرير جودة التعرف الضوئي
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">درجة الثقة</p>
                      <p className={`text-2xl font-bold mt-1 ${qualityColor}`}>{result.confidenceScore}%</p>
                      <Progress value={result.confidenceScore} className="h-1.5 mt-1" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">مستوى الجودة</p>
                      <p className={`text-lg font-semibold mt-1 ${qualityColor}`}>{qualityLabel}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">عدد الكلمات</p>
                      <p className="text-2xl font-bold mt-1">{result.wordCount}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">عدد مرات المسح</p>
                      <p className="text-2xl font-bold mt-1">{result.passCount}</p>
                    </div>
                  </div>

                  {result.processingNotes && (
                    <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-foreground">{result.processingNotes}</p>
                    </div>
                  )}

                  {result.lowConfidenceWords.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">
                        كلمات بمستوى ثقة منخفض ({result.lowConfidenceWords.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {result.lowConfidenceWords.map((w, i) => (
                          <span
                            key={i}
                            title={`ثقة: ${Math.round(w.confidence * 100)}%`}
                            className="px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs font-medium text-amber-700 cursor-help"
                          >
                            {w.word}
                            <span className="mr-1 text-amber-400 text-xs">{Math.round(w.confidence * 100)}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Extracted Text */}
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    النص المستخرج
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="bg-muted/30 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap font-mono text-right min-h-32 max-h-96 overflow-y-auto border"
                    dir="rtl"
                    data-testid="text-extracted"
                  >
                    {result.refinedText}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
