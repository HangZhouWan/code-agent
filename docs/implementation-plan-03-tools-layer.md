# 实现计划 03：工具层实现

**对应技术文档**：[2026-07-02-technical-implementation.md](./2026-07-02-technical-implementation.md) 第五节

**预计工时**：3 天（与 LLM 抽象层可并行开发，第 1-2 周）

**前置模块**：[01-Monorepo 与基础设施](./implementation-plan-01-monorepo.md)

---

## 1. 目标

构建可注册、可组合的工具系统，将每个工具封装为 `ToolDefinition`，通过 `ToolRegistry` 统一管理，并适配为 LangChain 的 `StructuredTool` 供 Agent 调用。

## 2. 设计要点

- **Zod schema 驱动**：每个工具用 Zod 定义输入 schema，自动获得类型推断和运行时校验
- **权限标签**：每个工具声明 `permission: 'safe' | 'confirm'`，供后续 SandboxGuard 使用
- **工作区隔离**：文件/Shell 操作限定在 `workspacePath` 内，防止路径穿越
- **工具上下文**：通过 `ToolContext` 注入 `workspacePath` 和 `sessionId`

## 3. 产出物清单

```
packages/core/src/tools/
├── base.ts          # ToolDefinition 接口 + ToolContext + createLangChainTool()
├── registry.ts      # ToolRegistry 类
├── file.ts          # file.read / file.write / file.list
├── shell.ts         # shell.exec（白名单 + 超时）
├── search.ts        # code_search（grep 封装）
├── git.ts           # git.status / git.diff / git.log / git.commit / git.branch
└── web.ts           # web.fetch（GET + 长度截断）
```

## 4. 依赖

```json
{
  "@langchain/core": "^0.3",
  "zod": "^3",
  "simple-git": "^3"
}
```

---

## 5. 实现步骤

### 步骤 5.1：工具基础接口 (`base.ts`)

定义核心抽象：

```typescript
export interface ToolContext {
  workspacePath: string;
  sessionId: string;
}

export interface ToolDefinition<T extends z.ZodObject<any> = any> {
  name: string;           // 工具唯一名称，如 "file.read"
  description: string;    // 给 LLM 看的描述
  schema: T;              // Zod schema，定义输入参数
  permission: PermissionLevel;  // 'safe' | 'confirm'
  execute(args: z.infer<T>, ctx: ToolContext): Promise<string>;
}
```

**`createLangChainTool()` 函数**：
- 输入：`ToolDefinition` + `ToolContext`
- 输出：`DynamicStructuredTool`（LangChain StructuredTool 实例）
- 作用：将内部 ToolDefinition 适配为 LangChain 工具

**实现注意**：
- `schema` 字段传给 `DynamicStructuredTool` 的 `schema` 参数
- `execute` 包装为 `func` 回调

### 步骤 5.2：工具注册表 (`registry.ts`)

```typescript
export class ToolRegistry {
  register(def: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  getToolsForAgent(capability: AgentCapability, ctx: ToolContext): StructuredTool[];
  listAll(): ToolDefinition[];
  static createDefault(): ToolRegistry;
}
```

关键方法：
- `register()`：存储 `ToolDefinition`
- `getToolsForAgent()`：根据 `AgentCapability.tools` 过滤 + 转换为 LangChain 工具
- `createDefault()`：返回空注册表（工具在入口文件中注册）

### 步骤 5.3：文件工具 (`file.ts`)

三个工具：

| 工具名 | 权限 | 功能 |
|--------|------|------|
| `file.read` | safe | 读取文件内容（UTF-8） |
| `file.write` | confirm | 写入文件，自动创建父目录 |
| `file.list` | safe | 列出目录内容（带图标） |

**路径安全**：
```typescript
function resolvePath(relativePath: string, ctx: ToolContext): string {
  const resolved = path.resolve(ctx.workspacePath, relativePath);
  if (!resolved.startsWith(ctx.workspacePath)) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  return resolved;
}
```

