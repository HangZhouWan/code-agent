/**
 * useSessions hook 单元测试
 *
 * 覆盖：
 * - 初始加载成功
 * - 初始加载失败（静默处理）
 * - createSession 成功 + 乐观更新
 * - createSession 失败返回 null
 * - deleteSession 成功 + 乐观更新
 * - deleteSession 失败返回 false
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSessions, type SessionSummary } from "../useSessions.js";

// ---------------------------------------------------------------------------
// Mock 数据
// ---------------------------------------------------------------------------

const MOCK_SESSIONS: SessionSummary[] = [
  { id: "s1", title: "Chat Alpha", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
  { id: "s2", title: "Chat Beta", createdAt: "2026-01-03T00:00:00Z", updatedAt: "2026-01-04T00:00:00Z" },
];

const NEW_SESSION: SessionSummary = {
  id: "s3",
  title: "New Chat",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("useSessions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 初始加载 ──

  it("应该在挂载时获取会话列表", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_SESSIONS,
    } as Response);

    const { result } = renderHook(() => useSessions());

    // 初始 loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sessions).toEqual(MOCK_SESSIONS);
    expect(fetch).toHaveBeenCalledWith("/api/sessions");
  });

  it("fetch 失败时应静默处理，sessions 为空", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sessions).toEqual([]);
  });

  it("非 ok 响应时应清空 sessions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHook(() => useSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sessions).toEqual([]);
  });

  // ── 创建会话 ──

  it("createSession 应 POST 并返回新会话，同时乐观更新列表", async () => {
    // 首次加载
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const { result } = renderHook(() => useSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Mock create response
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => NEW_SESSION,
    } as Response);

    let created: SessionSummary | null = null;
    await act(async () => {
      created = await result.current.createSession("New Chat");
    });

    expect(created).toEqual(NEW_SESSION);
    expect(result.current.sessions[0]).toEqual(NEW_SESSION);
  });

  it("createSession 失败时应返回 null", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const { result } = renderHook(() => useSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let created: SessionSummary | null = null;
    await act(async () => {
      created = await result.current.createSession();
    });

    expect(created).toBeNull();
  });

  // ── 删除会话 ──

  it("deleteSession 应 DELETE 并乐观更新列表", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_SESSIONS,
    } as Response);

    const { result } = renderHook(() => useSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
    } as Response);

    let deleted = false;
    await act(async () => {
      deleted = await result.current.deleteSession("s1");
    });

    expect(deleted).toBe(true);
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe("s2");
  });

  it("deleteSession 失败时应返回 false", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_SESSIONS } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const { result } = renderHook(() => useSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let deleted = true;
    await act(async () => {
      deleted = await result.current.deleteSession("s1");
    });

    expect(deleted).toBe(false);
  });
});
