/**
 * Planner / Replanner 输出 schema 与解析
 */

import { z } from "zod";

export const plannerTaskSchema = z.object({
  id: z.string().min(1).optional(),
  role: z.string().min(1),
  description: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  routing: z.enum(["direct", "bus"]).default("direct"),
});

export const plannerPlanSchema = z.object({
  complexity: z.enum(["simple", "complex"]).default("simple"),
  tasks: z.array(plannerTaskSchema).min(1).max(5),
});

export type PlannerPlan = z.infer<typeof plannerPlanSchema>;
export type PlannerTask = z.infer<typeof plannerTaskSchema>;

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return source.slice(start, end + 1);
}

export function parsePlannerPlan(text: string): PlannerPlan | null {
  const json = extractJson(text);
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const result = plannerPlanSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function plannerPrompt(roleIds: string[]): string {
  return [
    "You are the Planner for a multi-agent coding assistant.",
    "Break the user request into 1-5 subtasks. Return JSON only, no prose.",
    "Schema:",
    '{"complexity":"simple"|"complex","tasks":[{"id":"t1","role":"code|test|doc|review","description":"...","dependsOn":["t1"],"routing":"direct"|"bus"}]}',
    `Available roles: ${roleIds.join(", ")}.`,
    "Every task must have a unique id. dependsOn must reference those ids (never role names).",
    "Use direct routing unless the task genuinely benefits from event-bus collaboration.",
    "Keep tasks independent when possible; use dependsOn only for real ordering.",
    "For a single self-contained deliverable (e.g. generate one HTML file), set complexity=simple and return exactly one code task; do not add test/review tasks unless the user explicitly asks for verification.",
  ].join("\n");
}
