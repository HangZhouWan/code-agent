/**
 * LongTermMemory —— JSON 文件存储 + 关键词匹配搜索
 *
 * 首版实现：基于 JSON 文件的持久化存储，使用关键词匹配搜索。
 * 预留 embedding 接口，后续可替换为向量数据库。
 *
 * 存储路径：{basePath}/long-term-memory.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LongTermMemory, LongTermEntry } from './types.js';

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/** 生成唯一 ID */
function generateId(): string {
  return `ltm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 当前时间戳 */
function now(): Date {
  return new Date();
}

/**
 * 简单中文+英文分词
 *
 * 按空格、标点分割，返回长度 ≥ 2 的词条。
 * 后续可替换为 jieba 等专业分词库。
 */
function tokenize(text: string): string[] {
  // 按非字母数字和中文分割
  const tokens = text
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"'`~@#$%^&*+=|\\/<>\-]+/)
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)]; // 去重
}

/**
 * 计算查询与内容的匹配分数
 *
 * 对 query 分词，统计匹配到的 token 数。
 * 分数越高表示匹配越相关。
 */
function matchScore(query: string, content: string): number {
  const queryTokens = tokenize(query);
  const contentLower = content.toLowerCase();

  let score = 0;
  for (const token of queryTokens) {
    if (contentLower.includes(token)) {
      score += 1;
      // 精确匹配加分
      if (contentLower === token) {
        score += 2;
      }
    }
  }
  return score;
}

// ─────────────────────────────────────────────
// FileLongTermMemory
// ─────────────────────────────────────────────

/**
 * 基于 JSON 文件的长期记忆实现
 *
 * 所有记忆存储在单个 JSON 文件中。
 * 关键词匹配搜索，无外部依赖。
 *
 * 预留：后续可替换为 SQLite + embedding 向量搜索。
 */
export class FileLongTermMemory implements LongTermMemory {
  private entries: LongTermEntry[] = [];
  private readonly filePath: string;
  private loaded = false;

  constructor(basePath: string = './data') {
    // 确保目录存在
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
    this.filePath = path.join(basePath, 'long-term-memory.json');
  }

  /** 延迟加载：首次访问时从文件读取 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          // 将 ISO 日期字符串还原为 Date 对象
          this.entries = data.map((e: Record<string, unknown>) => ({
            id: e.id as string,
            sessionId: e.sessionId as string,
            content: e.content as string,
            metadata: (e.metadata as Record<string, unknown>) ?? {},
            createdAt: new Date(e.createdAt as string),
          }));
        }
      }
    } catch {
      // 文件损坏或不存在，从空数组开始
      this.entries = [];
    }

    this.loaded = true;
  }

  /** 持久化到文件 */
  private async persist(): Promise<void> {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8');
    } catch (error) {
      // 写入失败不阻塞，仅记录
      console.error('[LongTermMemory] Failed to persist:', error);
    }
  }

  /** 存储一条记忆 */
  async store(entry: {
    sessionId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.ensureLoaded();

    const record: LongTermEntry = {
      id: generateId(),
      sessionId: entry.sessionId,
      content: entry.content,
      metadata: entry.metadata ?? {},
      createdAt: now(),
    };

    this.entries.push(record);
    await this.persist();
  }

  /**
   * 搜索记忆
   *
   * 对 query 进行分词，遍历所有记忆计算关键词匹配分数，
   * 按分数降序返回 topK 条结果。
   */
  async search(
    query: string,
    topK = 5,
  ): Promise<Array<{ content: string; metadata: Record<string, unknown> }>> {
    await this.ensureLoaded();

    if (!query.trim() || this.entries.length === 0) {
      return [];
    }

    // 计算每条记忆的匹配分数
    const scored = this.entries.map((entry) => ({
      content: entry.content,
      metadata: entry.metadata ?? {},
      score: matchScore(query, entry.content),
    }));

    // 过滤零分结果，按分数降序排序
    const matched = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return matched.slice(0, topK).map(({ content, metadata }) => ({
      content,
      metadata,
    }));
  }

  /** 删除指定会话的所有记忆 */
  async deleteBySession(sessionId: string): Promise<void> {
    await this.ensureLoaded();

    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.sessionId !== sessionId);

    if (this.entries.length !== before) {
      await this.persist();
    }
  }

  /** 获取记忆总数 */
  async count(): Promise<number> {
    await this.ensureLoaded();
    return this.entries.length;
  }

  /**
   * 重置所有记忆（主要用于测试）
   */
  async _reset(): Promise<void> {
    this.entries = [];
    this.loaded = true;
    if (fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {
        // 忽略删除失败
      }
    }
  }
}
