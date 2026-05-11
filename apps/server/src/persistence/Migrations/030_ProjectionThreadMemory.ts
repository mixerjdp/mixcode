import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const ensureProjectionThreadMemorySchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_memory (
      thread_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      covered_message_id TEXT,
      covered_updated_at TEXT,
      recent_message_count INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      source_provider_instance_id TEXT,
      source_model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_memory_updated_at
    ON projection_thread_memory(updated_at)
  `;
});

export default ensureProjectionThreadMemorySchema;
