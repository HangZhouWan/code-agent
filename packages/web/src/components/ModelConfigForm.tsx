/**
 * ModelConfigForm —— 模型与工作目录配置表单
 *
 * 首次配置页（SetupPage）与设置弹窗（SettingsModal）共用。
 *
 * 输入：
 * - initial：当前配置视图（API Key 为脱敏值），可为空
 * - onSaved：保存成功回调
 *
 * 输出：提交后 POST /api/config；API Key 留空时沿用服务端已保存的值
 */

import { useState } from "react";
import {
  PROVIDER_DEFINITIONS,
  PROVIDER_IDS,
  type ProviderId,
} from "@code-agent/protocol";
import { saveModelConfig, type ModelConfigView } from "../api/config.js";

export interface ModelConfigFormProps {
  /** 现有配置；首次配置时为 null/undefined */
  initial?: ModelConfigView | null;
  /** 保存成功后的回调 */
  onSaved?: () => void;
}

const DEFAULT_PROVIDER: ProviderId = "openai";

const FIELD_CLASS =
  "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

/**
 * 渲染 Provider / 模型 / API Key / 自定义端点 / 工作目录表单。
 *
 * @returns 可直接嵌入页面或弹窗的表单元素
 */
export function ModelConfigForm({
  initial = null,
  onSaved,
}: ModelConfigFormProps) {
  const [provider, setProvider] = useState<ProviderId>(
    initial?.provider ?? DEFAULT_PROVIDER,
  );
  const [model, setModel] = useState(
    initial?.model ?? PROVIDER_DEFINITIONS[DEFAULT_PROVIDER].defaultModel,
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [workspacePath, setWorkspacePath] = useState(
    initial?.workspacePath ?? "",
  );
  const [autoMode, setAutoMode] = useState(initial?.autoMode ?? false);
  const [planMode, setPlanMode] = useState(initial?.planMode ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const definition = PROVIDER_DEFINITIONS[provider];
  const maskedApiKey = initial?.maskedApiKey ?? "";
  const hasSavedApiKey = maskedApiKey.length > 0;
  const canSubmit =
    !submitting &&
    model.trim().length > 0 &&
    (!definition.requiresApiKey || hasSavedApiKey || apiKey.trim().length > 0);

  /** 切换 Provider：重置为默认模型与默认端点，避免沿用上一个 Provider 的配置 */
  const handleProviderChange = (value: ProviderId) => {
    setProvider(value);
    setModel(PROVIDER_DEFINITIONS[value].defaultModel);
    setBaseUrl(PROVIDER_DEFINITIONS[value].defaultBaseUrl ?? "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await saveModelConfig({
        provider,
        model,
        apiKey,
        baseUrl,
        workspacePath,
        autoMode,
        planMode,
      });
      setApiKey("");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-300">
          Provider
        </label>
        <select
          value={provider}
          onChange={(e) =>
            handleProviderChange(e.target.value as ProviderId)
          }
          className={FIELD_CLASS}
        >
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_DEFINITIONS[id].label}
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
          placeholder={definition.defaultModel}
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-300">
          API Key{" "}
          {definition.requiresApiKey ? (
            <span className="text-red-400">*</span>
          ) : (
            <span className="text-gray-500">(可选)</span>
          )}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            hasSavedApiKey ? `已保存 ${maskedApiKey}，留空保持不变` : "sk-..."
          }
          required={definition.requiresApiKey && !hasSavedApiKey}
          className={FIELD_CLASS}
        />
        {hasSavedApiKey && (
          <p className="mt-1.5 text-xs text-gray-500">
            留空表示继续使用当前 Key
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-300">
          自定义 API 端点 <span className="text-gray-500">(可选)</span>
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={definition.defaultBaseUrl ?? "https://api.openai.com/v1"}
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-300">
          工作目录 <span className="text-gray-500">(可选)</span>
        </label>
        <input
          type="text"
          value={workspacePath}
          onChange={(e) => setWorkspacePath(e.target.value)}
          placeholder="/path/to/your/project"
          className={FIELD_CLASS}
        />
        <p className="mt-1.5 text-xs text-gray-500">
          作为 Code Agent 的默认工作目录；留空使用服务启动目录，需为已存在的目录。
        </p>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={autoMode}
            onChange={(e) => setAutoMode(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-blue-500"
          />
          <span>
            <span className="block text-sm font-medium text-gray-200">
              Auto mode
            </span>
            <span className="mt-0.5 block text-xs text-gray-500">
              开启后，工作区内的文件写入/修改和命令执行无需人工审批。
            </span>
          </span>
        </label>
        {autoMode && (
          <p className="mt-2 text-xs text-amber-400">
            ⚠ Agent 将直接修改文件并执行 shell 命令，请仅在可信的工作区开启。
          </p>
        )}
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={planMode}
            onChange={(e) => setPlanMode(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-purple-500"
          />
          <span>
            <span className="block text-sm font-medium text-gray-200">
              计划模式
            </span>
            <span className="mt-0.5 block text-xs text-gray-500">
              Agent 先只读扫描代码库并提交改进方案，用户确认后才修改文件。
            </span>
          </span>
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {submitting ? "保存中..." : "保存配置"}
      </button>
    </form>
  );
}
