/**
 * 将 SessionEvent 流渲染到终端
 */

import type { AgentSession, RunHandle } from "@code-agent/runtime";
import type { RunResult } from "@code-agent/protocol";
import {
  dim,
  formatError,
  formatToolStart,
  yellow,
} from "../format.js";

export interface ConsumeRunOptions {
  interactive: boolean;
  ask?: (prompt: string) => Promise<string>;
}

export async function consumeRun(
  session: AgentSession,
  handle: RunHandle,
  options: ConsumeRunOptions,
): Promise<RunResult> {
  const toolNames = new Map<string, string>();
  let printedAssistant = false;

  const streamed = (async () => {
    for await (const envelope of handle.events) {
      const event = envelope.event;

      switch (event.type) {
        case "message.completed":
          if (event.message.role === "assistant") {
            printedAssistant = true;
            process.stdout.write(`\n${event.message.content}\n`);
          }
          break;

        case "tool.started":
          toolNames.set(event.callId, event.toolName);
          console.log(
            formatToolStart(
              event.toolName,
              event.args as Record<string, unknown>,
            ),
          );
          break;

        case "tool.finished": {
          const name = toolNames.get(event.callId) ?? "tool";
          console.log(
            dim(
              `   ${event.ok ? "✓" : "✖"} ${name} (${event.durationMs}ms)`,
            ),
          );
          if (!event.ok && event.resultPreview) {
            console.log(
              dim(`     ${event.resultPreview.split("\n")[0]}`),
            );
          }
          break;
        }

        case "approval.required": {
          const request = event.request;
          if (options.interactive && options.ask) {
            const answer = await options.ask(
              `${yellow(`工具 ${request.toolName} 需要审批`)}\n` +
                `${JSON.stringify(request.args).slice(0, 200)}\n` +
                "Approve? [y/N]: ",
            );
            session.approve(
              request.callId,
              /^y(es)?$/i.test(answer.trim()) ? "approved" : "denied",
            );
          } else {
            console.log(
              yellow(
                `工具 ${request.toolName} 需要审批；非交互模式自动拒绝`,
              ),
            );
            session.approve(request.callId, "denied");
          }
          break;
        }

        case "user.question.required": {
          const question = event.question;
          if (options.interactive && options.ask) {
            const answer = await options.ask(`${question.question}\n> `);
            session.answer(question.questionId, answer);
          } else {
            console.log(
              yellow("非交互模式无法回答 ask_user，返回空字符串"),
            );
            session.answer(question.questionId, "");
          }
          break;
        }

        case "task.status":
          console.log(dim(`   [${event.roleId}] ${event.status}`));
          break;

        case "plan.updated":
          console.log(dim(`   计划: ${event.plan.tasks.length} 个任务`));
          break;

        case "session.title.updated":
          console.log(dim(`   标题: ${event.title}`));
          break;

        case "run.failed":
          console.log(formatError(event.error.message));
          break;

        case "run.aborted":
          console.log(yellow(`已取消: ${event.reason}`));
          break;

        case "run.completed":
          if (!printedAssistant && event.result.finalResponse) {
            process.stdout.write(`\n${event.result.finalResponse}\n`);
          }
          break;

        default:
          break;
      }

      if (
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.aborted"
      ) {
        break;
      }
    }
  })();

  const result = await handle.done;
  await streamed;
  return result;
}
