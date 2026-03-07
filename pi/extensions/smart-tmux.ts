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

function extractPreview(rawOutput: string): string {
  const lines = rawOutput.split("\n");
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return "(empty)";
  return nonEmpty.slice(-3).map((l) => l.length > 45 ? l.slice(0, 44) + "…" : l).join(" │ ");
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
    handler: async (args) => {
      const target = args?.trim() || undefined;
      pi.sendUserMessage(`use smart_tmux${target ? ` with target "${target}"` : ""}`, { deliverAs: "followUp" });
    },
  });

  async function pickPane(signal: AbortSignal | undefined, ctx: any): Promise<PaneInfo | null> {
    const listResult = await pi.exec("tmux",
      ["list-panes", "-a", "-F",
        "#{session_name}:#{window_index}.#{pane_index}\t#{window_name}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_width}x#{pane_height}\t#{?pane_active,*,}"],
      { signal, timeout: 3000 });
    if (listResult.code !== 0) throw new Error(`Failed to list panes: ${listResult.stderr}`);

    const cwd = ctx.cwd;
    const currentPane = await pi.exec("tmux", ["display-message", "-p", "#{session_name}:#{window_index}.#{pane_index}"], { signal, timeout: 2000 });
    const currentWindow = currentPane.code === 0 ? currentPane.stdout.trim().replace(/\.\d+$/, "") : "";
    const currentSession = currentWindow.split(":")[0] || "";
    const currentPaneId = currentPane.code === 0 ? currentPane.stdout.trim() : "";

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
      if (p.cmd !== "zsh" && p.cmd !== "bash" && p.cmd !== "fish") score += 10;
      if (p.active) score += 5;
      return { ...p, score, preview: "" };
    });
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) throw new Error("No tmux panes found");

    // Pre-capture top 4
    const topN = Math.min(4, scored.length);
    const topPanes = scored.slice(0, topN);
    const previews = await Promise.all(
      topPanes.map(async (p) => {
        const cap = await pi.exec("tmux", ["capture-pane", "-p", "-t", p.id], { signal, timeout: 2000 });
        return cap.code === 0 ? extractPreview(cap.stdout) : "?";
      })
    );
    topPanes.forEach((p, i) => { p.preview = previews[i]; });

    const hasMore = scored.length > topN;

    // Custom TUI picker
    return ctx.ui.custom<PaneInfo | null>((tui: any, theme: any, _kb: any, done: (v: PaneInfo | null) => void) => {
      let cursor = 0;
      let showAll = false;
      let allPreviews: string[] | null = null;
      const items = () => showAll ? scored : topPanes;
      const total = () => items().length + (hasMore && !showAll ? 1 : 0); // +1 for "show all"
      let cache: string[] | undefined;

      function render(width: number): string[] {
        if (cache) return cache;
        const lines: string[] = [];
        const bar = "━".repeat(width);

        lines.push(theme.fg("accent", bar));
        lines.push(theme.bold(theme.fg("accent", "  ⬡ Pick a tmux pane")));
        lines.push(theme.fg("accent", bar));
        lines.push("");

        const list = items();
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const sel = i === cursor;
          const shortPath = p.path.replace(/^\/home\/[^/]+/, "~");
          const num = theme.fg(sel ? "accent" : "dim", `${i + 1}`);
          const arrow = sel ? theme.fg("accent", " ▸ ") : "   ";
          const name = sel
            ? theme.bold(theme.fg("accent", `${p.id}  ${p.winName}`))
            : theme.fg("text", `${p.id}  ${p.winName}`);
          const pathStr = theme.fg("muted", shortPath);
          const active = p.active ? theme.fg("warning", " ◀") : "";

          lines.push(truncateToWidth(`${arrow}${num}  ${name}  ${pathStr}${active}`, width));

          // Preview line
          const preview = p.preview || (showAll && allPreviews ? allPreviews[i] : "");
          if (preview) {
            const previewLine = sel
              ? theme.fg("accent", `      ${preview}`)
              : theme.fg("dim", `      ${preview}`);
            lines.push(truncateToWidth(previewLine, width));
          }
          lines.push("");
        }

        if (hasMore && !showAll) {
          const sel = cursor === list.length;
          const arrow = sel ? theme.fg("accent", " ▸ ") : "   ";
          const text = sel
            ? theme.bold(theme.fg("accent", "… show all panes"))
            : theme.fg("dim", "… show all panes");
          lines.push(`${arrow}${text}`);
          lines.push("");
        }

        lines.push(theme.fg("accent", bar));
        lines.push(theme.fg("dim", "  ↑↓ navigate  1-4 quick pick  enter select  esc cancel"));
        lines.push(theme.fg("accent", bar));

        cache = lines;
        return lines;
      }

      async function loadAllPreviews() {
        if (allPreviews) return;
        allPreviews = await Promise.all(
          scored.map(async (p, i) => {
            if (i < topN) return topPanes[i].preview;
            const cap = await pi.exec("tmux", ["capture-pane", "-p", "-t", p.id], { timeout: 2000 });
            return cap.code === 0 ? extractPreview(cap.stdout) : "?";
          })
        );
        scored.forEach((p, i) => { p.preview = allPreviews![i]; });
        cache = undefined;
        tui.requestRender();
      }

      function handleInput(data: string) {
        if (matchesKey(data, Key.escape)) { done(null); return true; }

        if (matchesKey(data, Key.up)) {
          cursor = Math.max(0, cursor - 1);
          cache = undefined; tui.requestRender(); return true;
        }
        if (matchesKey(data, Key.down)) {
          cursor = Math.min(total() - 1, cursor + 1);
          cache = undefined; tui.requestRender(); return true;
        }

        // Number shortcuts 1-4
        const num = parseInt(data);
        if (num >= 1 && num <= items().length) {
          done(items()[num - 1]);
          return true;
        }

        if (matchesKey(data, Key.enter)) {
          const list = items();
          if (hasMore && !showAll && cursor === list.length) {
            showAll = true;
            cursor = 0;
            cache = undefined;
            tui.requestRender();
            loadAllPreviews();
            return true;
          }
          if (cursor < list.length) {
            done(list[cursor]);
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

      // Line count picker
      if (!params.lines && ctx.hasUI) {
        const howMuch = await ctx.ui.select("How much to capture?", [
          "Visible area only",
          "Last 50 lines",
          "Last 100 lines",
          "Last 500 lines",
          "Last 1000 lines",
          "Everything (full scrollback)",
        ]);
        if (!howMuch) return { content: [{ type: "text", text: "Cancelled." }], details: {} };

        if (howMuch.includes("50")) params.lines = 50;
        else if (howMuch.includes("100")) params.lines = 100;
        else if (howMuch.includes("500")) params.lines = 500;
        else if (howMuch.includes("1000")) params.lines = 1000;
        else if (howMuch.includes("Everything")) params.lines = 999999;
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
