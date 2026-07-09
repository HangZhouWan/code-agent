/**
 * Agent 编排 —— 类型定义
 *
 * 定义 WorkerAgent 的输入/输出接口和状态枚举。
 * 与 Orchestrator 的 SubTask 接口（定义在 server 包中）配合使用。
 */

/**
 * Worker 输入 —— 父 Agent（Orchestrator）派发给子 Agent 的任务描述
 *
 * 包含完成任务所需的所有信息：工具列表、上下文摘要、工作区路径等。
 * 子 Agent 不直接与用户交互，只看此输入结构。
 */
export interface WorkerInput {
  /** 子任务唯一标识，由 Orchestrator 分配 */
  taskId: string;
  /** 子任务的自然语言描述，Worker 的 System Prompt 直接使用 */
  description: string;
  /** 允许使用的工具名称列表，如 ["file_read", "code_search"] */
  tools: string[];
  /** 上下文摘要：依赖任务的结果或父 Agent 的背景信息 */
  context: string;
  /** 文件系统工作区根路径，所有文件操作限定在此路径下 */
  workspacePath: string;
  /** 最大迭代次数，默认 15 */
  maxIterations?: number;
  /** 执行超时时间（毫秒），默认 60000 */
  timeoutMs?: number;
  /**
   * 确认回调（可选）
   *
   * 当 Worker 使用的工具需要用户确认时（如 file_write），调用此回调。
   * 回调返回 Promise<boolean>：true = 批准，false = 拒绝。
   * 如不提供，confirm 级别的工具将抛出 ConfirmRequiredError。
   */
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
}

/**
 * Worker 执行状态
 *
 * - running: 正在执行
 * - success: 成功完成
 * - failed: 执行失败（工具错误、LLM 错误等）
 * - timeout: 超时中断
 * - awaiting_approval: 需要用户确认敏感操作
 */
export type WorkerStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'awaiting_approval';

/**
 * Worker 输出 —— 子 Agent 返回给 Orchestrator 的结构化结果
 *
 * 包含执行状态、结果文本、工具调用记录和错误信息。
 */
export interface WorkerOutput {
  /** 对应 WorkerInput.taskId */
  taskId: string;
  /** 执行结果状态 */
  status: WorkerStatus;
  /** 成功时的最终回复文本 */
  result?: string;
  /** 失败/超时/待审批时的错误信息 */
  error?: string;
  /** 工具调用记录，用于审计和调试 */
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
}
