import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useGetMe, useLogin, useLogout } from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const [user, setUser] = useState<User | null>(null);

  const { data: meData, isLoading, isError } = useGetMe({
    query: { retry: false, refetchOnWindowFocus: false },
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  useEffect(() => {
    if (meData) {
      setUser(meData as unknown as User);
    }
    if (isError) {
      setUser(null);
    }
  }, [meData, isError]);

  const login = async (username: string, password: string) => {
    const result = await loginMutation.mutateAsync({ data: { username, password } });
    setUser(result.user as unknown as User);
    setLocation("/");
  };

  const logout = async () => {
    await logoutMutation.mutateAsync({});
    setUser(null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
