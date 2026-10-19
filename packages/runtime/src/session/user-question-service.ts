/**
 * UserQuestionService —— ask_user 交互
 */

import {
  asQuestionId,
  type QuestionId,
  type RunId,
  type SessionEvent,
  type SessionId,
  type TaskId,
  type UserQuestion,
} from "@code-agent/protocol";
import type { Clock, IdGenerator } from "../ports/types.js";

export interface UserQuestionServiceOptions {
  sessionId: SessionId;
  clock: Clock;
  ids: IdGenerator;
  emit: (event: SessionEvent) => void;
  timeoutMs?: number;
}

export interface AskUserInput {
  runId: RunId;
  taskId: TaskId;
  question: string;
  options?: string[];
  allowFreeText?: boolean;
}

interface PendingQuestion {
  question: UserQuestion;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class UserQuestionService {
  private readonly pending = new Map<QuestionId, PendingQuestion>();
  private readonly timeoutMs: number;

  constructor(private readonly options: UserQuestionServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  request(input: AskUserInput): Promise<string> {
    const questionId = asQuestionId(this.options.ids.next("q"));
    const createdAt = this.options.clock.now();
    const expiresAt = new Date(
      this.options.clock.nowMs() + this.timeoutMs,
    ).toISOString();

    const question: UserQuestion = {
      questionId,
      sessionId: this.options.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      question: input.question,
      ...(input.options ? { options: input.options } : {}),
      allowFreeText: input.allowFreeText ?? true,
      createdAt,
      expiresAt,
    };

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(questionId);
        reject(new Error("User question timed out"));
      }, this.timeoutMs);

      this.pending.set(questionId, { question, resolve, reject, timer });
      this.options.emit({ type: "user.question.required", question });
    });
  }

  answer(questionId: QuestionId, answer: string): boolean {
    const pending = this.pending.get(questionId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(questionId);
    this.options.emit({
      type: "user.question.resolved",
      questionId,
      answer,
    });
    pending.resolve(answer);
    return true;
  }

  cancelRun(runId: RunId, reason = "run cancelled"): number {
    let cancelled = 0;
    for (const [questionId, pending] of this.pending) {
      if (pending.question.runId !== runId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(questionId);
      pending.reject(new Error(reason));
      cancelled++;
    }
    return cancelled;
  }

  listPending(): UserQuestion[] {
    return [...this.pending.values()].map((pending) => pending.question);
  }

  dispose(): void {
    for (const [questionId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(questionId);
      pending.reject(new Error("Session disposed"));
    }
  }
}
