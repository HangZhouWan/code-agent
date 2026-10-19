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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path: string) => {
    try {
      setLoading(true);
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
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setChildren({});
    setExpanded(new Set());
    await load(".");
  }, [load]);

  const toggle = useCallback(
    async (path: string) => {
      let opening = false;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          opening = true;
        }
        return next;
      });

      if (opening && !children[path]) {
        await load(path);
      }
    },
    [children, load],
  );

  useEffect(() => {
    void load(".");
  }, [load]);

  return {
    root,
    children,
    expanded,
    loading,
    error,
    toggle,
    refresh,
    load,
  };
}
