/**
 * SetupPage 测试
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SetupPage } from "../SetupPage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SetupPage", () => {
  it("展示首次配置表单", () => {
    vi.spyOn(globalThis, "fetch");

    render(<SetupPage />);

    expect(screen.getByText("欢迎使用 code-agent")).toBeInTheDocument();
    expect(screen.getByText("保存配置")).toBeDisabled();
  });

  it("保存成功后展示重启提示", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);

    render(<SetupPage />);

    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByText("保存配置"));

    expect(await screen.findByText("配置已保存")).toBeInTheDocument();
    expect(screen.getByText(/请重启服务/)).toBeInTheDocument();
  });
});
