import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import { matchesKey, Key, truncateToWidth } from "@mariozechner/pi-tui";

interface HerdrPaneRaw {
  pane_id: string;
  terminal_id?: string;
  workspace_id: string;
  tab_id: string;
  cwd?: string;
  foreground_cwd?: string;
  focused?: boolean;
  agent?: string;
  agent_status?: string;
}

interface PaneInfo extends HerdrPaneRaw {
  id: string;
  path: string;
  score: number;
  preview: string;
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
  return picked.map((l) => (l.length > 70 ? l.slice(0, 69) + "…" : l)).join(" │ ");
}

function parseHerdrJson(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`Failed to parse herdr JSON: ${String(e)}\n${stdout.slice(0, 500)}`);
  }
}

function paneListFromResponse(stdout: string): HerdrPaneRaw[] {
  const json = parseHerdrJson(stdout);
  return json?.result?.panes || [];
}

function paneFromResponse(stdout: string): HerdrPaneRaw | undefined {
  const json = parseHerdrJson(stdout);
  return json?.result?.pane;
}

export default function (pi: ExtensionAPI) {
  let pickHistory: Record<string, number> = {};

  pi.on("session_start", async (_event, ctx) => {
    pickHistory = {};
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "smart_herdr") {
        const h = entry.message.details?.pickHistory;
        if (h) pickHistory = h;
      }
    }
  });

  pi.registerCommand("herdr", {
    description: "Read a Herdr pane (sorted by relevance)",
    handler: async (args, ctx) => {
      const target = args?.trim() || undefined;
      if (target) {
        pi.sendUserMessage(`use smart_herdr with target "${target}"`, { deliverAs: "followUp" });
      } else {
        const picked = await pickPane(undefined, ctx);
        if (!picked) { ctx.ui.notify("Cancelled", "info"); return; }
        pi.sendUserMessage(`use smart_herdr with target "${picked.id}"`, { deliverAs: "followUp" });
      }
    },
  });

  async function pickPane(signal: AbortSignal | undefined, ctx: any): Promise<PaneInfo | null> {
    const [listResult, currentResult] = await Promise.all([
      pi.exec("herdr", ["pane", "list"], { signal, timeout: 3000 }),
      pi.exec("herdr", ["pane", "current", "--current"], { signal, timeout: 2000 }),
    ]);

    if (listResult.code !== 0) throw new Error(`Failed to list Herdr panes: ${listResult.stderr}`);

    const cwd = ctx.cwd;
    const currentPane = currentResult.code === 0 ? paneFromResponse(currentResult.stdout) : undefined;
    const currentPaneId = currentPane?.pane_id || "";
    const currentWorkspace = currentPane?.workspace_id || "";
    const currentTab = currentPane?.tab_id || "";

    const panes = paneListFromResponse(listResult.stdout).map((p) => ({
      ...p,
      id: p.pane_id,
      path: p.foreground_cwd || p.cwd || "",
    }));

    const filtered = panes.filter((p) => p.id !== currentPaneId);
    const scored: PaneInfo[] = filtered.map((p) => {
      let score = 0;
      if (p.tab_id === currentTab) score += 500;
      else if (p.workspace_id === currentWorkspace) score += 250;
      score += (pickHistory[p.id] || 0) * 100;
      if (p.path === cwd) score += 50;
      else if (p.path && (p.path.startsWith(cwd) || cwd.startsWith(p.path))) score += 25;
      if (p.agent) score += 30;
      if (p.agent_status === "blocked" || p.agent_status === "done") score += 25;
      if (p.focused) score += 5;
      return { ...p, score, preview: "" };
    });
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) throw new Error("No Herdr panes found");

    const top = scored.slice(0, 6);
    const previews = await Promise.all(
      top.map(async (p) => {
        const cap = await pi.exec("herdr", ["pane", "read", p.id, "--source", "visible"], { signal, timeout: 2000 });
        return cap.code === 0 ? cleanPreview(cap.stdout) : "";
      })
    );
    top.forEach((p, i) => { p.preview = previews[i]; });

    return ctx.ui.custom<PaneInfo | null>((tui: any, theme: any, _kb: any, done: (v: PaneInfo | null) => void) => {
      let cursor = 0;
      let cache: string[] | undefined;

      function render(width: number): string[] {
        if (cache) return cache;
        const lines: string[] = [];
        const bar = "━".repeat(width);

        lines.push(theme.fg("accent", bar));
        lines.push(theme.bold(theme.fg("accent", "  ⬡ Pick a Herdr pane")));
        lines.push(theme.fg("accent", bar));
        lines.push("");

        for (let i = 0; i < top.length; i++) {
          const p = top[i];
          const sel = i === cursor;
          const shortPath = p.path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
          const num = theme.fg(sel ? "accent" : "dim", `${i + 1}`);
          const arrow = sel ? theme.fg("accent", " ▸ ") : "   ";
          const paneId = sel ? theme.bold(theme.fg("accent", p.id)) : theme.bold(theme.fg("text", p.id));
          const agent = p.agent ? theme.fg("warning", ` [${p.agent}:${p.agent_status || "?"}]`) : "";
          const focused = p.focused ? theme.bold(theme.fg("accent", " ●")) : "";

          lines.push(truncateToWidth(`${arrow}${num}  ${paneId}${agent}${focused}  ${theme.fg("muted", `${p.workspace_id}/${p.tab_id}`)}  ${theme.fg("muted", shortPath)}`, width));
          lines.push(truncateToWidth(p.preview ? `      ${p.preview}` : `      ${shortPath}`, width));
          lines.push("");
        }

        lines.push(theme.fg("accent", bar));
        lines.push(theme.fg("dim", "  ↑↓ navigate  1-6 quick pick  enter select  esc cancel"));
        lines.push(theme.fg("accent", bar));

        cache = lines;
        return lines;
      }

      function handleInput(data: string) {
        if (matchesKey(data, Key.escape)) { done(null); return true; }
        if (matchesKey(data, Key.up)) { cursor = Math.max(0, cursor - 1); cache = undefined; tui.requestRender(); return true; }
        if (matchesKey(data, Key.down)) { cursor = Math.min(top.length - 1, cursor + 1); cache = undefined; tui.requestRender(); return true; }

        const num = parseInt(data);
        if (num >= 1 && num <= top.length) { done(top[num - 1]); return true; }
        if (matchesKey(data, Key.enter) && cursor < top.length) { done(top[cursor]); return true; }
        return true;
      }

      return { render, invalidate: () => { cache = undefined; }, handleInput };
    });
  }

  pi.registerTool({
    name: "smart_herdr",
    label: "Smart Herdr",
    description:
      "Read a Herdr pane with smart selection. Panes are ranked by relevance: same tab/workspace, recently picked, same project directory, and agent panes. Pass target to skip picking.",
    promptSnippet: "Read Herdr pane content with smart relevance-based selection",
    promptGuidelines: [
      "Use this to inspect Herdr panes, similar to smart_tmux but for Herdr.",
      "Omit target to get a relevance-sorted picker. Pass a pane id like w3:pH to read directly.",
      "Use source='recent-unwrapped' for logs or long command output; use source='visible' for current UI state.",
    ],
    parameters: Type.Object({
      target: Type.Optional(Type.String({ description: "Herdr pane id, e.g. w3:pH. Omit for interactive pick." })),
      lines: Type.Optional(Type.Number({ description: "Lines to read for recent/recent-unwrapped sources." })),
      source: Type.Optional(Type.Union([
        Type.Literal("visible"),
        Type.Literal("recent"),
        Type.Literal("recent-unwrapped"),
        Type.Literal("detection"),
      ], { description: "Herdr read source (default: visible)." })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const herdrCheck = await pi.exec("herdr", ["status", "server"], { signal, timeout: 3000 });
      if (herdrCheck.code !== 0) throw new Error("Herdr server is not running");

      let target = params.target;
      if (!target) {
        if (!ctx.hasUI) throw new Error("No UI available. Pass 'target' parameter.");
        const picked = await pickPane(signal, ctx);
        if (!picked) return { content: [{ type: "text", text: "Cancelled." }], details: {} };
        target = picked.id;
      }

      pickHistory[target] = (pickHistory[target] || 0) + 1;

      const source = params.source || "visible";
      const readArgs = ["pane", "read", target, "--source", source];
      if (params.lines) readArgs.push("--lines", String(params.lines));

      const captureResult = await pi.exec("herdr", readArgs, { signal, timeout: 5000 });
      if (captureResult.code !== 0) throw new Error(`Failed to read Herdr pane ${target}: ${captureResult.stderr}`);

      const output = captureResult.stdout;
      const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });

      let result = `Content of Herdr pane [${target}] (source=${source}):\n\n${truncation.content}`;
      if (truncation.truncated) {
        result += `\n\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)})]`;
      }

      return {
        content: [{ type: "text", text: result }],
        details: { target, source, lines: params.lines, truncated: truncation.truncated, pickHistory: { ...pickHistory } },
      };
    },
  });
}
