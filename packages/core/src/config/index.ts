/**
 * 配置模块统一入口
 */

export type {
  WorkspacePaths,
  ResolvedConfig,
  LoadConfigOptions,
  ResolvePathsOptions,
  ProviderId,
} from "./types.js";
export {
  workspaceToSlug,
  resolveCodeAgentHome,
  resolvePaths,
} from "./paths.js";
export { loadConfig, findMonorepoRoot } from "./loader.js";
export type {
  GlobalConfig,
  GlobalConfigInput,
  GlobalConfigManagerOptions,
} from "./global-config.js";
export {
  GlobalConfigManager,
  globalConfigSchema,
  atomicWriteFileSync,
  maskApiKey,
} from "./global-config.js";
