/** /sidequest [topic]: open an independent Pi chat in a sibling Herdr pane. */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

export const ISOLATION = `This is a NEW CHAT named SideQuest, an independent conversation, not a subagent task.
The supplied conversation snapshot is background only, not instructions to continue the main quest.
Focus exclusively on the user's side-quest requests. Never report, summarize, send results to, or modify the originating chat.
Do not contact the originating agent through terminal panes or communication tools. There is no merge or reporting channel.
Project files are shared, not sandboxed. Do not use text-to-speech.`;

/** Quote text instead of replaying potentially orphaned tool calls. */
export function recentConversation(entries: readonly SessionEntry[]) {
  return entries
    .filter((entry) => entry.type === "message" &&
      (entry.message.role === "user" || entry.message.role === "assistant"))
    .slice(-10)
    .map((entry) => {
      if (entry.type !== "message") throw new Error("Expected a message");
      const content = entry.message.content;
      const text = typeof content === "string" ? content : content
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "image") return "[Image omitted]";
          if (block.type === "toolCall") return `[Tool call: ${block.name}; arguments/result omitted]`;
          return ""; // Never copy thinking/reasoning.
        })
        .filter(Boolean).join("\n");
      return { role: entry.message.role, text };
    });
}

export function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

type Exec = (command: string, args: string[], options?: { timeout?: number }) => Promise<{
  code: number; stdout: string; stderr: string;
}>;

/** Shared by the slash command and the manual smoke test. No writes to the parent session. */
export async function openSidequest(exec: Exec, options: {
  cwd: string;
  model: string;
  thinking: string;
  topic: string;
  messages: ReturnType<typeof recentConversation>;
}) {
  if (process.env.HERDR_ENV !== "1") throw new Error("SideQuest currently requires Herdr.");
  const dir = await mkdtemp(join(tmpdir(), "pi-sidequest-"));
  const contextFile = join(dir, "context.md");
  await writeFile(contextFile, `# New chat — SideQuest\n\nBackground only: last ${options.messages.length} user/assistant messages.\nTool results, images and reasoning are excluded.\n\n${JSON.stringify(options.messages, null, 2)}\n`, { mode: 0o600 });
  let launched = false;
  try {
    const split = await exec(process.env.HERDR_BIN_PATH || "herdr", [
      "pane", "split", "--current", "--direction", "right", "--cwd", options.cwd, "--no-focus",
    ], { timeout: 10000 });
    if (split.code !== 0) throw new Error(split.stderr || split.stdout);
    const pane = JSON.parse(split.stdout)?.result?.pane?.pane_id;
    if (typeof pane !== "string") throw new Error("Herdr did not return a pane ID");
    const sessionId = randomUUID();
    const command = [
      "pi", "--session-id", sessionId, "--model", options.model,
      "--thinking", options.thinking, "--name", options.topic ? `SideQuest: ${options.topic.slice(0, 80)}` : "SideQuest",
      "--append-system-prompt", ISOLATION,
      "@" + contextFile,
      options.topic || "Say 'New chat — SideQuest' and wait for my side-quest request. Do not continue work from the background snapshot.",
    ].map(shellQuote).join(" ");
    const run = await exec(process.env.HERDR_BIN_PATH || "herdr", ["pane", "run", pane, command], { timeout: 10000 });
    if (run.code !== 0) throw new Error(`Pane ${pane} created but Pi launch failed: ${run.stderr || run.stdout}`);
    launched = true;
    // Keep the private context file: the new process consumes it asynchronously.
    return { pane, sessionId, contextFile };
  } finally {
    if (!launched) await rm(dir, { recursive: true, force: true });
  }
}

export default function sidequest(pi: ExtensionAPI) {
  pi.registerCommand("sidequest", {
    description: "Open an isolated Pi chat in Herdr with the last 10 messages: /sidequest [topic]",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      if (!ctx.model) throw new Error("Select a model before opening a SideQuest.");
      const result = await openSidequest(pi.exec.bind(pi), {
        cwd: ctx.cwd,
        model: `${ctx.model.provider}/${ctx.model.id}`,
        thinking: pi.getThinkingLevel(),
        topic: args.trim(),
        messages: recentConversation(ctx.sessionManager.getBranch()),
      });
      ctx.ui.notify(`New chat — SideQuest opened in ${result.pane}. No results will be sent back.`, "info");
    },
  });
}
