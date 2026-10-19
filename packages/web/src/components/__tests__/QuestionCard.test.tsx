/**
 * QuestionCard 测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QuestionCard } from "../QuestionCard.js";

afterEach(() => cleanup());

describe("QuestionCard", () => {
  it("点击选项提交回答", () => {
    const onSubmit = vi.fn();
    render(
      <QuestionCard
        question="Continue?"
        options={["yes", "no"]}
        allowFreeText={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByText("yes"));
    expect(onSubmit).toHaveBeenCalledWith("yes");
  });

  it("自由文本提交", () => {
    const onSubmit = vi.fn();
    render(
      <QuestionCard
        question="What next?"
        allowFreeText
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("输入回答..."), {
      target: { value: "do it" },
    });
    fireEvent.click(screen.getByText("发送"));

    expect(onSubmit).toHaveBeenCalledWith("do it");
  });
});
