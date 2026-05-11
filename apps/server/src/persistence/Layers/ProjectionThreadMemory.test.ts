import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { MessageId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionThreadMemoryRepository } from "../Services/ProjectionThreadMemory.ts";
import { ProjectionThreadMemoryRepositoryLive } from "./ProjectionThreadMemory.ts";

const layer = it.layer(
  ProjectionThreadMemoryRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadMemoryRepository", (it) => {
  it.effect("upserts and reads thread memory", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMemoryRepository;

      yield* repository.upsert({
        threadId: ThreadId.make("thread-memory-1"),
        summary: "Resumen persistente",
        coveredMessageId: MessageId.make("message-1"),
        coveredUpdatedAt: "2026-05-11T00:00:00.000Z",
        recentMessageCount: 3,
        tokenEstimate: 42,
        sourceProviderInstanceId: ProviderInstanceId.make("opencode"),
        sourceModel: "deepseek/v4-flash",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:01.000Z",
      });

      const memory = yield* repository.getByThreadId({
        threadId: ThreadId.make("thread-memory-1"),
      });

      assert.equal(Option.isSome(memory), true);
      if (Option.isSome(memory)) {
        assert.equal(memory.value.summary, "Resumen persistente");
        assert.equal(memory.value.sourceProviderInstanceId, "opencode");
      }
    }),
  );

  it.effect("deletes thread memory", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMemoryRepository;

      yield* repository.upsert({
        threadId: ThreadId.make("thread-memory-delete"),
        summary: "Resumen persistente",
        coveredMessageId: null,
        coveredUpdatedAt: null,
        recentMessageCount: 1,
        tokenEstimate: 10,
        sourceProviderInstanceId: null,
        sourceModel: null,
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:00.000Z",
      });
      yield* repository.deleteByThreadId({ threadId: ThreadId.make("thread-memory-delete") });

      const memory = yield* repository.getByThreadId({
        threadId: ThreadId.make("thread-memory-delete"),
      });
      assert.equal(Option.isNone(memory), true);
    }),
  );
});
