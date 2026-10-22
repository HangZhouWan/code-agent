/**
 * useWorkspaceTree 测试
 *
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEntry } from "@code-agent/protocol";

const { fetchWorkspaceTree } = vi.hoisted(() => ({
  fetchWorkspaceTree: vi.fn(),
}));

vi.mock("../../api/workspace.js", () => ({ fetchWorkspaceTree }));

import { useWorkspaceTree } from "../useWorkspaceTree.js";

const root: WorkspaceEntry[] = [
  { name: "src", path: "src", type: "directory" },
  { name: "README.md", path: "README.md", type: "file" },
];

const child: WorkspaceEntry[] = [
  { name: "a.ts", path: "src/a.ts", type: "file" },
];

beforeEach(() => {
  fetchWorkspaceTree.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useWorkspaceTree", () => {
  it("点击目录会请求子节点并写入 state", async () => {
    fetchWorkspaceTree.mockImplementation(
      async (path: string) => (path === "." ? root : child),
    );
    const { result } = renderHook(() => useWorkspaceTree());

    await waitFor(() => expect(result.current.root).toHaveLength(2));

    await act(async () => {
      await result.current.toggle("src");
    });

    expect(fetchWorkspaceTree).toHaveBeenCalledWith("src");
    expect(result.current.expanded.has("src")).toBe(true);
    expect(result.current.children.src).toEqual(child);
    expect(result.current.loadingPaths.size).toBe(0);
  });

  it("再次点击已加载的目录只收起，不重复请求", async () => {
    fetchWorkspaceTree.mockImplementation(
      async (path: string) => (path === "." ? root : child),
    );
    const { result } = renderHook(() => useWorkspaceTree());
    await waitFor(() => expect(result.current.root).toHaveLength(2));

    await act(async () => {
      await result.current.toggle("src");
    });
    const callsAfterLoad = fetchWorkspaceTree.mock.calls.length;

    await act(async () => {
      await result.current.toggle("src");
    });

    expect(result.current.expanded.has("src")).toBe(false);
    expect(fetchWorkspaceTree.mock.calls.length).toBe(callsAfterLoad);
  });

  it("加载失败保持展开，再次点击会重试", async () => {
    let srcCalls = 0;
    fetchWorkspaceTree.mockImplementation(async (path: string) => {
      if (path === ".") return root;
      srcCalls++;
      if (srcCalls === 1) throw new Error("boom");
      return child;
    });
    const { result } = renderHook(() => useWorkspaceTree());
    await waitFor(() => expect(result.current.root).toHaveLength(2));

    await act(async () => {
      await result.current.toggle("src");
    });
    expect(result.current.error).toContain("boom");
    expect(result.current.expanded.has("src")).toBe(true);
    expect(result.current.children.src).toBeUndefined();

    await act(async () => {
      await result.current.toggle("src");
    });
    expect(srcCalls).toBe(2);
    expect(result.current.children.src).toEqual(child);
    expect(result.current.error).toBeNull();
  });

  it("加载期间记录 loadingPaths", async () => {
    let resolveChild!: (entries: WorkspaceEntry[]) => void;
    fetchWorkspaceTree.mockImplementation((path: string) => {
      if (path === ".") return Promise.resolve(root);
      return new Promise<WorkspaceEntry[]>((resolve) => {
        resolveChild = resolve;
      });
    });
    const { result } = renderHook(() => useWorkspaceTree());
    await waitFor(() => expect(result.current.root).toHaveLength(2));

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.toggle("src");
    });

    await waitFor(() =>
      expect(result.current.loadingPaths.has("src")).toBe(true),
    );

    await act(async () => {
      resolveChild(child);
      await pending;
    });

    expect(result.current.loadingPaths.has("src")).toBe(false);
    expect(result.current.children.src).toEqual(child);
  });
});
