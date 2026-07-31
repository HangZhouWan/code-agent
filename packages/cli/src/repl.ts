/**
 * REPL loop — readline-based interactive session
 *
 * Core loop that:
 * - Reads user input via readline
 * - Dispatches /commands or processes chat messages
 * - Streams Orchestrator Graph events to stdout
 * - Accumulates message history across turns
 */

import * as readline from "node:readline";
import { HumanMessage, AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ToolRegistry, AgentRegistry, PermissionRegistry } from "@code-agent/core";
import { createOrchestratorGraph } from "@code-agent/server";
import { createApprovalHandler } from "./approval.js";
import {
  green,
  yellow,
  red,
  cyan,
  dim,
  formatToolStart,
  formatToolEnd,
  formatError,
  formatDone,
  formatPrompt,
  heading,
} from "./format.js";

// ─── Types ─────────────────────────────────────────

export interface ReplOptions {
  model: BaseChatModel;
  toolRegistry: ToolRegistry;
  workspacePath: string;
  permissionRegistry?: PermissionRegistry;
  agentRegistry: AgentRegistry;
}

// ─── Event stream helpers ──────────────────────────

/** Extract text delta from AIMessageChunk (same logic as server ws/chat.ts) */
function extractDelta(chunk: AIMessageChunk): string {
  const content = chunk.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text",
      )
      .map((block) => block.text)
      .join("");
  }
  return "";
}

/** Safe JSON stringify */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── Orchestrator Stream Adapter ───────────────────

/**
 * Run the Orchestrator Graph and stream events to stdout.
 *
 * A stripped-down version of server's streamOrchestrator — writes to
 * process.stdout instead of WebSocket.
 *
 * @returns the final assistant response text
 */
