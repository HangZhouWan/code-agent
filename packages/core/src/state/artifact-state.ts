/**
 * ArtifactStateStore —— 每会话的产物
 */

import type { Artifact, RunId, TaskId } from "@code-agent/protocol";

export class ArtifactStateStore {
  private readonly artifacts = new Map<string, Artifact>();

  add(artifact: Artifact): Artifact {
    this.artifacts.set(artifact.id, {
      ...artifact,
      payload: artifact.payload,
    });
    return artifact;
  }

  get(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  list(): Artifact[] {
    return [...this.artifacts.values()];
  }

  listByRun(runId: RunId): Artifact[] {
    return this.list().filter((artifact) => artifact.runId === runId);
  }

  listByTask(taskId: TaskId): Artifact[] {
    return this.list().filter((artifact) => artifact.taskId === taskId);
  }

  hydrate(artifacts: Artifact[]): void {
    this.artifacts.clear();
    for (const artifact of artifacts) {
      this.artifacts.set(artifact.id, artifact);
    }
  }

  snapshot(): Artifact[] {
    return this.list();
  }

  get size(): number {
    return this.artifacts.size;
  }
}
