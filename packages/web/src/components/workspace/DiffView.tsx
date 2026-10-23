/**
 * 只读 diff 预览
 */

import type { WorkspaceDiff } from "@code-agent/protocol";

export interface DiffViewProps {
  diff: WorkspaceDiff;
}

export function DiffView({ diff }: DiffViewProps) {
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs leading-5 text-gray-300">
      {diff.diff}
    </pre>
  );
}
