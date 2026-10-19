/**
 * Server 配置入口
 *
 * 配置合并逻辑统一在 @code-agent/runtime（core loader）中，
 * 这里只保留 server 需要的向后兼容类型/函数。
 */

import {
  loadConfig as loadCoreConfig,
  type LoadConfigOptions,
  type ResolvedConfig,
} from "@code-agent/runtime";

export type EnvConfig = ResolvedConfig;
export type { LoadConfigOptions };

/**
 * 加载 server 配置。
 *
 * 默认读取 process.env、.env、全局/项目 config.json；
 * 测试可注入 env/workspacePath/homeDir 以隔离文件系统。
 */
export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  return loadCoreConfig({
    ...options,
    env: options.env ?? process.env,
  });
}
