/**
 * 长期记忆 API client
 */

import type {
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MemoryStatus,
} from "@code-agent/protocol";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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

export interface MemoryFilter {
  status?: MemoryStatus;
  scope?: MemoryScope;
  kinds?: MemoryKind[];
  limit?: number;
}

export async function fetchMemories(
  filter: MemoryFilter = {},
): Promise<MemoryRecord[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.scope) params.set("scope", filter.scope);
  if (filter.kinds?.length) params.set("kinds", filter.kinds.join(","));
  if (filter.limit) params.set("limit", String(filter.limit));

  const response = await request<{ memories: MemoryRecord[] }>(
    `/api/memory?${params.toString()}`,
  );
  return response.memories;
}

export async function searchMemories(
  query: string,
  scope?: MemoryScope,
): Promise<MemoryRecord[]> {
  const params = new URLSearchParams({ query });
  if (scope) params.set("scope", scope);
  const response = await request<{ memories: MemoryRecord[] }>(
    `/api/memory/search?${params.toString()}`,
  );
  return response.memories;
}

export async function updateMemory(
  id: string,
  patch: {
    content?: string;
    tags?: string[];
    confidence?: number;
    status?: MemoryStatus;
    pinned?: boolean;
  },
): Promise<MemoryRecord> {
  return request<MemoryRecord>(`/api/memory/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteMemory(id: string): Promise<void> {
  await request<{ success: boolean }>(
    `/api/memory/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
