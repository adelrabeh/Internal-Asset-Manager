export const STATUS_CONFIG: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-amber-100 text-amber-700 border border-amber-200", label: "في الانتظار" },
  processing: { cls: "bg-blue-100 text-blue-700 border border-blue-200 animate-pulse", label: "قيد المعالجة" },
  ocr_complete: { cls: "bg-violet-100 text-violet-700 border border-violet-200", label: "بانتظار المراجعة" },
  reviewed: { cls: "bg-sky-100 text-sky-700 border border-sky-200", label: "بانتظار الاعتماد" },
  approved: { cls: "bg-emerald-100 text-emerald-700 border border-emerald-200", label: "معتمد" },
  completed: { cls: "bg-emerald-50 text-emerald-600 border border-emerald-100", label: "مكتمل" },
  rejected: { cls: "bg-red-100 text-red-700 border border-red-200", label: "مرفوض" },
  failed: { cls: "bg-rose-100 text-rose-700 border border-rose-200", label: "فشل" },
};

export function StatusBadge({ status }: { status: string }) {
  const { cls, label } = STATUS_CONFIG[status] ?? { cls: "bg-gray-100 text-gray-700", label: status };
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
}
