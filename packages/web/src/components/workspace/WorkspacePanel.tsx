/**
 * 只读工作区面板：文件树 + CodeMirror + diff
 */

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceDiff, WorkspaceFile } from "@code-agent/protocol";
import {
  fetchWorkspaceDiff,
  fetchWorkspaceFile,
} from "../../api/workspace.js";
import { useWorkspaceTree } from "../../hooks/useWorkspaceTree.js";
import { CodeViewer } from "./CodeViewer.js";
import { DiffView } from "./DiffView.js";
import { FileTree } from "./FileTree.js";

interface OpenFile {
  path: string;
  file: WorkspaceFile;
}

export function WorkspacePanel() {
  const tree = useWorkspaceTree();
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [mode, setMode] = useState<"code" | "diff">("code");
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // 全屏时按 Esc 退出
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const openFile = useCallback(async (path: string) => {
    try {
      setError(null);
      const file = await fetchWorkspaceFile(path);
      setOpenFiles((prev) => {
        const exists = prev.some((item) => item.path === path);
        return exists
          ? prev.map((item) => (item.path === path ? { path, file } : item))
          : [...prev, { path, file }];
      });
      setActivePath(path);
      setMode("code");
      setDiff(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const showDiff = useCallback(async () => {
    if (!activePath) return;
    try {
      setError(null);
      const result = await fetchWorkspaceDiff(activePath);
      setDiff(result);
      setMode("diff");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activePath]);

  const closeFile = useCallback(
    (path: string) => {
      setOpenFiles((prev) => {
        const next = prev.filter((item) => item.path !== path);
        if (activePath === path) {
          setActivePath(next[next.length - 1]?.path ?? null);
          setMode("code");
          setDiff(null);
        }
        return next;
      });
    },
    [activePath],
  );

  // 文件变更监听：刷新树与当前文件
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/workspace/events`,
    );

    socket.onmessage = (event) => {
      try {
        const change = JSON.parse(event.data as string) as {
          type?: string;
        };
        if (change.type !== "workspace.changed") return;
        void tree.refresh();
        if (activePath) {
          void openFile(activePath);
          if (mode === "diff") void showDiff();
        }
      } catch {
        // ignore malformed workspace events
      }
    };

    return () => socket.close();
  }, [activePath, mode, openFile, showDiff, tree.refresh]);

  const activeFile =
    openFiles.find((item) => item.path === activePath)?.file ?? null;

  return (
    <aside
      className={
        fullscreen
          ? "fixed inset-0 z-40 flex h-full w-full flex-col bg-gray-900"
          : "flex w-[45%] min-w-[320px] max-w-3xl flex-col border-l border-gray-800 bg-gray-900"
      }
    >
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Workspace
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFullscreen((value) => !value)}
            aria-label={fullscreen ? "退出全屏" : "全屏"}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            {fullscreen ? "退出全屏" : "全屏"}
          </button>
          <button
            type="button"
            onClick={() => void tree.refresh()}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={() => void showDiff()}
            disabled={!activePath}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
          >
            Diff
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={`shrink-0 overflow-auto border-r border-gray-800 p-2 ${
            fullscreen ? "w-64" : "w-52"
          }`}
        >
          {tree.error && (
            <p className="p-2 text-xs text-red-400">{tree.error}</p>
          )}
          <FileTree
            entries={tree.root}
            children={tree.children}
            expanded={tree.expanded}
            loadingPaths={tree.loadingPaths}
            selectedPath={activePath}
            onToggle={(path) => void tree.toggle(path)}
            onSelect={(path) => void openFile(path)}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {openFiles.length > 0 && (
            <div className="flex overflow-x-auto border-b border-gray-800">
              {openFiles.map((item) => (
                <div
                  key={item.path}
                  className={`flex items-center gap-2 border-r border-gray-800 px-3 py-1.5 text-xs ${
                    item.path === activePath
                      ? "bg-gray-800 text-gray-100"
                      : "text-gray-400 hover:bg-gray-800/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActivePath(item.path);
                      setMode("code");
                      setDiff(null);
                    }}
                    className="max-w-[10rem] truncate"
                    title={item.path}
                  >
                    {item.path.split("/").pop()}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeFile(item.path)}
                    className="text-gray-500 hover:text-gray-200"
                    aria-label={`关闭 ${item.path}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {error ? (
              <div className="p-4 text-sm text-red-400">{error}</div>
            ) : !activeFile ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">
                选择左侧文件查看内容
              </div>
            ) : mode === "diff" ? (
              diff ? (
                <DiffView diff={diff} />
              ) : (
                <div className="p-4 text-sm text-gray-500">加载 diff...</div>
              )
            ) : (
              <CodeViewer file={activeFile} />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
