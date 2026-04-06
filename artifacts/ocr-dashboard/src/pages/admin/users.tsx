import { useState } from "react";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Plus, Edit2, Trash2, UserCheck, UserX, Shield, Upload, ClipboardCheck, Stamp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
      role === "admin" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-700"
    }`}>
      {role === "admin" ? <Shield className="w-3 h-3" /> : null}
      {role === "admin" ? "مشرف" : "مستخدم"}
    </span>
  );
}

function PermissionBadges({ permissions, role }: { permissions: string[]; role: string }) {
  const effective = role === "admin" ? ["upload", "review", "approve"] : permissions;
  return (
    <div className="flex flex-wrap gap-1">
      {effective.includes("upload") && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded text-xs">
          <Upload className="w-2.5 h-2.5" /> رفع
        </span>
      )}
      {effective.includes("review") && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-violet-50 text-violet-600 border border-violet-200 rounded text-xs">
          <ClipboardCheck className="w-2.5 h-2.5" /> مراجعة
        </span>
      )}
      {effective.includes("approve") && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded text-xs">
          <Stamp className="w-2.5 h-2.5" /> اعتماد
        </span>
      )}
      {effective.length === 0 && (
        <span className="text-xs text-muted-foreground">لا صلاحيات</span>
      )}
    </div>
  );
}

const DEFAULT_FORM = { username: "", email: "", password: "", role: "user" as "user" | "admin", permissions: ["upload"] as string[] };

function PermissionCheckboxes({ permissions, onChange }: { permissions: string[]; onChange: (p: string[]) => void }) {
  const toggle = (p: string) => {
    onChange(permissions.includes(p) ? permissions.filter(x => x !== p) : [...permissions, p]);
  };
  return (
    <div className="space-y-2">
      <Label>الصلاحيات</Label>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={permissions.includes("upload")}
            onChange={() => toggle("upload")}
            className="w-4 h-4 accent-blue-600"
          />
          <Upload className="w-3.5 h-3.5 text-blue-600" />
          رفع الملفات وتشغيل OCR
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={permissions.includes("review")}
            onChange={() => toggle("review")}
            className="w-4 h-4 accent-violet-600"
          />
          <ClipboardCheck className="w-3.5 h-3.5 text-violet-600" />
          مراجعة الجودة
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={permissions.includes("approve")}
            onChange={() => toggle("approve")}
            className="w-4 h-4 accent-emerald-600"
          />
          <Stamp className="w-3.5 h-3.5 text-emerald-600" />
          الاعتماد النهائي
        </label>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const { data: users, isLoading } = useListUsers();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);

  const [editUser, setEditUser] = useState<User | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();

  const handleCreate = async () => {
    if (!form.username || !form.email || !form.password) return;
    const permissions = form.role === "admin" ? ["upload", "review"] : form.permissions;
    await createMutation.mutateAsync({ data: { ...form, permissions } });
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    setShowCreate(false);
    setForm(DEFAULT_FORM);
    toast({ title: "تم الإنشاء", description: "تم إنشاء المستخدم بنجاح" });
  };

  const handleToggleActive = async (id: number, isActive: boolean) => {
    await updateMutation.mutateAsync({ id, data: { isActive: !isActive } });
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    toast({ title: isActive ? "تم التعطيل" : "تم التفعيل" });
  };

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(`هل تريد حذف المستخدم "${username}"؟`)) return;
    await deleteMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    toast({ title: "تم الحذف", description: `تم حذف المستخدم ${username}` });
  };

  const handleSavePermissions = async () => {
    if (!editUser) return;
    await updateMutation.mutateAsync({ id: editUser.id, data: { permissions: editPerms } });
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    setEditUser(null);
    toast({ title: "تم الحفظ", description: "تم تحديث الصلاحيات بنجاح" });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} className="gap-2" data-testid="button-create-user">
          <Plus className="w-4 h-4" />
          مستخدم جديد
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            المستخدمون ({users?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">المستخدم</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">البريد</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">الدور</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">الصلاحيات</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">الحالة</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">تاريخ الإنشاء</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(users ?? []).map((user) => (
                  <tr key={user.id} data-testid={`row-user-${user.id}`} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{user.username}</td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                    <td className="px-4 py-3">
                      <PermissionBadges permissions={user.permissions ?? []} role={user.role} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                        user.isActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}>
                        {user.isActive ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                        {user.isActive ? "نشط" : "معطّل"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(user.createdAt).toLocaleDateString("ar-SA")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {user.role !== "admin" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-7 h-7 text-violet-500"
                            title="تعديل الصلاحيات"
                            onClick={() => { setEditUser(user); setEditPerms(user.permissions ?? []); }}
                            data-testid={`button-edit-perms-${user.id}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7"
                          onClick={() => handleToggleActive(user.id, user.isActive)}
                          data-testid={`button-toggle-user-${user.id}`}
                        >
                          {user.isActive ? <UserX className="w-3.5 h-3.5 text-amber-500" /> : <UserCheck className="w-3.5 h-3.5 text-emerald-500" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-destructive"
                          onClick={() => handleDelete(user.id, user.username)}
                          data-testid={`button-delete-user-${user.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إنشاء مستخدم جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>اسم المستخدم</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="اسم المستخدم"
                data-testid="input-new-username"
              />
            </div>
            <div className="space-y-2">
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="البريد الإلكتروني"
              />
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="كلمة المرور"
              />
            </div>
            <div className="space-y-2">
              <Label>الدور</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as "user" | "admin" })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">مستخدم</SelectItem>
                  <SelectItem value="admin">مشرف (كل الصلاحيات)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.role !== "admin" && (
              <PermissionCheckboxes
                permissions={form.permissions}
                onChange={(p) => setForm({ ...form, permissions: p })}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>إلغاء</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-confirm-create-user">
              {createMutation.isPending ? "جاري الإنشاء..." : "إنشاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Permissions Dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل صلاحيات — {editUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <PermissionCheckboxes permissions={editPerms} onChange={setEditPerms} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>إلغاء</Button>
            <Button onClick={handleSavePermissions} disabled={updateMutation.isPending} data-testid="button-save-permissions">
              {updateMutation.isPending ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
