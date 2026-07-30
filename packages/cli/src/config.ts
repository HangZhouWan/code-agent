/**
 * Environment variable config loading with Zod validation
 *
 * Mirrors @my-agent/server's config.ts. Duplicated here to avoid
 * importing from @my-agent/server (which triggers its main() side effect).
 */

import { z } from "zod";

// ─── Schema ────────────────────────────────────────

const envSchema = z.object({
  /** LLM provider: openai / anthropic / openai-compatible */
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]).default("openai"),

  /** Model name, e.g. gpt-4o / claude-opus-4-8 */
  LLM_MODEL: z.string().default("gpt-4o"),

  /** API key (required) */
  LLM_API_KEY: z.string(),

  /** Custom API endpoint (optional) */
  LLM_BASE_URL: z.string().optional(),

  /** Max retries, default 3 */
  LLM_MAX_RETRIES: z.coerce.number().default(3),

  /** Workspace root path */
  WORKSPACE_PATH: z.string().default("./workspace"),
});

// ─── Type ──────────────────────────────────────────

export type EnvConfig = z.infer<typeof envSchema>;

// ─── Load Function ─────────────────────────────────

/**
 * Load and validate environment variables.
 *
 * Reads from process.env, validates with Zod.
 * Throws ZodError if required fields are missing or invalid.
 */
export function loadConfig(): EnvConfig {
  return envSchema.parse(process.env);
}
