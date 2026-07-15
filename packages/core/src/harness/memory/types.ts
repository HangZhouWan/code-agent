/**
 * Memory —— 核心类型定义
 *
 * 定义 Agent Runtime 三层记忆体系的接口：
 * - ShortTermMemory：当前对话上下文（内存循环数组）
 * - LongTermMemory：跨会话知识存储（关键词搜索，预留 embedding 接口）
 * - WorkingMemory：当前 task 共享白板
 */

// ─────────────────────────────────────────────
// ShortTerm Memory
// ─────────────────────────────────────────────

/**
 * 短期记忆 —— 单 Agent 当前对话
 *
 * 内存循环数组实现，最多保留 200 条消息。
 * 超出上限自动淘汰最早的消息。
 */
export interface ShortTermMemory {
  /** 追加一条消息 */
  add(entry: { role: string; content: string }): void;

  /** 获取最近 n 条消息 */
  recent(n: number): Array<{ role: string; content: string }>;

  /** 获取所有消息 */
  all(): Array<{ role: string; content: string }>;

  /** 清空所有消息 */
  clear(): void;
}

// ─────────────────────────────────────────────
// LongTerm Memory
// ─────────────────────────────────────────────

/**
 * 长期记忆条目
 */
export interface LongTermEntry {
  /** 条目唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 内容 */
  content: string;
  /** 可选元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 长期记忆 —— 跨会话知识存储
 *
 * 首版使用关键词匹配搜索，预留 embedding 接口。
 * 后续可替换为向量数据库（如 Pinecone、pgvector）。
 */
export interface LongTermMemory {
  /** 存储一条记忆 */
  store(entry: {
    sessionId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  /**
   * 搜索记忆
   *
   * 当前实现：关键词匹配，对 query 分词后匹配 content。
   * 预留：embedding 语义搜索。
   *
   * @param query - 搜索查询
   * @param topK - 返回前 K 条结果，默认 5
   */
  search(
    query: string,
    topK?: number,
  ): Promise<Array<{ content: string; metadata: Record<string, unknown> }>>;

  /** 删除指定会话的所有记忆 */
  deleteBySession(sessionId: string): Promise<void>;

  /** 获取记忆总数 */
  count(): Promise<number>;
}

// ─────────────────────────────────────────────
// Working Memory
// ─────────────────────────────────────────────

/**
 * 工作记忆 —— 当前 task 内所有 Agent 共享的"白板"
 *
 * 基于内存 Map 实现，task 结束即清理，无持久化。
 * 用于 Agent 间共享中间结果（如 "当前项目语言"、"已发现的问题列表"）。
 */
export interface WorkingMemory {
  /** 写入键值 */
  write(key: string, value: unknown): void;

  /** 读取键值 */
  read<T = unknown>(key: string): T | null;

  /** 获取全部快照 */
  snapshot(): Record<string, unknown>;

  /** 清空所有键值 */
  clear(): void;
}

// ─────────────────────────────────────────────
// Memory Manager
// ─────────────────────────────────────────────

/**
 * 记忆管理器总接口
 *
 * 聚合三层记忆：ShortTerm、LongTerm、Working。
 */
export interface IMemoryManager {
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  working: WorkingMemory;
}
