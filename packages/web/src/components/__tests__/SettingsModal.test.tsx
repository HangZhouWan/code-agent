/**
 * SettingsModal 测试
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SettingsModal } from "../SettingsModal.js";

/**
 * 按 URL 和方法返回不同响应：GET 返回现有配置，POST 返回保存成功。
 */
function mockConfigApi(): ReturnType<typeof vi.fn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/config") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            LLM_PROVIDER: "anthropic",
            LLM_MODEL: "claude-sonnet-4-5",
            LLM_API_KEY: "sk-a...1234",
            WORKSPACE_PATH: "/Users/me/projects/app",
          }),
        } as unknown as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as unknown as Response;
    },
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsModal", () => {
  it("打开时读取并预填当前配置", async () => {
    mockConfigApi();

    render(<SettingsModal onClose={vi.fn()} />);

    expect(screen.getByText("模型与工作目录")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("claude-sonnet-4-5")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("/Users/me/projects/app"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("已保存 sk-a...1234，留空保持不变"),
    ).toBeInTheDocument();
  });

  it("弹窗限制在视口内，表单区域可独立滚动", async () => {
    mockConfigApi();

    render(<SettingsModal onClose={vi.fn()} />);

    await screen.findByDisplayValue("claude-sonnet-4-5");
    expect(
      screen.getByTestId("settings-dialog").className,
    ).toContain("max-h-[85dvh]");

    const scroll = screen.getByTestId("settings-scroll");
    expect(scroll.className).toContain("overflow-y-auto");
    expect(scroll.className).toContain("min-h-0");
    // 表单应渲染在滚动容器内，而不是直接撑高 dialog
    expect(scroll.contains(screen.getByText("保存配置"))).toBe(true);
  });

  it("保存成功后提示重启服务", async () => {
    mockConfigApi();

    render(<SettingsModal onClose={vi.fn()} />);

    await screen.findByDisplayValue("claude-sonnet-4-5");
    fireEvent.click(screen.getByText("保存配置"));

    expect(await screen.findByText("配置已保存")).toBeInTheDocument();
    expect(
      screen.getByText("重启服务后新配置才会生效。"),
    ).toBeInTheDocument();
  });

  it("点击关闭按钮触发 onClose", async () => {
    mockConfigApi();
    const onClose = vi.fn();

    render(<SettingsModal onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("关闭"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("按 Escape 触发 onClose", async () => {
    mockConfigApi();
    const onClose = vi.fn();

    render(<SettingsModal onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("读取配置失败时展示重试入口", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "配置读取失败" }),
    } as unknown as Response);

    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("配置读取失败");
    });
    expect(screen.getByText("重试")).toBeInTheDocument();
  });
});
