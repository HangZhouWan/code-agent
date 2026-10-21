/**
 * 将 SessionEvent 流渲染到终端
 */

import type { AgentSession, RunHandle } from "@code-agent/runtime";
import type {
  ApprovalRequest,
  CodeProposal,
  RunResult,
} from "@code-agent/protocol";
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
  let streamedText = false;

  const streamed = (async () => {
    for await (const envelope of handle.events) {
      const event = envelope.event;

      switch (event.type) {
        case "message.delta":
          streamedText = true;
          process.stdout.write(event.delta);
          break;

        case "message.completed":
          if (event.message.role === "assistant") {
            printedAssistant = true;
            if (streamedText) {
              streamedText = false;
              process.stdout.write("\n");
            } else {
              process.stdout.write(`\n${event.message.content}\n`);
            }
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
          if (request.kind === "plan") {
            await handlePlanApproval(session, request, options);
            break;
          }
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

/** 默认选择推荐方案，其次第一个方案 */
function defaultSelection(proposals: CodeProposal[]): string[] {
  const recommended = proposals.find((proposal) => proposal.recommended);
  return [recommended?.id ?? proposals[0]!.id];
}

/**
 * 解析方案选择输入。
 *
 * 输入：用户输入、方案列表
 * 输出：选中的方案 ID；无法识别时返回 null
 */
function parsePlanSelection(
  answer: string,
  proposals: CodeProposal[],
): string[] | null {
  if (!answer) return defaultSelection(proposals);
  if (/^a(ll)?$/i.test(answer)) return proposals.map((p) => p.id);

  const ids: string[] = [];
  for (const part of answer.split(/[,\s]+/).filter(Boolean)) {
    const index = Number(part);
    if (!Number.isInteger(index) || index < 1 || index > proposals.length) {
      return null;
    }
    ids.push(proposals[index - 1]!.id);
  }
  return ids.length > 0 ? [...new Set(ids)] : null;
}

/** 在终端展示方案并等待用户选择或拒绝 */
async function handlePlanApproval(
  session: AgentSession,
  request: ApprovalRequest,
  options: ConsumeRunOptions,
): Promise<void> {
  const plan = request.plan;
  if (!plan) {
    session.approve(request.callId, {
      decision: "denied",
      feedback: "Missing plan payload",
    });
    return;
  }

  console.log(yellow("\n计划模式：请确认改进方案"));
  console.log(plan.summary);

  plan.proposals.forEach((proposal, index) => {
    console.log(
      `\n${index + 1}. ${proposal.title}${
        proposal.recommended ? "（推荐）" : ""
      }`,
    );
    console.log(`   ${proposal.summary}`);
    for (const file of proposal.files) {
      console.log(`   - ${file.path}`);
      for (const change of file.changes) {
        console.log(`     · ${change}`);
      }
    }
    if (proposal.effort) console.log(`   工作量: ${proposal.effort}`);
    if (proposal.rationale) console.log(`   理由: ${proposal.rationale}`);
    if (proposal.risks) console.log(`   风险: ${proposal.risks}`);
  });

  if (!options.interactive || !options.ask) {
    console.log(
      yellow(
        "非交互模式无法确认方案，自动拒绝；如需直接执行请使用 --no-plan",
      ),
    );
    session.approve(request.callId, {
      decision: "denied",
      feedback:
        "Plan approval requires an interactive terminal. Re-run with --no-plan to apply changes directly.",
    });
    return;
  }

  const answer = (
    await options.ask(
      "\n选择方案（序号逗号分隔 / a=全部 / Enter=推荐 / n=拒绝）: ",
    )
  ).trim();

  if (/^n(o)?$/i.test(answer)) {
    const feedback = (await options.ask("拒绝原因（可留空）: ")).trim();
    session.approve(request.callId, {
      decision: "denied",
      ...(feedback ? { feedback } : {}),
    });
    return;
  }

  const selected = parsePlanSelection(answer, plan.proposals);
  if (!selected) {
    console.log(yellow("输入无法识别，默认选择推荐方案"));
  }
  session.approve(request.callId, {
    decision: "approved",
    selectedProposalIds: selected ?? defaultSelection(plan.proposals),
  });
}
