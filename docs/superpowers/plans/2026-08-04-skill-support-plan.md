# Skill 支持 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Code Agent 平台增加 Claude Code 风格的 skill 支持 —— 项目级定义的指令/提示词包，在 Orchestrator 规划阶段由 LLM 自动匹配并注入到子任务上下文。

**Architecture:** 新增 SkillRegistry 组件（core 包），负责扫描 `.agent/skills/*.md` 文件并解析 frontmatter + body。Planner 构建 system prompt 时注入 skill 列表让 LLM 匹配，Dispatcher 将匹配到的 skill prompt 注入子任务 context。整个链路通过现有 graph.ts 的依赖注入传递。

**Tech Stack:** TypeScript, Node.js fs API, 手写 frontmatter 解析器（无需额外依赖）

## Global Constraints

- 所有公开类型从 `@code-agent/core` 的 index.ts 统一导出
- 不引入新的 npm 依赖（手写 frontmatter 解析）
- 向后兼容：skillRegistry 参数全部可选，不存在时行为与现状一致
- 错误处理采用优雅降级：单个 skill 文件出错不影响其他 skill 加载
- 遵循项目现有的命名和注释风格

---

## 文件结构

```
packages/core/src/skills/
├── types.ts              # SkillDefinition 类型
├── registry.ts           # SkillRegistry 类（加载/查询）
├── index.ts              # 统一导出
└── __tests__/
    └── registry.test.ts  # 单元测试

packages/core/src/index.ts                     # 导出新增的 skill 类型和类
packages/server/src/orchestrator/types.ts      # Plan 增加 matchedSkills
packages/server/src/orchestrator/nodes/planner.ts   # 注入 skill 列表到 prompt，解析 matchedSkills
packages/server/src/orchestrator/nodes/dispatcher.ts # 注入 skill prompt 到 context
packages/server/src/orchestrator/graph.ts      # 传递 skillRegistry
```

---

### Task 1: Skill 类型定义

**Files:**
- Create: `packages/core/src/skills/types.ts`

**Interfaces:**
- Produces: `SkillDefinition { name: string; description: string; prompt: string }`
- Produces: `SkillSummary { name: string; description: string }`

- [ ] **Step 1: 创建 types.ts**

```typescript
/**
 * Skill 类型定义
 *
 * Skill 是项目级定义的可复用指令/提示词包，
 * 在 Orchestrator 规划阶段由 LLM 自动匹配并注入到子任务上下文。
 */

/**
 * Skill 完整定义
 *
 * 从 .agent/skills/*.md 解析后得到的结构化对象。
 * name 和 description 来自 YAML frontmatter，prompt 来自 body。
 */
export interface SkillDefinition {
  /** 唯一标识，如 "react-best-practices"，对应文件名（不含扩展名） */
  name: string;

  /** 一段话描述 skill 适用场景，作为 LLM 匹配的唯一依据 */
  description: string;

  /** frontmatter 之后的 Markdown body，即实际的 skill prompt 内容 */
  prompt: string;
}

/**
 * Skill 摘要（给 Planner 用）
 *
 * 仅包含名称和描述，不含 prompt body。
 * 注入到 Planner 的 system prompt 中供 LLM 匹配，节省 token。
 */
export interface SkillSummary {
  /** Skill 名称 */
  name: string;

  /** Skill 描述 */
  description: string;
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skills/types.ts
git commit -m "feat(skills): add SkillDefinition and SkillSummary types"
```

---

### Task 2: SkillRegistry 类

**Files:**
- Create: `packages/core/src/skills/registry.ts`

**Interfaces:**
- Consumes: `SkillDefinition` from Task 1
- Consumes: `SkillSummary` from Task 1
- Produces: `SkillRegistry { loadFromDirectory(dir): void; listAll(): SkillSummary[]; get(name): SkillDefinition | undefined }`

- [ ] **Step 1: 创建 registry.ts**

