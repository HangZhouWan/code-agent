/**
 * LLM Provider 注册表
 *
 * 新增 provider 只需在这里添加定义，并在 core 的 factory 注册创建函数。
 */

export const PROVIDER_IDS = ["openai", "anthropic", "openai-compatible"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  /** 默认上下文窗口（tokens），可在模型级覆盖 */
  modelWindow: number;
  supportsToolCalling: boolean;
}

export const PROVIDER_DEFINITIONS: Record<ProviderId, ProviderDefinition> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o",
    requiresApiKey: true,
    modelWindow: 128_000,
    supportsToolCalling: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    requiresApiKey: true,
    modelWindow: 200_000,
    supportsToolCalling: true,
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI 兼容 (Ollama / LM Studio)",
    defaultModel: "llama3",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    modelWindow: 32_768,
    supportsToolCalling: true,
  },
};

export const DEFAULT_PROVIDER_ID: ProviderId = "openai";

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function getProviderDefinition(id: ProviderId): ProviderDefinition {
  return PROVIDER_DEFINITIONS[id];
}

export function getDefaultModel(id: ProviderId): string {
  return PROVIDER_DEFINITIONS[id].defaultModel;
}

export function getDefaultModelWindow(id: ProviderId): number {
  return PROVIDER_DEFINITIONS[id].modelWindow;
}
