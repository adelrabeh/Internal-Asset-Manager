import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import {
  LayoutDashboard,
  FileText,
  Upload,
  Users,
  ScrollText,
  Settings,
  LogOut,
  Shield,
  ChevronLeft,
  Bell,
  Search,
  Key,
  X,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/jobs", label: "المهام", icon: FileText },
  { href: "/upload", label: "رفع ملف", icon: Upload },
  { href: "/search", label: "بحث في النصوص", icon: Search },
  { href: "/admin/users", label: "المستخدمون", icon: Users, adminOnly: true },
  { href: "/admin/logs", label: "سجلات التدقيق", icon: ScrollText, adminOnly: true },
  { href: "/admin/system", label: "النظام", icon: Settings, adminOnly: true },
  { href: "/admin/api-keys", label: "مفاتيح API", icon: Key, adminOnly: true },
];

function NotificationBell() {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    setOpen((v) => !v);
    if (!open && unreadCount > 0) markAllRead();
  };

  const typeLabel: Record<string, string> = {
    job_ready_for_review: "جاهزة للمراجعة",
    job_ready_for_approval: "جاهزة للاعتماد",
    job_approved: "تم الاعتماد",
    job_rejected: "تم الرفض",
    job_completed: "اكتملت",
  };

  const typeDot: Record<string, string> = {
    job_ready_for_review: "bg-violet-400",
    job_ready_for_approval: "bg-blue-400",
    job_approved: "bg-green-400",
    job_rejected: "bg-red-400",
    job_completed: "bg-gray-400",
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className="relative text-muted-foreground"
        onClick={handleOpen}
        data-testid="button-notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute left-0 top-10 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden" dir="rtl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-medium text-sm">الإشعارات</span>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground" onClick={clearAll}>
                  مسح الكل
                </Button>
              )}
              <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => setOpen(false)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">لا توجد إشعارات</div>
            ) : (
              notifications.map((n) => (
                <Link key={n.id} href={`/jobs/${n.jobId}`} onClick={() => setOpen(false)}>
                  <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer border-b border-border/50 last:border-0">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${typeDot[n.type] ?? "bg-gray-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{n.message}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {typeLabel[n.type] ?? n.type} • {n.timestamp.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50 shrink-0 mt-1" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const visibleItems = navItems.filter((item) => !item.adminOnly || user?.role === "admin");

  return (
    <div className="flex h-screen bg-background" dir="rtl">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col bg-sidebar border-l border-sidebar-border transition-all duration-300 shrink-0",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-sidebar-foreground truncate">منظومة الرقمنة</p>
              <p className="text-xs text-sidebar-foreground/50 truncate">نظام داخلي</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  data-testid={`nav-${item.href.replace(/\//g, "-")}`}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all",
                    isActive
                      ? "bg-sidebar-primary text-white"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    collapsed ? "justify-center" : "",
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* User / Logout */}
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {!collapsed && user && (
            <div className="px-3 py-2 rounded-lg bg-sidebar-accent">
              <p className="text-xs font-semibold text-sidebar-foreground">{user.username}</p>
              <p className="text-xs text-sidebar-foreground/50">
                {user.role === "admin" ? "مشرف النظام" : "مستخدم"}
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            data-testid="button-logout"
            className={cn(
              "w-full text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10",
              collapsed ? "px-0 justify-center" : "justify-start gap-2",
            )}
            onClick={logout}
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span>خروج</span>}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-full text-sidebar-foreground/50",
              collapsed ? "px-0 justify-center" : "justify-start gap-2",
            )}
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn("w-4 h-4 transition-transform", collapsed ? "rotate-180" : "")} />
            {!collapsed && <span className="text-xs">طي القائمة</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            {visibleItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              if (isActive) {
                const Icon = item.icon;
                return (
                  <div key={item.href} className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    <h1 className="font-semibold text-foreground">{item.label}</h1>
                  </div>
                );
              }
              return null;
            })}
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-xs font-bold text-white">
                {user?.username?.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
