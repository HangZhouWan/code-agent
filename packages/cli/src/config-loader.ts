/**
 * CLI 配置入口
 *
 * 所有合并逻辑已收敛到 @code-agent/core 的统一 loader；
 * 这里只保留 CLI 现有 import 路径的兼容导出。
 */

export { loadConfig } from "@code-agent/core";
export type {
  LoadConfigOptions,
  ResolvedConfig as EnvConfig,
} from "@code-agent/core";

/** 配置文件原始数据（兼容旧类型） */
export type ConfigFileData = Record<string, unknown>;
