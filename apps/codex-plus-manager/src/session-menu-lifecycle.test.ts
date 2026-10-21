import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/90-action-groups.js", import.meta.url), "utf8");
const functions = ["disposeSessionMoreMenu", "sessionMoreMenuOwnerDetached", "pruneSessionMoreMenus", "installSessionMoreMenuAutoClose", "closeSessionMoreMenus"].map(name => {
  const match = source.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"));
  assert.ok(match, name); return match[0];
}).join("\n");

class UiNode {
  isConnected = true;
  hidden = true;
  children: UiNode[] = [];
  hover = false;
  attrs = new Map<string, string>();
  classes = new Set<string>();
  listeners = new Map<string, Set<() => void>>();
  __codexSessionMoreRow?: UiNode;
  __codexSessionMoreGroup?: UiNode;
  __codexSessionMoreCleanup?: () => void;
  __codexSessionCopyRow?: UiNode;
  __codexSessionAutoRenameRow?: UiNode;
  classList = { remove: (name: string) => this.classes.delete(name) };
  contains(node: UiNode): boolean { return this === node || this.children.some(child => child.contains(node)); }
  querySelector() { return this.children[0] ?? null; }
  querySelectorAll() { return [...this.children]; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  remove() { this.isConnected = false; }
  replaceChildren() { this.children = []; }
  matches() { return this.hover; }
  addEventListener(name: string, callback: () => void) { const set = this.listeners.get(name) ?? new Set(); set.add(callback); this.listeners.set(name, set); }
  removeEventListener(name: string, callback: () => void) { this.listeners.get(name)?.delete(callback); }
  fire(name: string) { for (const callback of this.listeners.get(name) ?? []) callback(); }
}

function fixture() {
  const menus: UiNode[] = [], timers = new Map<number, () => void>();
  let nextTimer = 0;
  const document = { activeElement: null as UiNode | null, querySelectorAll: () => menus.filter(menu => menu.isConnected) };
  const window = { setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: (id: number) => timers.delete(id) };
  const ctx = vm.createContext({ document, window, moreMenuClass: "menu", moreButtonClass: "more", actionGroupClass: "group" });
  vm.runInContext(functions, ctx);
  const add = () => {
    const row = new UiNode(), group = new UiNode(), button = new UiNode(), menu = new UiNode(), item = new UiNode();
    row.children.push(group); group.children.push(button); menu.children.push(item);
    menu.__codexSessionMoreRow = row; menu.__codexSessionMoreGroup = group;
    item.__codexSessionCopyRow = row; item.__codexSessionAutoRenameRow = row;
    menus.push(menu); ctx.installSessionMoreMenuAutoClose(row, menu);
    return { row, group, button, menu, item };
  };
  return { ctx, document, menus, timers, add };
}

test("twenty rows rebuilt nine times retain twenty menus and no detached owners", () => {
  const f = fixture(); let rows = Array.from({ length: 20 }, f.add);
  for (let cycle = 0; cycle < 9; cycle++) {
    for (const { row, group } of rows) { row.remove(); group.remove(); }
    f.ctx.pruneSessionMoreMenus(); rows = Array.from({ length: 20 }, f.add);
  }
  f.ctx.closeSessionMoreMenus(); f.ctx.pruneSessionMoreMenus();
  assert.equal(f.document.querySelectorAll().length, 20);
  assert.ok(f.document.querySelectorAll().every(menu => !f.ctx.sessionMoreMenuOwnerDetached(menu)));
});

test("disposal cancels every pending auto-close timer, detaches handlers and clears owned references", () => {
  const f = fixture(), { row, group, button, menu, item } = f.add();
  menu.hidden = false; row.classes.add("codex-session-more-open"); button.attrs.set("aria-expanded", "true");
  menu.fire("pointerleave"); menu.fire("focusout"); group.fire("pointerleave");
  assert.equal(f.timers.size, 3);
  group.remove(); f.ctx.pruneSessionMoreMenus();
  assert.equal(f.timers.size, 0);
  assert.equal(menu.isConnected, false); assert.equal(menu.hidden, true);
  assert.equal(menu.children.length, 0); assert.equal(button.attrs.get("aria-expanded"), "false");
  assert.equal(row.classes.size, 0);
  for (const node of [menu, group]) assert.ok([...node.listeners.values()].every(set => set.size === 0));
  assert.equal(menu.__codexSessionMoreRow, undefined); assert.equal(menu.__codexSessionMoreGroup, undefined);
  assert.equal(menu.__codexSessionMoreCleanup, undefined);
  assert.equal(item.__codexSessionCopyRow, undefined); assert.equal(item.__codexSessionAutoRenameRow, undefined);
  f.ctx.disposeSessionMoreMenu(menu); // 重复清理无副作用。
});

test("moved action groups are retired while reconnected rows and unowned extension menus survive", () => {
  const f = fixture(), moved = f.add(), restored = f.add();
  moved.row.children = []; // 行与组都连接，但组已不属于该行。
  restored.row.remove(); restored.row.isConnected = true;
  const extension = new UiNode(); f.menus.push(extension);
  f.ctx.pruneSessionMoreMenus();
  assert.equal(moved.menu.isConnected, false); assert.equal(moved.group.isConnected, false);
  assert.equal(restored.menu.isConnected, true); assert.equal(extension.isConnected, true);
});

test("valid menus retain hover/focus and outside auto-close behavior", () => {
  const f = fixture(), { row, group, button, menu, item } = f.add(); menu.hidden = false;
  const fire = () => { menu.fire("pointerleave"); for (const [id, callback] of [...f.timers]) { f.timers.delete(id); callback(); } };
  group.hover = true; fire(); assert.equal(menu.hidden, false);
  group.hover = false; f.document.activeElement = item; fire(); assert.equal(menu.hidden, false);
  f.document.activeElement = null; row.classes.add("codex-session-more-open"); fire();
  assert.equal(menu.hidden, true); assert.equal(button.attrs.get("aria-expanded"), "false");
  assert.equal(row.classes.size, 0); assert.equal(f.timers.size, 0);
});

test("existing deferred scans prune before attaching new groups, and reinjection exposes cleanup", () => {
  const view = readFileSync(new URL("../../../assets/inject/renderer-inject/95-conversation-view.js", import.meta.url), "utf8");
  const scan = view.match(/^  function scanDeferred\(\) \{[^]*?^  \}/m)?.[0];
  assert.ok(scan); assert.ok(scan.indexOf("pruneSessionMoreMenus();") < scan.indexOf("sessionRows().forEach(tryAttachButton)"));
  assert.match(source, /window\.__codexPlusSessionMoreMenusCleanup\?\.\(\)/);
});
