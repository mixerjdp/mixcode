# Flujo de mensaje a respuesta

Este documento resume, en pseudocodigo, el recorrido completo desde que el usuario envia un mensaje hasta que la respuesta final aparece terminada en la UI.

La parte importante: T3 no puede confiar en una sola senal de OpenCode. El provider puede emitir eventos en vivo, guardar snapshots en `session.messages`, cambiar `session.status`, o dejar de emitir `session.idle`. Por eso el server combina streaming, reconciliacion, memoria persistente y un fallback poller conservador.

## Vista general

```text
Usuario -> ChatView -> WebSocket -> Server -> Provider/OpenCode
       -> Runtime events -> Ingestion -> Orchestration projection
       -> WebSocket push -> UI timeline -> respuesta final
```

## Crear o reabrir thread

```text
onThreadOpen(threadId):
  load projected thread:
    - projection_thread_messages
    - projection_thread_activities
    - provider session binding/runtime state
    - projection_thread_memory if present

  render historical chat from projection

  note:
    visual history is not automatically provider context
    old messages must be reintroduced through native resume or T3 memory
```

## Enviar mensaje

```text
onUserPressSend(message):
  composer read input
  create optimistic user message
  persist thread settings for next turn
  dispatch command thread.turn.start
  mark thread/session as working

server receives thread.turn.start:
  validate request
  resolve provider/model/runtime mode
  resolve thread and current message
  ensure provider session exists

  load thread memory:
    memory = projection_thread_memory[threadId]
    providerSession = active provider session for thread

  decide restored context:
    if provider has usable native resumeCursor:
      use native provider continuity
      do not inject T3 memory
    else if thread has prior projected messages or memory:
      build context:
        - conversationSummary from memory
        - last 8 recent non-system messages
        - restoredFromMemory = true
    else:
      no extra context

  create turnId
  save turnStartedAt
  mark session activeTurnId = turnId
  emit turn.started

  call provider.sendTurn(...)
```

## OpenCode sendTurn

```text
OpenCodeAdapter.sendTurn(input):
  build prompt parts:
    if input.context exists:
      prepend hidden text block:
        "Contexto restaurado de esta conversacion anterior..."
        summary
        recent messages
        instruction:
          "No digas que es conversacion nueva si el usuario pregunta que han hablado."

    append current user text
    append file attachment parts

  set activeTurnId
  set turnStartedAt
  set active agent/variant
  mark provider session running
  emit turn.started

  call session.promptAsync(parts)

  start fallback poller in session scope
```

## Eventos en vivo del provider

```text
provider event.subscribe emits events:
  may emit:
    - reasoning text
    - tool lifecycle parts
    - assistant text
    - permission/question requests
    - session.status busy/idle
    - session.idle

OpenCodeAdapter handles each event:
  if event belongs to a different OpenCode session:
    ignore it

  write native event best-effort for debugging

  if event is reasoning text:
    emit content.delta(streamKind = reasoning_text)

  if event is tool lifecycle:
    emit item.started / item.updated / item.completed

  if event is assistant text:
    emit content.delta(streamKind = assistant_text)
    if text completes:
      emit item.completed for assistant message

  if event is session.status idle or session.idle:
    reconcile session.messages snapshot
    emit missing assistant text deltas
    emit missing tool lifecycle rows
    clear activeTurnId
    mark provider session ready
    emit turn.completed
```

## Fallback poller

```text
fallback poller:
  while activeTurnId is current turn:
    reconciliation = read session.messages

    from session.messages:
      collect assistant messages created after turnStartedAt
      emit missing reasoning text
      emit missing assistant text
      emit missing tool lifecycle rows
      compute:
        hasRenderableAssistantText
        hasIncompleteToolCall
        fingerprint of completed assistant snapshots

    sessionStatus = read session.status

    if sessionStatus == idle and hasRenderableAssistantText:
      complete turn
      stop polling

    if session.status is unavailable:
      only complete when:
        - hasRenderableAssistantText
        - no pending/running tool call
        - completed snapshot fingerprint stayed stable for several polls

    if sessionStatus == busy:
      keep polling

    sleep 500ms
```

## Why the poller is conservative

