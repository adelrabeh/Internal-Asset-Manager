import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, Shield } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: unknown) {
      const msg = (err as { data?: { error?: string } })?.data?.error ?? "فشل تسجيل الدخول. يرجى التحقق من البيانات.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(222,47%,8%)]" dir="rtl">
      <div className="w-full max-w-md px-4">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[hsl(199,89%,48%)] mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">منظومة رقمنة الوثائق</h1>
          <p className="text-sm text-slate-400 mt-1">نظام داخلي مؤمَّن - للمستخدمين المصرح لهم فقط</p>
        </div>

        <Card className="border-slate-700 bg-[hsl(222,40%,12%)] shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-lg">تسجيل الدخول</CardTitle>
            <CardDescription className="text-slate-400">أدخل بيانات اعتمادك للوصول إلى النظام</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-slate-300">اسم المستخدم</Label>
                <Input
                  id="username"
                  data-testid="input-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-[hsl(222,47%,8%)] border-slate-600 text-white placeholder:text-slate-500 text-right"
                  placeholder="اسم المستخدم"
                  required
                  dir="rtl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">كلمة المرور</Label>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-[hsl(222,47%,8%)] border-slate-600 text-white placeholder:text-slate-500 text-right"
                  placeholder="كلمة المرور"
                  required
                  dir="rtl"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-md px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                data-testid="button-login"
                className="w-full bg-[hsl(199,89%,48%)] hover:bg-[hsl(199,89%,42%)] text-white font-medium"
                disabled={loading}
              >
                {loading ? "جاري التحقق..." : "تسجيل الدخول"}
              </Button>
            </form>

            <div className="mt-4 pt-4 border-t border-slate-700">
              <p className="text-xs text-slate-500 text-center">بيانات تجريبية: admin / Admin@1234</p>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-600 mt-6">
          جميع الاتصالات مشفرة. يتم تسجيل جميع عمليات الدخول.
        </p>
      </div>
    </div>
  );
}
