/**
 * 只读代码查看器（CodeMirror 6）
 */

import CodeMirror from "@uiw/react-codemirror";
import type { WorkspaceFile } from "@code-agent/protocol";

export interface CodeViewerProps {
  file: WorkspaceFile;
}

export function CodeViewer({ file }: CodeViewerProps) {
  if (file.isBinary) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        二进制文件不支持预览
      </div>
    );
  }

  if (file.truncated && !file.content) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        文件过大（{Math.round(file.size / 1024)} KB），暂不支持预览
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <CodeMirror
        value={file.content}
        height="100%"
        theme="dark"
        readOnly
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
        }}
      />
    </div>
  );
}
