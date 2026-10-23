/**
 * SetupPage —— 首次配置引导页面
 *
 * 当服务端未配置 LLM 模型时展示，复用 ModelConfigForm 完成
 * Provider、模型、API Key 和自定义端点的配置。
 */

import { useState } from "react";
import { ModelConfigForm } from "./ModelConfigForm.js";

export function SetupPage() {
  const [success, setSuccess] = useState(false);

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
    <div className="flex min-h-screen items-center justify-center bg-gray-950 py-10">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8">
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">⚡</div>
          <h1 className="text-2xl font-bold text-white">欢迎使用 code-agent</h1>
          <p className="mt-2 text-sm text-gray-400">
            请配置您的 LLM 模型与工作目录以开始使用
          </p>
        </div>

        <ModelConfigForm onSaved={() => setSuccess(true)} />

        <p className="mt-6 text-center text-xs text-gray-500">
          配置将保存到 ~/.code-agent/config.json
        </p>
      </div>
    </div>
  );
}
