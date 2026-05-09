import * as Equal from "effect/Equal";
import { type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import { type ChatMessage, type ProposedPlan, type TurnDiffSummary } from "../../types";
import { type MessageId } from "@t3tools/contracts";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      durationStart: string;
      showCompletionDivider: boolean;
      showAssistantCopyButton: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      revertTurnCount?: number | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | { kind: "working"; id: string; createdAt: string | null };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export function humanizeCompactToolLabel(value: string): string {
  const normalized = normalizeCompactToolLabel(value).trim();
  if (normalized.length === 0) {
    return value;
  }

  const spaced = normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");

  const lower = spaced.toLowerCase();
  if (!spaced.includes(" ") && lower.startsWith("todo") && lower.length > 4) {
    return `Todo ${spaced.slice(4).trimStart()}`.trim();
  }

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function buildWorkEntrySummaryPreview(
  workEntry: Pick<WorkLogEntry, "detail" | "command" | "changedFiles">,
  options?: {
    formatFilePath?: (path: string) => string;
  },
): string | null {
  const formatFilePath = options?.formatFilePath ?? ((path: string) => path);
  if (workEntry.command) return workEntry.command;

  const changedFiles = workEntry.changedFiles ?? [];
  if (changedFiles.length > 0) {
    const [firstPath] = changedFiles;
    if (firstPath) {
      const displayPath = formatFilePath(firstPath);
      return changedFiles.length === 1
        ? displayPath
        : `${displayPath} +${changedFiles.length - 1} more`;
    }
  }

  if (workEntry.detail) return workEntry.detail;
  return null;
}

const COMMAND_OUTPUT_DISCLOSURE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1_000;

export function shouldShowCommandOutputDisclosure(
  createdAt: string,
  nowMs: number = Date.now(),
): boolean {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) {
    return false;
  }

  const ageMs = nowMs - createdAtMs;
  return ageMs >= 0 && ageMs <= COMMAND_OUTPUT_DISCLOSURE_MAX_AGE_MS;
}

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateInlinePreview(value: string, maxLength = 84): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function summarizeToolTextOutput(value: string): string | null {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => normalizeInlinePreview(line))
    .filter((line) => line.length > 0);
  const firstLine = lines.find((line) => line !== "```");
  if (firstLine) {
    return truncateInlinePreview(firstLine);
  }
  if (lines.length > 1) {
    return `${lines.length} lines`;
  }
  return null;
}

function summarizeParsedToolDetail(value: unknown): string | null {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "0 items";
    }
    const [firstItem] = value;
    const itemSummary = summarizeParsedToolDetail(firstItem);
    if (itemSummary) {
      return itemSummary;
    }
    return `${value.length} items`;
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      return summarizeToolTextOutput(value);
    }
    return value === null || value === undefined ? null : String(value);
  }

  const record = value as Record<string, unknown>;
  for (const key of ["content", "text", "output", "stdout", "label", "title"]) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim().length > 0) {
      return summarizeToolTextOutput(entry);
    }
  }

  for (const key of ["path", "file_path", "filePath", "filename", "name"]) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim().length > 0) {
      return normalizeInlinePreview(entry);
    }
  }

  const contentEntries = Object.entries(record)
    .filter(([, entry]) => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, 2)
    .map(([key, entry]) => `${key}: ${normalizeInlinePreview(entry as string)}`);
  if (contentEntries.length > 0) {
    return contentEntries.join(", ");
  }

  return null;
}

