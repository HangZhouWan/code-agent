/**
 * CLI 首次配置引导
 *
 * Provider 元数据来自 @code-agent/protocol，避免与 Web setup 页面重复维护。
 */

import * as readline from "node:readline";
import type { GlobalConfigInput, GlobalConfigManager } from "@code-agent/runtime";
import { PROVIDER_DEFINITIONS, PROVIDER_IDS } from "@code-agent/protocol";

const PROVIDER_OPTIONS = PROVIDER_IDS.map((id) => PROVIDER_DEFINITIONS[id]);

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function providerMenu(): string {
  let menu = "\n请选择 LLM Provider:\n";
  for (let i = 0; i < PROVIDER_OPTIONS.length; i++) {
    menu += `  [${i + 1}] ${PROVIDER_OPTIONS[i].label}\n`;
  }
  menu += `请输入数字 (1-${PROVIDER_OPTIONS.length}): `;
  return menu;
}

export async function runSetupWizard(
  configManager: GlobalConfigManager,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n" + "=".repeat(50));
  console.log("  欢迎使用 code-agent！");
  console.log("  首次使用，请配置 LLM 模型。");
  console.log("=".repeat(50));

  let providerIndex = -1;
  while (providerIndex < 0 || providerIndex >= PROVIDER_OPTIONS.length) {
    const answer = await question(rl, providerMenu());
    const n = parseInt(answer, 10);
    if (n >= 1 && n <= PROVIDER_OPTIONS.length) {
      providerIndex = n - 1;
    } else {
      console.log(`  请输入 1-${PROVIDER_OPTIONS.length} 之间的数字。`);
    }
  }
  const provider = PROVIDER_OPTIONS[providerIndex];

  const model =
    (await question(rl, `模型名称 [${provider.defaultModel}]: `)) ||
    provider.defaultModel;

  let apiKey = "";
  if (provider.requiresApiKey) {
    while (!apiKey) {
      apiKey = await question(rl, "API Key (必填，注意不要泄露给他人): ");
      if (!apiKey) console.log("  API Key 为必填项，请输入。");
    }
  } else {
    apiKey = await question(rl, "API Key (可选，直接回车跳过): ");
  }

  const baseUrlHint = provider.defaultBaseUrl
    ? ` [${provider.defaultBaseUrl}]`
    : "";
  const baseURL = await question(
    rl,
    `自定义 API 端点 (可选，直接回车跳过)${baseUrlHint}: `,
  );

  const config: GlobalConfigInput = {
    LLM_PROVIDER: provider.id,
    LLM_MODEL: model,
    ...(apiKey ? { LLM_API_KEY: apiKey } : {}),
    ...(baseURL ? { LLM_BASE_URL: baseURL } : {}),
  };

  try {
    configManager.save(config);
    console.log(`\n✓ 配置已保存到 ${configManager.getConfigPath()}`);
  } catch (err) {
    console.error(
      "\n✗ 保存配置失败:",
      err instanceof Error ? err.message : String(err),
    );
    rl.close();
    process.exit(1);
  }

  console.log("  正在启动...\n");
  rl.close();
}
