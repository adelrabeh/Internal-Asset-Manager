import { useState } from "react";
import { Link } from "wouter";
import { useListJobs, useDeleteJob, useRetryJob } from "@workspace/api-client-react";
import { getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, RefreshCw, Trash2, Eye, Plus, Filter, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export const STATUS_CONFIG: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-amber-100 text-amber-700 border border-amber-200", label: "في الانتظار" },
  processing: { cls: "bg-blue-100 text-blue-700 border border-blue-200 animate-pulse", label: "قيد المعالجة" },
  ocr_complete: { cls: "bg-violet-100 text-violet-700 border border-violet-200", label: "بانتظار المراجعة" },
  reviewed: { cls: "bg-sky-100 text-sky-700 border border-sky-200", label: "بانتظار الاعتماد" },
  approved: { cls: "bg-emerald-100 text-emerald-700 border border-emerald-200", label: "معتمد" },
  rejected: { cls: "bg-red-100 text-red-700 border border-red-200", label: "مرفوض" },
  failed: { cls: "bg-rose-100 text-rose-700 border border-rose-200", label: "فشل" },
};

export function StatusBadge({ status }: { status: string }) {
  const { cls, label } = STATUS_CONFIG[status] ?? { cls: "bg-gray-100 text-gray-700", label: status };
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
}

function FileTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    pdf: "bg-red-100 text-red-600",
    jpg: "bg-blue-100 text-blue-600",
    png: "bg-purple-100 text-purple-600",
  };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-mono font-bold uppercase ${colors[type] ?? "bg-gray-100 text-gray-600"}`}>
      {type}
    </span>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: string) {
  return new Date(date).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
}

const EXPORTABLE_STATUSES = ["ocr_complete", "reviewed", "approved"];

export default function JobsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useListJobs(
    statusFilter !== "all" ? { status: statusFilter as "pending" | "processing" | "ocr_complete" | "reviewed" | "approved" | "rejected" | "failed" } : undefined,
  );

  const deleteMutation = useDeleteJob();
  const retryMutation = useRetryJob();

  const jobs = data?.jobs ?? [];

  const exportableJobs = jobs.filter((j) => EXPORTABLE_STATUSES.includes(j.status));
  const allExportableSelected = exportableJobs.length > 0 && exportableJobs.every((j) => selectedIds.has(j.id));

  const toggleSelectAll = () => {
    if (allExportableSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(exportableJobs.map((j) => j.id)));
    }
  };

  const toggleJob = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkExport = async () => {
    if (selectedIds.size === 0) return;
    setExporting(true);
    try {
      const r = await fetch(`${BASE}/api/jobs/bulk-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ jobIds: Array.from(selectedIds) }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error ?? "فشل التصدير");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ocr-export-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setSelectedIds(new Set());
      toast({ title: "تم التصدير", description: `تم تصدير ${selectedIds.size} ملف بنجاح` });
    } catch (e) {
      toast({ title: "خطأ في التصدير", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (id: number, filename: string) => {
    if (!confirm(`هل تريد حذف المهمة "${filename}"؟`)) return;
    await deleteMutation.mutateAsync({ id });
    selectedIds.delete(id);
    setSelectedIds(new Set(selectedIds));
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
    toast({ title: "تم الحذف", description: "تم حذف المهمة بنجاح" });
  };

  const handleRetry = async (id: number) => {
    await retryMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
    toast({ title: "إعادة المحاولة", description: "تمت إعادة إضافة المهمة إلى قائمة المعالجة" });
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSelectedIds(new Set()); }}>
            <SelectTrigger className="w-48" data-testid="select-status-filter">
              <SelectValue placeholder="تصفية بالحالة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع المهام</SelectItem>
              <SelectItem value="pending">في الانتظار</SelectItem>
              <SelectItem value="processing">قيد المعالجة</SelectItem>
              <SelectItem value="ocr_complete">بانتظار المراجعة</SelectItem>
              <SelectItem value="reviewed">بانتظار الاعتماد</SelectItem>
              <SelectItem value="approved">معتمدة</SelectItem>
              <SelectItem value="rejected">مرفوضة</SelectItem>
              <SelectItem value="failed">فشلت</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleBulkExport}
              disabled={exporting}
              data-testid="button-bulk-export"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? "جاري التصدير..." : `تصدير مجمع (${selectedIds.size})`}
            </Button>
          )}
          <Link href="/upload">
            <Button data-testid="button-new-upload" className="gap-2">
              <Plus className="w-4 h-4" />
              رفع ملف جديد
            </Button>
          </Link>
        </div>
      </div>

      {/* Jobs Table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>{data ? `${data.total} مهمة` : "قائمة المهام"}</span>
            {exportableJobs.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                حدد الملفات للتصدير المجمع (DOCX)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">لا توجد مهام بعد</p>
              <Link href="/upload">
                <Button variant="outline" size="sm" className="mt-3">
                  رفع ملف جديد
                </Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-3 w-10">
                      {exportableJobs.length > 0 && (
                        <Checkbox
                          checked={allExportableSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="تحديد الكل"
                        />
                      )}
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">#</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">اسم الملف</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">النوع</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">الحجم</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">الحالة</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">التاريخ</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {jobs.map((job) => {
                    const isExportable = EXPORTABLE_STATUSES.includes(job.status);
                    const isSelected = selectedIds.has(job.id);
                    return (
                      <tr
                        key={job.id}
                        data-testid={`row-job-${job.id}`}
                        className={`hover:bg-muted/20 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                      >
                        <td className="px-4 py-3">
                          {isExportable && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleJob(job.id)}
                              aria-label={`تحديد ${job.originalFilename}`}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{job.id}</td>
                        <td className="px-4 py-3">
                          <div className="max-w-48 truncate font-medium">{job.originalFilename}</div>
                          {job.retryCount > 0 && (
                            <span className="text-xs text-muted-foreground">محاولة {job.retryCount}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <FileTypeBadge type={job.fileType} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{formatSize(job.fileSize)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={job.status} />
                          {job.errorMessage && (
                            <p className="text-xs text-red-500 mt-1 max-w-32 truncate" title={job.errorMessage}>
                              {job.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(job.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Link href={`/jobs/${job.id}`}>
                              <Button variant="ghost" size="icon" className="w-7 h-7" data-testid={`button-view-job-${job.id}`}>
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            </Link>
                            {job.status === "failed" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-amber-500"
                                data-testid={`button-retry-job-${job.id}`}
                                onClick={() => handleRetry(job.id)}
                                disabled={retryMutation.isPending}
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7 text-destructive"
                              data-testid={`button-delete-job-${job.id}`}
                              onClick={() => handleDelete(job.id, job.originalFilename)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
