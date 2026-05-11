import type {
  ModelSelection,
  OrchestrationMessage,
  OrchestrationThreadActivity,
  ProviderTurnContext,
} from "@t3tools/contracts";
import type { ProjectionThreadMemory } from "../persistence/Services/ProjectionThreadMemory.ts";

const COMPACT_AFTER_NEW_MESSAGES = 12;
const COMPACT_AFTER_ESTIMATED_TOKENS = 100_000;
const RECENT_MESSAGE_COUNT = 8;
const MAX_SUMMARY_CHARS = 12_000;
const MAX_RECENT_MESSAGE_CHARS = 2_000;

export function estimateThreadMemoryTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimTo(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

function formatMessage(message: Pick<OrchestrationMessage, "role" | "text" | "createdAt">): string {
  const role =
    message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System";
  return `- ${role} (${message.createdAt}): ${trimTo(message.text, 1_500)}`;
}

function formatActivity(activity: OrchestrationThreadActivity): string | null {
  if (
    activity.kind !== "tool.completed" &&
    activity.kind !== "tool.started" &&
    activity.kind !== "context-compaction" &&
    activity.kind !== "checkpoint.captured"
  ) {
    return null;
  }
  return `- ${activity.summary}`;
}

export function shouldCompactThreadMemory(input: {
  readonly memory: ProjectionThreadMemory | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
}): boolean {
  const completedMessages = input.messages.filter(
    (message) => !message.streaming && message.text.trim().length > 0,
  );
  if (completedMessages.length === 0) {
    return false;
  }

  const coveredUpdatedAt = input.memory?.coveredUpdatedAt ?? null;
  const newMessages =
    coveredUpdatedAt === null
      ? completedMessages
      : completedMessages.filter((message) => message.updatedAt > coveredUpdatedAt);
  const estimatedTokens = estimateThreadMemoryTokens(
    newMessages.map((message) => message.text).join("\n"),
  );

  return (
    newMessages.length >= COMPACT_AFTER_NEW_MESSAGES ||
    estimatedTokens >= COMPACT_AFTER_ESTIMATED_TOKENS
  );
}

export function buildThreadMemorySummary(input: {
  readonly previousSummary?: string | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}): string | null {
  const completedMessages = input.messages.filter(
    (message) => !message.streaming && message.text.trim().length > 0,
  );
  if (completedMessages.length === 0) {
    return null;
  }

  const importantActivities = input.activities
    .map(formatActivity)
    .filter((entry): entry is string => entry !== null)
    .slice(-12);
  const messageLines = completedMessages.slice(-40).map(formatMessage);
  const sections = [
    "Resumen persistente de la conversacion:",
    input.previousSummary?.trim() ? trimTo(input.previousSummary, 4_000) : null,
    "Mensajes y decisiones recientes:",
    ...messageLines,
    importantActivities.length > 0 ? "Actividad tecnica relevante:" : null,
    ...importantActivities,
  ].filter((entry): entry is string => entry !== null && entry.trim().length > 0);

  return trimTo(sections.join("\n"), MAX_SUMMARY_CHARS);
}

export function buildThreadMemoryContext(input: {
  readonly memory: ProjectionThreadMemory | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly currentMessageId: string;
}): ProviderTurnContext | undefined {
  const priorMessages = input.messages.filter(
    (message) =>
      message.id !== input.currentMessageId &&
      message.role !== "system" &&
      !message.streaming &&
      message.text.trim().length > 0,
  );
  const recentMessages = priorMessages.slice(-RECENT_MESSAGE_COUNT).map((message) => ({
    role: message.role,
    text: trimTo(message.text, MAX_RECENT_MESSAGE_CHARS),
    createdAt: message.createdAt,
  }));
  const conversationSummary = input.memory?.summary.trim();

  if (!conversationSummary && recentMessages.length === 0) {
    return undefined;
  }

  return {
    ...(conversationSummary ? { conversationSummary } : {}),
    ...(recentMessages.length > 0 ? { recentMessages } : {}),
    restoredFromMemory: input.memory !== null,
  };
}

export function modelSelectionModel(modelSelection: ModelSelection | undefined): string | null {
  return modelSelection?.model ?? null;
}

export function hasUsableProviderResumeCursor(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export const THREAD_MEMORY_RECENT_MESSAGE_COUNT = RECENT_MESSAGE_COUNT;