```typescript
/**
 * SkillRegistry —— Skill 注册管理中心
 *
 * 负责：
 * - 扫描 .agent/skills/ 目录，解析 Markdown + YAML frontmatter 文件
 * - 提供 listAll() 供 Planner 查询可用 skill（仅摘要，节省 token）
 * - 提供 get() 供 Dispatcher 获取完整 skill prompt
 *
 * 错误处理采用优雅降级：单个文件解析失败不影响其他文件的加载。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillDefinition, SkillSummary } from './types.js';

/**
 * 解析 Markdown frontmatter
 *
 * 格式：
 * ---
 * key: value
 * ---
 * body content
 *
 * 仅支持简单 YAML：单层 key: value，不支持嵌套、数组、引号转义。
 * 足够覆盖 skill 文件的 name 和 description 字段。
 */
function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { frontmatter: {}, body: raw };
  }

  const frontmatterBlock = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterBlock.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Skill 注册管理中心
 *
 * 线程不安全 —— 应在应用启动时一次性加载完成。
 *
 * @example
 * ```ts
 * const registry = new SkillRegistry();
 * registry.loadFromDirectory('/path/to/.agent/skills');
 * const summaries = registry.listAll();
 * const skill = registry.get('react-best-practices');
 * ```
 */
export class SkillRegistry {
  /** name → SkillDefinition */
  private skills = new Map<string, SkillDefinition>();

  /**
   * 从目录加载所有 .md skill 文件
   *
   * 扫描指定目录下所有 .md 文件，解析 frontmatter 和 body。
   * 目录不存在或为空时静默跳过（不报错）。
   * 单个文件解析失败时打 warning 日志并跳过，不影响其他文件。
   * 同名 skill 按文件名字典序只加载第一个，打 warning。
   *
   * @param dir - skill 文件目录路径
   */
  loadFromDirectory(dir: string): void {
    try {
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) return;
    } catch {
      // 目录不存在 → 静默跳过
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // 按文件名字典序排序，保证同名 skill 冲突时可预测
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of mdFiles) {
      try {
        const filePath = path.join(dir, entry.name);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(raw);

        const name = frontmatter['name'];
        const description = frontmatter['description'];

        if (!name || !description) {
          console.warn(
            `[SkillRegistry] Skipping "${entry.name}": missing required frontmatter fields (name, description)`,
          );
          continue;
        }

        if (this.skills.has(name)) {
          console.warn(
            `[SkillRegistry] Skipping "${entry.name}": skill "${name}" already registered (name collision)`,
          );
          continue;
        }

        this.skills.set(name, { name, description, prompt: body });
      } catch (err) {
        console.warn(
          `[SkillRegistry] Failed to load "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 列出所有可用 skill 的摘要
   *
   * 仅返回名称和描述，不含 prompt body，用于注入 Planner 的 system prompt。
   *
   * @returns Skill 摘要数组
   */
  listAll(): SkillSummary[] {
    const result: SkillSummary[] = [];
    for (const { name, description } of this.skills.values()) {
      result.push({ name, description });
    }
    return result;
  }

  /**
   * 根据名称获取完整 skill 定义
   *
   * @param name - skill 名称
   * @returns SkillDefinition 或 undefined（skill 不存在时）
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * 已加载的 skill 数量
   */
  get count(): number {
    return this.skills.size;
  }
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skills/registry.ts
git commit -m "feat(skills): add SkillRegistry with frontmatter parsing and directory loading"
```

---

### Task 3: Skill 模块导出

**Files:**
- Create: `packages/core/src/skills/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `SkillDefinition`, `SkillSummary` from Task 1
- Consumes: `SkillRegistry` from Task 2

- [ ] **Step 1: 创建 skills/index.ts**

```typescript
/**
 * @code-agent/core —— Skills 模块
 *
 * 提供 skill 类型定义和注册管理中心。
 */

export type { SkillDefinition, SkillSummary } from './types.js';
export { SkillRegistry } from './registry.js';
```

- [ ] **Step 2: 修改 core/src/index.ts — 在"子 Agent 编排"导出之后新增 skill 导出**

在 `export { WorkerAgent } from './agent/worker.js';` 行之后添加：

