import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
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
  { href: "/admin/users", label: "المستخدمون", icon: Users, adminOnly: true },
  { href: "/admin/logs", label: "سجلات التدقيق", icon: ScrollText, adminOnly: true },
  { href: "/admin/system", label: "النظام", icon: Settings, adminOnly: true },
];

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
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <Bell className="w-4 h-4" />
            </Button>
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
