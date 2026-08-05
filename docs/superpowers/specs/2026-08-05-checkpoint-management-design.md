# Checkpoint Management Design

**Date**: 2026-08-05
**Status**: Final

## Problem

After the hardening commit (34351ea), checkpoint files are not persisted. Root causes:

1. **Ephemeral by design**: Agent checkpoints are saved each step but purged on success. Normal execution leaves no checkpoint on disk.
2. **Ctrl+C does not cancel agent execution**: The `AbortController` only aborts the LangGraph stream output. `agent.executeTask()` running inside the dispatcher node is unaffected — it continues executing, completes, and purges the checkpoint.
3. **No orchestrator-level checkpoint**: Only individual subtasks have checkpoints. If the orchestrator (planner → dispatcher → finalizer) is interrupted, there is no recovery mechanism for the overall plan.
4. **Silent save failures**: The hardening commit wrapped `checkpoint.save()` in try-catch and publishes errors to EventBus where nobody listens.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Recovery granularity | Orchestrator level (方案 B) | User cares about the whole task, not individual subtasks |
| Save timing | Node-level auto-save (方案 B) | Save after planner + update on dispatcher progress; enables recovery from any interruption |
| Checkpoint content | Metadata only (plan + messages) | Keep files small; re-execute subtasks on recovery |
| Recovery behavior | Re-execute all subtasks (方案 A) | Simple, no dependency result mismatch issues |
| Implementation approach | 方案 B: Node-level auto-save + AbortController propagation | Balanced scope; fixes the root cause of abort not propagating |

## Architecture

```
User Request
  │
  ▼
┌─ Orchestrator ─────────────────────────────────────┐
│  planner ──→ dispatcher ──→ finalizer              │
│    │            │                                   │
│    ▼            ▼                                   │
│  [Orchestrator Checkpoint]                          │
│  Save: plan + messages                              │
│  Auto-save after planner completes                  │
│  Only purge on final success                        │
└────────────┬───────────────────────────────────────┘
             │ per subtask
             ▼
┌─ Agent.executeTask() ──────────────────────────────┐
│  ExecutionEngine.runLoop()                          │
│    │                                                │
│    ▼                                                │
│  [Agent Checkpoint] (existing logic, unchanged)     │
│  Save each step, purge on success                   │
│  NEW: check abort signal, skip purge on abort       │
└────────────────────────────────────────────────────┘
```

## AbortController Propagation

**Current**: AbortController stops only the LangGraph stream. The agent keeps running.

**After fix**:

```
REPL (Ctrl+C) → abortController.abort()
                   ↓
              streamEvents(signal) → AbortError → stream stops
                   ↓
              createOrchestratorGraph({ signal })  ← NEW
                   ↓
              dispatcher reads signal
                   ↓
              agent.executeTask({ signal })  ← NEW param
                   ↓
              ExecutionEngine.runLoop() checks signal.aborted each iteration
                   ↓
              Abort detected → keep checkpoint → save orchestrator state → exit
```

### Change chain (4 locations)

| File | Change |
|------|--------|
| `packages/cli/src/repl.ts` | Pass `AbortController.signal` into `streamOrchestrator` / graph options |
| `packages/server/src/orchestrator/graph.ts` | `OrchestratorGraphOptions` adds `signal?: AbortSignal`, passes to dispatcher |
| `packages/server/src/orchestrator/nodes/dispatcher.ts` | `executeDirectTasks` accepts signal, passes to `agent.executeTask({ signal })` |
| `packages/core/src/agent/agent.ts` + `engine.ts` | `executeTask` and `runLoop` accept signal, check each loop; abort skips purge |

## Orchestrator Checkpoint Data Structure

```typescript
interface OrchestratorCheckpoint {
  sessionId: string;          // unique session UUID
  createdAt: Date;
  // Original user request
  messages: SerializedMessage[];
  // Planner output
  plan: {
    complexity: 'simple' | 'complex';
    tasks: SubTask[];         // id, description, tools, dependsOn, routing, role
    suggestedAgents: Record<string, string>;
  };
  // Progress bookmark (for logging/debug; does not affect recovery)
  progress: {
    currentNode: 'planner' | 'dispatcher' | 'finalizer';
    completedTaskIds: string[];
  };
}
```

Storage: `~/.code-agent/projects/<slug>/checkpoints/session-<sessionId>.json`

## Save and Recovery Flow

### Save Timing

```
planner completes → save OrchestratorCheckpoint (plan generated)
dispatcher batch completes → update progress (overwrite same file)
finalizer completes → purge OrchestratorCheckpoint (all done)
```

Signal handling:

```
SIGINT/SIGTERM → Agent detects abort → keep Agent checkpoint
              → Orchestrator catches exception → keep Orchestrator checkpoint
              → exit
```

### Recovery Flow

```
Next startup
  │
  ▼
listTasks() → find pending session-*.json files
  │
  ▼
List for user to choose (or auto-resume latest)
  │
  ▼
Load OrchestratorCheckpoint
  │
  ├─ Use checkpoint.messages as input
  ├─ Use checkpoint.plan to skip planner, enter dispatcher directly
  └─ Dispatcher re-executes ALL subtasks (design decision)
  │
  ▼
All complete → purge both checkpoints
```

## File Layout

```
~/.code-agent/projects/<slug>/checkpoints/
├── session-<uuid>.json        # Orchestrator checkpoint (NEW)
├── <taskId>.json              # Agent checkpoint (existing, unchanged)
└── ...
```

## Cleanup Strategy

| Scenario | Orchestrator checkpoint | Agent checkpoint |
|----------|------------------------|------------------|
| Normal completion | Purge after finalizer | Purge per subtask (existing) |
| User interrupt (Ctrl+C) | Keep | Keep (agent skips purge on abort) |
| LLM timeout | Keep | Keep (existing logic) |
| Process crash | Keep (last saved state) | Keep (last saved state) |
| Recovery success | Purge | Purge |
| Expired (stale) | `cleanup(olderThan)` periodic | `cleanup(olderThan)` periodic |

## Session Lifecycle

```
session-abc123.json

Created:  after planner completes
Updated:  after each dispatcher batch (overwrite progress)
Deleted:  after finalizer / after recovery success / cleanup expiry
```

One user request = one session. If multiple pending checkpoints exist (e.g., consecutive Ctrl+C), list all on startup, newest first, let user choose.

## File Changes Summary

| File | Change |
|------|--------|
| `packages/core/src/harness/execution/checkpoint.ts` | Add `OrchestratorCheckpoint` type, `IOrchestratorCheckpointManager` interface, `FileOrchestratorCheckpointManager` implementation |
| `packages/core/src/harness/execution/engine.ts` | `runLoop()` accepts `AbortSignal`, checks each iteration |
| `packages/core/src/agent/agent.ts` | `executeTask()` accepts `signal`, passes to engine; abort skips purge |
| `packages/server/src/orchestrator/graph.ts` | `OrchestratorGraphOptions` adds `signal`, `checkpointManager` |
| `packages/server/src/orchestrator/nodes/dispatcher.ts` | Pass `signal` to agent |
| `packages/server/src/orchestrator/nodes/finalizer.ts` | Purge orchestrator checkpoint on success |
| `packages/cli/src/index.ts` | Detect pending sessions on startup, provide recovery entry |
| `packages/cli/src/repl.ts` | Pass `AbortController.signal` into orchestrator |
