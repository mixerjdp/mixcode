import { describe, expect, it } from "vitest";
import { MessageId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import {
  buildThreadMemoryContext,
  buildThreadMemorySummary,
  hasUsableProviderResumeCursor,
  shouldCompactThreadMemory,
} from "./ThreadMemory.ts";

describe("ThreadMemory", () => {
  it("builds restored context from persisted memory and recent messages", () => {
    const context = buildThreadMemoryContext({
      memory: {
        threadId: ThreadId.make("thread-1"),
        summary: "El usuario estaba depurando memoria entre sesiones.",
        coveredMessageId: MessageId.make("message-1"),
        coveredUpdatedAt: "2026-05-11T00:00:00.000Z",
        recentMessageCount: 2,
        tokenEstimate: 20,
        sourceProviderInstanceId: ProviderInstanceId.make("opencode"),
        sourceModel: "deepseek/v4-flash",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:00.000Z",
      },
      currentMessageId: "message-current",
      messages: [
        {
          id: MessageId.make("message-previous"),
          role: "user",
          text: "holi hola cuentame un chiste",
          streaming: false,
          attachments: [],
          turnId: null,
          createdAt: "2026-05-11T00:00:00.000Z",
          updatedAt: "2026-05-11T00:00:00.000Z",
        },
        {
          id: MessageId.make("message-current"),
          role: "user",
          text: "que hemos platicado?",
          streaming: false,
          attachments: [],
          turnId: null,
          createdAt: "2026-05-11T00:01:00.000Z",
          updatedAt: "2026-05-11T00:01:00.000Z",
        },
      ],
    });

    expect(context?.conversationSummary).toContain("memoria entre sesiones");
    expect(context?.recentMessages).toHaveLength(1);
    expect(context?.recentMessages?.[0]?.text).toBe("holi hola cuentame un chiste");
  });

  it("compacts when enough new messages accumulated", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: MessageId.make(`message-${index}`),
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `message ${index}`,
      streaming: false,
      attachments: [],
      turnId: null,
      createdAt: `2026-05-11T00:00:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-05-11T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));

    expect(shouldCompactThreadMemory({ memory: null, messages })).toBe(true);
  });

  it("does not compact tiny threads that can be restored from recent messages", () => {
    expect(
      shouldCompactThreadMemory({
        memory: null,
        messages: [
          {
            id: MessageId.make("message-short"),
            role: "user",
            text: "hola",
            streaming: false,
            attachments: [],
            turnId: null,
            createdAt: "2026-05-11T00:00:00.000Z",
            updatedAt: "2026-05-11T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(false);
  });

  it("waits until the restored context is near 100k tokens before compacting by size", () => {
    expect(
      shouldCompactThreadMemory({
        memory: {
          threadId: ThreadId.make("thread-memory-threshold"),
          summary: "Resumen previo",
          coveredMessageId: null,
          coveredUpdatedAt: null,
          recentMessageCount: 0,
          tokenEstimate: 0,
          sourceProviderInstanceId: null,
          sourceModel: null,
          createdAt: "2026-05-11T00:00:00.000Z",
          updatedAt: "2026-05-11T00:00:00.000Z",
        },
        messages: [
          {
            id: MessageId.make("message-99k-chars"),
            role: "assistant",
            text: "x".repeat(99_000),
            streaming: false,
            attachments: [],
            turnId: null,
            createdAt: "2026-05-11T00:00:00.000Z",
            updatedAt: "2026-05-11T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(false);
  });

  it("keeps the summary provider neutral", () => {
    const summary = buildThreadMemorySummary({
      previousSummary: null,
      activities: [],
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "user",
          text: "quiero que recuerdes esta conversacion",
          streaming: false,
          attachments: [],
          turnId: null,
          createdAt: "2026-05-11T00:00:00.000Z",
          updatedAt: "2026-05-11T00:00:00.000Z",
        },
      ],
    });

    expect(summary).toContain("Resumen persistente");
    expect(summary).toContain("quiero que recuerdes");
  });

  it("treats null and undefined resume cursors as unusable", () => {
    expect(hasUsableProviderResumeCursor(undefined)).toBe(false);
    expect(hasUsableProviderResumeCursor(null)).toBe(false);
    expect(hasUsableProviderResumeCursor({ threadId: "provider-thread" })).toBe(true);
  });
});
