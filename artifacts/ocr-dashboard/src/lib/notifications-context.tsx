import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "./auth-context";

export interface Notification {
  id: string;
  type: string;
  jobId: number;
  filename: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  markAllRead: () => void;
  clearAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  clearAll: () => {},
});

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  useEffect(() => {
    if (!user) return;

    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    const url = `${base}/api/notifications/stream`;

    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.addEventListener("notification", (e) => {
      try {
        const data = JSON.parse(e.data);
        const notification: Notification = {
          id: `${data.jobId}-${Date.now()}`,
          type: data.type,
          jobId: data.jobId,
          filename: data.filename,
          message: data.message,
          timestamp: new Date(),
          read: false,
        };
        setNotifications((prev) => [notification, ...prev].slice(0, 50));
      } catch {
        // ignore parse errors
      }
    });

    es.onerror = () => {
      // Reconnect handled automatically by browser
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [user]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markAllRead, clearAll }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
