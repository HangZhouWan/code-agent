/**
 * CheckpointManager —— 执行快照持久化
 *
 * 提供 Agent 执行中断恢复能力：
 * - 每 Step 执行前自动保存 checkpoint
 * - 支持 resume(taskId) 从断点恢复
 * - 文件存储实现（每次覆盖，只保留最新）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BaseMessage } from '@langchain/core/messages';

// ─────────────────────────────────────────────
// 核心类型
// ─────────────────────────────────────────────

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
  call: { name: string; args: Record<string, unknown> };
  result: string;
}

/**
 * 思考记录
 */
export interface Thought {
  /** 推理过程 */
  reasoning: string;
  /** 决策类型 */
  decision: 'use_tool' | 'publish_event' | 'request_agent' | 'done' | 'replan';
  /** 工具调用（decision === use_tool） */
  toolCall?: { name: string; args: Record<string, unknown> };
  /** 事件发布（decision === publish_event） */
  event?: { topic: string; payload: unknown };
  /** 目标 Agent（decision === request_agent） */
  targetAgent?: string;
  /** 请求负载（decision === request_agent） */
  payload?: unknown;
  /** 最终总结（decision === done/replan） */
  summary?: string;
}

/**
 * 运行时上下文
 *
 * 执行引擎用于维持 Agent 当前状态的核心数据结构。
 */
export interface RuntimeContext {
  /** 消息历史 */
  messages: BaseMessage[];
  /** 当前 token 使用量（估算） */
  tokenCount: number;
  /** 压缩后生成的摘要 */
  summary?: string;
}

/**
 * Checkpoint 快照
 *
 * 记录 Agent 执行的完整状态，用于恢复。
 */
export interface CheckpointSnapshot {
  /** 任务 ID */
  taskId: string;
  /** Agent ID */
  agentId: string;
  /** 当前执行步数 */
  step: number;
  /** 创建时间 */
  createdAt: Date;
  /** 运行时上下文（包含消息历史） */
  context: RuntimeContext;
  /** 工具调用历史 */
  toolHistory: ToolCallRecord[];
  /** 推理记录 */
  reasoningTrail: Thought[];
}

// ─────────────────────────────────────────────
// CheckpointManager 接口
// ─────────────────────────────────────────────

/**
 * Checkpoint 管理器接口
 *
 * 负责执行快照的创建、读取、清理。
 * 每次 save 覆盖上次记录（只保留最新 checkpoint）。
 */
export interface ICheckpointManager {
  /**
   * 保存执行快照
   *
   * 每次都覆盖写入最新 checkpoint。
   */
  save(
    taskId: string,
    snapshot: Omit<CheckpointSnapshot, 'createdAt'>,
  ): Promise<void>;

  /**
   * 加载最新快照
   *
   * 文件不存在返回 null。
   */
  load(taskId: string): Promise<CheckpointSnapshot | null>;

  /**
   * 列出指定任务的所有 checkpoint 历史
   *
   * 当前实现只保留最新一个，列表最多一项。
   * 预留：后续可支持多版本 checkpoint（如每 N 步保留一个）。
   */
  list(taskId: string): Promise<Array<{ step: number; createdAt: Date }>>;

  /**
   * 删除指定任务的 checkpoint
   */
  purge(taskId: string): Promise<void>;

  /**
   * 清理过期 checkpoint
   *
   * 删除创建时间早于 olderThan 的所有 checkpoint 文件。
   */
  cleanup(olderThan: Date): Promise<void>;
}

// ─────────────────────────────────────────────
// FileCheckpointManager
// ─────────────────────────────────────────────

/**
 * 基于文件系统的 CheckpointManager 实现
 *
 * 每个 task 的 checkpoint 存储为独立 JSON 文件。
 * 路径格式：{basePath}/{taskId}.json
 *
 * 线程不安全 —— 同一 taskId 不应并发 save。
 */
export class FileCheckpointManager implements ICheckpointManager {
  private readonly basePath: string;

  constructor(basePath: string = './data/checkpoints') {
    this.basePath = basePath;
    this.ensureDir();
  }

