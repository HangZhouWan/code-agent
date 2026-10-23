/**
 * 新状态管理入口（Task / Artifact / Session）
 */

export {
  TASK_TRANSITIONS,
  canTransition,
  assertTransition,
  InvalidTaskTransitionError,
} from "./task-machine.js";
export { TaskStateStore } from "./task-state.js";
export type { CreateTaskInput } from "./task-state.js";
export { ArtifactStateStore } from "./artifact-state.js";
export { SessionStateManager } from "./session-state.js";
export type { SessionStateSnapshot } from "./session-state.js";
