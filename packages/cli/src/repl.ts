/**
 * CLI REPL —— 消费 AgentSession 事件流
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { AgentSession, MemoryService } from "@code-agent/runtime";
import { asMemoryId } from "@code-agent/protocol";
import { consumeRun } from "./render/run.js";
import {
  dim,
  formatError,
  formatPrompt,
  green,
  heading,
  yellow,
} from "./format.js";

export interface ReplOptions {
  session: AgentSession;
  memory?: MemoryService;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const { session, memory } = options;
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(heading("code-agent"));
  console.log(dim("输入 /help 查看命令，/exit 退出"));

  // 文件持久化端口会恢复上次会话，这里展示最近消息
  try {
    const snapshot = await session.snapshot();
    const recent = snapshot.messages.slice(-20);
    if (recent.length > 0) {
      console.log(dim("--- 最近消息 ---"));
      for (const message of recent) {
        console.log(
          dim(`${message.role}> ${message.content.slice(0, 500)}`),
        );
      }
      console.log(dim("----------------"));
    }
  } catch {
    // 历史读取失败不影响 REPL 启动
  }

  rl.on("SIGINT", () => {
    if (session.busy) {
      console.log(yellow("\n正在取消当前任务..."));
      void session.abort();
    } else {
      rl.close();
    }
  });

  while (true) {
    let line: string;
    try {
      line = (await rl.question(formatPrompt())).trim();
    } catch {
      break;
    }

    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    if (line === "/help") {
      printReplHelp();
      continue;
    }
    if (line === "/abort") {
      await session.abort();
      continue;
    }
    if (line === "/plan" || line.startsWith("/plan ")) {
      const value = line.slice("/plan".length).trim();
      if (!value) {
        console.log(
          dim(`计划模式: ${session.planMode ? "开启" : "关闭"}`),
        );
        continue;
      }
      if (value !== "on" && value !== "off") {
        console.log(yellow("用法: /plan [on|off]"));
        continue;
      }
      try {
        session.setPlanMode(value === "on");
        console.log(
          dim(`计划模式已${value === "on" ? "开启" : "关闭"}`),
        );
      } catch (error) {
        console.log(
          yellow(error instanceof Error ? error.message : String(error)),
        );
      }
      continue;
    }
    if (line === "/memory" || line.startsWith("/memory ")) {
      await showMemory(memory, line.slice("/memory".length).trim());
      continue;
    }
    if (line.startsWith("/remember ")) {
      await remember(memory, line.slice("/remember ".length).trim());
      continue;
    }
    if (line.startsWith("/forget ")) {
      await forget(memory, line.slice("/forget ".length).trim());
      continue;
    }

    try {
      const handle = await session.run({ content: line });
      await consumeRun(session, handle, {
        interactive: true,
        ask: (prompt) => rl.question(prompt),
      });
    } catch (error) {
      console.log(
        formatError(error instanceof Error ? error.message : String(error)),
      );
    }
  }

  rl.close();
  await session.dispose();
}

function printReplHelp(): void {
  console.log(
    [
      "",
      "  /help                 显示帮助",
      "  /exit, /quit          退出",
      "  /abort                取消当前任务",
      "  /plan [on|off]        查看/切换计划模式",
      "  /memory [query]       查看/搜索长期记忆",
      "  /remember <text>      写入一条记忆",
      "  /forget <id>          删除一条记忆",
      "",
    ].join("\n"),
  );
}

async function showMemory(
  memory: MemoryService | undefined,
  query: string,
): Promise<void> {
  if (!memory) {
    console.log(yellow("记忆功能未启用"));
    return;
  }
  const records = query
    ? await memory.search({ query, topK: 10 })
    : await memory.list({ limit: 20 });

  if (records.length === 0) {
    console.log(dim("(无记忆)"));
    return;
  }
  for (const record of records) {
    console.log(
      `${dim(record.id)} [${record.scope}] ${record.content}`,
    );
  }
}

async function remember(
  memory: MemoryService | undefined,
  content: string,
): Promise<void> {
  if (!memory) {
    console.log(yellow("记忆功能未启用"));
    return;
  }
  if (!content) {
    console.log(yellow("用法: /remember <内容>"));
    return;
  }
  const stored = await memory.store({
    content,
    kind: "fact",
    confidence: 0.9,
  });
  console.log(
    green(
      stored.pendingReview
        ? `已进入审核队列: ${stored.record.id}`
        : `已记住: ${stored.record.id}`,
    ),
  );
}

async function forget(
  memory: MemoryService | undefined,
  id: string,
): Promise<void> {
  if (!memory) {
    console.log(yellow("记忆功能未启用"));
    return;
  }
  if (!id) {
    console.log(yellow("用法: /forget <id>"));
    return;
  }
  const deleted = await memory.delete(asMemoryId(id));
  console.log(deleted ? green("已删除") : yellow("未找到该记忆"));
}
