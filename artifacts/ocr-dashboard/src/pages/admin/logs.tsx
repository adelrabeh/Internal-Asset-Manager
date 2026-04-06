import { useState } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText, ChevronRight, ChevronLeft } from "lucide-react";

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    LOGIN_SUCCESS: "bg-emerald-100 text-emerald-700",
    LOGIN_FAILED: "bg-red-100 text-red-700",
    LOGOUT: "bg-slate-100 text-slate-700",
    JOB_CREATED: "bg-blue-100 text-blue-700",
    JOB_DELETED: "bg-red-100 text-red-700",
    JOB_RETRIED: "bg-amber-100 text-amber-700",
    JOB_PROCESSED: "bg-blue-100 text-blue-700",
    FILE_UPLOADED: "bg-indigo-100 text-indigo-700",
    DOWNLOAD_DOCX: "bg-purple-100 text-purple-700",
    DOWNLOAD_TEXT: "bg-purple-100 text-purple-700",
    USER_CREATED: "bg-emerald-100 text-emerald-700",
    USER_UPDATED: "bg-blue-100 text-blue-700",
    USER_DELETED: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-mono font-medium ${colors[action] ?? "bg-gray-100 text-gray-700"}`}>
      {action}
    </span>
  );
}

export default function AdminLogsPage() {
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  const { data, isLoading } = useListAuditLogs({ page, limit: LIMIT });

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" />
            سجلات التدقيق ({data?.total ?? 0} سجل)
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
                    {(data?.logs ?? []).map((log) => (
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
                    {(data?.logs ?? []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                          لا توجد سجلات بعد
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