```typescript
// Skills
export type { SkillDefinition, SkillSummary } from './skills/index.js';
export { SkillRegistry } from './skills/index.js';
```

- [ ] **Step 3: 验证编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skills/index.ts packages/core/src/index.ts
git commit -m "feat(skills): export SkillRegistry and types from @code-agent/core"
```

---

### Task 4: SkillRegistry 单元测试

**Files:**
- Create: `packages/core/src/skills/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `SkillRegistry`, `SkillDefinition`, `SkillSummary` from Task 3

- [ ] **Step 1: 创建测试文件**

```typescript
/**
 * SkillRegistry 单元测试
 *
 * 覆盖：正常加载、空目录、不存在目录、frontmatter 解析、
 * 缺少字段、YAML 格式错误、body 为空、同名冲突。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SkillRegistry } from '../registry.js';

describe('SkillRegistry', () => {
  let tmpDir: string;
  let skillsDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-test-'));
    skillsDir = path.join(tmpDir, '.agent', 'skills');
    registry = new SkillRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── 正常路径 ─────────────────────────────

  it('should load a valid skill file', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'react.md'),
      '---\nname: react-best-practices\ndescription: React patterns and best practices\n---\n\nUse functional components with hooks.',
    );

    registry.loadFromDirectory(skillsDir);

    expect(registry.count).toBe(1);

    const summaries = registry.listAll();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      name: 'react-best-practices',
      description: 'React patterns and best practices',
    });

    const skill = registry.get('react-best-practices');
    expect(skill).toBeDefined();
    expect(skill!.name).toBe('react-best-practices');
    expect(skill!.description).toBe('React patterns and best practices');
    expect(skill!.prompt).toBe('Use functional components with hooks.');
  });

  it('should load multiple skill files', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'react.md'),
      '---\nname: react\ndescription: React\n---\n\nReact content',
    );
    fs.writeFileSync(
      path.join(skillsDir, 'sql.md'),
      '---\nname: sql\ndescription: SQL\n---\n\nSQL content',
    );

    registry.loadFromDirectory(skillsDir);

    expect(registry.count).toBe(2);
    expect(registry.listAll()).toHaveLength(2);
  });

  it('should handle empty body skill', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'minimal.md'),
      '---\nname: minimal\ndescription: Minimal skill\n---\n',
    );

    registry.loadFromDirectory(skillsDir);

    expect(registry.count).toBe(1);
    expect(registry.get('minimal')!.prompt).toBe('');
  });

  // ─── 降级路径 ─────────────────────────────

  it('should silently skip non-existent directory', () => {
    const nonExistent = path.join(tmpDir, 'does-not-exist');
    expect(() => registry.loadFromDirectory(nonExistent)).not.toThrow();
    expect(registry.count).toBe(0);
    expect(registry.listAll()).toEqual([]);
  });

  it('should silently handle empty directory', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    registry.loadFromDirectory(skillsDir);
    expect(registry.count).toBe(0);
    expect(registry.listAll()).toEqual([]);
  });

  it('should skip .md files without frontmatter name', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'no-name.md'),
      '---\ndescription: Missing name field\n---\n\nBody',
    );

    registry.loadFromDirectory(skillsDir);

    expect(registry.count).toBe(0);
    expect(registry.listAll()).toEqual([]);
  });

  it('should skip .md files without frontmatter description', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'no-desc.md'),
      '---\nname: no-desc\n---\n\nBody',
    );

    registry.loadFromDirectory(skillsDir);

    expect(registry.count).toBe(0);
    expect(registry.listAll()).toEqual([]);
  });

  it('should handle files with no frontmatter at all', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'plain.md'),
      'Just plain text without any frontmatter.',
    );

    registry.loadFromDirectory(skillsDir);

    expect(registry.count).toBe(0);
  });

  // ─── 同名冲突 ─────────────────────────────

  it('should deduplicate by name (first wins alphabetically)', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    // a.md 字母序在前，应该被加载
    fs.writeFileSync(
      path.join(skillsDir, 'a-first.md'),
      '---\nname: my-skill\ndescription: First registration\n---\n\nFirst body.',
    );
    // z.md 字母序在后，同名冲突被跳过
    fs.writeFileSync(
      path.join(skillsDir, 'z-second.md'),
      '---\nname: my-skill\ndescription: Second registration\n---\n\nSecond body.',
    );

    registry.loadFromDirectory(skillsDir);

    expect(registry.count).toBe(1);
    const skill = registry.get('my-skill');
    expect(skill!.description).toBe('First registration');
    expect(skill!.prompt).toBe('First body.');
  });

  // ─── get 查询 ──────────────────────────────

  it('should return undefined for unknown skill', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should list only names and descriptions', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'skill.md'),
      '---\nname: test-skill\ndescription: Test desc\n---\n\nLong prompt content here.',
    );

    registry.loadFromDirectory(skillsDir);

    const summaries = registry.listAll();
    expect(summaries).toHaveLength(1);
    // listAll 不应包含 prompt
    expect((summaries[0] as any).prompt).toBeUndefined();
  });

  // ─── 非 .md 文件 ──────────────────────────

  it('should ignore non-markdown files', () => {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'notes.txt'), 'Some notes');
    fs.writeFileSync(path.join(skillsDir, 'config.json'), '{}');
    fs.writeFileSync(
      path.join(skillsDir, 'real.md'),
      '---\nname: real\ndescription: Real skill\n---\n\nContent',
    );

    registry.loadFromDirectory(skillsDir);

    expect(registry.count).toBe(1);
    expect(registry.get('real')).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd packages/core && npx vitest run src/skills/__tests__/registry.test.ts`
