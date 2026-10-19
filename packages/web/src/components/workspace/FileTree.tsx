/**
 * 只读文件树
 */

import type { WorkspaceEntry } from "@code-agent/protocol";

export interface FileTreeProps {
  entries: WorkspaceEntry[];
  children: Record<string, WorkspaceEntry[]>;
  expanded: Set<string>;
  selectedPath?: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

export function FileTree(props: FileTreeProps) {
  return (
    <div className="space-y-0.5 text-sm">
      <TreeLevel {...props} depth={0} />
    </div>
  );
}

function TreeLevel({
  entries,
  children,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
  depth,
}: FileTreeProps & { depth: number }) {
  return (
    <>
      {entries.map((entry) => {
        const isDirectory = entry.type === "directory";
        const isOpen = expanded.has(entry.path);
        const isSelected = selectedPath === entry.path;

        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() =>
                isDirectory ? onToggle(entry.path) : onSelect(entry.path)
              }
              style={{ paddingLeft: 6 + depth * 12 }}
              className={`flex w-full items-center gap-1 truncate rounded px-1 py-1 text-left ${
                isSelected
                  ? "bg-blue-500/15 text-blue-200"
                  : "text-gray-300 hover:bg-gray-800"
              }`}
              title={entry.path}
            >
              <span className="w-3 shrink-0 text-gray-500">
                {isDirectory ? (isOpen ? "▾" : "▸") : ""}
              </span>
              <span className="shrink-0">
                {isDirectory ? "📁" : "📄"}
              </span>
              <span className="truncate">{entry.name}</span>
            </button>

            {isDirectory && isOpen && children[entry.path] && (
              <TreeLevel
                entries={children[entry.path]}
                children={children}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
