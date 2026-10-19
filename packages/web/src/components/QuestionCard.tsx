/**
 * ask_user 问题卡片
 */

import { useState } from "react";

export interface QuestionCardProps {
  question: string;
  options?: string[];
  allowFreeText: boolean;
  onSubmit: (answer: string) => void;
}

export function QuestionCard({
  question,
  options,
  allowFreeText,
  onSubmit,
}: QuestionCardProps) {
  const [text, setText] = useState("");

  return (
    <div className="mx-4 mb-3 rounded-lg border border-blue-500/40 bg-blue-500/5 p-4">
      <p className="mb-3 text-sm text-gray-200 whitespace-pre-wrap">
        {question}
      </p>

      {options && options.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onSubmit(option)}
              className="rounded-md border border-blue-500/50 bg-gray-900 px-3 py-1.5 text-sm text-blue-200 hover:bg-blue-500/10"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {allowFreeText && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) onSubmit(text.trim());
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="输入回答..."
            className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            发送
          </button>
        </form>
      )}
    </div>
  );
}