Expected: 全部 PASS（约 12 个测试用例）

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skills/__tests__/registry.test.ts
git commit -m "test(skills): add SkillRegistry unit tests"
```

---

### Task 5: Plan 类型增加 matchedSkills

**Files:**
- Modify: `packages/server/src/orchestrator/types.ts`

**Interfaces:**
- Produces: `Plan.matchedSkills?: Record<string, string[]>`

- [ ] **Step 1: 修改 Plan 接口**

在 `suggestedAgents: Record<string, string>;` 行之后添加：

```typescript
  /**
   * LLM 匹配的 skill 列表（可选）
   *
   * 映射：taskId → skill name[]。
   * Dispatcher 根据此字段将对应 skill 的 prompt 注入子任务 context。
   * 当没有 skill 被加载或 LLM 未匹配时，此字段为 undefined 或 {}。
   */
  matchedSkills?: Record<string, string[]>;
```

- [ ] **Step 2: 验证编译通过**

Run: `cd packages/server && npx tsc --noEmit`
Expected: 无类型错误（尚未有代码引用新增字段）

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/orchestrator/types.ts
git commit -m "feat(skills): add matchedSkills field to Plan type"
```

---

### Task 6: Planner 注入 skill 列表并解析匹配结果

**Files:**
- Modify: `packages/server/src/orchestrator/nodes/planner.ts`

**Interfaces:**
- Consumes: `SkillRegistry`, `SkillSummary` from `@code-agent/core`
- Consumes: `Plan` with `matchedSkills` from Task 5
- Modifies: `createPlannerNode()` 增加 `skillRegistry?` 参数
- Modifies: `buildPlannerPrompt()` 在 "Available Agents" 后增加 "Available Skills" 段落
- Modifies: LLM 输出解析 —— 提取 `matchedSkills` 字段加入 Plan

- [ ] **Step 1: 修改 import，增加 SkillRegistry 类型引用**

在文件顶部的 import 中，于 `@code-agent/core` 的 import 语句中增加 `SkillRegistry`：

当前 import 为：
```typescript
import { ToolRegistry, type ToolDefinition } from '@code-agent/core';
import type { AgentRegistry } from '@code-agent/core';
```

修改为：
```typescript
import { ToolRegistry, type ToolDefinition, type SkillSummary } from '@code-agent/core';
import type { AgentRegistry, SkillRegistry } from '@code-agent/core';
```

