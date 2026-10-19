/**
 * 不支持原生 tool calling 的 provider 的 JSON fallback 解析器
 *
 * 解析失败或字段非法时返回 replan，避免把错误输出误判为成功。
 */

export type FallbackDecision = "use_tool" | "done" | "replan";

export interface FallbackThought {
  decision: FallbackDecision;
  toolCall?: { name: string; args: Record<string, unknown> };
  summary?: string;
  reason?: string;
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return source.slice(start, end + 1);
}

export function parseFallbackThought(text: string): FallbackThought {
  const json = extractJson(text);
  if (!json) {
    return {
      decision: "replan",
      summary: text.slice(0, 500),
      reason: "Model did not return valid JSON",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      decision: "replan",
      summary: text.slice(0, 500),
      reason: "Model returned invalid JSON",
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { decision: "replan", reason: "Model output is not an object" };
  }

  const candidate = parsed as {
    decision?: unknown;
    toolCall?: {
      name?: unknown;
      args?: unknown;
    };
    summary?: unknown;
    reason?: unknown;
  };

  if (
    candidate.decision !== "use_tool" &&
    candidate.decision !== "done" &&
    candidate.decision !== "replan"
  ) {
    return {
      decision: "replan",
      ...(typeof candidate.summary === "string"
        ? { summary: candidate.summary }
        : {}),
      reason: "Missing or invalid decision",
    };
  }

  const thought: FallbackThought = { decision: candidate.decision };
  if (typeof candidate.summary === "string") thought.summary = candidate.summary;
  if (typeof candidate.reason === "string") thought.reason = candidate.reason;

  if (candidate.decision === "use_tool") {
    const name = candidate.toolCall?.name;
    const args = candidate.toolCall?.args;
    if (typeof name !== "string" || name.length === 0) {
      return {
        decision: "replan",
        reason: "use_tool requires toolCall.name",
      };
    }
    thought.toolCall = {
      name,
      args:
        typeof args === "object" && args !== null
          ? (args as Record<string, unknown>)
          : {},
    };
  }

  return thought;
}
