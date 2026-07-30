/**
 * Terminal output formatting utilities
 *
 * Uses ANSI escape codes for colored output. Zero external dependencies.
 * Compatible with most modern terminals.
 */

// ─── ANSI Escape Codes ─────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const FG = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

// ─── Public API ────────────────────────────────────

/** Wrap text in green (streaming LLM output) */
export function green(text: string): string {
  return `${FG.green}${text}${RESET}`;
}

/** Wrap text in yellow (tool calls, warnings) */
export function yellow(text: string): string {
  return `${FG.yellow}${text}${RESET}`;
}

/** Wrap text in red (errors) */
export function red(text: string): string {
  return `${FG.red}${text}${RESET}`;
}

/** Wrap text in cyan (headings, info) */
export function cyan(text: string): string {
  return `${FG.cyan}${text}${RESET}`;
}

/** Wrap text in dim (secondary info, tool results) */
export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

/** Wrap text in bold */
export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

// ─── Composite Helpers ─────────────────────────────

/** Tool start indicator: 🛠 tool_name(args) */
export function formatToolStart(tool: string, args: Record<string, unknown>): string {
  const argsPreview = JSON.stringify(args).slice(0, 100);
  return yellow(`🛠  ${tool}(${argsPreview})`);
}

/** Tool result indicator */
export function formatToolEnd(result: string): string {
  return dim(`   → ${result.slice(0, 200)}`);
}

/** Error message */
export function formatError(message: string): string {
  return red(`✖ ${message}`);
}

/** Success / done indicator */
export function formatDone(): string {
  return green("✓ Done");
}

/** Prompt string */
export function formatPrompt(): string {
  return bold(green("my-agent > "));
}

/** Section heading */
export function heading(text: string): string {
  return cyan(`\n── ${text} ──`);
}
