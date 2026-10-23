/**
 * Server 持久化端口组合
 */

import {
  SystemClock,
  UuidIdGenerator,
  type CheckpointStore,
  type RuntimePorts,
} from "@code-agent/runtime";
import type { ServerDb } from "../db/server-db.js";
import { SqliteEventLog } from "./sqlite-event-log.js";
import { SqliteRunStore } from "./sqlite-run-store.js";
import { SqliteSessionStore } from "./sqlite-session-store.js";

export function createSqlitePorts(
  db: ServerDb,
  checkpoints: CheckpointStore,
): RuntimePorts {
  return {
    sessions: new SqliteSessionStore(db),
    runs: new SqliteRunStore(db),
    events: new SqliteEventLog(db),
    checkpoints,
    clock: new SystemClock(),
    ids: new UuidIdGenerator(),
  };
}

export {
  SqliteSessionStore,
  SqliteRunStore,
  SqliteEventLog,
};
