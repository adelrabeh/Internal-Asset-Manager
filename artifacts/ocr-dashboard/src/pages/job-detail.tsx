import { useRoute, Link } from "wouter";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
  ThumbsUp,
  ThumbsDown,
  ClipboardCheck,
  Stamp,
  ImageIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { STATUS_CONFIG } from "./jobs";
import { StructuredOcrText } from "@/components/structured-ocr-text";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function StatusBadge({ status }: { status: string }) {
  const iconMap: Record<string, React.ComponentType<{className?: string}>> = {
    approved: CheckCircle, rejected: XCircle, failed: XCircle, ocr_complete: ClipboardCheck,
    processing: RefreshCw, pending: Clock,
  };
  const { cls, label } = STATUS_CONFIG[status] ?? { cls: "bg-gray-100 text-gray-700", label: status };
  const Icon = iconMap[status] ?? Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${cls}`}>
      <Icon className={`w-3.5 h-3.5 ${status === "processing" ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}

export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const id = params ? parseInt(params.id) : 0;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = useAuth();

  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [approveNotes, setApproveNotes] = useState("");
  const [approveLoading, setApproveLoading] = useState(false);

  const { data: job, isLoading: jobLoading } = useGetJob(id, {
    query: { enabled: !!id, queryKey: getGetJobQueryKey(id), refetchInterval: 3000 },
  });

  const hasOcrResult = ["ocr_complete", "reviewed", "approved", "rejected"].includes(job?.status ?? "");

  const { data: result, isLoading: resultLoading } = useGetJobResult(id, {
    query: { enabled: hasOcrResult, queryKey: getGetJobResultQueryKey(id) },
  });

  const processMutation = useProcessJob();
  const retryMutation = useRetryJob();

  const handleReview = async (action: "approve" | "reject") => {
    setReviewLoading(true);
    try {
      const res = await fetch(`${BASE}/api/jobs/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: reviewNotes }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "فشل الإجراء");
      }
      qc.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
      toast({
        title: action === "approve" ? "تم الإرسال للاعتماد" : "تم الرفض",
        description: action === "approve" ? "تمت مراجعة المهمة وإرسالها للاعتماد النهائي" : "تم رفض المهمة من مرحلة المراجعة",
      });
      setReviewNotes("");
    } catch (e) {
      toast({ title: "خطأ", description: (e as Error).message, variant: "destructive" });
    } finally {
      setReviewLoading(false);
    }
  };

  const handleApprove = async (action: "approve" | "reject") => {
    setApproveLoading(true);
    try {
      const res = await fetch(`${BASE}/api/jobs/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: approveNotes }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "فشل الإجراء");
      }
      qc.invalidateQueries({ queryKey: getGetJobQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
      toast({
        title: action === "approve" ? "تم الاعتماد" : "تم الرفض",
        description: action === "approve" ? "تم اعتماد المهمة نهائياً" : "تم رفض المهمة من مرحلة الاعتماد",
      });
      setApproveNotes("");
    } catch (e) {
      toast({ title: "خطأ", description: (e as Error).message, variant: "destructive" });
    } finally {
      setApproveLoading(false);
    }
  };

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
  const qualityLabelMap: Record<string, string> = { high: "جودة عالية", medium: "جودة متوسطة", low: "جودة منخفضة" };
  const qualityLabel = result?.qualityLevel ? (qualityLabelMap[result.qualityLevel] ?? "") : "";

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
          <div className="flex flex-wrap gap-2 mt-4">
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
            {(["ocr_complete", "reviewed", "approved"].includes(job.status)) && (
              <>
                <a href={`${BASE}/api/jobs/${job.id}/download/docx`} download>
                  <Button className="gap-2" data-testid="button-download-docx">
                    <Download className="w-4 h-4" />
                    تحميل Word
                  </Button>
                </a>
                <a href={`${BASE}/api/jobs/${job.id}/download/text`} download>
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

      {/* ── Document Preview ────────────────────────────────────────────── */}
      {hasOcrResult && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Original Document */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-primary" />
                الوثيقة الأصلية
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {job.fileType === "pdf" ? (
                <iframe
                  src={`${BASE}/api/jobs/${job.id}/preview`}
                  className="w-full h-96 rounded-b-lg border-0"
                  title="معاينة الوثيقة"
                />
              ) : (
                <div className="p-3">
                  <img
                    src={`${BASE}/api/jobs/${job.id}/preview`}
                    alt={job.originalFilename}
                    className="w-full object-contain max-h-96 rounded-lg border border-border"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                      (e.target as HTMLImageElement).parentElement!.innerHTML = '<p class="text-sm text-muted-foreground text-center py-8">تعذّر تحميل معاينة الملف</p>';
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* OCR Text */}
          {result && (
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  النص المستخرج
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/30 rounded-lg p-3 max-h-96 overflow-y-auto">
                  <StructuredOcrText text={result.refinedText} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Review Panel (مراجعة جودة OCR) ──────────────────────────────── */}
      {job.status === "ocr_complete" && hasPermission("review") && (
        <Card className="shadow-sm border-violet-200 bg-violet-50/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-violet-800">
              <ClipboardCheck className="w-4 h-4" />
              مراجعة جودة OCR
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-violet-700">
              راجع النص المستخرج أدناه. عند الموافقة ستُرسل المهمة لمرحلة الاعتماد النهائي.
            </p>
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1.5">ملاحظات المراجعة (اختياري)</label>
              <Textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="أضف ملاحظاتك هنا..."
                className="text-sm resize-none"
                rows={3}
                dir="rtl"
                data-testid="input-review-notes"
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => handleReview("approve")}
                disabled={reviewLoading}
                className="gap-2 bg-sky-600 hover:bg-sky-700 text-white"
                data-testid="button-send-for-approval"
              >
                <ThumbsUp className="w-4 h-4" />
                إرسال للاعتماد
              </Button>
              <Button
                onClick={() => handleReview("reject")}
                disabled={reviewLoading}
                variant="destructive"
                className="gap-2"
                data-testid="button-reject"
              >
                <ThumbsDown className="w-4 h-4" />
                رفض
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Review Complete Banner ─────────────────────────────────────── */}
      {job.status === "reviewed" && (
        <Card className="shadow-sm border-sky-200 bg-sky-50/40">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <ClipboardCheck className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sky-700">اجتازت هذه المهمة مراجعة الجودة</p>
                {job.reviewNotes && <p className="text-sm text-muted-foreground mt-1">{job.reviewNotes}</p>}
                {job.reviewedAt && (
                  <p className="text-xs text-muted-foreground mt-0.5">{new Date(job.reviewedAt).toLocaleString("ar-SA")}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Approve Panel (اعتماد نهائي) ──────────────────────────────── */}
      {job.status === "reviewed" && hasPermission("approve") && (
        <Card className="shadow-sm border-emerald-200 bg-emerald-50/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-emerald-800">
              <Stamp className="w-4 h-4" />
              الاعتماد النهائي
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-emerald-700">
              هذه المهمة اجتازت مراجعة الجودة وتنتظر اعتمادك النهائي.
            </p>
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1.5">ملاحظات الاعتماد (اختياري)</label>
              <Textarea
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="أضف ملاحظاتك هنا..."
                className="text-sm resize-none"
                rows={3}
                dir="rtl"
                data-testid="input-approve-notes"
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => handleApprove("approve")}
                disabled={approveLoading}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="button-approve"
              >
                <Stamp className="w-4 h-4" />
                اعتماد
              </Button>
              <Button
                onClick={() => handleApprove("reject")}
                disabled={approveLoading}
                variant="destructive"
                className="gap-2"
                data-testid="button-reject-approval"
              >
                <ThumbsDown className="w-4 h-4" />
                رفض
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Final Decision Banner ──────────────────────────────────────── */}
      {(job.status === "approved" || job.status === "rejected") && (
        <Card className={`shadow-sm border ${job.status === "approved" ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`}>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start gap-3">
              {job.status === "approved"
                ? <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                : <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />}
              <div>
                <p className={`font-semibold ${job.status === "approved" ? "text-emerald-700" : "text-red-700"}`}>
                  {job.status === "approved" ? "تم اعتماد هذه المهمة نهائياً" : "تم رفض هذه المهمة"}
                </p>
                {job.approveNotes && <p className="text-sm text-muted-foreground mt-1">{job.approveNotes}</p>}
                {job.approvedAt && (
                  <p className="text-xs text-muted-foreground mt-0.5">{new Date(job.approvedAt).toLocaleString("ar-SA")}</p>
                )}
              </div>
            </div>
            {job.reviewNotes && (
              <div className="border-t pt-3 flex items-start gap-3">
                <ClipboardCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">ملاحظات المراجعة</p>
                  <p className="text-sm mt-0.5">{job.reviewNotes}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* OCR Result */}
      {hasOcrResult && (
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
                    className="bg-muted/30 rounded-lg p-4 min-h-32 max-h-96 overflow-y-auto border"
                    data-testid="text-extracted"
                  >
                    <StructuredOcrText text={result.refinedText} />
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
