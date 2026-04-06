import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Key, Plus, Trash2, Copy, Check, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface ApiKey {
  id: number;
  userId: number;
  name: string;
  prefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

async function fetchApiKeys(): Promise<ApiKey[]> {
  const r = await fetch(`${BASE}/api/api-keys`, { credentials: "include" });
  if (!r.ok) throw new Error("فشل تحميل المفاتيح");
  return r.json();
}

async function createApiKey(body: { name: string; expiresInDays?: number }): Promise<{ id: number; name: string; prefix: string; key: string; message: string }> {
  const r = await fetch(`${BASE}/api/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.error ?? "فشل إنشاء المفتاح");
  }
  return r.json();
}

async function revokeApiKey(id: number): Promise<void> {
  const r = await fetch(`${BASE}/api/api-keys/${id}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error("فشل إلغاء المفتاح");
}

export default function AdminApiKeysPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys, isLoading } = useQuery({ queryKey: ["api-keys"], queryFn: fetchApiKeys });

  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setNewKeyName("");
      setExpiresInDays("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast({ title: "تم إنشاء المفتاح", description: "احفظ المفتاح الآن — لن يظهر مرة أخرى." });
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast({ title: "تم إلغاء المفتاح" });
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              مفاتيح API ({keys?.length ?? 0})
            </CardTitle>
            <Button size="sm" className="gap-2" onClick={() => { setShowCreate(true); setCreatedKey(null); }} data-testid="button-create-api-key">
              <Plus className="w-3.5 h-3.5" />
              إنشاء مفتاح
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (keys?.length ?? 0) === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Key className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد مفاتيح API بعد</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys!.map((key) => (
                <div key={key.id} className="flex items-center justify-between px-4 py-3 gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{key.name}</span>
                      {!key.isActive && (
                        <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">ملغى</span>
                      )}
                      {key.expiresAt && new Date(key.expiresAt) < new Date() && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">منتهي</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{key.prefix}••••••••</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      أُنشئ: {new Date(key.createdAt).toLocaleDateString("ar-SA")}
                      {key.lastUsedAt && ` • آخر استخدام: ${new Date(key.lastUsedAt).toLocaleDateString("ar-SA")}`}
                      {key.expiresAt && ` • ينتهي: ${new Date(key.expiresAt).toLocaleDateString("ar-SA")}`}
                    </p>
                  </div>
                  {key.isActive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() => revokeMutation.mutate(key.id)}
                      disabled={revokeMutation.isPending}
                      data-testid={`button-revoke-key-${key.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إنشاء مفتاح API جديد</DialogTitle>
          </DialogHeader>
          {createdKey ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800">احفظ هذا المفتاح الآن. لن يظهر مرة أخرى.</p>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted p-2 rounded font-mono break-all">{createdKey}</code>
                <Button size="icon" variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <Button className="w-full" onClick={() => { setShowCreate(false); setCreatedKey(null); }}>إغلاق</Button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">اسم المفتاح</Label>
                  <Input
                    className="mt-1 text-right"
                    placeholder="مثال: نظام الأرشفة الخارجي"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-sm">انتهاء الصلاحية (أيام، اتركه فارغاً لعدم الانتهاء)</Label>
                  <Input
                    className="mt-1 text-right"
                    placeholder="365"
                    type="number"
                    min="1"
                    max="3650"
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>إلغاء</Button>
                <Button
                  onClick={() => createMutation.mutate({ name: newKeyName.trim(), expiresInDays: expiresInDays ? Number(expiresInDays) : undefined })}
                  disabled={!newKeyName.trim() || createMutation.isPending}
                >
                  إنشاء
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
