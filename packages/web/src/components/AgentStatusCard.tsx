/**
 * AgentStatusCard 组件 —— 多 Agent 状态面板
 *
 * 实时显示各 Agent 的运行状态，数据来源为 WebSocket 推送的
 * `agent_status` 消息类型。
 *
 * ┌─────────────────────────┐
 * │  Agents                 │
 * │  🔵 Code Agent  busy    │
 * │  🟢 Test Agent  idle    │
 * │  🟢 Doc Agent   idle    │
 * └─────────────────────────┘
 *
 * 状态  | 图标 | 色彩
 * -------|------|------
 * idle   | 🟢  | green
 * busy   | 🔵  | blue
 * error  | 🔴  | red
 * offline| ⚫  | gray
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 单个 Agent 状态 */
export interface AgentInfo {
  /** Agent 角色标识 */
  role: string;
  /** Agent 唯一 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 运行状态 */
  status: "idle" | "busy" | "error" | "offline";
  /** 当前执行的任务（busy 时有值） */
  currentTask?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgentStatusCardProps {
  /** Agent 状态列表 */
  agents: AgentInfo[];
  /** 面板是否可折叠 */
  collapsible?: boolean;
}

// ---------------------------------------------------------------------------
// 状态配置
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  AgentInfo["status"],
  { icon: string; label: string; dotColor: string; textColor: string }
> = {
  idle: {
    icon: "🟢",
    label: "Idle",
    dotColor: "bg-green-500",
    textColor: "text-green-400",
  },
  busy: {
    icon: "🔵",
    label: "Busy",
    dotColor: "bg-blue-500",
    textColor: "text-blue-400",
  },
  error: {
    icon: "🔴",
    label: "Error",
    dotColor: "bg-red-500",
    textColor: "text-red-400",
  },
  offline: {
    icon: "⚫",
    label: "Offline",
    dotColor: "bg-gray-500",
    textColor: "text-gray-400",
  },
};

/** 角色对应名称映射 */
const ROLE_NAME_MAP: Record<string, string> = {
  code: "Code Agent",
  test: "Test Agent",
  doc: "Doc Agent",
};

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * AgentStatusCard
 *
 * 显示多 Agent 实时状态面板，支持折叠展开。
 * 数据来源于 WebSocket `agent_status` 推送或 HTTP `/api/agents` 轮询。
 *
 * @example
 * ```tsx
 * <AgentStatusCard agents={[
 *   { id: 'a1', role: 'code', name: 'Code Agent', status: 'busy', currentTask: 'task-1' },
 *   { id: 'a2', role: 'test', name: 'Test Agent', status: 'idle' },
 * ]} />
 * ```
 */
export function AgentStatusCard({
  agents,
  collapsible = true,
}: AgentStatusCardProps) {
  const [expanded, setExpanded] = useState(true);

  if (agents.length === 0) return null;

  // 统计各状态数量
  const counts = {
    total: agents.length,
    busy: agents.filter((a) => a.status === "busy").length,
    idle: agents.filter((a) => a.status === "idle").length,
    error: agents.filter((a) => a.status === "error").length,
    offline: agents.filter((a) => a.status === "offline").length,
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/50 overflow-hidden">
      {/* ── 标题行 ── */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-sm font-semibold text-gray-300">Agents</span>

        {/* 状态统计 */}
        <div className="flex items-center gap-3 ml-auto text-xs text-gray-500">
          {counts.busy > 0 && (
            <span className="text-blue-400">{counts.busy} busy</span>
          )}
          {counts.idle > 0 && (
            <span className="text-green-400">{counts.idle} idle</span>
          )}
          {counts.error > 0 && (
            <span className="text-red-400">{counts.error} error</span>
          )}
        </div>

        {/* 折叠按钮 */}
        {collapsible && (
          <button
            type="button"
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▲" : "▼"}
          </button>
        )}
      </div>

      {/* ── Agent 列表 ── */}
      {expanded && (
        <div className="border-t border-gray-700/50">
          {agents.map((agent) => {
            const cfg = STATUS_CONFIG[agent.status];
            const displayName =
              agent.name || ROLE_NAME_MAP[agent.role] || agent.role;

            return (
              <div
                key={agent.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors"
              >
                {/* 状态指示点 */}
                <span className="text-sm" title={cfg.label}>
                  {cfg.icon}
                </span>

                {/* Agent 名称 */}
                <span className="text-sm text-gray-300 font-medium">
                  {displayName}
                </span>

                {/* 当前任务 */}
                {agent.currentTask && (
                  <span className="text-xs text-gray-500 truncate max-w-[120px]">
                    {agent.currentTask}
                  </span>
                )}

                {/* 状态标签 */}
                <span className={`text-xs ml-auto ${cfg.textColor}`}>
                  {cfg.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
