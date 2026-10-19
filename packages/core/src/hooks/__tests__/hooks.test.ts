/**
 * HooksEngine 测试
 */

import { describe, expect, it, vi } from "vitest";
import { HooksEngine } from "../engine.js";
import { createSecretFilterHook } from "../builtins/secret-filter.js";
import { createLoggerHook } from "../builtins/logger.js";

describe("HooksEngine", () => {
  it("注册、触发并合并 modifiedArgs", async () => {
    const engine = new HooksEngine();
    engine.on("tool:before", async () => ({
      modifiedArgs: { a: 1 },
    }));
    engine.on("tool:before", async () => ({
      modifiedArgs: { b: 2 },
    }));

    const result = await engine.trigger("tool:before", {
      agentId: "a1",
      data: {},
    });

    expect(result.modifiedArgs).toEqual({ a: 1, b: 2 });
  });

  it("任一 handler skip 时整体 skip", async () => {
    const engine = new HooksEngine();
    engine.on("tool:before", async () => ({ skip: false }));
    engine.on("tool:before", async () => ({ skip: true }));

    const result = await engine.trigger("tool:before", {
      agentId: "a1",
      data: {},
    });
    expect(result.skip).toBe(true);
  });

  it("handler 异常通过 onError 上报且不阻塞后续 handler", async () => {
    const errors: unknown[] = [];
    const engine = new HooksEngine({
      onError: (_event, error) => errors.push(error),
    });
    let reached = false;
    engine.on("agent:start", async () => {
      throw new Error("boom");
    });
    engine.on("agent:start", async () => {
      reached = true;
    });

    await engine.trigger("agent:start", { agentId: "a1", data: {} });

    expect(errors).toHaveLength(1);
    expect(reached).toBe(true);
  });

  it("off 移除 handler", async () => {
    const engine = new HooksEngine();
    const handler = vi.fn(async () => {});
    engine.on("agent:start", handler);
    engine.off("agent:start", handler);

    await engine.trigger("agent:start", { agentId: "a1", data: {} });
    expect(handler).not.toHaveBeenCalled();
  });

  it("secret-filter 脱敏 API key", async () => {
    const engine = new HooksEngine();
    engine.on("tool:before", createSecretFilterHook());

    const result = await engine.trigger("tool:before", {
      agentId: "a1",
      data: { args: { apiKey: "sk-1234567890abcdefghij" } },
    });

    expect(
      (result.modifiedArgs as { apiKey: string }).apiKey,
    ).toBe("***REDACTED***");
  });

  it("logger hook 不抛错", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const engine = new HooksEngine();
    engine.on("agent:start", createLoggerHook());

    await engine.trigger("agent:start", { agentId: "a1", data: {} });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
