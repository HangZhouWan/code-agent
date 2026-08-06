/**
 * SetupPage —— 首次配置引导页面
 *
 * 当服务端未配置 LLM 模型时展示，提供 Provider、模型、
 * API Key 和自定义端点的表单，提交后保存到 ~/.code-agent/config.json。
 */

import { useState, useEffect } from "react";

type Provider = "openai" | "anthropic" | "openai-compatible";

interface ProviderOption {
  value: Provider;
  label: string;
  defaultModel: string;
}

const PROVIDERS: ProviderOption[] = [
  { value: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
  { value: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-5" },
  { value: "openai-compatible", label: "OpenAI 兼容 (Ollama / LM Studio)", defaultModel: "llama3" },
];

export function SetupPage() {
  const [checking, setChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/config/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSetupRequired(data.setupRequired);
      } catch {
        setSetupRequired(true);
      } finally {
        setChecking(false);
      }
    }
    check();
  }, []);

  const handleProviderChange = (value: Provider) => {
    setProvider(value);
    const option = PROVIDERS.find((p) => p.value === value);
    if (option) setModel(option.defaultModel);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          LLM_PROVIDER: provider,
          LLM_MODEL: model,
          LLM_API_KEY: apiKey,
          ...(baseUrl ? { LLM_BASE_URL: baseUrl } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || `请求失败 (${res.status})`);
        return;
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络请求失败，请检查服务是否运行");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-400">正在检查配置...</p>
      </div>
    );
  }

  if (!setupRequired && !success) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-400">配置已就绪，请刷新页面。</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="w-full max-w-md rounded-xl border border-green-800 bg-gray-900 p-8 text-center">
          <div className="mb-4 text-4xl">✓</div>
          <h2 className="mb-2 text-xl font-semibold text-green-400">配置已保存</h2>
          <p className="mb-6 text-gray-400">
            配置已写入服务器。请重启服务以加载新配置，然后刷新此页面。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-green-700 px-6 py-2 text-white hover:bg-green-600 transition-colors"
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8">
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">⚡</div>
          <h1 className="text-2xl font-bold text-white">欢迎使用 code-agent</h1>
          <p className="mt-2 text-sm text-gray-400">请配置您的 LLM 模型以开始使用</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as Provider)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              模型名称
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              API Key <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              自定义 API 端点 <span className="text-gray-500">(可选)</span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !apiKey.trim()}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {submitting ? "保存中..." : "保存配置"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          配置将保存到 ~/.code-agent/config.json
        </p>
      </div>
    </div>
  );
}