- [ ] **Step 2: 修改 buildPlannerPrompt，增加 skills 参数和段落**

修改函数签名：
```typescript
function buildPlannerPrompt(
  availableAgents: Array<{ role: string; description: string; tools: string[] }>,
  availableTools: ToolDefinition[],
  availableSkills: SkillSummary[],
): string {
```

在 `## Available Tools` 段落之后，`## Instructions` 之前，插入 skills 段落：

```typescript
  const skillList = availableSkills.length > 0
    ? availableSkills
        .map((s) => `- **${s.name}**: ${s.description}`)
        .join('\n')
    : '';

  const skillsSection = availableSkills.length > 0
    ? `\n## Available Skills\n${skillList}\n`
    : '';
```

然后在返回的 prompt 字符串中，在 `## Instructions` 之前插入 `${skillsSection}`。

在 `## Instructions` 的第 8 条之后增加第 9 条：

```
9. Select relevant skills from the Available Skills list for each subtask if the Available Skills section exists. Only assign a skill when it genuinely helps that specific subtask. Output skill names in the matchedSkills field. If no skills are relevant for a task, use an empty array.
```

在 JSON 模板中增加 `matchedSkills`：

```
"matchedSkills": {
  "task-1": ["skill-name"],
  "task-2": []
}
```

- [ ] **Step 3: 修改 createPlannerNode 签名**

```typescript
export function createPlannerNode(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  agentRegistry?: AgentRegistry,
  skillRegistry?: SkillRegistry,
) {
```

在函数体内部，于 `systemPrompt` 构建之前获取 skill 摘要：

```typescript
  const availableSkills = skillRegistry ? skillRegistry.listAll() : [];
  const systemPrompt = buildPlannerPrompt(availableAgents, availableTools, availableSkills);
```

- [ ] **Step 4: 修改 Plan 解析逻辑，提取 matchedSkills**

在 `validateSubTask` 调用之后的 `plan` 构建处，从 LLM 返回的 raw object 中提取 `matchedSkills`。

在 `plan = { complexity, tasks, suggestedAgents };` 这一行（约 339 行），改为：

```typescript
      // 提取 matchedSkills（可选字段，LLM 可能不返回或返回 null）
      const matchedSkills: Record<string, string[]> = {};
      if (obj.matchedSkills && typeof obj.matchedSkills === 'object') {
        for (const [taskId, skillNames] of Object.entries(obj.matchedSkills)) {
          if (Array.isArray(skillNames)) {
            matchedSkills[taskId] = skillNames
              .filter((s): s is string => typeof s === 'string')
              .filter((s) => s.length > 0);
          }
        }
      }

      plan = { complexity, tasks, suggestedAgents, matchedSkills };
```

同样，在兼容旧数组格式的 Plan 包装中也加上 `matchedSkills: {}`：

```typescript
      plan = {
        complexity: uniqueRoles.size <= 1 ? 'simple' : 'complex',
        tasks,
        suggestedAgents: Object.fromEntries(tasks.map((t) => [t.id, t.role])),
        matchedSkills: {},
      };
```

- [ ] **Step 5: 验证编译通过**

Run: `cd packages/server && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 6: 验证现有 planner 测试仍通过**

Run: `cd packages/server && npx vitest run src/orchestrator/ --reporter=verbose 2>&1 | head -60`
Expected: 现有测试 PASS（matchedSkills 为可选，不应破坏现有测试）

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/orchestrator/nodes/planner.ts
git commit -m "feat(skills): inject skill list into Planner prompt and parse matchedSkills from LLM output"
```

---

### Task 7: Dispatcher 注入 skill prompt 到子任务 context

**Files:**
- Modify: `packages/server/src/orchestrator/nodes/dispatcher.ts`

**Interfaces:**
- Consumes: `SkillRegistry` from `@code-agent/core`
- Modifies: `createDispatcherNode()` 增加 `skillRegistry?` 参数
- Modifies: `buildContext()` 在 context 头部注入匹配的 skill prompt
- Modifies: `executeDirectTasks()` 传递 `plan.matchedSkills`
- Modifies: `executeBusTasks()` 传递 `plan.matchedSkills`

