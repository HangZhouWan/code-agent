/**
 * 工作区只读浏览 DTO
 */

import type { IsoTimestamp } from "../json.js";

export type WorkspaceEntryType = "file" | "directory";

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: WorkspaceEntryType;
  size?: number;
  mtime?: IsoTimestamp;
}

export interface WorkspaceFile {
  path: string;
  content: string;
  language?: string;
  encoding: "utf-8";
  size: number;
  isBinary: boolean;
  truncated: boolean;
  mtime: IsoTimestamp;
}

export interface WorkspaceDiff {
  path: string;
  diff: string;
  isNew: boolean;
}

export type GitFileStatusCode = "M" | "A" | "D" | "R" | "U" | "?";

export interface GitFileStatus {
  path: string;
  status: GitFileStatusCode;
  staged: boolean;
}
