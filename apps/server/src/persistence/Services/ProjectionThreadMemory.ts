/**
 * ProjectionThreadMemoryRepository - Persisted provider-neutral thread memory.
 *
 * Owns compact conversation summaries that can be injected into providers that
 * cannot resume their own durable context.
 *
 * @module ProjectionThreadMemoryRepository
 */
import {
  IsoDateTime,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadMemory = Schema.Struct({
  threadId: ThreadId,
  summary: TrimmedNonEmptyString,
  coveredMessageId: Schema.NullOr(MessageId),
  coveredUpdatedAt: Schema.NullOr(IsoDateTime),
  recentMessageCount: Schema.Number,
  tokenEstimate: Schema.Number,
  sourceProviderInstanceId: Schema.NullOr(ProviderInstanceId),
  sourceModel: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadMemory = typeof ProjectionThreadMemory.Type;

export const GetProjectionThreadMemoryInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionThreadMemoryInput = typeof GetProjectionThreadMemoryInput.Type;

export const DeleteProjectionThreadMemoryInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadMemoryInput = typeof DeleteProjectionThreadMemoryInput.Type;

export interface ProjectionThreadMemoryRepositoryShape {
  readonly upsert: (
    memory: ProjectionThreadMemory,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getByThreadId: (
    input: GetProjectionThreadMemoryInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadMemory>, ProjectionRepositoryError>;

  readonly deleteByThreadId: (
    input: DeleteProjectionThreadMemoryInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadMemoryRepository extends Context.Service<
  ProjectionThreadMemoryRepository,
  ProjectionThreadMemoryRepositoryShape
>()("t3/persistence/Services/ProjectionThreadMemory/ProjectionThreadMemoryRepository") {}
