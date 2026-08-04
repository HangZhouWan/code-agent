# Skill 支持 —— 设计文档

## 概述

为 Code Agent 平台增加 Claude Code 风格的 skill 支持。Skill 是项目级定义的可复用指令/提示词包，Orchestrator 在规划阶段由 LLM 自动匹配并注入到子任务上下文中，增强 Agent 在特定领域的能力。

### 核心决策

| 决策点 | 选择 |
|--------|------|
| 触发方式 | 自动匹配（非手动 `/name` 语法） |
| 存储位置 | 项目级 `.agent/skills/*.md` |
| 匹配层级 | Orchestrator Planner 阶段，LLM 驱动匹配 |
| 加载时机 | 应用启动时一次性扫描加载 |

---

## Skill 文件格式

**路径**：`<project-root>/.agent/skills/*.md`

**格式**：Markdown + YAML frontmatter

```markdown
---
name: react-best-practices
description: React hooks, component composition, and performance optimization patterns
---

You are an expert in React best practices. When writing React code:
- Prefer functional components with hooks over class components
- ...
```

- `name`（必填）：唯一标识，用作注册表中的 key
- `description`（必填）：一段话描述 skill 适用场景，作为 LLM 匹配的唯一依据
- body：frontmatter 之后的内容，实际的 skill prompt，将被注入到 Agent 上下文

---

## 架构变更

### 新增组件：SkillRegistry

位置：`packages/core/src/skills/`

```
packages/core/src/skills/
├── index.ts          # 导出
├── registry.ts       # SkillRegistry 类
└── types.ts          # SkillDefinition 类型
```

**SkillRegistry 接口**：

```typescript
export interface SkillDefinition {
  name: string;
  description: string;
  prompt: string;
}

export class SkillRegistry {
  // 扫描目录加载所有 .md 文件
  loadFromDirectory(dir: string): void;

  // 给 Planner 用，只返回名称和描述（节省 token）
  listAll(): { name: string; description: string }[];

  // 给 Dispatcher 用，获取完整 skill 内容
  get(name: string): SkillDefinition | undefined;
}
```

### 变更组件

#### 1. Plan 类型（`packages/server/src/orchestrator/types.ts`）

Plan 增加 `matchedSkills` 字段：

```typescript
export interface Plan {
  complexity: 'simple' | 'complex';
  tasks: SubTask[];
  suggestedAgents: Record<string, string>;
  matchedSkills?: Record<string, string[]>;  // 可选，taskId → skill name[]，默认 {}
}
```

#### 2. Planner 节点（`packages/server/src/orchestrator/nodes/planner.ts`）

- `createPlannerNode()` 增加 `skillRegistry?: SkillRegistry` 参数
- `buildPlannerPrompt()` 在 "Available Agents" 之后增加 "Available Skills" 段落
- 修改 Instructions 中的 JSON 模板，要求 LLM 输出 `matchedSkills` 字段

System prompt 新增段落示例：

```markdown
## Available Skills
- **react-best-practices**: React hooks, component composition, and performance optimization patterns
- **sql-optimization**: SQL query optimization, indexing strategies, and EXPLAIN analysis

## Instructions
...
9. Select relevant skills from the Available Skills list for each subtask. A skill should be assigned only if it genuinely helps with that specific subtask. Output skill names in the matchedSkills field:
{
  "matchedSkills": {
    "task-1": ["react-best-practices"],
    "task-2": []
  }
}
```

#### 3. Dispatcher 节点（`packages/server/src/orchestrator/nodes/dispatcher.ts`）

- `createDispatcherNode()` 增加 `skillRegistry?: SkillRegistry` 参数
- `buildContext()` 增加 skill prompt 注入逻辑：从 `plan.matchedSkills[task.id]` 获取 skill 名称，从 registry 获取完整 prompt，注入到 context 头部
- 注入格式：`[Skill "name"]:\n<prompt body>`

#### 4. 应用入口（`packages/server/` 或 `packages/cli/`）

- 启动时创建 SkillRegistry 实例
- 调用 `skillRegistry.loadFromDirectory('<workspace>/.agent/skills')`
- 将 registry 传递给 `createPlannerNode()` 和 `createDispatcherNode()`

---

## 数据流

```
应用启动
  └→ SkillRegistry.loadFromDirectory('.agent/skills/')
       └→ 解析所有 .md 文件，存入内存 Map

用户输入到达
  └→ Planner
       ├→ skillRegistry.listAll() → 注入 "Available Skills" 到 system prompt
       └→ LLM 生成 Plan（含 matchedSkills）

Dispatcher
  └→ 对每个子任务：
       ├→ 从 plan.matchedSkills[taskId] 获取 skill 名称列表
       ├→ skillRegistry.get(name) → 获取完整 prompt
       └→ 注入到子任务上下文 → Agent 执行
```

---

## 错误处理

| 场景 | 行为 |
|------|------|
| `.agent/skills/` 目录不存在 | 静默跳过，不影响现有流程 |
| 目录为空 | Planner prompt 不出现 "Available Skills"，`matchedSkills` 默认为 `{}` |
| 单个文件 frontmatter 解析失败 | 跳过该文件，打 warning 日志 |
| 缺少 `name` 或 `description` | 跳过该文件，打 warning 日志 |
| body 为空 | 仍然加载（不注入内容），不报错 |
| 同名 skill 冲突 | 字典序第一个生效，打 warning |
| LLM 匹配到不存在的 skill（幻觉） | Dispatcher 中 `get()` 返回 undefined，静默跳过 |

---

## 测试要点

- 空目录/不存在目录的降级行为
- frontmatter 解析：正常、缺少字段、YAML 格式错误、body 为空
- LLM 匹配 skill 正确注入到 Plan
- Dispatcher 正确注入 skill prompt 到 context
- Plan 中无 skill 时 flow 不受影响
- 同名 skill 冲突处理

---

## 不在范围内

- 手动 `/<name>` 触发语法（用户选择自动匹配）
- Skill 热更新/文件监听（需要重启）
- Skill 嵌套/继承/组合
- Agent 层动态匹配 skill
- 全局 skill 目录
- 非 markdown 格式的 skill 定义
