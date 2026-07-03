/**
 * 会话列表数据获取 hook
 *
 * 提供会话列表的获取、创建和删除功能。
 * 连接到后端 REST API (/api/sessions)。
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 会话摘要（从 GET /api/sessions 返回） */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** useSessions 返回值 */
export interface UseSessionsReturn {
  /** 会话列表（按 updatedAt 降序） */
  sessions: SessionSummary[];
  /** 是否正在加载 */
  loading: boolean;
  /** 创建新会话 */
  createSession: (title?: string) => Promise<SessionSummary | null>;
  /** 删除会话 */
  deleteSession: (id: string) => Promise<boolean>;
  /** 重新加载会话列表 */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useSessions
 *
 * 在 Sidebar 中使用，管理会话列表的获取和操作。
 *
 * @example
 * ```tsx
 * const { sessions, loading, createSession } = useSessions();
 * const handleNew = async () => {
 *   const session = await createSession();
 *   if (session) onSelectSession(session.id);
 * };
 * ```
 */
export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 获取会话列表 ──
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) {
        console.error("[useSessions] Failed to fetch sessions:", res.status);
        setSessions([]);
        return;
      }
      const data: SessionSummary[] = await res.json();
      setSessions(data);
    } catch (err) {
      console.error("[useSessions] Error fetching sessions:", err);
      // 静默处理：保留已有数据
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 首次挂载时获取 ──
  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── 创建新会话 ──
  const createSession = useCallback(
    async (title = "New Chat"): Promise<SessionSummary | null> => {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) {
          console.error("[useSessions] Failed to create session:", res.status);
          return null;
        }
        const session: SessionSummary = await res.json();
        // 乐观更新：将新会话插入列表头部
        setSessions((prev) => [session, ...prev]);
        return session;
      } catch (err) {
        console.error("[useSessions] Error creating session:", err);
        return null;
      }
    },
    [],
  );

  // ── 删除会话 ──
  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204) {
          console.error("[useSessions] Failed to delete session:", res.status);
          return false;
        }
        // 乐观更新：从列表中移除
        setSessions((prev) => prev.filter((s) => s.id !== id));
        return true;
      } catch (err) {
        console.error("[useSessions] Error deleting session:", err);
        return false;
      }
    },
    [],
  );

  return { sessions, loading, createSession, deleteSession, refresh };
}