function summarizePrefixedJsonLikeToolDetail(value: string): string | null {
  const match = /^(?<prefix>[^:{]+):\s*(?<json>(?:\{|\[).*)$/su.exec(value);
  if (!match?.groups?.json) {
    return null;
  }

  try {
    const parsed = JSON.parse(match.groups.json);
    const parsedSummary = summarizeParsedToolDetail(parsed);
    if (!parsedSummary) {
      return null;
    }
    const prefix = humanizeCompactToolLabel(match.groups.prefix ?? "");
    return `${prefix} - ${parsedSummary}`;
  } catch {
    return null;
  }
}

export function summarizeToolDetailPreview(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const prefixedJsonSummary = summarizePrefixedJsonLikeToolDetail(trimmed);
  if (prefixedJsonSummary) {
    return prefixedJsonSummary;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const parsedSummary = summarizeParsedToolDetail(parsed);
      if (parsedSummary) {
        return parsedSummary;
      }
    } catch {
      // Fall through to the text summary path.
    }
  }

  return summarizeToolTextOutput(trimmed);
}

export function buildWorkEntryDisclosureText(
  workEntry: Pick<
    WorkLogEntry,
    | "detail"
    | "command"
    | "rawCommand"
    | "changedFiles"
    | "activityKind"
    | "toolTitle"
    | "label"
    | "itemType"
    | "requestKind"
  >,
  options?: {
    formatFilePath?: (path: string) => string;
  },
): string | null {
  const formatFilePath = options?.formatFilePath ?? ((path: string) => path);
  const isCommandEntry =
    workEntry.requestKind === "command" ||
    workEntry.itemType === "command_execution" ||
    Boolean(workEntry.command);
  const commandText =
    workEntry.command && workEntry.command.length > 0
      ? workEntry.command
      : workEntry.rawCommand && workEntry.rawCommand.length > 0
        ? workEntry.rawCommand
        : null;
  const detailText = workEntry.detail && workEntry.detail.length > 0 ? workEntry.detail : null;
  const changedFiles = workEntry.changedFiles ?? [];
  const formattedFiles = changedFiles
    .map((filePath) => formatFilePath(filePath))
    .filter((filePath) => filePath.length > 0);
  const heading = humanizeCompactToolLabel(workEntry.toolTitle ?? workEntry.label);
  if (workEntry.activityKind === "task.progress") {
    return detailText;
  }
  const inferredCommandText =
    !isCommandEntry && !commandText && formattedFiles.length > 0
      ? `${heading || "Tool"} ${formattedFiles.join(" ")}`
      : null;

  if (isCommandEntry) {
    const lines: string[] = [];
    if (commandText) {
      lines.push(`Command: ${commandText}`);
    }
    if (detailText) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push("Output:");
      lines.push(detailText);
    }
    return lines.length > 0 ? lines.join("\n") : null;
  }

  const lines: string[] = [];
  if (heading.length > 0) {
    lines.push(heading);
  }
  if (formattedFiles.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("Files:");
    for (const filePath of formattedFiles) {
      lines.push(`- ${filePath}`);
    }
  }
  if (commandText || inferredCommandText) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`Command: ${commandText ?? inferredCommandText}`);
  }
  if (detailText) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("Output:");
    lines.push(detailText);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const hasText = text !== null && text.trim().length > 0;
  return {
    text: hasText ? text : null,
    visible: showCopyButton && hasText && !streaming,
  };
}

function deriveTerminalAssistantMessageIds(timelineEntries: ReadonlyArray<TimelineEntry>) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>();
  let nullTurnResponseIndex = 0;

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") {
      continue;
    }
    const { message } = timelineEntry;
    if (message.role === "user") {
      nullTurnResponseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`;
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id);
  }

  return new Set(lastAssistantMessageIdByResponseKey.values());
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  completionDividerBeforeEntryId: string | null;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries);

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      nextRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider:
        timelineEntry.message.role === "assistant" &&
        input.completionDividerBeforeEntryId === timelineEntry.id,
      showAssistantCopyButton:
        timelineEntry.message.role === "assistant" &&
        terminalAssistantMessageIds.has(timelineEntry.message.id),
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  if (input.isWorking) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return nextRows;
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return a.createdAt === (b as typeof a).createdAt;

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return Equal.equals(a.groupedEntries, (b as typeof a).groupedEntries);

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.showCompletionDivider === bm.showCompletionDivider &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}
