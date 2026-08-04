/**
 * CLI 参数解析器
 *
 * 支持 Claude Code 式的调用方式：
 *   code-agent                          # 以当前目录为工作区，启动 REPL
 *   code-agent /path/to/project         # 以指定目录为工作区，启动 REPL
 *   code-agent "帮我分析这个项目"         # 非交互模式：执行单次查询后退出
 *   code-agent -p "分析项目"             # --print 模式：输出后退出
 *   code-agent --model gpt-4o           # 指定模型
 *   code-agent --resume <task-id>       # 恢复一个 checkpoint
 *   code-agent --version                # 显示版本
 *   code-agent --help                   # 帮助信息
 */

import { resolve } from "node:path";

// ─── Types ────────────────────────────────────────

export interface CliArgs {
  /** 工作区路径（解析后的绝对路径） */
  workspacePath: string;
  /** 非交互模式的输入文本，undefined 表示进入 REPL */
  query: string | undefined;
  /** 是否为 --print 模式 */
  printMode: boolean;
  /** 模型覆盖（--model） */
  model: string | undefined;
  /** 恢复 checkpoint 的任务 ID */
  resumeTaskId: string | undefined;
  /** 是否显示帮助信息 */
  showHelp: boolean;
  /** 是否显示版本号 */
  showVersion: boolean;
}

// ─── Help Text ────────────────────────────────────

const HELP_TEXT = `
code-agent — AI-powered coding agent for your terminal

Usage:
  code-agent [options] [workspace-path] [query]

Modes:
  code-agent                              Start interactive REPL in current directory
  code-agent /path/to/project             Start REPL with specified workspace
  code-agent "帮我分析这个项目"             Run a single query and exit
  code-agent -p "分析项目"                  Print-only mode, output result and exit

Options:
  -p, --print               Print-only mode (implied when query is provided)
  -m, --model <model>       Override the LLM model (e.g. gpt-4o, claude-opus-4-8)
  --resume <task-id>        Resume a previously interrupted task from checkpoint
  -v, --version             Show version number
  -h, --help                Show this help message

Examples:
  code-agent                                      # Interactive REPL
  code-agent ~/projects/my-app                    # REPL in specific directory
  code-agent "What does this project do?"         # Single query
  code-agent -p "List all TypeScript files"       # Print-only
  code-agent --model claude-opus-4-8              # REPL with specific model
  code-agent --resume task_abc123                 # Resume task

Environment:
  LLM_PROVIDER              LLM provider: openai | anthropic | openai-compatible
  LLM_MODEL                 Model name (default: gpt-4o)
  LLM_API_KEY               API key (required)
  LLM_BASE_URL              Custom API endpoint (optional)

Config Files:
  ~/.code-agent/config.json           Global config
  $WORKSPACE/.code-agent/config.json  Project-level config (overrides global)

Workspace:
		Runtime data (checkpoints, memory) is stored under ~/.code-agent/projects/
		scoped by workspace path. Project config lives in $WORKSPACE/.code-agent/.
`;

// ─── Parsing Logic ───────────────────────────────

/**
 * Parse CLI arguments into a structured CliArgs object.
 *
 * Parsing strategy:
 * 1. Scan for flags (--help, --version, --model, --resume, -p)
 * 2. First non-flag, non-option-value argument → could be workspacePath or query
 *    - If it looks like a path (starts with /, ./, ../, ~/) → workspacePath
 *    - Otherwise → query
 * 3. Remaining non-flag argument → query (if not already set)
 * 4. If no workspacePath specified → use process.cwd()
 */
export function parseArgs(argv: string[]): CliArgs {
  const raw = argv.slice(2); // skip node and script path

  let workspacePath: string | undefined;
  let query: string | undefined;
  let printMode = false;
  let model: string | undefined;
  let resumeTaskId: string | undefined;
  let showHelp = false;
  let showVersion = false;

  let i = 0;
  while (i < raw.length) {
    const arg = raw[i];

    switch (arg) {
      case "-h":
      case "--help":
        showHelp = true;
        break;

      case "-v":
      case "--version":
        showVersion = true;
        break;

      case "-p":
      case "--print":
        printMode = true;
        break;

      case "-m":
      case "--model":
        i++;
        if (i < raw.length) {
          model = raw[i];
        }
        break;

      case "--resume":
        i++;
        if (i < raw.length) {
          resumeTaskId = raw[i];
        }
        break;

      default: {
        // Positional argument — determine if path or query
        if (arg.startsWith("-")) {
          // Unknown flag — ignore (could warn, but be lenient)
          break;
        }

        if (workspacePath === undefined && looksLikePath(arg)) {
          workspacePath = arg;
        } else if (query === undefined) {
          query = arg;
        }
        // If both workspacePath and query are set, ignore extra args
        break;
      }
    }

    i++;
  }

  // Resolve workspace: specified path → otherwise cwd
  const resolvedWorkspace = resolve(workspacePath ?? process.cwd());

  // If a query is provided without -p, auto-enable printMode for non-interactive
  if (query && !printMode) {
    printMode = true;
  }

  return {
    workspacePath: resolvedWorkspace,
    query: query ?? undefined,
    printMode,
    model: model ?? undefined,
    resumeTaskId: resumeTaskId ?? undefined,
    showHelp,
    showVersion,
  };
}

// ─── Helpers ──────────────────────────────────────

/** Check if a string looks like a file/directory path */
function looksLikePath(arg: string): boolean {
  return (
    arg.startsWith("/") ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.startsWith("~/") ||
    arg === "."
  );
}

/**
 * Print help text to stdout and exit.
 */
export function printHelp(): void {
  process.stdout.write(HELP_TEXT.trimStart());
}

/**
 * Print version to stdout.
 */
export function printVersion(version: string): void {
  process.stdout.write(`code-agent v${version}\n`);
}
