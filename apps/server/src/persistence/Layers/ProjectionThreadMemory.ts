import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import { ensureProjectionThreadMemorySchema } from "../Migrations/030_ProjectionThreadMemory.ts";
import {
  DeleteProjectionThreadMemoryInput,
  GetProjectionThreadMemoryInput,
  ProjectionThreadMemory,
  ProjectionThreadMemoryRepository,
  type ProjectionThreadMemoryRepositoryShape,
} from "../Services/ProjectionThreadMemory.ts";

const makeProjectionThreadMemoryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureProjectionThreadMemorySchema.pipe(
    Effect.mapError(toPersistenceSqlError("ProjectionThreadMemoryRepository.ensureSchema")),
  );

  const upsertProjectionThreadMemoryRow = SqlSchema.void({
    Request: ProjectionThreadMemory,
    execute: (row) => sql`
      INSERT INTO projection_thread_memory (
        thread_id,
        summary,
        covered_message_id,
        covered_updated_at,
        recent_message_count,
        token_estimate,
        source_provider_instance_id,
        source_model,
        created_at,
        updated_at
      )
      VALUES (
        ${row.threadId},
        ${row.summary},
        ${row.coveredMessageId},
        ${row.coveredUpdatedAt},
        ${row.recentMessageCount},
        ${row.tokenEstimate},
        ${row.sourceProviderInstanceId},
        ${row.sourceModel},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (thread_id)
      DO UPDATE SET
        summary = excluded.summary,
        covered_message_id = excluded.covered_message_id,
        covered_updated_at = excluded.covered_updated_at,
        recent_message_count = excluded.recent_message_count,
        token_estimate = excluded.token_estimate,
        source_provider_instance_id = excluded.source_provider_instance_id,
        source_model = excluded.source_model,
        updated_at = excluded.updated_at
    `,
  });

  const getProjectionThreadMemoryRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadMemoryInput,
    Result: ProjectionThreadMemory,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        summary,
        covered_message_id AS "coveredMessageId",
        covered_updated_at AS "coveredUpdatedAt",
        recent_message_count AS "recentMessageCount",
        token_estimate AS "tokenEstimate",
        source_provider_instance_id AS "sourceProviderInstanceId",
        source_model AS "sourceModel",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_thread_memory
      WHERE thread_id = ${threadId}
      LIMIT 1
    `,
  });

  const deleteProjectionThreadMemoryRow = SqlSchema.void({
    Request: DeleteProjectionThreadMemoryInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_memory
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadMemoryRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadMemoryRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadMemoryRepository.upsert:query")),
    );

  const getByThreadId: ProjectionThreadMemoryRepositoryShape["getByThreadId"] = (input) =>
    getProjectionThreadMemoryRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMemoryRepository.getByThreadId:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadMemoryRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadMemoryRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMemoryRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByThreadId,
    deleteByThreadId,
  } satisfies ProjectionThreadMemoryRepositoryShape;
});

export const ProjectionThreadMemoryRepositoryLive = Layer.effect(
  ProjectionThreadMemoryRepository,
  makeProjectionThreadMemoryRepository,
);
