# Flujo de mensaje a respuesta

Este documento resume, en pseudocodigo, el recorrido completo desde que el usuario envia un mensaje hasta que la respuesta final aparece terminada en la UI.

La idea es mostrar el flujo real del sistema, incluyendo:

- captura del mensaje en la UI
- envio del turno al server
- arranque de la sesion del provider
- eventos de razonamiento, tool calls y texto final
- reconciliacion de snapshots cuando faltan eventos en vivo
- proyeccion a actividades y timeline
- cierre del turno

## Vista general

```text
Usuario -> ChatView -> WebSocket -> Server -> Provider/OpenCode
       -> Runtime events -> Ingestion -> Orchestration projection
       -> WebSocket push -> UI timeline -> respuesta final
```

## Pseudocodigo

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
  create turnId
  save turnStartedAt
  mark session activeTurnId = turnId
  emit turn.started

  call provider.promptAsync(...) with text + attachments

provider starts processing:
  may emit:
    - reasoning text
    - tool lifecycle parts
    - assistant text
    - session.status busy/idle
    - session.messages snapshots

server ingests provider events:
  for each runtime event:
    if event is reasoning text:
      emit content.delta(streamKind = reasoning_text)
      project task.progress / work log entry

    if event is tool lifecycle:
      emit item.started / item.updated / item.completed
      project tool.started / tool.updated / tool.completed

    if event is assistant text:
      emit content.delta(streamKind = assistant_text)
      if text completes:
        emit item.completed for assistant message

    if event is session.status idle or session.idle:
      reconcile session.messages snapshot
      if snapshot contains assistant message text:
        emit missing assistant text deltas
        emit missing tool lifecycle rows
      clear activeTurnId
      emit turn.completed

if live events are incomplete:
  fallback poller:
    while turn still active:
      read session.messages
      if completed assistant message exists:
        reconstruct assistant content
        reconstruct tool rows
        emit any missing runtime events
        close turn

projection pipeline:
  store runtime events as thread activities
  normalize activities into:
    - work log rows
    - assistant messages
    - turn diff summaries
    - pending approvals / user inputs

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

Because of that, the server must not trust only one signal.
It needs both live event handling and snapshot reconciliation.
```

## Key rules

```text
rule 1: never close a turn just because reasoning appeared
rule 2: close a turn only when there is a renderable assistant answer
rule 3: keep tool.updated / tool.completed rows separate
rule 4: if a tool event arrives without a usable turnId, recover it from the active turn window
rule 5: prefer reconciliation from session.messages when the live stream is incomplete
```

## Important files

- [apps/web/src/components/ChatView.tsx](../apps/web/src/components/ChatView.tsx)
- [apps/web/src/session-logic.ts](../apps/web/src/session-logic.ts)
- [apps/web/src/components/chat/MessagesTimeline.logic.ts](../apps/web/src/components/chat/MessagesTimeline.logic.ts)
- [apps/server/src/provider/Layers/OpenCodeAdapter.ts](../apps/server/src/provider/Layers/OpenCodeAdapter.ts)
- [apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts](../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts)
- [apps/server/src/orchestration/projector.ts](../apps/server/src/orchestration/projector.ts)

## Short mental model

```text
User message enters once.
Provider may speak in pieces.
Server must rebuild the full story.
UI only renders what the projection preserves.
```
