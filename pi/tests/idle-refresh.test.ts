// Run with Node 24+: node --test pi/tests/idle-refresh.test.ts
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import idleRefresh, { IDLE_DELAY_MS, MAX_REFRESHES, recentUserMessages, reminder } from "../extensions/idle-refresh.ts";

function message(role: string, content: unknown, extra = {}): SessionEntry {
  return { type: "message", message: { role, content, ...extra } } as SessionEntry;
}

function harness(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const sent: { message: any; options: any }[] = [];
  const notices: string[] = [];
  const state = {
    idle: true, pending: false, sessionId: "session-1", leafId: "leaf-1",
    branch: [message("user", "Please finish the work."), message("assistant", "Done.", { stopReason: "stop" })],
  };
  const ctx = {
    hasUI: true,
    isIdle: () => state.idle,
    hasPendingMessages: () => state.pending,
    sessionManager: {
      getBranch: () => state.branch,
      getSessionId: () => state.sessionId,
      getLeafId: () => state.leafId,
    },
    ui: { notify: (text: string) => notices.push(text) },
  };
  idleRefresh({
    on: (event: string, handler: Function) => handlers.set(event, handler),
    registerCommand: (name: string, options: { handler: Function }) => commands.set(name, options),
    sendMessage: (message: any, options: any) => sent.push({ message, options }),
  } as unknown as ExtensionAPI);
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, ctx);
  const tick = () => t.mock.timers.tick(IDLE_DELAY_MS);
  const command = (args: string) => commands.get("idle-refresh")!.handler(args, ctx);
  emit("session_start");
  return { state, ctx, sent, notices, emit, tick, command };
}

test("last five user messages preserve chronological order, text blocks and boundaries", () => {
  const entries = [
    message("user", "old"), message("assistant", "not a user"),
    message("user", "one\nline two"), message("toolResult", "not a user"),
    message("user", [{ type: "text", text: "two" }]),
    message("user", [{ type: "image", data: "secret-image" }, { type: "text", text: "three" }]),
    { type: "custom_message", customType: "idle-refresh", content: "not a user" } as SessionEntry,
    message("user", "four"), message("user", "five"),
  ];
  const texts = recentUserMessages(entries);
  assert.deepEqual(texts, ["one\nline two", "two", "[Image omitted]\nthree", "four", "five"]);
  const prompt = reminder(texts);
  assert.ok(prompt.includes(JSON.stringify(texts, null, 2)));
  assert.match(prompt, /not a new user request/);
  assert.match(prompt, /don't repeat completed work or revive abandoned requests/);
  assert.match(prompt, /If nothing remains, stop/);
  assert.match(prompt, /If you need user input, ask rather than guessing/);
  assert.ok(!prompt.includes("secret-image"));
});

test("only settlement arms a 30s timer; injection explicitly triggers a same-session turn", (t) => {
  const h = harness(t);
  h.emit("agent_end");
  h.tick();
  assert.equal(h.sent.length, 0);
  h.emit("agent_settled", { aborted: false });
  t.mock.timers.tick(IDLE_DELAY_MS - 1);
  assert.equal(h.sent.length, 0);
  t.mock.timers.tick(1);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].options, { triggerTurn: true, deliverAs: "followUp" });
  assert.equal(h.sent[0].message.customType, "idle-refresh");
  assert.equal(h.sent[0].message.display, true);
  assert.ok(h.sent[0].message.content.includes("Please finish the work."));
});

test("automatic turns are capped and only genuine new input resets the budget", (t) => {
  const h = harness(t);
  for (let i = 0; i < MAX_REFRESHES + 3; i++) {
    h.emit("agent_start");
    h.emit("agent_settled", { aborted: false });
    h.tick();
  }
  assert.equal(h.sent.length, MAX_REFRESHES);
  h.emit("input", { source: "extension" });
  h.emit("agent_settled", { aborted: false });
  h.tick();
  assert.equal(h.sent.length, MAX_REFRESHES);
  h.emit("input", { source: "interactive" });
  h.emit("agent_settled", { aborted: false });
  h.tick();
  assert.equal(h.sent.length, MAX_REFRESHES + 1);
});

for (const event of ["input", "agent_start", "session_shutdown", "session_before_switch", "session_before_fork", "session_before_tree", "session_tree", "session_before_compact", "ui_prompt_start"]) {
  test(`${event} cancels a pending reminder`, (t) => {
    const h = harness(t);
    h.emit("agent_settled", { aborted: false });
    h.emit(event, { source: "interactive" });
    h.tick();
    assert.equal(h.sent.length, 0);
  });
}

test("aborts stay suspended until real user input", (t) => {
  const h = harness(t);
  h.emit("agent_settled", { aborted: true });
  h.tick();
  h.emit("input", { source: "extension" });
  h.emit("agent_settled", { aborted: false });
  h.tick();
  assert.equal(h.sent.length, 0);
  h.emit("input", { source: "rpc" });
  h.emit("agent_settled", { aborted: false });
  h.tick();
  assert.equal(h.sent.length, 1);
});

for (const change of ["busy", "queued", "session", "branch"] as const) {
  test(`callback rechecks ${change} before sending`, (t) => {
    const h = harness(t);
    h.emit("agent_settled", { aborted: false });
    if (change === "busy") h.state.idle = false;
    if (change === "queued") h.state.pending = true;
    if (change === "session") h.state.sessionId = "session-2";
    if (change === "branch") h.state.leafId = "leaf-2";
    h.tick();
    assert.equal(h.sent.length, 0);
  });
}

test("off cancels the timer and on only affects future completed runs", async (t) => {
  const h = harness(t);
  h.emit("agent_settled", { aborted: false });
  await h.command("off");
  h.tick();
  h.emit("agent_settled", { aborted: false });
  h.tick();
  assert.equal(h.sent.length, 0);
  await h.command("on");
  h.tick();
  assert.equal(h.sent.length, 0);
  h.emit("agent_settled", { aborted: false });
  h.tick();
  assert.equal(h.sent.length, 1);
  await h.command("status");
  assert.match(h.notices.at(-1)!, /1\/2 reminders used/);
});

test("empty branches and failed assistant responses do not trigger reminders", (t) => {
  const h = harness(t);
  for (const branch of [[], [message("assistant", "Hello")],
    [message("user", "Task"), message("assistant", "", { stopReason: "error" })],
    [message("user", "Task"), message("assistant", "", { stopReason: "aborted" })]]) {
    h.state.branch = branch;
    h.emit("agent_settled", { aborted: false });
    h.tick();
  }
  assert.equal(h.sent.length, 0);
});

test("session startup cancels old timers without disabling the command preference", async (t) => {
  const h = harness(t);
  h.emit("agent_settled", { aborted: false });
  h.emit("session_start");
  h.tick();
  assert.equal(h.sent.length, 0);
  await h.command("off");
  h.emit("session_start");
  h.emit("agent_settled", { aborted: false });
  h.tick();
  assert.equal(h.sent.length, 0);
});
