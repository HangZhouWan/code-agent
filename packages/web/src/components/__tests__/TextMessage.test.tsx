/**
 * TextMessage 组件测试
 *
 * 覆盖：
 * - 基本文本渲染
 * - Markdown 渲染（粗体、代码块）
 * - 流式输出时显示光标
 * - 非流式时不显示光标
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TextMessage } from "../TextMessage.js";

describe("TextMessage", () => {
  it("应渲染基本文本内容", () => {
    render(<TextMessage content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("应渲染粗体 Markdown", () => {
    render(<TextMessage content="Hello **bold** world" />);
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
  });

  it("应渲染行内代码", () => {
    render(<TextMessage content="Use `const` keyword" />);
    const code = screen.getByText("const");
    expect(code.tagName).toBe("CODE");
  });

  it("流式输出时应显示闪烁光标", () => {
    const { container } = render(
      <TextMessage content="streaming" isStreaming />,
    );
    const cursor = container.querySelector(".animate-pulse");
    expect(cursor).toBeInTheDocument();
  });

  it("非流式时不应显示光标", () => {
    const { container } = render(
      <TextMessage content="done" />,
    );
    const cursor = container.querySelector(".animate-pulse");
    expect(cursor).toBeNull();
  });

  it("应处理空内容", () => {
    const { container } = render(<TextMessage content="" />);
    // 应渲染但不崩溃
    expect(container.querySelector(".prose")).toBeInTheDocument();
  });
});
