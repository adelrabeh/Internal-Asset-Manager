import { useGetDashboardSummary, useGetRecentActivity, useGetQualityMetrics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, CheckCircle, Clock, XCircle, Users, TrendingUp, Award, Activity, ClipboardCheck } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { StatusBadge } from "./jobs";

function QualityBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const variants: Record<string, string> = {
    high: "bg-emerald-100 text-emerald-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-red-100 text-red-700",
  };
  const labels: Record<string, string> = {
    high: "عالية",
    medium: "متوسطة",
    low: "منخفضة",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variants[level] ?? ""}`}>
      {labels[level] ?? level}
    </span>
  );
}

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({ limit: 8 });
  const { data: metrics, isLoading: metricsLoading } = useGetQualityMetrics();

  const qualityData = metrics
    ? [
        { name: "عالية", value: metrics.highQualityPct, color: "#10b981" },
        { name: "متوسطة", value: metrics.mediumQualityPct, color: "#f59e0b" },
        { name: "منخفضة", value: metrics.lowQualityPct, color: "#ef4444" },
      ]
    : [];

  const statsData = summary
    ? [
        { name: "معتمد", value: (summary as any).approvedJobs ?? 0, color: "#10b981" },
        { name: "مراجعة", value: (summary as any).ocrCompleteJobs ?? 0, color: "#8b5cf6" },
        { name: "انتظار", value: summary.pendingJobs, color: "#f59e0b" },
        { name: "معالجة", value: summary.processingJobs, color: "#3b82f6" },
        { name: "مرفوض", value: (summary as any).rejectedJobs ?? 0, color: "#f97316" },
        { name: "فشل", value: summary.failedJobs, color: "#ef4444" },
      ]
    : [];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "إجمالي المهام",
            value: summary?.totalJobs ?? 0,
            icon: FileText,
            color: "text-blue-500",
            bg: "bg-blue-50",
          },
          {
            label: "معتمدة",
            value: (summary as any)?.approvedJobs ?? 0,
            icon: CheckCircle,
            color: "text-emerald-500",
            bg: "bg-emerald-50",
          },
          {
            label: "بانتظار المراجعة",
            value: (summary as any)?.ocrCompleteJobs ?? 0,
            icon: ClipboardCheck,
            color: "text-violet-500",
            bg: "bg-violet-50",
          },
          {
            label: "فشلت / مرفوضة",
            value: (summary?.failedJobs ?? 0) + ((summary as any)?.rejectedJobs ?? 0),
            icon: XCircle,
            color: "text-red-500",
            bg: "bg-red-50",
          },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="shadow-sm">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    {summaryLoading ? (
                      <Skeleton className="h-8 w-16 mt-1" />
                    ) : (
                      <p className="text-3xl font-bold mt-1">{stat.value.toLocaleString("ar-SA")}</p>
                    )}
                  </div>
                  <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Row 2: Quality + Processing Time */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">متوسط وقت المعالجة</p>
                {summaryLoading ? (
                  <Skeleton className="h-8 w-24 mt-1" />
                ) : (
                  <p className="text-3xl font-bold mt-1">
                    {summary ? (summary.avgProcessingTimeMs / 1000).toFixed(1) : "0"}
                    <span className="text-sm font-normal text-muted-foreground mr-1">ثانية</span>
                  </p>
                )}
              </div>
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <Activity className="w-5 h-5 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">متوسط درجة الثقة</p>
                {summaryLoading ? (
                  <Skeleton className="h-8 w-20 mt-1" />
                ) : (
                  <p className="text-3xl font-bold mt-1">
                    {summary?.avgConfidenceScore ?? 0}
                    <span className="text-sm font-normal text-muted-foreground mr-1">%</span>
                  </p>
                )}
              </div>
              <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-teal-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي المستخدمين</p>
                {summaryLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <p className="text-3xl font-bold mt-1">{summary?.totalUsers ?? 0}</p>
                )}
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-indigo-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quality Distribution */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" />
              توزيع جودة المستخرجات
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : metrics && metrics.totalProcessed > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="60%" height={160}>
                  <PieChart>
                    <Pie data={qualityData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                      {qualityData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 flex-1">
                  {qualityData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-sm text-muted-foreground">{d.name}</span>
                      </div>
                      <span className="text-sm font-semibold">{d.value.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                لا توجد بيانات بعد
              </div>
            )}
          </CardContent>
        </Card>

        {/* Jobs Breakdown */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              توزيع المهام
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : summary && summary.totalJobs > 0 ? (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={statsData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fontFamily: "Cairo" }} width={50} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {statsData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                لا توجد بيانات بعد
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            آخر النشاطات
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : activity && activity.length > 0 ? (
            <div className="divide-y divide-border">
              {activity.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.filename}</p>
                      <p className="text-xs text-muted-foreground">{item.username}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.qualityLevel && <QualityBadge level={item.qualityLevel} />}
                    <StatusBadge status={item.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground text-sm">
              لم تتم معالجة أي مهام بعد
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
