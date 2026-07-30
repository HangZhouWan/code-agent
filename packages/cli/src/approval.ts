/**
 * Interactive tool approval via stdin
 *
 * Provides the `onConfirmRequired` callback consumed by the Orchestrator Graph.
 * When a tool requires user confirmation, this prompts in the terminal and
 * returns true/false based on user input.
 */

import * as readline from "node:readline";
import { yellow, red } from "./format.js";

// ─── Public Factory ────────────────────────────────

/**
 * Create an interactive approval callback for the Orchestrator.
 *
 * Uses a single readline interface shared across all approvals.
 *
 * @param rl - shared readline instance (from REPL)
 * @returns callback compatible with createOrchestratorGraph's onConfirmRequired
 */
export function createApprovalHandler(
  rl: readline.Interface,
): (toolName: string, args: Record<string, unknown>) => Promise<boolean> {
  return (toolName: string, args: Record<string, unknown>): Promise<boolean> => {
    return promptApproval(rl, toolName, args);
  };
}

// ─── Implementation ────────────────────────────────

const APPROVAL_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Prompt the user for tool confirmation via stdin.
 *
 * Displays the tool name and arguments, waits for y/N response.
 * Times out after 2 minutes, defaulting to denied.
 */
function promptApproval(
  rl: readline.Interface,
  toolName: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const argsPreview = JSON.stringify(args).slice(0, 200);

  const question = [
    yellow(`🛠  ${toolName}(${argsPreview})`),
    red("⚠  This tool requires confirmation."),
    `Approve? [y/N]: `,
  ].join("\n");

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      process.stdout.write("\n");
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);

    rl.question(question, (answer) => {
      clearTimeout(timeout);
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}
