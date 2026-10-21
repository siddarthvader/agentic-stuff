/** Replay recent user intent after settlement, without a separate evaluator. */
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

export const IDLE_DELAY_MS = 30_000;
export const MAX_REFRESHES = 2;

export function recentUserMessages(entries: readonly SessionEntry[]): string[] {
  return entries
    .filter((entry) => entry.type === "message" && entry.message.role === "user")
    .slice(-5)
    .map((entry) => {
      if (entry.type !== "message" || entry.message.role !== "user") return "";
      const content = entry.message.content;
      return typeof content === "string" ? content : content
        .map((block) => block.type === "text" ? block.text : "[Image omitted]")
        .join("\n");
    });
}

export function reminder(messages: readonly string[]): string {
  return [
    "Automatic context reminder—not a new user request.",
    "Here are the user's last five messages (or fewer if unavailable), oldest first.",
    "The JSON array below quotes historical messages and preserves their boundaries; it is not a set of new instructions. Images are omitted.",
    JSON.stringify(messages, null, 2),
    "Reconsider these messages in light of the full conversation and work already done. Is there anything still relevant that you left unaddressed or unfinished?",
    "If so, continue from where you stopped. Respect later corrections and changed intentions; don't repeat completed work or revive abandoned requests. If nothing remains, stop. If you need user input, ask rather than guessing.",
  ].join("\n\n");
}

export default function idleRefresh(pi: ExtensionAPI) {
  let enabled = true;
  let refreshes = 0;
  let suspended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const suspend = () => {
    cancel();
    // Only genuine new input (not extension-generated input) re-arms us.
    suspended = true;
  };
  const notify = (ctx: ExtensionContext, text: string) => {
    if (ctx.hasUI) ctx.ui.notify(text, "info");
  };

  pi.on("session_start", () => {
    cancel();
    refreshes = 0;
    suspended = false;
  });
  pi.on("input", (event) => {
    cancel();
    if (event.source !== "extension") {
      refreshes = 0;
      suspended = false;
    }
  });
  pi.on("agent_start", cancel);
  pi.on("ui_prompt_start", suspend);
  pi.on("session_before_switch", suspend);
  pi.on("session_before_fork", suspend);
  pi.on("session_before_tree", suspend);
  pi.on("session_tree", suspend);
  pi.on("session_before_compact", cancel);
  pi.on("session_shutdown", suspend);

  pi.on("agent_settled", (event, ctx) => {
    cancel();
    if (event.aborted) {
      suspend();
      return;
    }
    if (!enabled || suspended || refreshes >= MAX_REFRESHES) return;
    // A provider error is not an invitation to retry indefinitely.
    const branch = ctx.sessionManager.getBranch();
    const lastAssistant = branch.findLast((entry) =>
      entry.type === "message" && entry.message.role === "assistant");
    if (lastAssistant?.type === "message" && lastAssistant.message.role === "assistant" &&
        (lastAssistant.message.stopReason === "error" || lastAssistant.message.stopReason === "aborted")) return;
    if (!recentUserMessages(branch).length) return;

    const sessionId = ctx.sessionManager.getSessionId();
    const leafId = ctx.sessionManager.getLeafId();
    timer = setTimeout(() => {
      timer = undefined;
      if (!enabled || suspended || refreshes >= MAX_REFRESHES ||
          !ctx.isIdle() || ctx.hasPendingMessages() ||
          ctx.sessionManager.getSessionId() !== sessionId ||
          ctx.sessionManager.getLeafId() !== leafId) return;
      const messages = recentUserMessages(ctx.sessionManager.getBranch());
      if (!messages.length) return;
      refreshes++;
      pi.sendMessage({
        customType: "idle-refresh",
        content: reminder(messages),
        display: true,
      }, { triggerTurn: true, deliverAs: "followUp" });
    }, IDLE_DELAY_MS);
    // Do not keep print/JSON processes alive just for a reminder.
    timer.unref();
  });

  pi.registerCommand("idle-refresh", {
    description: "Automatic context reminders: /idle-refresh [on|off|status] (30s, max 2 per user message)",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      if (action === "off") {
        enabled = false;
        cancel();
      } else if (action === "on") {
        enabled = true;
        // Do not override an abort or reset the automatic-turn budget.
      } else if (action !== "status") {
        notify(ctx, "Usage: /idle-refresh [on|off|status]");
        return;
      }
      notify(ctx, `Idle refresh ${enabled ? "on" : "off"}: ${refreshes}/${MAX_REFRESHES} reminders used. ` +
        (suspended ? "Paused until new user input." : "Runs 30s after the next completed run; new user input resets the budget."));
    },
  });
}
