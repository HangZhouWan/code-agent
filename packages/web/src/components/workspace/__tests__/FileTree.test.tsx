/**
 * FileTree 测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { WorkspaceEntry } from "@code-agent/protocol";
import { FileTree } from "../FileTree.js";

afterEach(() => cleanup());

const entries: WorkspaceEntry[] = [
  { name: "src", path: "src", type: "directory" },
  { name: "README.md", path: "README.md", type: "file" },
];

const children: Record<string, WorkspaceEntry[]> = {
  src: [{ name: "a.ts", path: "src/a.ts", type: "file" }],
};

describe("FileTree", () => {
  it("点击目录触发 toggle，展开后渲染子节点", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FileTree
        entries={entries}
        children={children}
        expanded={new Set()}
        loadingPaths={new Set()}
        selectedPath={null}
        onToggle={onToggle}
        onSelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("src"));
    expect(onToggle).toHaveBeenCalledWith("src");
    expect(screen.queryByText("a.ts")).toBeNull();

    rerender(
      <FileTree
        entries={entries}
        children={children}
        expanded={new Set(["src"])}
        loadingPaths={new Set()}
        selectedPath="src/a.ts"
        onToggle={onToggle}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("点击文件触发 onSelect", () => {
    const onSelect = vi.fn();
    render(
      <FileTree
        entries={entries}
        children={children}
        expanded={new Set()}
        loadingPaths={new Set()}
        selectedPath={null}
        onToggle={() => {}}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText("README.md"));
    expect(onSelect).toHaveBeenCalledWith("README.md");
  });

  it("目录展开但子节点未返回时显示加载中", () => {
    render(
      <FileTree
        entries={entries}
        children={{}}
        expanded={new Set(["src"])}
        loadingPaths={new Set(["src"])}
        selectedPath={null}
        onToggle={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("空目录显示提示，加载失败显示重试提示", () => {
    const { rerender } = render(
      <FileTree
        entries={entries}
        children={{ src: [] }}
        expanded={new Set(["src"])}
        loadingPaths={new Set()}
        selectedPath={null}
        onToggle={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("（空目录）")).toBeInTheDocument();

    rerender(
      <FileTree
        entries={entries}
        children={{}}
        expanded={new Set(["src"])}
        loadingPaths={new Set()}
        selectedPath={null}
        onToggle={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/加载失败/)).toBeInTheDocument();
  });
});