async function streamOrchestrator(
  messages: BaseMessage[],
  options: ReplOptions,
  rl: readline.Interface,
): Promise<string> {
  const { model, toolRegistry, workspacePath, permissionRegistry, agentRegistry } = options;

  const onConfirmRequired = createApprovalHandler(rl);

  const graph = createOrchestratorGraph({
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    agentRegistry,
  });

  let finalResponse = "";

  try {
    const stream = graph.streamEvents(
      { messages },
      { version: "v2" },
    );

    for await (const event of stream) {
      switch (event.event) {
        // ── LLM streaming output ──
        case "on_chat_model_stream": {
          const chunk = event.data?.chunk;
          if (chunk instanceof AIMessageChunk) {
            const delta = extractDelta(chunk);
            if (delta) {
              process.stdout.write(green(delta));
            }
          }
          break;
        }

        // ── Tool call start ──
        case "on_tool_start": {
          const toolName = event.name || "unknown";
          const input = (event.data?.input ?? {}) as Record<string, unknown>;
          process.stdout.write(`\n${formatToolStart(toolName, input)}\n`);
          break;
        }

        // ── Tool call end ──
        case "on_tool_end": {
          const output = safeJsonStringify(event.data?.output);
          process.stdout.write(`${formatToolEnd(output)}\n`);
          break;
        }

        // ── Node complete ──
        case "on_chain_end": {
          if (event.name === "finalizer") {
            const output = event.data?.output as Record<string, unknown> | undefined;
            finalResponse =
              (output?.finalResponse as string) ?? "No response generated.";
            process.stdout.write(`\n${formatDone()}\n\n`);
          }
          break;
        }
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    process.stdout.write(`\n${formatError(message)}\n`);
  }

  return finalResponse;
}

// ─── Command Handlers ──────────────────────────────

/** Print available commands */
function cmdHelp(): void {
  process.stdout.write(`${heading("Available Commands")}
  ${cyan("/clear")}      ${dim("Reset conversation context")}
  ${cyan("/history")}    ${dim("Show message history summary")}
  ${cyan("/agents")}     ${dim("Show agent status")}
  ${cyan("/tools")}      ${dim("List registered tools")}
  ${cyan("/help")}       ${dim("Show this help message")}
  ${cyan("/exit")}       ${dim("Exit the REPL")}

  ${dim("Ctrl+C to cancel a running task; Ctrl+C on empty prompt to exit.")}
`);
}

/** Print message history summary */
function cmdHistory(messages: BaseMessage[]): void {
  if (messages.length === 0) {
    process.stdout.write(`${dim("No messages in current session.")}\n`);
    return;
  }

  process.stdout.write(heading("Message History"));
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.getType?.() ?? "unknown";
    const content =
      typeof msg.content === "string"
        ? msg.content.slice(0, 100).replace(/\n/g, " ")
        : JSON.stringify(msg.content).slice(0, 100);
    const icon = role === "human" ? "👤" : "🤖";
    process.stdout.write(`  ${icon} ${dim(`[${i + 1}]`)} ${content}${content.length >= 100 ? "..." : ""}\n`);
  }
  process.stdout.write("\n");
}

/** Print agent status table */
function cmdAgents(agentRegistry: AgentRegistry): void {
  const agents = agentRegistry.getAllAgents();

  if (agents.length === 0) {
    process.stdout.write(`${dim("No agents registered.")}\n`);
    return;
  }

  process.stdout.write(heading("Agent Status"));
  process.stdout.write(`  ${dim("role".padEnd(10))} ${dim("id".padEnd(30))} ${dim("status")}\n`);
  process.stdout.write(`  ${"─".repeat(60)}\n`);

  for (const agent of agents) {
    const role = agent.role.id.padEnd(10);
    const id = agent.id.padEnd(30);
    const status = agent.role.id === "code" ? green("active") : "active";
    process.stdout.write(`  ${role} ${dim(id)} ${status}\n`);
  }
  process.stdout.write("\n");
}

/** List registered tools */
function cmdTools(toolRegistry: ToolRegistry): void {
  const tools = toolRegistry.listAll();

  if (tools.length === 0) {
    process.stdout.write(`${dim("No tools registered.")}\n`);
    return;
  }

  process.stdout.write(heading("Available Tools"));
  for (const tool of tools) {
    process.stdout.write(`  ${cyan(tool.name.padEnd(20))} ${dim(tool.description.slice(0, 60))}\n`);
  }
  process.stdout.write("\n");
}

// ─── REPL Start ────────────────────────────────────

/**
 * Start the interactive REPL session.
 *
 * Initializes readline, sets up command dispatch, and runs the
 * message processing loop with streaming orchestrator output.
 *
 * Gracefully handles SIGINT (Ctrl+C):
 * - During a running task → cancels the task
 * - On empty prompt → exits the REPL
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: formatPrompt(),
  });

  // Accumulated conversation history
  const messages: BaseMessage[] = [];

  // Track whether a task is currently running (for SIGINT handling)
  let running = false;

  process.stdout.write(cyan("\n  code-agent CLI REPL"));
  process.stdout.write(dim(`\n  Type /help for commands, or just start chatting.\n\n`));

  rl.prompt();

  // ── Line handler ──
  rl.on("line", async (line: string) => {
    const input = line.trim();

    // Empty input → just re-prompt
    if (!input) {
      rl.prompt();
      return;
    }

    // ── Commands ──
    if (input.startsWith("/")) {
      switch (input) {
        case "/help":
          cmdHelp();
          break;
        case "/history":
          cmdHistory(messages);
          break;
        case "/clear":
          messages.length = 0;
          process.stdout.write(`${green("✓")} ${dim("Conversation context cleared.")}\n`);
          break;
        case "/agents":
          cmdAgents(options.agentRegistry);
          break;
        case "/tools":
          cmdTools(options.toolRegistry);
          break;
        case "/exit":
          process.stdout.write(`${dim("Goodbye!")}\n`);
          rl.close();
          return;
        default:
          process.stdout.write(
            `${formatError(`Unknown command: "${input}". Type /help for available commands.`)}\n`,
          );
      }
      rl.prompt();
      return;
    }

    // ── Chat message ──
    running = true;
    messages.push(new HumanMessage(input));

    const finalResponse = await streamOrchestrator(messages, options, rl);

    if (finalResponse) {
      // Stream output already displayed; also add to history
      messages.push(new HumanMessage(`[assistant] ${finalResponse}`));
    }

    running = false;
    rl.prompt();
  });

  // ── SIGINT handler (Ctrl+C) ──
  rl.on("SIGINT", () => {
    if (running) {
      // Task is running — cancel it
      process.stdout.write(`\n${yellow("⚠  Task cancelled.")}\n`);
      running = false;
      // Clear the current line and re-prompt
      rl.prompt();
    } else {
      // No task running — confirm exit
      process.stdout.write(`\n${dim("Goodbye!")}\n`);
      rl.close();
    }
  });

  // ── Close handler ──
  rl.on("close", () => {
    process.stdout.write(`\n${dim("Session ended.")}\n`);
    process.exit(0);
  });
}
