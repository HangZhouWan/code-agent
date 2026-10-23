/**
 * ModelConfigForm 测试
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModelConfigForm } from "../ModelConfigForm.js";
import type { ModelConfigView } from "../../api/config.js";

/** 构造成功的保存响应 */
function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  } as unknown as Response;
}

/** 读取最近一次 fetch 的 JSON body */
function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const calls = fetchMock.mock.calls;
  const init = calls[calls.length - 1]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

function existingConfig(
  overrides: Partial<ModelConfigView> = {},
): ModelConfigView {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    maskedApiKey: "sk-a...1234",
    baseUrl: "https://example.com/v1",
    workspacePath: "/Users/me/projects/app",
    autoMode: false,
    planMode: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ModelConfigForm", () => {
  it("首次配置时要求填写 API Key，填写后才可提交", () => {
    render(<ModelConfigForm />);

    expect(screen.getByDisplayValue("gpt-4o")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
    expect(screen.getByText("保存配置")).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-test" },
    });

    expect(screen.getByText("保存配置")).not.toBeDisabled();
  });

  it("切换 Provider 时重置默认模型和端点", () => {
    render(<ModelConfigForm />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "anthropic" },
    });

    expect(screen.getByDisplayValue("claude-sonnet-4-5")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("https://api.openai.com/v1"),
    ).toHaveValue("");
  });

  it("提交表单时 POST 配置", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse());
    const onSaved = vi.fn();

    render(<ModelConfigForm onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: " sk-test " },
    });
    fireEvent.click(screen.getByText("保存配置"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(lastRequestBody(fetchMock)).toEqual({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-test",
      LLM_BASE_URL: null,
      WORKSPACE_PATH: null,
      AUTO_MODE: false,
      PLAN_MODE: true,
    });
  });

  it("已有配置时预填字段，Key 留空仍可提交且不提交 Key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse());
    const onSaved = vi.fn();

    render(
      <ModelConfigForm initial={existingConfig()} onSaved={onSaved} />,
    );

    expect(screen.getByDisplayValue("gpt-4o-mini")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://example.com/v1"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("/Users/me/projects/app"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Auto mode/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /计划模式/ }),
    ).toBeChecked();
    expect(
      screen.getByPlaceholderText("已保存 sk-a...1234，留空保持不变"),
    ).toBeInTheDocument();
    expect(screen.getByText("留空表示继续使用当前 Key")).toBeInTheDocument();
    expect(screen.getByText("保存配置")).not.toBeDisabled();

    fireEvent.click(screen.getByText("保存配置"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(lastRequestBody(fetchMock)).toEqual({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o-mini",
      LLM_BASE_URL: "https://example.com/v1",
      WORKSPACE_PATH: "/Users/me/projects/app",
      AUTO_MODE: false,
      PLAN_MODE: true,
    });
  });

  it("开启 Auto mode 后随配置一起提交", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse());

    render(<ModelConfigForm initial={existingConfig()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Auto mode/ }));
    expect(
      screen.getByText(/Agent 将直接修改文件并执行 shell 命令/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("保存配置"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastRequestBody(fetchMock)).toMatchObject({ AUTO_MODE: true });
  });

  it("修改工作目录后随配置一起提交", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse());

    render(<ModelConfigForm initial={existingConfig()} onSaved={vi.fn()} />);

    fireEvent.change(
      screen.getByDisplayValue("/Users/me/projects/app"),
      { target: { value: "/Users/me/projects/other" } },
    );
    fireEvent.click(screen.getByText("保存配置"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastRequestBody(fetchMock)).toMatchObject({
      WORKSPACE_PATH: "/Users/me/projects/other",
    });
  });

  it("无 Key 的 Provider 不要求填写 API Key", () => {
    render(
      <ModelConfigForm
        initial={existingConfig({
          provider: "openai-compatible",
          model: "llama3",
          maskedApiKey: "",
          baseUrl: "http://localhost:11434/v1",
        })}
      />,
    );

    expect(screen.getByText("保存配置")).not.toBeDisabled();
    expect(
      screen.getByPlaceholderText("http://localhost:11434/v1"),
    ).toBeInTheDocument();
  });

  it("保存失败时展示错误信息", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: "API Key 无效" }),
    } as unknown as Response);

    render(<ModelConfigForm />);

    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-bad" },
    });
    fireEvent.click(screen.getByText("保存配置"));

    expect(await screen.findByRole("alert")).toHaveTextContent("API Key 无效");
  });
});
