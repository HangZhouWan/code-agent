/**
 * Sidebar 组件测试
 *
 * Sidebar 是纯展示组件，所有数据和回调均由父级通过 props 传入。
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Sidebar } from "../Sidebar.js";
import type { SessionSummary } from "../../hooks/useSessions.js";

const MOCK_SESSIONS: SessionSummary[] = [
  {
    id: "s1",
    title: "Chat One",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
  {
    id: "s2",
    title: "Chat Two",
    createdAt: "2026-01-03T00:00:00Z",
    updatedAt: "2026-01-04T00:00:00Z",
  },
];

/** 构建默认 props，测试可挑选需要的字段覆盖 */
function createProps(overrides?: Partial<Parameters<typeof Sidebar>[0]>) {
  return {
    activeSessionId: null as string | null,
    onSelectSession: vi.fn(),
    sessions: [] as SessionSummary[],
    loading: false,
    onCreateSession: vi.fn().mockResolvedValue(null) as (
      title?: string,
    ) => Promise<SessionSummary | null>,
    onDeleteSession: vi.fn().mockResolvedValue(true) as (
      id: string,
    ) => Promise<boolean>,
    onUpdateTitle: vi.fn().mockResolvedValue(true) as (
      id: string,
      title: string,
    ) => Promise<boolean>,
    ...overrides,
  };
}

describe("Sidebar", () => {
  afterEach(() => {
    cleanup();
  });

  it("应渲染 New Chat 按钮", () => {
    render(<Sidebar {...createProps()} />);
    expect(screen.getByText("New Chat")).toBeInTheDocument();
  });

  it("加载中应显示 loading 文字", () => {
    render(<Sidebar {...createProps({ loading: true, sessions: [] })} />);
    expect(screen.getByText(/Loading sessions/)).toBeInTheDocument();
  });

  it("空列表应显示引导文字", () => {
    render(<Sidebar {...createProps({ loading: false, sessions: [] })} />);
    expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
  });

  it("应渲染会话列表", () => {
    render(
      <Sidebar {...createProps({ loading: false, sessions: MOCK_SESSIONS })} />,
    );
    expect(screen.getByText("Chat One")).toBeInTheDocument();
    expect(screen.getByText("Chat Two")).toBeInTheDocument();
  });

  it("点击会话应触发 onSelectSession", () => {
    const onSelectSession = vi.fn();
    render(
      <Sidebar
        {...createProps({
          onSelectSession,
          sessions: MOCK_SESSIONS,
        })}
      />,
    );

    // 点击按钮本身（而非标题 <p>——标题点击会触发编辑模式并 stopPropagation）
    const btn = screen.getByText("Chat One").closest("button")!;
    fireEvent.click(btn);
    expect(onSelectSession).toHaveBeenCalledWith("s1");
  });

  it("活跃会话应高亮显示", () => {
    render(
      <Sidebar
        {...createProps({
          activeSessionId: "s1",
          sessions: MOCK_SESSIONS,
        })}
      />,
    );

    const activeBtn = screen.getByText("Chat One").closest("button");
    expect(activeBtn?.className).toContain("bg-gray-700");
  });

  it("点击 New Chat 应调用 onCreateSession 并选中新会话", async () => {
    const newSession: SessionSummary = {
      id: "new-1",
      title: "New Chat",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    };
    const onCreateSession = vi.fn().mockResolvedValue(newSession);
    const onSelectSession = vi.fn();

    render(
      <Sidebar
        {...createProps({
          onCreateSession,
          onSelectSession,
          sessions: [],
        })}
      />,
    );

    fireEvent.click(screen.getByText("New Chat"));

    // 等待 Promise 链完成
    await vi.waitFor(() => {
      expect(onCreateSession).toHaveBeenCalled();
      expect(onSelectSession).toHaveBeenCalledWith("new-1");
    });
  });
});
