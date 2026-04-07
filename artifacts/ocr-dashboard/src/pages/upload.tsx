import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListJobsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, X, CheckCircle, AlertCircle, CloudUpload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface UploadFile {
  file: File;
  id: string;
  status: "pending" | "uploading" | "processing" | "done" | "error";
  progress: number;
  error?: string;
  jobId?: number;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "application/pdf", "image/tiff", "image/tif"];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPage() {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    const valid = arr.filter((f) => {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        toast({ title: "نوع الملف غير مدعوم", description: `${f.name}: يُقبل JPG، PNG، PDF، TIF فقط`, variant: "destructive" });
        return false;
      }
      if (f.size > MAX_SIZE) {
        toast({ title: "الملف كبير جداً", description: `${f.name}: الحد الأقصى 50 ميغابايت`, variant: "destructive" });
        return false;
      }
      return true;
    });

    setFiles((prev) => [
      ...prev,
      ...valid.map((f) => ({
        file: f,
        id: `${Date.now()}-${Math.random()}`,
        status: "pending" as const,
        progress: 0,
      })),
    ]);
  }, [toast]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const uploadFile = async (uploadFile: UploadFile): Promise<number | null> => {
    const formData = new FormData();
    formData.append("file", uploadFile.file);

    // Upload
    const uploadRes = await fetch("/api/uploads", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json();
      throw new Error(err.error ?? "فشل رفع الملف");
    }

    const uploadData = await uploadRes.json();

    // Create job
    const jobRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        filename: uploadData.filename,
        originalFilename: uploadData.originalFilename,
        fileType: uploadData.fileType,
        fileSize: uploadData.fileSize,
      }),
    });

    if (!jobRes.ok) {
      const err = await jobRes.json();
      throw new Error(err.error ?? "فشل إنشاء المهمة");
    }

    const job = await jobRes.json();

    // Start processing
    await fetch(`/api/jobs/${job.id}/process`, {
      method: "POST",
      credentials: "include",
    });

    return job.id;
  };

  const handleUploadAll = async () => {
    const pending = files.filter((f) => f.status === "pending");
    if (pending.length === 0) return;

    for (const f of pending) {
      setFiles((prev) =>
        prev.map((item) =>
          item.id === f.id ? { ...item, status: "uploading", progress: 30 } : item,
        ),
      );

      try {
        const jobId = await uploadFile(f);
        setFiles((prev) =>
          prev.map((item) =>
            item.id === f.id ? { ...item, status: "done", progress: 100, jobId: jobId ?? undefined } : item,
          ),
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((item) =>
            item.id === f.id
              ? { ...item, status: "error", error: (err as Error).message }
              : item,
          ),
        );
      }
    }

    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
    toast({ title: "تم الرفع", description: "تمت إضافة الملفات إلى قائمة المعالجة" });
  };

  const hasPending = files.some((f) => f.status === "pending");
  const allDone = files.length > 0 && files.every((f) => f.status === "done");

  return (
    <div className="max-w-2xl mx-auto space-y-4" dir="rtl">
      {/* Drop Zone */}
      <Card
        className={`shadow-sm border-2 border-dashed transition-all cursor-pointer ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        data-testid="dropzone"
      >
        <CardContent className="py-12 text-center">
          <CloudUpload className={`w-12 h-12 mx-auto mb-4 ${dragging ? "text-primary" : "text-muted-foreground"}`} />
          <h3 className="text-lg font-semibold mb-1">اسحب الملفات هنا أو انقر للاختيار</h3>
          <p className="text-sm text-muted-foreground">يدعم JPG، PNG، PDF، TIF — حجم أقصى 50 ميغابايت</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.pdf,.tif,.tiff"
            className="hidden"
            data-testid="input-file"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </CardContent>
      </Card>

      {/* File List */}
      {files.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">الملفات المحددة ({files.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {files.map((f) => (
              <div key={f.id} data-testid={`file-item-${f.id}`} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(f.file.size)}</p>
                  {f.status === "uploading" && <Progress value={f.progress} className="h-1 mt-1" />}
                  {f.status === "error" && (
                    <p className="text-xs text-destructive mt-1">{f.error}</p>
                  )}
                  {f.status === "done" && f.jobId && (
                    <button
                      className="text-xs text-primary underline mt-1"
                      onClick={(e) => { e.stopPropagation(); setLocation(`/jobs/${f.jobId}`); }}
                    >
                      عرض المهمة #{f.jobId}
                    </button>
                  )}
                </div>
                <div className="shrink-0">
                  {f.status === "pending" && (
                    <Button variant="ghost" size="icon" className="w-6 h-6" onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {f.status === "done" && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                  {f.status === "error" && <AlertCircle className="w-5 h-5 text-destructive" />}
                  {f.status === "uploading" && (
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              {hasPending && (
                <Button onClick={handleUploadAll} className="gap-2" data-testid="button-upload-all">
                  <Upload className="w-4 h-4" />
                  رفع ومعالجة ({files.filter((f) => f.status === "pending").length} ملف)
                </Button>
              )}
              {allDone && (
                <Button onClick={() => setLocation("/jobs")} variant="outline" className="gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  عرض المهام
                </Button>
              )}
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={(e) => { e.stopPropagation(); setFiles([]); }}
              >
                مسح القائمة
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