所有文件工具必须通过 `resolvePath()` 解析路径，防止 `../../../etc/passwd` 路径穿越。

### 步骤 5.4：Shell 工具 (`shell.ts`)

**工具名**：`shell.exec`，权限 `confirm`

**安全机制（双层）**：
1. **命令白名单**：仅允许预定义的命令集合
   ```typescript
   const ALLOWED_COMMANDS = new Set([
     "ls", "cat", "head", "tail", "wc", "find", "grep", "echo",
     "mkdir", "touch", "cp", "mv", "git", "npm", "npx", "pnpm",
     "node", "tsx", "which", "pwd", "whoami", "uname", "env",
   ]);
   ```
2. **Layer 2（在 SandboxGuard 中）**：高危命令模式检测（`rm -rf /`、`sudo`、`curl | bash` 等）

**超时与缓冲**：
- 执行超时：30 秒
- 输出缓冲：最大 10MB

### 步骤 5.5：代码搜索工具 (`search.ts`)

**工具名**：`code_search`，权限 `safe`

直接用 `grep -rn` 封装：
- 支持正则 pattern
- 可选文件类型过滤 (`--include`)
- 最大结果数：`-m` 参数控制（默认 20）
- grep 的 exit code 1（无匹配）视为正常，返回 "No matches found."

### 步骤 5.6：Git 工具 (`git.ts`)

使用 `simple-git` 库封装，统一用 `ctx.workspacePath` 作为 git 工作目录：

| 工具名 | 权限 | 功能 |
|--------|------|------|
| `git.status` | safe | 工作区状态（JSON 格式） |
| `git.diff` | safe | 差异对比（可选 --staged） |
| `git.log` | safe | 提交日志（默认 20 条） |
| `git.commit` | confirm | 创建提交 |
| `git.branch` | confirm | 列出/创建分支 |

实现要点：
- `git.status` 返回 JSON 字符串便于 LLM 解析
- `git.commit` 仅支持 `message` 参数（简化版）
- `git.branch` 同时支持 list 和 create 模式

### 步骤 5.7：Web 工具 (`web.ts`)

**工具名**：`web.fetch`，权限 `safe`

实现要点：
- 仅 GET 请求
- User-Agent: `MyAgent/1.0`
- 超时：15 秒
- 仅处理 `text/*` 和 `application/json` 内容类型
- 超过 `maxLength`（默认 50000 字符）自动截断并标注

### 步骤 5.8：统一导出

在 `packages/core/src/index.ts` 中导出工具层：
```typescript
export { ToolRegistry, type ToolDefinition, type ToolContext, createLangChainTool } from './tools/base.js';
export {
  fileReadTool, fileWriteTool, fileListTool,
  shellExecTool, codeSearchTool,
  gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool, gitBranchTool,
  webFetchTool,
} from './tools/index.js';
```

---

## 6. 验证方式

```typescript
import { ToolRegistry, fileReadTool, codeSearchTool } from '@my-agent/core';

const registry = ToolRegistry.createDefault();
registry.register(fileReadTool);
registry.register(codeSearchTool);

const tools = registry.getToolsForAgent(
  { tools: ['file.read', 'code_search'], paths: ['./workspace'] },
  { workspacePath: './workspace', sessionId: 'test' }
);

const result = await tools[0].invoke({ path: 'README.md' });
console.log(result);
```

## 7. 验收标准

- [ ] 6 类 12 个工具全部注册成功
- [ ] `file.read/write/list` 路径穿越防护生效
- [ ] `shell.exec` 白名单过滤非允许命令
- [ ] `code_search` grep 退出码 1 时返回 "No matches found"
- [ ] `git.*` 系列工具在非 git 目录下给出有意义的错误信息
- [ ] `web.fetch` 超时和二进制约束生效
- [ ] 所有工具的 Zod schema 校验正确，输入无效类型时抛出 ZodError
- [ ] `getToolsForAgent` 根据 capability 正确过滤工具
