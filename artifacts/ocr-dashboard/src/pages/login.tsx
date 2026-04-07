import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertCircle, Lock } from "lucide-react";

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
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "hsl(216,50%,6%)" }}
      dir="rtl"
    >
      {/* Subtle gold top border */}
      <div className="fixed top-0 inset-x-0 h-1" style={{ background: "linear-gradient(90deg, hsl(38,45%,62%), hsl(38,55%,72%), hsl(38,45%,62%))" }} />

      <div className="w-full max-w-sm px-4">

        {/* Darah Logo + Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center rounded-2xl bg-white p-4 mb-5 shadow-2xl" style={{ boxShadow: "0 0 0 1px hsl(38,30%,50%,0.4), 0 20px 40px rgba(0,0,0,0.5)" }}>
            <img
              src="/darah-logo.png"
              alt="دارة الملك عبدالعزيز"
              className="h-20 w-auto object-contain"
            />
          </div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "hsl(38,40%,82%)" }}>
            دارة الملك عبدالعزيز
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(38,20%,65%)" }}>
            منظومة رقمنة الوثائق والمخطوطات
          </p>
        </div>

        {/* Login Card */}
        <Card
          className="shadow-2xl border-0"
          style={{ background: "hsl(216,42%,11%)", border: "1px solid hsl(216,38%,20%)" }}
        >
          <CardHeader className="pb-2 pt-6 px-6">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-4 h-4" style={{ color: "hsl(38,45%,62%)" }} />
              <span className="font-semibold" style={{ color: "hsl(38,15%,92%)" }}>
                تسجيل الدخول
              </span>
            </div>
            <p className="text-xs" style={{ color: "hsl(216,20%,55%)" }}>
              نظام داخلي مؤمَّن — للمستخدمين المصرح لهم فقط
            </p>
          </CardHeader>

          <CardContent className="px-6 pb-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username" style={{ color: "hsl(38,15%,80%)" }}>
                  اسم المستخدم
                </Label>
                <Input
                  id="username"
                  data-testid="input-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="text-right focus-visible:ring-1"
                  style={{
                    background: "hsl(216,45%,8%)",
                    borderColor: "hsl(216,38%,22%)",
                    color: "hsl(38,15%,92%)",
                  }}
                  placeholder="اسم المستخدم"
                  required
                  dir="rtl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" style={{ color: "hsl(38,15%,80%)" }}>
                  كلمة المرور
                </Label>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="text-right focus-visible:ring-1"
                  style={{
                    background: "hsl(216,45%,8%)",
                    borderColor: "hsl(216,38%,22%)",
                    color: "hsl(38,15%,92%)",
                  }}
                  placeholder="كلمة المرور"
                  required
                  dir="rtl"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm rounded-md px-3 py-2.5"
                  style={{ background: "hsl(0,62%,20%)", border: "1px solid hsl(0,62%,35%)", color: "hsl(0,80%,80%)" }}>
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                data-testid="button-login"
                className="w-full font-semibold mt-2 transition-all"
                style={{
                  background: "hsl(38,45%,55%)",
                  color: "hsl(216,50%,8%)",
                }}
                disabled={loading}
              >
                {loading ? "جاري التحقق..." : "دخول"}
              </Button>
            </form>

            <div className="mt-5 pt-4" style={{ borderTop: "1px solid hsl(216,38%,18%)" }}>
              <p className="text-xs text-center" style={{ color: "hsl(216,20%,42%)" }}>
                بيانات تجريبية: admin / Admin@1234
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs mt-5" style={{ color: "hsl(216,20%,35%)" }}>
          جميع الاتصالات مشفرة · يتم تسجيل جميع عمليات الدخول
        </p>
      </div>
    </div>
  );
}
