/**
 * code-agent CLI —— 基于 @code-agent/runtime 的薄适配器
 */

import { asSessionId } from "@code-agent/protocol";
import {
  GlobalConfigManager,
  createFilePorts,
  createMutex,
  createRuntime,
  createRuntimeBootstrap,
  loadConfig,
} from "@code-agent/runtime";
import { parseArgs, printHelp, printVersion } from "./args.js";
import { dim, formatError, heading } from "./format.js";
import { consumeRun } from "./render/run.js";
import { startRepl } from "./repl.js";
import { runSetupWizard } from "./setup-wizard.js";

export const CLI_VERSION = "0.1.0";

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.showHelp) {
    printHelp();
    return;
  }
  if (args.showVersion) {
    printVersion(CLI_VERSION);
    return;
  }

  const configManager = new GlobalConfigManager();
  if (!configManager.isConfigured()) {
    if (!process.stdin.isTTY) {
      console.error(
        formatError(
          "LLM 尚未配置，请在终端运行 code-agent 完成首次配置",
        ),
      );
      process.exitCode = 1;
      return;
    }
    await runSetupWizard(configManager);
  }

  const cfg = loadConfig({
    workspacePath: args.workspacePath,
    cliModel: args.model,
  });

  console.log(heading("code-agent"));
  console.log(dim(`workspace: ${cfg.WORKSPACE_PATH}`));
  console.log(dim(`model: ${cfg.LLM_PROVIDER}/${cfg.LLM_MODEL}`));

  const bootstrap = createRuntimeBootstrap({
    config: cfg,
    writeLock: createMutex(),
  });
  const ports = createFilePorts(
    cfg.paths.dataDir,
    bootstrap.checkpointStore,
  );
  const runtime = createRuntime(bootstrap.harness, {
    ports,
    orchestration: true,
  });

  try {
    if (args.resumeTaskId) {
      const recoverable = await bootstrap.checkpointStore.listRecoverable();
      const target =
        recoverable.find(
          (item) =>
            item.runId === args.resumeTaskId ||
            item.sessionId === args.resumeTaskId,
        ) ?? recoverable[0];

      if (!target) {
        console.log(formatError("没有可恢复的 checkpoint"));
        process.exitCode = 1;
        return;
      }

      const checkpoint =
        await bootstrap.checkpointStore.loadLatestSession(target.sessionId);
      const workspacePath =
        checkpoint?.workspacePath ?? args.workspacePath;
      const session = await runtime.createSession({
        sessionId: target.sessionId,
        workspacePath,
        title: "Resumed",
        orchestration: true,
        ...(args.planMode !== undefined ? { planMode: args.planMode } : {}),
      });

      const handle = await session.resume(target.runId);
      await consumeRun(session, handle, { interactive: false });

      if (args.query) {
        const queryHandle = await session.run({ content: args.query });
        await consumeRun(session, queryHandle, { interactive: false });
        await session.dispose();
      } else if (process.stdin.isTTY) {
        await startRepl({ session, memory: bootstrap.memory });
      } else {
        await session.dispose();
      }
      return;
    }

    const session = await runtime.createSession({
      sessionId: asSessionId("cli-default"),
      workspacePath: args.workspacePath,
      title: "CLI Session",
      ...(args.planMode !== undefined ? { planMode: args.planMode } : {}),
    });

    if (args.query) {
      const handle = await session.run({ content: args.query });
      await consumeRun(session, handle, { interactive: false });
      await session.dispose();
      return;
    }

    if (!process.stdin.isTTY) {
      console.error(formatError("非交互模式需要提供 query"));
      process.exitCode = 1;
      await session.dispose();
      return;
    }

    await startRepl({ session, memory: bootstrap.memory });
  } finally {
    await runtime.dispose();
  }
}

main().catch((error) => {
  console.error(
    formatError(error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
});
