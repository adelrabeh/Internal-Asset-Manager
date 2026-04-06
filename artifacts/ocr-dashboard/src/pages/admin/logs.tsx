import { useState } from "react";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText, ChevronRight, ChevronLeft, Search, X } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  LOGIN_SUCCESS: "bg-emerald-100 text-emerald-700",
  LOGIN_FAILED: "bg-red-100 text-red-700",
  ACCOUNT_LOCKED: "bg-red-200 text-red-800 font-bold",
  ACCOUNT_LOCKED_ATTEMPT: "bg-red-100 text-red-700",
  LOGOUT: "bg-slate-100 text-slate-700",
  JOB_CREATED: "bg-blue-100 text-blue-700",
  JOB_DELETED: "bg-red-100 text-red-700",
  JOB_RETRIED: "bg-amber-100 text-amber-700",
  JOB_PROCESSED: "bg-blue-100 text-blue-700",
  JOB_REVIEWED: "bg-violet-100 text-violet-700",
  JOB_APPROVED: "bg-green-100 text-green-700",
  JOB_REJECTED_BY_REVIEWER: "bg-orange-100 text-orange-700",
  JOB_REJECTED_BY_APPROVER: "bg-red-100 text-red-700",
  FILE_UPLOADED: "bg-indigo-100 text-indigo-700",
  DOWNLOAD_DOCX: "bg-purple-100 text-purple-700",
  DOWNLOAD_TEXT: "bg-purple-100 text-purple-700",
  BULK_EXPORT: "bg-purple-100 text-purple-700",
  USER_CREATED: "bg-emerald-100 text-emerald-700",
  USER_UPDATED: "bg-blue-100 text-blue-700",
  USER_DELETED: "bg-red-100 text-red-700",
  API_KEY_CREATED: "bg-cyan-100 text-cyan-700",
  API_KEY_REVOKED: "bg-orange-100 text-orange-700",
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "دخول ناجح",
  LOGIN_FAILED: "دخول فاشل",
  ACCOUNT_LOCKED: "حساب مقفل",
  ACCOUNT_LOCKED_ATTEMPT: "محاولة على حساب مقفل",
  LOGOUT: "خروج",
  JOB_CREATED: "مهمة جديدة",
  JOB_DELETED: "حذف مهمة",
  JOB_RETRIED: "إعادة معالجة",
  JOB_PROCESSED: "بدء معالجة",
  JOB_REVIEWED: "مراجعة جودة",
  JOB_APPROVED: "اعتماد نهائي",
  JOB_REJECTED_BY_REVIEWER: "رفض (مراجع)",
  JOB_REJECTED_BY_APPROVER: "رفض (معتمد)",
  FILE_UPLOADED: "رفع ملف",
  DOWNLOAD_DOCX: "تنزيل DOCX",
  DOWNLOAD_TEXT: "تنزيل نص",
  BULK_EXPORT: "تصدير مجمع",
  USER_CREATED: "إنشاء مستخدم",
  USER_UPDATED: "تحديث مستخدم",
  USER_DELETED: "حذف مستخدم",
  API_KEY_CREATED: "مفتاح API جديد",
  API_KEY_REVOKED: "إلغاء مفتاح API",
};

function ActionBadge({ action }: { action: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-mono font-medium ${ACTION_COLORS[action] ?? "bg-gray-100 text-gray-700"}`}>
      {ACTION_LABELS[action] ?? action}
    </span>
  );
}

export default function AdminLogsPage() {
  const [page, setPage] = useState(1);
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const LIMIT = 25;

  const { data, isLoading } = useListAuditLogs({ page, limit: LIMIT });

  const allLogs = data?.logs ?? [];

  // Apply client-side filters
  const filtered = allLogs.filter((log) => {
    const matchUser = !userFilter || (log.username ?? "").toLowerCase().includes(userFilter.toLowerCase());
    const matchAction = !actionFilter || log.action.toLowerCase().includes(actionFilter.toLowerCase());
    return matchUser && matchAction;
  });

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 1;

  const hasFilters = userFilter || actionFilter;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Filters */}
      <Card className="shadow-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-40">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="فلتر بالمستخدم..."
                value={userFilter}
                onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
                className="pr-9 text-right text-sm h-9"
              />
            </div>
            <div className="relative flex-1 min-w-40">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="فلتر بنوع الإجراء (مثال: LOGIN)..."
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
                className="pr-9 text-right text-sm h-9"
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="gap-1.5 h-9" onClick={() => { setUserFilter(""); setActionFilter(""); }}>
                <X className="w-3.5 h-3.5" />
                مسح الفلاتر
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" />
            سجلات التدقيق ({hasFilters ? `${filtered.length} من ` : ""}{data?.total ?? 0} سجل)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">الوقت</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">المستخدم</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">الإجراء</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">النوع</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">التفاصيل</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">عنوان IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((log) => (
                      <tr key={log.id} data-testid={`row-log-${log.id}`} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "medium" })}
                        </td>
                        <td className="px-4 py-2 font-medium">{log.username ?? "-"}</td>
                        <td className="px-4 py-2"><ActionBadge action={log.action} /></td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">{log.resourceType}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground max-w-48 truncate" title={log.details ?? ""}>
                          {log.details ?? "-"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground font-mono">{log.ipAddress ?? "-"}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                          {hasFilters ? "لا توجد سجلات مطابقة للفلتر" : "لا توجد سجلات بعد"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 p-4 border-t">
                  <Button
                    variant="outline"
                    size="icon"
                    className="w-8 h-8"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    صفحة {page} من {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="w-8 h-8"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
