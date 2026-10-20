/**
 * Finalizer 节点
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { extractText, type ChatModelLike } from "@code-agent/core";
import type { OrchestratorStateValue } from "../state.js";

export interface FinalizerNodeDeps {
  model: ChatModelLike;
  signal?: AbortSignal;
}

export function createFinalizerNode(deps: FinalizerNodeDeps) {
  return async (state: OrchestratorStateValue) => {
    if (state.results.length === 0) {
      return {
        finalResponse: "No tasks were executed.",
        nextAction: "finalize" as const,
      };
    }

    const summaries = state.results
      .map((result) => {
        const files = result.artifacts?.filesChanged
          ?.map((file) => file.path)
          .join(", ");
        return (
          `- [${result.role}] ${result.status}: ${result.summary}` +
          (files ? ` (files: ${files})` : "")
        );
      })
      .join("\n");

    let finalResponse: string | undefined;
    try {
      const response = await deps.model.invoke(
        [
          new SystemMessage({
            content:
              "You are the Finalizer. Summarize the completed work for the user in Chinese. " +
              "Be concise and include failures or risks. " +
              "If a task lists written files, do not claim the artifact is missing.",
          }),
          new HumanMessage({
            content: `User request: ${state.userMessage}\n\nTask results:\n${summaries}`,
          }),
        ],
        deps.signal ? { signal: deps.signal } : {},
      );
      finalResponse = extractText(response).trim() || undefined;
    } catch {
      finalResponse = undefined;
    }

    return {
      finalResponse: finalResponse ?? summaries,
      nextAction: "finalize" as const,
    };
  };
}
