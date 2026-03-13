import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import { matchesKey, Key, truncateToWidth } from "@mariozechner/pi-tui";

interface PaneInfo {
  id: string;
  winName: string;
  cmd: string;
  path: string;
  size: string;
  active: boolean;
  sessWin: string;
  sess: string;
  score: number;
  preview: string;
}

function isShellCommand(cmd: string): boolean {
  return cmd === "zsh" || cmd === "bash" || cmd === "fish";
}

function cleanAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

function cleanPreview(rawOutput: string): string {
  const lines = cleanAnsi(rawOutput)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return "";

  const useful = lines.filter((l) => {
    if (/^[~\/\w.-]+[@:].*[#$>]?$/.test(l)) return false;
    if (/^[│└┌┐─━~ ]+$/.test(l)) return false;
    if (/^[><^~`'"(){}\[\]|_\\\-=$ ]+$/.test(l)) return false;
    if (/^[~ ]*[#$>]$/.test(l)) return false;
    return true;
  });

  const picked = (useful.length > 0 ? useful : lines).slice(-2);
  return picked.map((l) => (l.length > 60 ? l.slice(0, 59) + "…" : l)).join(" │ ");
}

export default function (pi: ExtensionAPI) {
  let pickHistory: Record<string, number> = {};

  pi.on("session_start", async (_event, ctx) => {
    pickHistory = {};
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "smart_tmux") {
        const h = entry.message.details?.pickHistory;
        if (h) pickHistory = h;
      }
    }
  });

  pi.registerCommand("tmux", {
    description: "Read a tmux pane (sorted by relevance)",
    handler: async (args, ctx) => {
      const target = args?.trim() || undefined;
      if (target) {
        // Direct target — just ask the agent to read it
        pi.sendUserMessage(`use smart_tmux with target "${target}"`, { deliverAs: "followUp" });
      } else {
        // No target — run picker directly, skip the LLM round-trip
        const picked = await pickPane(undefined, ctx);
        if (!picked) { ctx.ui.notify("Cancelled", "info"); return; }
        pi.sendUserMessage(`use smart_tmux with target "${picked.id}"`, { deliverAs: "followUp" });
      }
    },
  });

  async function pickPane(signal: AbortSignal | undefined, ctx: any): Promise<PaneInfo | null> {
    // Run both tmux queries in parallel
    const [listResult, currentPane] = await Promise.all([
      pi.exec("tmux", ["list-panes", "-a", "-F",
        "#{session_name}:#{window_index}.#{pane_index}\t#{window_name}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_width}x#{pane_height}\t#{?pane_active,*,}"],
        { signal, timeout: 3000 }),
      pi.exec("tmux", ["display-message", "-p", "#{session_name}:#{window_index}.#{pane_index}"], { signal, timeout: 2000 }),
    ]);

    if (listResult.code !== 0) throw new Error(`Failed to list panes: ${listResult.stderr}`);

    const cwd = ctx.cwd;
    const currentPaneId = currentPane.code === 0 ? currentPane.stdout.trim() : "";
    const currentWindow = currentPaneId.replace(/\.\d+$/, "");
    const currentSession = currentWindow.split(":")[0] || "";

    const panes = listResult.stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [id, winName, cmd, path, size, active] = line.split("\t");
      return { id, winName, cmd, path, size, active: active === "*", sessWin: id.replace(/\.\d+$/, ""), sess: id.split(":")[0] };
    });

    const filtered = panes.filter((p) => p.id !== currentPaneId);
    const scored: PaneInfo[] = filtered.map((p) => {
      let score = 0;
      if (p.sessWin === currentWindow) score += 500;
      else if (p.sess === currentSession) score += 200;
      score += (pickHistory[p.id] || 0) * 100;
      if (p.path === cwd) score += 50;
      else if (p.path.startsWith(cwd) || cwd.startsWith(p.path)) score += 25;
      if (!isShellCommand(p.cmd)) score += 10;
      if (p.active) score += 5;
      return { ...p, score, preview: "" };
    });
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) throw new Error("No tmux panes found");

    // Only show top 4 most relevant panes
    const top = scored.slice(0, 4);

    // Fetch previews for just the 4 in parallel
    const previews = await Promise.all(
      top.map(async (p) => {
        const cap = await pi.exec("tmux", ["capture-pane", "-p", "-t", p.id], { signal, timeout: 2000 });
        return cap.code === 0 ? cleanPreview(cap.stdout) : "";
      })
    );
    top.forEach((p, i) => {
      p.preview = previews[i];
    });

    return ctx.ui.custom<PaneInfo | null>((tui: any, theme: any, _kb: any, done: (v: PaneInfo | null) => void) => {
      let cursor = 0;
      let cache: string[] | undefined;

      function render(width: number): string[] {
        if (cache) return cache;
        const lines: string[] = [];
        const bar = "━".repeat(width);

        lines.push(theme.fg("accent", bar));
        lines.push(theme.bold(theme.fg("accent", "  ⬡ Pick a tmux pane")));
        lines.push(theme.fg("accent", bar));
        lines.push("");

        for (let i = 0; i < top.length; i++) {
          const p = top[i];
          const sel = i === cursor;
          const shortPath = p.path.replace(/^\/home\/[^/]+/, "~");
          const num = theme.fg(sel ? "accent" : "dim", `${i + 1}`);
          const arrow = sel ? theme.fg("accent", " ▸ ") : "   ";
          const paneId = sel
            ? theme.bold(theme.fg("accent", p.id))
            : theme.bold(theme.fg("text", p.id));
          const cmdBadge = theme.fg("warning", ` [${p.cmd}]`);
          const active = p.active ? theme.bold(theme.fg("accent", " ●")) : "";

          lines.push(truncateToWidth(`${arrow}${num}  ${paneId}${cmdBadge}${active}  ${theme.fg("muted", shortPath)}`, width));

          const line2 = p.preview
            ? `      ${p.preview}`
            : `      ${p.winName || shortPath}`;
          lines.push(truncateToWidth(sel ? theme.fg("accent", line2) : theme.fg("dim", line2), width));
          lines.push("");
        }

        lines.push(theme.fg("accent", bar));
        lines.push(theme.fg("dim", "  ↑↓ navigate  1-4 quick pick  enter select  esc cancel"));
        lines.push(theme.fg("accent", bar));

        cache = lines;
        return lines;
      }

      function handleInput(data: string) {
        if (matchesKey(data, Key.escape)) { done(null); return true; }

        if (matchesKey(data, Key.up)) {
          cursor = Math.max(0, cursor - 1);
          cache = undefined; tui.requestRender(); return true;
        }
        if (matchesKey(data, Key.down)) {
          cursor = Math.min(top.length - 1, cursor + 1);
          cache = undefined; tui.requestRender(); return true;
        }

        const num = parseInt(data);
        if (num >= 1 && num <= top.length) {
          done(top[num - 1]);
          return true;
        }

        if (matchesKey(data, Key.enter)) {
          if (cursor < top.length) {
            done(top[cursor]);
            return true;
          }
        }
        return true;
      }

      return { render, invalidate: () => { cache = undefined; }, handleInput };
    });
  }

  pi.registerTool({
    name: "smart_tmux",
    label: "Smart Tmux",
    description:
      "Read a tmux pane with smart selection. Panes are ranked by relevance: recently picked, same project directory, and active commands. Pass target to skip picking.",
    promptSnippet: "Read tmux pane content with smart relevance-based selection",
    promptGuidelines: [
      "Use this instead of read_tmux_pane for smarter pane selection.",
      "Omit target to get a relevance-sorted picker. Pass target to read directly.",
    ],
    parameters: Type.Object({
      target: Type.Optional(Type.String({ description: "Pane target e.g. 'session:window.pane'. Omit for interactive pick." })),
      lines: Type.Optional(Type.Number({ description: "Scrollback lines to capture (default: visible area)" })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tmuxCheck = await pi.exec("tmux", ["list-sessions"], { signal, timeout: 3000 });
      if (tmuxCheck.code !== 0) throw new Error("tmux is not running");

      let target = params.target;

      if (!target) {
        if (!ctx.hasUI) throw new Error("No UI available. Pass 'target' parameter.");

        const picked = await pickPane(signal, ctx);
        if (!picked) return { content: [{ type: "text", text: "Cancelled." }], details: {} };
        target = picked.id;
      }

      pickHistory[target] = (pickHistory[target] || 0) + 1;

      const captureArgs = ["capture-pane", "-p", "-t", target];
      if (params.lines) captureArgs.push("-S", `-${params.lines}`);

      const captureResult = await pi.exec("tmux", captureArgs, { signal, timeout: 5000 });
      if (captureResult.code !== 0) throw new Error(`Failed to capture pane ${target}: ${captureResult.stderr}`);

      const output = captureResult.stdout;
      const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });

      let result = `Content of tmux pane [${target}]:\n\n${truncation.content}`;
      if (truncation.truncated) {
        result += `\n\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)})]`;
      }

      return {
        content: [{ type: "text", text: result }],
        details: { target, lines: params.lines, truncated: truncation.truncated, pickHistory: { ...pickHistory } },
      };
    },
  });
}
