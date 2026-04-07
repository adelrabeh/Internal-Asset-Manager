import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { NotificationsProvider } from "@/lib/notifications-context";
import AppLayout from "@/components/layout";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import JobsPage from "@/pages/jobs";
import JobDetailPage from "@/pages/job-detail";
import UploadPage from "@/pages/upload";
import SearchPage from "@/pages/search";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/project-detail";
import AdminUsersPage from "@/pages/admin/users";
import AdminLogsPage from "@/pages/admin/logs";
import AdminSystemPage from "@/pages/admin/system";
import AdminApiKeysPage from "@/pages/admin/api-keys";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function ProtectedRoute({ component: Component, adminOnly }: { component: React.ComponentType; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">جاري التحقق...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (adminOnly && user.role !== "admin") {
    return <Redirect to="/" />;
  }

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/jobs" component={() => <ProtectedRoute component={JobsPage} />} />
      <Route path="/jobs/:id" component={() => <ProtectedRoute component={JobDetailPage} />} />
      <Route path="/upload" component={() => <ProtectedRoute component={UploadPage} />} />
      <Route path="/search" component={() => <ProtectedRoute component={SearchPage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} />} />
      <Route path="/projects/:id" component={() => <ProtectedRoute component={ProjectDetailPage} />} />
      <Route path="/admin/users" component={() => <ProtectedRoute component={AdminUsersPage} adminOnly />} />
      <Route path="/admin/logs" component={() => <ProtectedRoute component={AdminLogsPage} adminOnly />} />
      <Route path="/admin/system" component={() => <ProtectedRoute component={AdminSystemPage} adminOnly />} />
      <Route path="/admin/api-keys" component={() => <ProtectedRoute component={AdminApiKeysPage} adminOnly />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <NotificationsProvider>
              <Router />
            </NotificationsProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