```text
Bad behavior to avoid:
  OpenCode writes "Listo. Verifiquemos el resultado final:"
  session.messages contains renderable assistant text
  OpenCode is still busy and will run more reads/tools
  T3 closes the turn too early

Current behavior:
  render/reconcile the intermediate text
  keep thread working while session.status is busy
  wait for idle or stable final snapshot
```

## Runtime ingestion

```text
projection pipeline:
  receive ProviderRuntimeEvent
  store runtime events as projected activities/messages

  normalize events into:
    - work log rows
    - assistant messages
    - turn diff summaries
    - pending approvals / user inputs

  on assistant text delta:
    append to projected assistant message

  on tool lifecycle:
    append or update work log entry

  on turn.completed:
    finalize assistant messages for turn
    clear active provider turn
    evaluate thread memory compaction
```

## Memoria persistente T3

```text
after turn.completed:
  load resolved thread details
  load existing projection_thread_memory

  shouldCompactThreadMemory when:
    - more than 12 completed messages since coveredMessageId
    - estimated thread tokens >= 100000

  if compaction needed:
    build summary from:
      - previous summary
      - new completed user/assistant messages
      - important work log activities
      - checkpoints/diffs when available

    save projection_thread_memory:
      - summary
      - coveredMessageId
      - coveredUpdatedAt
      - recentMessageCount
      - tokenEstimate
      - sourceProviderInstanceId
      - sourceModel
      - createdAt / updatedAt

    emit context-compaction activity
```

## UI render

```text
UI re-renders:
  derive timeline rows from:
    - messages
    - proposed plans
    - work log entries

  if thread is still working:
    show working indicator

  if turn is completed:
    show final assistant message and tool rows

end:
  user sees the assistant response fully rendered
  composer unlocks for the next prompt
```

## What makes this tricky

```text
The provider can finish the turn in more than one way:

1. live stream emits the final assistant text
2. live stream misses parts, but session.messages contains them
3. session.idle arrives before all lifecycle parts are projected
4. session.messages contains intermediate assistant text while session.status is still busy
5. app/server restarts and the provider cannot resume native context

Because of that, the server must not trust only one signal.
It needs live event handling, snapshot reconciliation, session.status checks,
and provider-neutral memory restoration.
```

## Key rules

```text
rule 1: never close a turn just because reasoning appeared
rule 2: never close a turn just because any assistant text appeared
rule 3: close immediately only on authoritative idle + renderable assistant answer
rule 4: if session.status is unavailable, require stable snapshots and no active tools
rule 5: keep tool.updated / tool.completed rows separate
rule 6: prefer reconciliation from session.messages when the live stream is incomplete
rule 7: when native resume is unavailable, inject T3 memory as hidden provider context
rule 8: memory never replaces visual history; projection_thread_messages remains source for UI
```

## Important files

- [apps/web/src/components/ChatView.tsx](../apps/web/src/components/ChatView.tsx)
- [apps/web/src/session-logic.ts](../apps/web/src/session-logic.ts)
- [apps/web/src/components/chat/MessagesTimeline.logic.ts](../apps/web/src/components/chat/MessagesTimeline.logic.ts)
- [apps/server/src/provider/Layers/OpenCodeAdapter.ts](../apps/server/src/provider/Layers/OpenCodeAdapter.ts)
- [apps/server/src/orchestration/Layers/ProviderCommandReactor.ts](../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts)
- [apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts](../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts)
- [apps/server/src/orchestration/ThreadMemory.ts](../apps/server/src/orchestration/ThreadMemory.ts)
- [apps/server/src/persistence/Services/ProjectionThreadMemory.ts](../apps/server/src/persistence/Services/ProjectionThreadMemory.ts)
- [apps/server/src/persistence/Layers/ProjectionThreadMemory.ts](../apps/server/src/persistence/Layers/ProjectionThreadMemory.ts)
- [apps/server/src/orchestration/projector.ts](../apps/server/src/orchestration/projector.ts)

## Short mental model

```text
User message enters once.
Provider may speak in pieces.
Server must rebuild the full story.
UI only renders what the projection preserves.
Old chats need memory or native resume to become provider context again.
```