  /** 获取 task 对应的文件路径 */
  private filePath(taskId: string): string {
    // 清理 taskId 中的潜在路径穿越字符
    const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.basePath, `${safeId}.json`);
  }

  /** 确保存储目录存在 */
  private ensureDir(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /** 保存执行快照（覆盖写入） */
  async save(
    taskId: string,
    snapshot: Omit<CheckpointSnapshot, 'createdAt'>,
  ): Promise<void> {
    this.ensureDir();

    const full: CheckpointSnapshot = {
      ...snapshot,
      createdAt: new Date(),
    };

    // 序列化：将 BaseMessage 转为可序列化的格式
    const serialized = this.serialize(full);
    fs.writeFileSync(this.filePath(taskId), JSON.stringify(serialized, null, 2), 'utf-8');
  }

  /** 加载最新快照 */
  async load(taskId: string): Promise<CheckpointSnapshot | null> {
    const fp = this.filePath(taskId);

    if (!fs.existsSync(fp)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      const data = JSON.parse(raw);
      return this.deserialize(data);
    } catch {
      // 文件损坏，返回 null
      return null;
    }
  }

  /** 列出 checkpoint 元数据 */
  async list(
    taskId: string,
  ): Promise<Array<{ step: number; createdAt: Date }>> {
    const snapshot = await this.load(taskId);
    if (!snapshot) return [];
    return [{ step: snapshot.step, createdAt: snapshot.createdAt }];
  }

  /** 删除 checkpoint */
  async purge(taskId: string): Promise<void> {
    const fp = this.filePath(taskId);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
    }
  }

  /** 清理过期 checkpoint */
  async cleanup(olderThan: Date): Promise<void> {
    if (!fs.existsSync(this.basePath)) return;

    const files = fs.readdirSync(this.basePath);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const fp = path.join(this.basePath, file);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtime < olderThan) {
          fs.unlinkSync(fp);
        }
      } catch {
        // 文件可能已被删除
      }
    }
  }

  // ─── 序列化/反序列化 ──────────────────────

  /**
   * 序列化 snapshot 为可 JSON 化的对象
   *
   * BaseMessage 中包含不可直接序列化的字段（如 Map），
   * 这里转为 plain object 后存储。
   */
  private serialize(
    snapshot: CheckpointSnapshot,
  ): Record<string, unknown> {
    return {
      taskId: snapshot.taskId,
      agentId: snapshot.agentId,
      step: snapshot.step,
      createdAt: snapshot.createdAt.toISOString(),
      context: {
        messages: snapshot.context.messages.map((m) => m.toJSON()),
        tokenCount: snapshot.context.tokenCount,
        summary: snapshot.context.summary,
      },
      toolHistory: snapshot.toolHistory,
      reasoningTrail: snapshot.reasoningTrail,
    };
  }

  /**
   * 反序列化 plain object 为 CheckpointSnapshot
   *
   * 注意：此方法只恢复数据结构，不会还原 LangChain BaseMessage 的完整方法。
   * resume 时 ExecutionEngine 需要根据 JSON 数据重建消息。
   */
  private deserialize(data: Record<string, unknown>): CheckpointSnapshot {
    const ctx = data.context as Record<string, unknown>;
    const rawMessages = (ctx.messages as Array<Record<string, unknown>>) ?? [];

    // 从 JSON 重建消息对象
    // 保存原始的 JSON 数据，方便 ExecutionEngine 按需重建
    const messages = rawMessages.map((m) => {
      const { HumanMessage, AIMessage, ToolMessage, SystemMessage } =
        require('@langchain/core/messages');
      const type = m.lc_id ?? m.id;
      // 根据 langchain 类型标识重建消息
      const typeStr = Array.isArray(type) ? type[type.length - 1] : String(type ?? '');
      if (typeStr.includes('HumanMessage')) {
        return new HumanMessage(m as any);
      } else if (typeStr.includes('AIMessage')) {
        return new AIMessage(m as any);
      } else if (typeStr.includes('ToolMessage')) {
        return new ToolMessage(m as any);
      } else if (typeStr.includes('SystemMessage')) {
        return new SystemMessage(m as any);
      }
      // fallback: 按 role 判断
      const kwargs = m.kwargs ?? m;
      const role = (kwargs as Record<string, unknown>).role;
      if (role === 'ai' || role === 'assistant') {
        return new AIMessage(kwargs as any);
      } else if (role === 'tool') {
        return new ToolMessage(kwargs as any);
      } else if (role === 'system') {
        return new SystemMessage(kwargs as any);
      }
      return new HumanMessage(kwargs as any);
    });

    return {
      taskId: data.taskId as string,
      agentId: data.agentId as string,
      step: data.step as number,
      createdAt: new Date(data.createdAt as string),
      context: {
        messages,
        tokenCount: (ctx.tokenCount as number) ?? 0,
        summary: ctx.summary as string | undefined,
      },
      toolHistory: (data.toolHistory as ToolCallRecord[]) ?? [],
      reasoningTrail: (data.reasoningTrail as Thought[]) ?? [],
    };
  }
}
