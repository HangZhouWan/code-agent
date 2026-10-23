/**
 * SQLite EventLog
 */

import type { EventLog } from "@code-agent/runtime";
import {
  asRunId,
  asSessionId,
  type EventEnvelope,
  type SessionEvent,
  type SessionId,
} from "@code-agent/protocol";
import type { ServerDb } from "../db/server-db.js";

interface EventRow {
  id: string;
  session_id: string;
  run_id: string;
  seq: number;
  ts: string;
  event: string;
}

function toEnvelope(row: EventRow): EventEnvelope<SessionEvent> {
  return {
    v: 1,
    id: row.id,
    sessionId: asSessionId(row.session_id),
    runId: asRunId(row.run_id),
    seq: row.seq,
    ts: row.ts,
    event: JSON.parse(row.event) as SessionEvent,
  };
}

export class SqliteEventLog implements EventLog {
  constructor(private readonly db: ServerDb) {}

  async append(envelope: EventEnvelope<SessionEvent>): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runtime_events
         (id, session_id, run_id, seq, ts, event) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        envelope.id,
        envelope.sessionId,
        envelope.runId,
        envelope.seq,
        envelope.ts,
        JSON.stringify(envelope.event),
      );
  }

  async since(
    sessionId: SessionId,
    seq: number,
  ): Promise<Array<EventEnvelope<SessionEvent>>> {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, run_id, seq, ts, event
         FROM runtime_events WHERE session_id = ? AND seq > ?
         ORDER BY seq ASC`,
      )
      .all(sessionId, seq) as EventRow[];
    return rows.map(toEnvelope);
  }

  async lastSeq(sessionId: SessionId): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) AS seq
         FROM runtime_events WHERE session_id = ?`,
      )
      .get(sessionId) as { seq: number };
    return row?.seq ?? 0;
  }
}
