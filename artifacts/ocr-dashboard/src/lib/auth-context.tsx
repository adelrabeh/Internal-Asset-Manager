import { createContext, useContext, type ReactNode } from "react";
import { useGetMe, useLogin, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: meData, isLoading, fetchStatus } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000,
    },
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  // True only during the initial session check on mount
  const resolvedLoading = isLoading && fetchStatus === "fetching";
  const user = (meData as unknown as User) ?? null;

  const login = async (username: string, password: string) => {
    const result = await loginMutation.mutateAsync({ data: { username, password } });
    // Pre-populate the /me cache so ProtectedRoute sees the user immediately
    qc.setQueryData(getGetMeQueryKey(), result.user);
    setLocation("/");
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    qc.clear();
    setLocation("/login");
  };

  return (
    <AuthContext.Provider value={{ user, isLoading: resolvedLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
