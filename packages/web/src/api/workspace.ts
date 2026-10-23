/**
 * 工作区只读 API client
 */

import type {
  WorkspaceDiff,
  WorkspaceDiffResponse,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
} from "@code-agent/protocol";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      body?.error?.message ?? `Request failed: HTTP ${res.status}`,
    );
  }
  return (await res.json()) as T;
}

export async function fetchWorkspaceTree(
  path = ".",
): Promise<WorkspaceEntry[]> {
  const response = await getJson<WorkspaceTreeResponse>(
    `/api/workspace/tree?path=${encodeURIComponent(path)}`,
  );
  return response.entries;
}

export async function fetchWorkspaceFile(
  path: string,
): Promise<WorkspaceFile> {
  const response = await getJson<WorkspaceFileResponse>(
    `/api/workspace/file?path=${encodeURIComponent(path)}`,
  );
  return response.file;
}

export async function fetchWorkspaceDiff(
  path: string,
): Promise<WorkspaceDiff> {
  const response = await getJson<WorkspaceDiffResponse>(
    `/api/workspace/diff?path=${encodeURIComponent(path)}`,
  );
  return response.diff;
}
