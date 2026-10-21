import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../../assets/inject/", import.meta.url);
const patch = readFileSync(new URL("dream-skin-mutation-filter.js", root), "utf8").trim();
const anchor = 'if (record.type !== "attributes") return true;';
const source = readFileSync(new URL("upstream/dream-skin/windows/renderer-inject.js", root), "utf8");

function observer(patched: boolean) {
  const calls: unknown[] = [];
  const start = source.indexOf("    const predicateClass =");
  const end = source.indexOf("\n  let mediaQuery", start);
  assert.ok(start > 0 && end > start);
  // 截取真实监听器，保留上游的属性筛选与调度行为。
  const code = source.slice(start, end).replace(/\n  \}\s*$/, "");
  const create = new Function("MutationObserver", "scheduleEnsure", `let partObserver; ${patched ? code.replace(anchor, patch) : code} return partObserver;`);
  const captured = create(class { callback: unknown; constructor(callback: unknown) { this.callback = callback; } }, (...args: unknown[]) => calls.push(args));
  return { callback: captured.callback, calls };
}
const text = { nodeType: 3 }, comment = { nodeType: 8 }, element = { nodeType: 1 };
const children = (addedNodes: unknown[], removedNodes: unknown[] = []) => ({ type: "childList", addedNodes, removedNodes });

test("local skin patch has exactly one upstream anchor on both platforms", () => {
  for (const platform of ["windows", "macos"]) {
    const runtime = readFileSync(new URL(`upstream/dream-skin/${platform}/renderer-inject.js`, root), "utf8");
    assert.equal(runtime.split(anchor).length - 1, 1);
  }
});

test("text replacement, clearing and comment-only updates skip skin structure scans", () => {
  const before = observer(false), after = observer(true);
  for (const record of [children([text], [text]), children([], [text]), children([text]), children([comment], [comment])]) {
    before.callback([record]); after.callback([record]);
  }
  assert.equal(before.calls.length, 4);
  assert.equal(after.calls.length, 0);
});

test("element additions/removals and mixed batches keep exactly the original refresh", () => {
  const before = observer(false), after = observer(true);
  for (const batch of [[children([element])], [children([], [element])], [children([text], [element])], [children([text]), children([element])]]) {
    before.callback(batch); after.callback(batch);
  }
  assert.equal(after.calls.length, 4);
  assert.deepEqual(after.calls, before.calls);
});

test("structural attribute changes retain upstream behavior", () => {
  const before = observer(false), after = observer(true);
  for (const [attributeName, oldValue, value] of [["class", "", "main-surface"], ["role", "", "dialog"], ["data-testid", "", "home-icon"], ["class", "foo", "bar"], ["role", "dialog", "dialog"]]) {
    const records = [{ type: "attributes", attributeName, oldValue, target: { getAttribute: () => value } }];
    before.callback(records); after.callback(records);
  }
  assert.equal(after.calls.length, 3);
  assert.deepEqual(after.calls, before.calls);
});
