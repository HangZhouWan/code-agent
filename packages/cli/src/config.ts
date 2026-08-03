/**
 * Config re-export layer
 *
 * The core config loading logic lives in config-loader.ts.
 * This file provides backwards-compatible re-exports.
 */

export {
  loadConfig,
  type EnvConfig,
  type LoadConfigOptions,
  type ConfigFileData,
} from "./config-loader.js";
