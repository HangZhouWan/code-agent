/**
 * 工作区路径安全
 *
 * 所有用户/模型提供的路径都必须经过：
 * 1. resolve 后仍在 workspace root 内
 * 2. 已存在的路径 realpath 后仍在 root 内（防 symlink 逃逸）
 * 3. 不存在路径的最近存在祖先 realpath 后仍在 root 内
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export class PathEscapeError extends Error {
  constructor(inputPath: string) {
    super(`Path escapes workspace: "${inputPath}"`);
    this.name = "PathEscapeError";
  }
}

function assertWithin(root: string, target: string): void {
  if (target === root) return;
  if (!target.startsWith(root + sep)) {
    throw new PathEscapeError(target);
  }
}

function nearestExistingAncestor(target: string): string {
  let current = target;
  for (let i = 0; i < 64; i++) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * 解析工作区内的路径。
 *
 * @throws PathEscapeError 路径穿越 / symlink 逃逸 / null 字节
 */
export function resolveWorkspacePath(
  workspacePath: string,
  inputPath: string,
): string {
  if (inputPath.includes("\0")) {
    throw new PathEscapeError(inputPath);
  }

  const root = resolve(workspacePath);
  const target = resolve(root, inputPath);
  assertWithin(root, target);

  const realRoot = existsSync(root) ? realpathSync(root) : root;
  const ancestor = nearestExistingAncestor(target);
  const realAncestor = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
  assertWithin(realRoot, realAncestor);

  return target;
}

export function isPathWithin(
  workspacePath: string,
  inputPath: string,
): boolean {
  try {
    resolveWorkspacePath(workspacePath, inputPath);
    return true;
  } catch {
    return false;
  }
}
