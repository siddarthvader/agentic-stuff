#!/usr/bin/env bun

import { render, useKeyboard } from "@opentui/solid";
import { createSignal, For, onCleanup, onMount } from "solid-js";
import { writeFileSync } from "node:fs";

type Status = "WORK" | "WAIT" | "IDLE";
type Agent = "pi" | "claude" | "codex" | "nvim";

type Row = {
  target: string;
  session: string;
  title: string;
  cwd: string;
  cmd: string;
  agent: Agent;
  status: Status;
  active: boolean;
};

const DEFAULT_AGENTS: Agent[] = ["pi", "claude", "codex", "nvim"];

function sh(cmd: string, args: string[] = [], quiet = true): string {
  const p = Bun.spawnSync([cmd, ...args], { stdout: "pipe", stderr: quiet ? "ignore" : "pipe" });
  return p.success ? Buffer.from(p.stdout).toString("utf8") : "";
}

function tmuxOpt(name: string, fallback: string): string {
  const v = sh("tmux", ["show-option", "-gqv", name]).trim();
  return v || fallback;
}

function normalizeAgent(v: string): string {
  const n = (v || "").trim().toLowerCase();
  if (n === "openai-codex") return "codex";
  return n;
}

function firstRune(s: string): string {
  return Array.from(s || "")[0] || "";
}

function isBraillePrefix(title: string): boolean {
  const r = firstRune(title);
  const cp = r.codePointAt(0) || 0;
  return cp >= 0x2800 && cp <= 0x28ff;
}

function detectCodexFromNode(pid: number): boolean {
  if (!pid) return false;
  const self = sh("ps", ["-p", String(pid), "-o", "args="]).toLowerCase();
  if (self.includes("codex") || self.includes("openai-codex")) return true;

  const kids = sh("pgrep", ["-P", String(pid)]).trim();
  if (!kids) return false;
  for (const k of kids.split(/\s+/)) {
    const child = sh("ps", ["-p", k, "-o", "comm=,args="]).toLowerCase();
    if (child.includes("codex") || child.includes("openai-codex")) return true;
  }
  return false;
}

function statusForPane(target: string, title: string, agent: Agent): Status {
  if (agent === "nvim") return "IDLE";
  if (isBraillePrefix(title)) return "WORK";

  const text = sh("tmux", ["capture-pane", "-p", "-t", target, "-S", "-80"]);
  const lower = text.toLowerCase();

  // Waiting for user input/confirmation
  if (
    lower.includes("esc to cancel") ||
    lower.includes("press enter") ||
    lower.includes("enter your choice") ||
    lower.includes("[y/n]") ||
    lower.includes("(y/n)")
  ) {
    return "WAIT";
  }

  const lines = text.split("\n");
  const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0) || "";

  // If prompt is visible, agent is idle
  if (/\s*[❯>]\s*$/.test(lastNonEmpty)) return "IDLE";

  // Otherwise, agent process is alive and not waiting => working
  if (agent === "pi" || agent === "claude" || agent === "codex") return "WORK";

  return "IDLE";
}

function loadRows(): Row[] {
  const configured = tmuxOpt("@agent_session_commands", DEFAULT_AGENTS.join(" "))
    .split(/\s+/)
    .map((x) => normalizeAgent(x) as Agent)
    .filter(Boolean);
  const allowed = new Set(configured);

  const raw = sh("tmux", [
    "list-panes",
    "-a",
    "-F",
    "#{session_name}:#{window_index}.#{pane_index}|#{session_name}|#{pane_current_command}|#{pane_title}|#{pane_current_path}|#{pane_pid}|#{?pane_active,ACTIVE,}",
  ]);

  const out: Row[] = [];
  const seen = new Set<string>();

  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [target, session, cmdRaw, titleRaw, cwd, pidRaw, activeRaw] = line.split("|");
    if (!target || seen.has(target)) continue;

    const cmd = normalizeAgent(cmdRaw);
    const title = titleRaw || "";
    let agent: Agent | null = null;

    if (allowed.has(cmd as Agent)) agent = cmd as Agent;
    else if (cmd === "node" && allowed.has("codex") && detectCodexFromNode(Number(pidRaw || 0))) agent = "codex";

    if (!agent) continue;

    seen.add(target);
    out.push({
      target,
      session,
      cmd: cmdRaw || "",
      title,
      cwd: cwd || "",
      agent,
      status: statusForPane(target, title, agent),
      active: activeRaw === "ACTIVE",
    });
  }

  const rank = (s: Status) => (s === "WAIT" ? 0 : s === "WORK" ? 1 : 2);
  out.sort((a, b) => rank(a.status) - rank(b.status) || Number(b.active) - Number(a.active) || a.target.localeCompare(b.target));
  return out;
}

function emitAction(action: "switch" | "parent" | "lazygit", target: string) {
  const file = process.env.OSM_ACTION_FILE;
  if (file) {
    try {
      writeFileSync(file, `${action}|${target}`, "utf8");
    } catch {}
  }
}

