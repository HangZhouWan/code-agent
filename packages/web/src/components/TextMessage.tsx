/**
 * TextMessage 组件 —— Markdown 渲染
 *
 * 使用 react-markdown + remark-gfm 渲染消息内容，
 * 支持 GFM 扩展（表格、删除线、任务列表等）。
 * 流式输出时显示闪烁光标指示器。
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TextMessageProps {
  /** 消息文本内容 */
  content: string;
  /** 是否为流式输出中 */
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * TextMessage
 *
 * 暗色主题 Markdown 渲染，使用 prose prose-invert 实现排版。
 *
 * @example
 * ```tsx
 * <TextMessage content="Hello **world**" isStreaming />
 * ```
 */
export function TextMessage({ content, isStreaming }: TextMessageProps) {
  return (
    <div className="prose prose-invert max-w-none prose-headings:text-gray-100 prose-p:text-gray-200 prose-a:text-blue-400 prose-strong:text-gray-100 prose-code:text-blue-300 prose-pre:bg-gray-950 prose-pre:border prose-pre:border-gray-700 prose-pre:rounded-lg prose-blockquote:border-l-blue-500 prose-blockquote:text-gray-400 prose-li:text-gray-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
      {/* 流式输出光标指示器 */}
      {isStreaming && (
        <span className="inline-block w-2 h-5 ml-0.5 bg-blue-400 animate-pulse align-text-bottom rounded-sm" />
      )}
    </div>
  );
}
