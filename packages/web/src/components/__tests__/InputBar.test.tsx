/**
 * InputBar 组件测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InputBar } from "../InputBar.js";

describe("InputBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("初始状态 Send 按钮应禁用", () => {
    render(<InputBar onSend={vi.fn()} />);
    expect(screen.getByText("Send")).toBeDisabled();
  });

  it("输入文本后 Send 按钮应可用", () => {
    render(<InputBar onSend={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Hello" } });

    expect(screen.getByText("Send")).not.toBeDisabled();
  });

  it("点击 Send 应触发 onSend 并清空输入", () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Hello world" } });
    fireEvent.click(screen.getByText("Send"));

    expect(onSend).toHaveBeenCalledWith("Hello world");
    expect(textarea.value).toBe("");
  });

  it("空白内容不应触发 onSend", () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByText("Send"));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter 键应发送消息", () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Quick message" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSend).toHaveBeenCalledWith("Quick message");
  });

  it("Shift+Enter 应换行而非发送", () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "Line 1" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    // 不应触发 onSend（Shift+Enter 是默认浏览器行为=换行）
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disabled 时 textarea 和按钮应禁用", () => {
    render(<InputBar onSend={vi.fn()} disabled />);

    const textarea = screen.getByPlaceholderText(/Agent is thinking/);
    expect(textarea).toBeDisabled();
    expect(screen.getByText("Send")).toBeDisabled();
  });

  it("disabled 时 placeholder 应显示 Agent is thinking", () => {
    render(<InputBar onSend={vi.fn()} disabled />);
    expect(screen.getByPlaceholderText(/Agent is thinking/)).toBeInTheDocument();
  });

  it("输入法组合期间按 Enter 不发送，组合结束后才发送", () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: "你好" } });

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("你好");
  });

  it("isComposing 的 Enter 不触发发送", () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: "你好" } });

    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("IME keyCode 229 的 Enter 不触发发送", () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: "你好" } });

    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("流式中应显示 Stop 而不是 Send", () => {
    render(<InputBar onSend={vi.fn()} onStop={vi.fn()} isStreaming />);

    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  it("流式中 textarea 应禁用", () => {
    render(<InputBar onSend={vi.fn()} onStop={vi.fn()} isStreaming />);

    expect(screen.getByPlaceholderText(/Agent is thinking/)).toBeDisabled();
  });

  it("点击 Stop 应触发 onStop", () => {
    const onStop = vi.fn();
    render(<InputBar onSend={vi.fn()} onStop={onStop} isStreaming />);

    fireEvent.click(screen.getByText("Stop"));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("未提供 onStop 时 Stop 按钮禁用", () => {
    render(<InputBar onSend={vi.fn()} isStreaming />);

    expect(screen.getByText("Stop")).toBeDisabled();
  });
});