- [ ] **Step 1: 修改 import，增加 SkillRegistry**

在 `@code-agent/core` 的 import 中增加 `SkillRegistry`：

当前：
```typescript
import {
  ToolRegistry,
  WorkerAgent,
  type WorkerOutput,
  type PermissionRegistry,
  type IEventBus,
  type AgentRegistry,
  type AgentOutput,
} from '@code-agent/core';
```

修改为：
```typescript
import {
  ToolRegistry,
  WorkerAgent,
  type WorkerOutput,
  type PermissionRegistry,
  type IEventBus,
  type AgentRegistry,
  type AgentOutput,
  type SkillRegistry,
} from '@code-agent/core';
```

- [ ] **Step 2: 修改 DispatcherInput 接口，增加 plan.matchedSkills**

在 `DispatcherInput` 的 `plan` 字段中增加 matchedSkills：

```typescript
interface DispatcherInput {
  plan: { tasks: SubTask[]; complexity: string; matchedSkills?: Record<string, string[]> };
  pendingTasks: SubTask[];
  completedTasks: Record<string, WorkerOutput>;
}
```

- [ ] **Step 3: 修改 buildContext，增加 skill 注入逻辑**

在 `buildContext` 函数签名中增加 skillRegistry 和 matchedSkills 参数，在 context 头部注入 skill prompt：

```typescript
function buildContext(
  task: SubTask,
  completed: Record<string, WorkerOutput>,
  planMatchedSkills: Record<string, string[]> | undefined,
  skillRegistry: SkillRegistry | undefined,
): string {
  const parts: string[] = [];

  // 注入匹配的 skill prompt（放在 context 最前面）
  const taskSkills = planMatchedSkills?.[task.id];
  if (taskSkills && taskSkills.length > 0 && skillRegistry) {
    for (const skillName of taskSkills) {
      const skill = skillRegistry.get(skillName);
      if (skill && skill.prompt.length > 0) {
        parts.push(`[Skill "${skillName}"]:\n${skill.prompt}`);
      }
    }
  }

  // 注入依赖任务的结果
  if (task.dependsOn?.length) {
    for (const depId of task.dependsOn) {
      const dep = completed[depId];
      if (dep) {
        parts.push(
          `[前置任务 "${depId}" 的结果]：${dep.result ?? dep.error ?? 'No output'}`,
        );
      }
    }
  }

  return parts.join('\n\n');
}
```

- [ ] **Step 4: 修改 createDispatcherNode 签名，增加 skillRegistry 参数**

```typescript
export function createDispatcherNode(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permissionRegistry?: PermissionRegistry,
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>,
  eventBus?: IEventBus,
  agentRegistry?: AgentRegistry,
  skillRegistry?: SkillRegistry,
) {
```

- [ ] **Step 5: 修改 dispatcherNode 内部，传递 plan.matchedSkills 和 skillRegistry**

在 `dispatcherNode` 函数体中，将 `plan.matchedSkills` 传递给 `executeDirectTasks` 和 `executeBusTasks`：

在调用 `executeDirectTasks` 处，增加两个参数：
```typescript
      const directResults = await executeDirectTasks(
        allDirectTasks,
        completedTasks,
        model,
        toolRegistry,
        workspacePath,
        permissionRegistry,
        onConfirmRequired,
        agentRegistry,
        state.plan.matchedSkills,
        skillRegistry,
      );
```

同样修改 `executeBusTasks` 的调用：
```typescript
      const busResults = await executeBusTasks(
        busTasks,
        completedTasks,
        eventBus,
        state.plan.matchedSkills,
        skillRegistry,
      );
```

- [ ] **Step 6: 修改 executeDirectTasks 和 executeBusTasks 签名**

