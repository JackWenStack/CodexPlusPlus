import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/63-desktop-session-filter.js", import.meta.url), "utf8");
function runtime(window: Record<string, any> = {}, settings = { enhancementsEnabled: true }, document = { querySelectorAll: () => [] as any[] }) {
  return new Function("window", "codexPlusBackendSettings", "document", `${source}; return {
    filter: desktopSidebarSessions, patch: patchDesktopSessionListMirror,
    discover: desktopSessionMirrorFromFiber, sync: syncDesktopSessionListFilter,
    restore: restoreDesktopSessionListMirror, state: desktopSessionFilter
  };`)(window, settings, document);
}
function mirror(hostId = "local") {
  return {
    hostId, recent: [] as any[], summaries: [] as any[], hasFetchedRecentConversations: false,
    notifications: [] as any[], conversations: new Map([["cli", { turns: ["existing content"] }]]),
    getRecentConversations() { return this.recent; },
    getThreadSummaries() { return this.summaries; },
    applyRecentConversations(items: any[], loaded = true) {
      this.recent = items; this.hasFetchedRecentConversations = loaded;
      this.notifications.push(["recent", items, loaded]);
    },
    applyThreadSummaries(items: any[]) { this.summaries = items; this.notifications.push(["summaries", items]); },
  };
}

test("only explicit local CLI sources are excluded; desktop, unknown and remote survive", () => {
  const { filter } = runtime();
  const records = [
    { id: "cli", source: "cli" }, { id: "exec", source: "exec" },
    { id: "tui", originator: "codex-tui" }, { id: "old-cli", originator: "codex_cli_rs" },
    { id: "desktop", source: "vscode" }, { id: "unknown" },
    { id: "explicit-desktop", source: "cli", originator: "Codex Desktop" },
    { id: "remote", source: "cli", hostId: "ssh:server" },
    { id: "child", source: { subagent: "thread_spawn" } },
  ];
  assert.deepEqual(filter(records, "local").map((x: any) => x.id), ["desktop", "unknown", "explicit-desktop", "remote", "child"]);
  assert.equal(filter(records, "ssh:server"), records);
  assert.equal(records.length, 9);
  assert.equal(filter(null, "local"), null);
});

test("native list consumers receive filtered rows before grouping, without discarding conversation content", () => {
  const r = runtime(), m = mirror();
  const rows = [{ id: "cli", source: "cli" }, { id: "desktop", source: "vscode" }];
  m.recent = rows; m.summaries = rows;
  const content = m.conversations.get("cli");
  assert.equal(r.patch(m), true);
  assert.deepEqual(m.recent.map(x => x.id), ["desktop"]);
  assert.deepEqual(m.summaries.map(x => x.id), ["desktop"]);
  assert.equal(m.hasFetchedRecentConversations, false);
  assert.equal(m.conversations.get("cli"), content);
  assert.equal(rows.length, 2);
  assert.ok(m.notifications.every(([, items]) => items.every((x: any) => x.id !== "cli")));
});

test("refreshes remain filtered and disabling restores the latest unmodified lists", () => {
  const settings = { enhancementsEnabled: true }, r = runtime({}, settings), m = mirror();
  const original = m.applyThreadSummaries;
  r.patch(m);
  const fresh = [{ id: "new-cli", source: "cli" }, { id: "new-desktop", source: "vscode" }];
  m.applyRecentConversations(fresh, true); m.applyThreadSummaries(fresh);
  assert.deepEqual(m.summaries.map(x => x.id), ["new-desktop"]);
  settings.enhancementsEnabled = false;
  r.sync(true);
  assert.equal(m.recent, fresh); assert.equal(m.summaries, fresh);
  assert.equal(m.applyThreadSummaries, original);
  assert.equal(m.hasFetchedRecentConversations, true);
  assert.equal(r.state.target, null);
});

test("reinjection is idempotent, scope replacement restores the old mirror, remote mirrors are untouched", () => {
  const window = {}, r = runtime(window), old = mirror(), next = mirror(), remote = mirror("ssh:server");
  old.summaries = [{ id: "cli", source: "cli" }];
  const original = old.applyThreadSummaries;
  r.patch(old); const wrapper = old.applyThreadSummaries;
  runtime(window).patch(old);
  assert.equal(old.applyThreadSummaries, wrapper);
  assert.equal(r.patch(remote), false);
  r.patch(next);
  assert.equal(old.applyThreadSummaries, original);
  assert.equal(old.summaries.length, 1);
  const rows = [{ source: "vscode" }]; next.applyThreadSummaries(rows);
  assert.equal(next.summaries, rows, "preserve identity when nothing was filtered");
});

test("bounded discovery reads existing local signals, ignores worker managers and tolerates missing metadata", () => {
  const r = runtime(), m = mirror();
  const signal = (value: any) => ({ get: () => value, subscribe() {} });
  const bindings = new Map([
    [1, new Map([["local", { value: signal({ getThreadSummaries() {} }) }]])],
    [2, new Map([["local", { value: signal(m) }]])],
  ]);
  const fiber = { memoizedState: { memoizedState: { current: { node: { familyBindings: bindings } } } } };
  assert.equal(r.discover(fiber), m);
  assert.equal(r.discover({ memoizedState: {} }), null);
  const cycle: any = {}; cycle.return = cycle;
  assert.equal(r.discover(cycle), null);
});

test("unsupported immutable native methods leave both list methods and data unchanged", () => {
  const r = runtime(), m = mirror();
  const original = m.applyRecentConversations;
  const rows = [{ id: "cli", source: "cli" }];
  m.recent = rows; m.summaries = rows;
  Object.defineProperty(m, "applyThreadSummaries", { value: m.applyThreadSummaries, writable: false });
  assert.equal(r.patch(m), false);
  assert.equal(m.applyRecentConversations, original);
  assert.equal(m.recent, rows); assert.equal(m.summaries, rows);
  assert.equal(m.notifications.length, 0);
  assert.equal(r.state.target, null);
});
