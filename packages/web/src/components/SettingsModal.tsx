/**
 * SettingsModal —— 模型配置弹窗
 *
 * 用于在首次配置完成后再次修改模型配置。
 *
 * 输入：onClose —— 关闭弹窗回调
 * 行为：
 * - 打开时 GET /api/config 读取当前配置（API Key 为脱敏值）
 * - 通过 ModelConfigForm 修改并保存
 * - 保存成功后提示需要重启服务
 */

import { useCallback, useEffect, useState } from "react";
import { fetchModelConfig, type ModelConfigView } from "../api/config.js";
import { ModelConfigForm } from "./ModelConfigForm.js";

export interface SettingsModalProps {
  /** 关闭弹窗 */
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [config, setConfig] = useState<ModelConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /** 读取当前配置，供表单预填 */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setConfig(await fetchModelConfig());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "读取配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape 关闭弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-config-title"
        className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2
              id="model-config-title"
              className="text-lg font-semibold text-white"
            >
              模型配置
            </h2>
            <p className="mt-1 text-xs text-gray-500">修改后需重启服务生效</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded px-2 py-1 text-xl leading-none text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            ×
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">
            正在读取配置...
          </p>
        ) : loadError ? (
          <div className="space-y-4">
            <div
              role="alert"
              className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400"
            >
              {loadError}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="w-full rounded-lg border border-gray-700 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800"
            >
              重试
            </button>
          </div>
        ) : saved ? (
          <div className="space-y-4 text-center">
            <div className="text-3xl">✓</div>
            <p className="font-medium text-green-400">配置已保存</p>
            <p className="text-sm text-gray-400">
              重启服务后新配置才会生效。
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-green-700 px-4 py-2.5 text-white hover:bg-green-600 transition-colors"
            >
              关闭
            </button>
          </div>
        ) : (
          <ModelConfigForm initial={config} onSaved={() => setSaved(true)} />
        )}
      </div>
    </div>
  );
}
