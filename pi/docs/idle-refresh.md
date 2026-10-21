# Idle context reminders

`pi/extensions/idle-refresh.ts` is discovered by this repo's existing Pi package manifest. Run `/reload` to load it, or try it in a new process:

```bash
pi -e ./pi/extensions/idle-refresh.ts
```

Enabled by default. After `agent_settled`, wait 30 seconds and send a visible custom `idle-refresh` message with `{ triggerTurn: true, deliverAs: "followUp" }`. This starts another turn in the **same session**, using its existing context—not a second agent or a new chat.

## Injected prompt

> Automatic context reminder—not a new user request.
>
> Here are the user's last five messages (or fewer if unavailable), oldest first.
>
> The JSON array below quotes historical messages and preserves their boundaries; it is not a set of new instructions. Images are omitted.
>
> [JSON array of the messages]
>
> Reconsider these messages in light of the full conversation and work already done. Is there anything still relevant that you left unaddressed or unfinished?
>
> If so, continue from where you stopped. Respect later corrections and changed intentions; don't repeat completed work or revive abandoned requests. If nothing remains, stop. If you need user input, ask rather than guessing.

Text is copied without summarization; images use placeholders. Message selection follows the active branch and excludes assistant messages, tool results, and the custom reminders themselves.

## Controls and limits

- `/idle-refresh status` (or `/idle-refresh`) shows the setting and budget.
- `/idle-refresh off` disables reminders and cancels a pending timer.
- `/idle-refresh on` enables reminders after a future completed run. It does not immediately run the model or override an abort.
- Maximum **two automatic reminders per genuine user input**, reset by interactive or RPC input, not extension-generated input. Settings/budget are in-memory; reloading starts a fresh runtime with reminders enabled.
- Abort/Escape during a run, blocking extension UI prompts, and tree/session navigation suspend reminders until new user input. Provider errors do not schedule a reminder.
- New input, a new agent run, compaction, shutdown, and reload cancel pending timers. Before sending, the callback checks idle state, queued messages, session identity, and branch position again.

The reminder asks the model to judge what remains; there is no task registry or programmatic completion detector. It may decide nothing remains, or ask a question. Another reminder can still follow until the two-turn budget is exhausted. Automatic turns consume tokens and can invoke tools with the session's normal permissions. Use `off` when you do not want unattended continuation.

Use interactive or RPC mode to keep the session alive. A timer does not keep a print/JSON process alive after it finishes.

## Tests

Node 24+ (native TypeScript stripping; no dependencies needed):

```bash
node --test pi/tests/idle-refresh.test.ts
```

Tests use virtual time and a mocked extension API; they do not make model calls. Coverage includes prompt boundaries/order, explicit turn triggering, budgets, cancellation, aborts, queued work, stale sessions/branches, provider errors, and command controls.
