/**
 * 上下文压缩器
 *
 * 当 Agent 消息历史的 token 使用量超过阈值时，
 * 对历史消息生成摘要，释放 token 预算给新的对话轮次。
 *
 * 压缩策略：
 * 1. 消息总数 ≤ keepRecent → 对全部消息生成摘要
 * 2. 消息总数 > keepRecent → 保留最近 N 条完整内容，更早的消息生成摘要
 * 3. 摘要函数当前为简单截断，后续替换为 LLM 摘要
 */

import type { BaseMessage } from '@langchain/core/messages';

/**
 * 压缩消息历史，生成摘要
 *
 * @param messages - 完整的消息历史数组
 * @param maxTokens - 压缩目标 token 数（未使用，预留给 LLM 摘要实现）
 * @param options - 压缩选项
 * @param options.keepRecent - 保留最近 N 条消息不压缩，默认 20
 * @returns 摘要字符串
 */
export async function compressMessages(
  messages: BaseMessage[],
  _maxTokens: number,
  options?: { keepRecent?: number },
): Promise<string> {
  const keepRecent = options?.keepRecent ?? 20;

  if (messages.length === 0) {
    return '';
  }

  // 确定需要压缩的消息范围
  let messagesToCompress: BaseMessage[];
  let recentMessages: BaseMessage[];

  if (messages.length <= keepRecent) {
    // 消息较少，压缩全部但保留摘要
    messagesToCompress = messages;
    recentMessages = [];
  } else {
    // 保留最近 keepRecent 条消息，压缩更早的消息
    const splitIndex = messages.length - keepRecent;
    messagesToCompress = messages.slice(0, splitIndex);
    recentMessages = messages.slice(splitIndex);
  }

  // 当前实现：简单截断摘要
  // 后续替换为 LLM 调用生成真正摘要
  const summary = summarize(messagesToCompress, recentMessages);

  return summary;
}

/**
 * 摘要生成函数
 *
 * 当前实现：取前 5 条消息的前 200 字符作为摘要。
 * 标注为后续替换为 LLM 摘要实现。
 *
 * @param toCompress - 需要压缩的消息
 * @param _recent - 保留的消息（当前未使用）
 * @returns 摘要字符串
 *
 * @todo 替换为 LLM 驱动的摘要生成
 */
function summarize(toCompress: BaseMessage[], _recent: BaseMessage[]): string {
  const excerpts = toCompress.slice(0, 5).map((msg, i) => {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
    const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
    const role = msg.getType?.() ?? 'unknown';
    return `[${i + 1}] ${role}: ${preview}`;
  });

  return `[Summary of ${toCompress.length} earlier messages]\n${excerpts.join('\n')}`;
}
