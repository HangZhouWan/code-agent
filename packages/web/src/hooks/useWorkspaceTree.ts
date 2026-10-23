/**
 * 懒加载工作区文件树
 */

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceEntry } from "@code-agent/protocol";
import { fetchWorkspaceTree } from "../api/workspace.js";

export interface UseWorkspaceTreeReturn {
  root: WorkspaceEntry[];
  children: Record<string, WorkspaceEntry[]>;
  expanded: Set<string>;
  /** 正在加载的目录路径 */
  loadingPaths: Set<string>;
  loading: boolean;
  error: string | null;
  toggle: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  load: (path: string) => Promise<void>;
}

export function useWorkspaceTree(): UseWorkspaceTreeReturn {
  const [root, setRoot] = useState<WorkspaceEntry[]>([]);
  const [children, setChildren] = useState<
    Record<string, WorkspaceEntry[]>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path: string) => {
    setLoadingPaths((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    try {
      setError(null);
      const entries = await fetchWorkspaceTree(path);
      if (path === ".") {
        setRoot(entries);
      } else {
        setChildren((prev) => ({ ...prev, [path]: entries }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    setChildren({});
    setExpanded(new Set());
    await load(".");
  }, [load]);

  const toggle = useCallback(
    async (path: string) => {
      const isOpen = expanded.has(path);
      const hasChildren = children[path] !== undefined;
      const isLoading = loadingPaths.has(path);

      if (!isOpen) {
        setExpanded((prev) => new Set(prev).add(path));
        if (!hasChildren && !isLoading) {
          await load(path);
        }
        return;
      }

      // 展开状态下没有子节点，说明上一次加载失败：保持展开并重试
      if (!hasChildren) {
        if (!isLoading) await load(path);
        return;
      }

      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    },
    [children, expanded, load, loadingPaths],
  );

  useEffect(() => {
    void load(".");
  }, [load]);

  return {
    root,
    children,
    expanded,
    loadingPaths,
    loading: loadingPaths.size > 0,
    error,
    toggle,
    refresh,
    load,
  };
}