`executeDirectTasks` 增加 `planMatchedSkills` 和 `skillRegistry` 参数：
```typescript
async function executeDirectTasks(
  tasks: SubTask[],
  completed: Record<string, WorkerOutput>,
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permissionRegistry?: PermissionRegistry,
  onConfirmRequired?: (...),
  agentRegistry?: AgentRegistry,
  planMatchedSkills?: Record<string, string[]>,
  skillRegistry?: SkillRegistry,
): Promise<WorkerOutput[]> {
```
内部调用 `buildContext` 时传递新参数：
```typescript
const context = buildContext(task, completed, planMatchedSkills, skillRegistry);
```

`executeBusTasks` 同样增加参数（仅传递给 `buildContext`）：
```typescript
async function executeBusTasks(
  tasks: SubTask[],
  completed: Record<string, WorkerOutput>,
  eventBus?: IEventBus,
  planMatchedSkills?: Record<string, string[]>,
  skillRegistry?: SkillRegistry,
): Promise<WorkerOutput[]> {
```
内部调用 `buildContext` 时传递：
```typescript
const context = buildContext(task, completed, planMatchedSkills, skillRegistry);
```

- [ ] **Step 7: 验证编译通过**

Run: `cd packages/server && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/orchestrator/nodes/dispatcher.ts
git commit -m "feat(skills): inject matched skill prompts into subtask context in Dispatcher"
```

---

### Task 8: Graph 线程传递 skillRegistry

**Files:**
- Modify: `packages/server/src/orchestrator/graph.ts`

**Interfaces:**
- Consumes: `SkillRegistry` from `@code-agent/core`
- Modifies: `OrchestratorGraphOptions` 增加 `skillRegistry?`
- Modifies: `createOrchestratorGraph` 将 skillRegistry 传递给 Planner 和 Dispatcher

- [ ] **Step 1: 修改 import**

在 `@code-agent/core` 的 import 中增加 `SkillRegistry`：

```typescript
import {
  ToolRegistry,
  type PermissionRegistry,
  type IEventBus,
  type AgentRegistry,
  type SkillRegistry,
} from '@code-agent/core';
```

- [ ] **Step 2: 修改 OrchestratorGraphOptions**

在 `agentRegistry` 之后增加：

```typescript
  /** Skill 注册表（可选，提供 skill 匹配和注入能力） */
  skillRegistry?: SkillRegistry;
```

- [ ] **Step 3: 修改 createOrchestratorGraph 传递 skillRegistry**

在 options 解构中增加 `skillRegistry`：
```typescript
  const {
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    eventBus,
    agentRegistry,
    skillRegistry,
  } = options;
```

修改节点的创建调用：

```typescript
  const plannerNode = createPlannerNode(model, toolRegistry, agentRegistry, skillRegistry);
  const dispatcherNode = createDispatcherNode(
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    eventBus,
    agentRegistry,
    skillRegistry,
  );
```

- [ ] **Step 4: 验证编译通过**

Run: `cd packages/server && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/orchestrator/graph.ts
git commit -m "feat(skills): thread SkillRegistry through graph to Planner and Dispatcher"
```

---

### Task 9: 端到端验证

**Files:**
- 无新文件，验证整体链路

- [ ] **Step 1: 创建测试 skill 文件**

```bash
mkdir -p /tmp/test-skills
cat > /tmp/test-skills/react.md << 'EOF'
---
name: react-best-practices
description: React hooks and component patterns
---

Always use functional components with hooks. Prefer composition over inheritance.
EOF
```

- [ ] **Step 2: 运行 core 包全部测试**

Run: `cd packages/core && npx vitest run`
Expected: 所有已有测试 + 新增 SkillRegistry 测试全部 PASS

- [ ] **Step 3: 运行 server 包全部测试**

Run: `cd packages/server && npx vitest run`
Expected: 所有已有测试 PASS（skillRegistry 可选，不应破坏现有测试）

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `cd packages/core && npx tsc --noEmit && cd ../server && npx tsc --noEmit`
Expected: 两个包都无类型错误

- [ ] **Step 5: Commit 验证结果**

```bash
git add -A
git commit -m "chore: end-to-end verification after skill support implementation"
```