function agentLabel(agent: Agent): string {
  return agent.toUpperCase();
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function statusIcon(status: Status, spinTick: number): string {
  if (status === "WORK") return SPINNER_FRAMES[spinTick % SPINNER_FRAMES.length]!;
  if (status === "WAIT") return "◐";
  return "○";
}

function statusColor(status: Status): string {
  if (status === "WORK") return "green";
  if (status === "WAIT") return "yellow";
  return "gray";
}

function agentColor(agent: Agent): string {
  if (agent === "claude") return "magenta";
  if (agent === "pi") return "cyan";
  if (agent === "codex") return "blue";
  return "yellow";
}

function trimTitle(s: string): string {
  return (s || "").replace(/^\s*[✳⠂⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, "");
}

function pathTail(p: string): string {
  const parts = (p || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || p || "-";
}

function displayTitle(row: Row): string {
  if (row.agent === "nvim") {
    return `${pathTail(row.cwd)}  [${row.target}]`;
  }
  return trimTitle(row.title);
}

function App() {
  const [rows, setRows] = createSignal<Row[]>(loadRows());
  const [cursor, setCursor] = createSignal(0);
  const [spinTick, setSpinTick] = createSignal(0);

  const refresh = () => {
    const old = rows()[cursor()]?.target;
    const next = loadRows();
    setRows(next);
    if (!next.length) {
      setCursor(0);
      return;
    }
    const idx = old ? next.findIndex((r) => r.target === old) : -1;
    if (idx >= 0) setCursor(idx);
    else setCursor((v) => Math.min(v, next.length - 1));
  };

  const selectCurrent = () => {
    const row = rows()[cursor()];
    if (!row) return;
    emitAction("switch", row.target);
    process.exit(0);
  };

  onMount(() => {
    const refreshTimer = setInterval(refresh, 1000);
    const spinTimer = setInterval(() => setSpinTick((v) => v + 1), 120);
    onCleanup(() => {
      clearInterval(refreshTimer);
      clearInterval(spinTimer);
    });
  });

  useKeyboard((e) => {
    const list = rows();
    if (e.name === "q" || (e.name === "c" && e.ctrl)) process.exit(0);
    if (!list.length) return;

    if (e.name === "j" || e.name === "down") setCursor((v) => (v + 1) % list.length);
    else if (e.name === "k" || e.name === "up") setCursor((v) => (v - 1 + list.length) % list.length);
    else if (e.name === "return") selectCurrent();
    else if (e.name === "p") {
      const row = list[cursor()];
      if (row) {
        emitAction("parent", row.target);
        process.exit(0);
      }
    } else if (e.name === "g") {
      const row = list[cursor()];
      if (row) {
        emitAction("lazygit", row.target);
        process.exit(0);
      }
    } else if (/^[1-9]$/.test(e.name || "")) {
      const i = Number(e.name) - 1;
      if (i < list.length) {
        emitAction("switch", list[i]!.target);
        process.exit(0);
      }
    }
  });

  return (
    <box flexDirection="column" padding={1} width="100%" height="100%">
      <box flexDirection="row">
        <text bold fg="magenta">open</text>
        <text bold fg="cyan">-session</text>
        <text bold fg="blue">-manager</text>
      </box>
      <box flexDirection="row">
        <text fg="green"> ● Work </text>
        <text fg="yellow"> ◐ Wait </text>
        <text fg="gray"> ○ Idle </text>
      </box>
      <text> </text>
      <For each={rows()}>
        {(row, i) => {
          const selected = () => i() === cursor();
          const prefix = () => (selected() ? "▸" : " ");
          const num = () => `${i() + 1}`.padStart(2, " ");
          const icon = () => statusIcon(row.status, spinTick());
          const status = () => row.status.padEnd(4, " ");
          const agent = () => agentLabel(row.agent).padEnd(6, " ");
          const session = () => row.session.padEnd(12, " ");
          const title = () => displayTitle(row);

          return (
            <box flexDirection="row" inverse={selected()}>
              <text dimColor={!selected() && row.status === "IDLE"}>{`${prefix()} ${num()} ${row.active ? "●" : "·"}  `}</text>
              <text fg={statusColor(row.status)} dimColor={!selected() && row.status === "IDLE"}>{`${icon()} ${status()}  `}</text>
              <text fg={row.status === "IDLE" ? "gray" : agentColor(row.agent)} dimColor={row.status === "IDLE"}>{`${agent()}  `}</text>
              <text fg={row.status === "IDLE" ? "gray" : "cyan"} dimColor={row.status === "IDLE"}>{`${session()}  `}</text>
              <text fg={row.status === "IDLE" ? "gray" : "white"} dimColor={!selected() && row.status === "IDLE"}>{title()}</text>
            </box>
          );
        }}
      </For>
      <text> </text>
      <box flexDirection="row">
        <text fg="cyan">j/k</text><text dimColor> or </text><text fg="cyan">↑/↓</text><text dimColor> navigate · </text><text fg="green">enter</text><text dimColor> switch · </text><text fg="yellow">p</text><text dimColor> parent · </text><text fg="blue">g</text><text dimColor> lazygit · </text><text fg="magenta">1-9</text><text dimColor> quick switch · </text><text fg="red">q</text><text dimColor> quit</text>
      </box>
    </box>
  );
}

function runListMode() {
  const rows = loadRows();
  for (const r of rows) {
    console.log([r.target, r.agent.toUpperCase(), r.status, r.session, r.cmd, r.title, r.cwd].join("|"));
  }
}

const mode = process.argv[2] ?? "picker";
if (mode === "list") {
  runListMode();
} else {
  render(() => <App />);
}
