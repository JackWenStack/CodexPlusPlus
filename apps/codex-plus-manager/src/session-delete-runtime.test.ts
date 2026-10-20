import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const shard = (name: string) => readFileSync(new URL(`../../../assets/inject/renderer-inject/${name}`, import.meta.url), "utf8");
const refs = shard("60-plugin-marketplace.js");
const deletion = shard("80-session-share.js");
const refHelpers = refs.slice(refs.indexOf("  function isClientNewThreadId(value)"), refs.indexOf("  if (window.__CODEX_PLUS_TEST_SESSION_REF__)"));
const singleFunction = (source: string, name: string) => source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  \\}`, "m"))?.[0] ?? "";
const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";

class Element {
  attributes = new Map<string, string>();
  parentElement: Element | null = null;
  visible = true;
  disabled = false;
  removed = false;
  clicks = 0;
  textContent = "";
  __reactFiber$fixture: any = null;
  constructor(attributes: Record<string, string> = {}) { for (const [key, value] of Object.entries(attributes)) this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  querySelector() { return null; }
  get isConnected() { return !this.removed; }
  closest(selector: string): Element | null {
    if (selector.includes("data-codex-plus-ext") && this.getAttribute("data-codex-plus-ext")) return this;
    if (selector.includes("aside") || selector.includes("nav")) return this.parentElement;
    return null;
  }
  contains() { return false; }
  blur() {}
  remove() { this.removed = true; }
  click() { this.clicks += 1; }
}

function row(id = uuid, host: string | null = null, props: any = null) {
  const element = new Element({ "data-app-action-sidebar-thread-id": id, href: `/thread/${id}` });
  if (host !== null) element.setAttribute("data-app-action-sidebar-thread-host-id", host);
  element.__reactFiber$fixture = { pendingProps: props, memoizedProps: null, return: null };
  return element;
}

function refFixture() {
  const context = vm.createContext({ selectors: { threadTitle: ".title" } });
  vm.runInContext(refHelpers, context);
  return (element: Element) => JSON.parse(JSON.stringify(context.sessionRefFromRow(element)));
}

// 26.930 静态原生合同：sidebarThreadRow({id,hostId,active})；kDo 的
// {conversationId,hostId,threadSummary} 以 hostId ?? threadSummary?.hostId 配对；
// 行组件还构造 {hostId,threadId:conversationId} locator。不是从 UUID 猜本机。
test("session host resolves paired native locators and thread summaries", () => {
  const resolve = refFixture();
  for (const props of [
    { conversationId: uuid, hostId: "local" },
    { threadId: uuid, hostId: "local" },
    { id: uuid, hostId: "local" },
    { conversationId: uuid, threadSummary: { id: uuid, hostId: "local" } },
    { conversationId: uuid, threadSummary: { hostId: "local" } },
    { thread: { id: uuid, hostId: "local" } },
    { children: { props: { threadId: uuid, hostId: "local" } } },
    { threadId: `local:${uuid}` },
  ]) assert.equal(resolve(row(uuid, null, props)).host_id, "local", JSON.stringify(props));
  assert.equal(resolve(row(uuid, null, { thread: { id: uuid, hostId: "ssh:fixture" } })).host_id, "ssh:fixture");
  assert.equal(resolve(row(`local:${uuid}`)).host_id, "local");
});

test("unknown, unrelated and conflicting host metadata remains refused", () => {
  const resolve = refFixture();
  for (const props of [
    null,
    { hostId: "local" },
    { threadId: otherUuid, hostId: "local" },
    { conversationId: uuid, hostId: "local", threadSummary: { id: uuid, hostId: "ssh:fixture" } },
    { conversationId: uuid, threadId: otherUuid, hostId: "local" },
    { conversationId: uuid, threadSummary: { id: otherUuid, hostId: "local" } },
  ]) assert.equal(resolve(row(uuid, null, props)).host_id, null, JSON.stringify(props));
  assert.equal(resolve(row(`local:${uuid}`, null, { threadId: uuid, hostId: "ssh:fixture" })).host_id, null);
  const element = row(uuid);
  element.__reactFiber$fixture.return = { pendingProps: { conversationId: otherUuid, hostId: "local" }, return: null };
  assert.equal(resolve(element).host_id, null);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise<void>((done) => setImmediate(done));

function deleteFixture() {
  const rows = [row(uuid, "local"), row(otherUuid, "local")];
  const button = new Element();
  const native = new Element({ "aria-label": "New chat" }); native.parentElement = new Element();
  const outside = new Element({ "aria-label": "New chat" });
  const extension = new Element({ "aria-label": "New chat", "data-codex-plus-ext": "fixture" }); extension.parentElement = new Element();
  const buttons = [native, outside, extension];
  const request = deferred<any>();
  const confirmations: string[] = [], requests: any[] = [], diagnostics: any[] = [], toasts: string[] = [], timers: number[] = [], refreshes: any[] = [];
  let reloads = 0;
  const location: any = { href: "", pathname: "", search: "", hash: "", reload: () => { reloads += 1; } };
  const setLocation = (href: string) => { const url = new URL(href); Object.assign(location, { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash }); };
  const activate = (id: string) => {
    setLocation(`app://-/thread/${id}`);
    rows.forEach((element) => element.setAttribute("data-app-action-sidebar-thread-active", String(element.getAttribute("data-app-action-sidebar-thread-id") === id)));
  };
  activate(uuid);
  const context = vm.createContext({ Element, HTMLElement: Element, URL, window: { location },
    document: { activeElement: null, querySelectorAll: () => buttons }, selectors: { threadTitle: ".title" },
    sessionRows: () => rows.filter((element) => element.isConnected),
    visibleElement: (element: Element) => element.visible && element.isConnected,
    isExtensionUiNode: (element: Element) => !!element.getAttribute("data-codex-plus-ext"),
    confirmDelete: (title: string) => { confirmations.push(title); return Promise.resolve(true); },
    postJson: (_path: string, ref: any) => { requests.push(ref); return request.promise; },
    showToast: (text: string) => { toasts.push(text); },
    sendCodexPlusDiagnostic: (event: string, details: any) => { diagnostics.push({ event, details }); },
    setTimeout: (_fn: Function, delay: number) => { timers.push(delay); return delay; },
    clearTimeout: (delay: number) => { const index = timers.indexOf(delay); if (index >= 0) timers.splice(index, 1); },
    codexAppAssetUrl: () => "",
    rpc: { sendRequest: (method: string, params: any) => { refreshes.push({ method, params }); return Promise.resolve({}); } },
  });
  vm.runInContext(`${refHelpers}\n${singleFunction(refs, "locationThreadId")}\n${singleFunction(refs, "currentSessionRef")}\n${deletion.slice(deletion.indexOf("  function rowHref(row)"), deletion.indexOf("  async function exportMarkdown(ref)"))}\n${singleFunction(deletion, "sendNativeSessionRequest")}\n${singleFunction(deletion, "syncLocalSessionMutation")}\n${singleFunction(deletion, "refreshRecentConversationsForHost")}\nfunction signal(e,t){return rpc.sendRequest(e,t)}; loadOptionalCodexAppModule=async()=>({signal});`, context);
  const begin = async (element = rows[0]) => { context.openDeleteConfirmForRow(element, button, context.sessionRefFromRow(element), { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); await flush(); };
  const finish = async (result = { status: "local_deleted", session_id: requests[0]?.session_id, message: "deleted" }) => { request.resolve(result); await flush(); };
  return { context, rows, native, buttons, requests, confirmations, diagnostics, timers, toasts, refreshes, begin, finish, activate, setLocation, reloads: () => reloads };
}

test("local current deletion uses native navigation and refresh without a page reload", async () => {
  const f = deleteFixture(); await f.begin(); await f.finish();
  assert.equal(f.native.clicks, 1);
  assert.equal(f.rows[0].removed, true);
  assert.equal(f.refreshes.length, 1);
  assert.equal(f.refreshes[0].method, "handle-app-server-notification-for-host");
  assert.equal(f.refreshes[0].params.hostId, "local");
  assert.equal(f.refreshes[0].params.notification.method, "thread/deleted");
  assert.equal(f.refreshes[0].params.notification.params.threadId, uuid);
  assert.equal(f.timers.length, 0);
  assert.equal(f.reloads(), 0);
});

test("async deletion cannot navigate away from a conversation selected in the meantime", async () => {
  const f = deleteFixture(); await f.begin(); f.activate(otherUuid); await f.finish();
  assert.equal(f.native.clicks, 0);
  assert.equal(f.rows[0].removed, true);
  assert.equal(f.rows[1].removed, false);
  assert.equal(f.timers.length, 0);
});

test("async deletion cannot remove a DOM row reused for another thread or host", async () => {
  for (const changeHost of [false, true]) {
    const f = deleteFixture(); await f.begin();
    f.rows[0].setAttribute(changeHost ? "data-app-action-sidebar-thread-host-id" : "data-app-action-sidebar-thread-id", changeHost ? "ssh:fixture" : otherUuid);
    await f.finish();
    assert.equal(f.rows[0].removed, false);
    assert.equal(f.native.clicks, 0);
    assert.equal(f.timers.length, 0);
  }
});

test("native navigation cannot remove a row synchronously repurposed by React", async () => {
  const f = deleteFixture();
  f.native.click = () => { f.native.clicks += 1; f.rows[0].setAttribute("data-app-action-sidebar-thread-id", otherUuid); };
  await f.begin(); await f.finish();
  assert.equal(f.native.clicks, 1); assert.equal(f.rows[0].removed, false);
  assert.equal(f.timers.length, 0);
});

test("a row changing host while confirmation is pending is rejected before deletion", async () => {
  const f = deleteFixture(), confirmation = deferred<boolean>();
  f.context.confirmDelete = () => confirmation.promise;
  await f.begin(); f.rows[0].setAttribute("data-app-action-sidebar-thread-host-id", "ssh:fixture");
  confirmation.resolve(true); await flush();
  assert.equal(f.requests.length, 0); assert.equal(f.rows[0].removed, false);
  assert.match(f.toasts[0], /会话已变化/);
});

test("remote deletion continues to rely on native host notifications", async () => {
  const f = deleteFixture(); f.rows[0].setAttribute("data-app-action-sidebar-thread-host-id", "ssh:fixture");
  await f.begin(); await f.finish({ status: "server_deleted", session_id: uuid, message: "deleted" });
  assert.equal(f.requests[0].host_id, "ssh:fixture");
  assert.equal(f.native.clicks, 0); assert.equal(f.rows[0].removed, false);
  assert.equal(f.refreshes.length, 0); assert.equal(f.timers.length, 0);
});

test("a mismatched deletion result does not mutate the requested conversation view", async () => {
  const f = deleteFixture(); await f.begin(); await f.finish({ status: "local_deleted", session_id: otherUuid, message: "deleted" });
  assert.equal(f.rows[0].removed, false); assert.equal(f.native.clicks, 0);
  assert.match(f.toasts[0], /结果与请求会话不一致/);
});

test("non-current deletion refreshes the list without changing the selected thread", async () => {
  const f = deleteFixture(); await f.begin(f.rows[1]); await f.finish();
  assert.equal(f.native.clicks, 0);
  assert.equal(f.rows[1].removed, true);
  assert.equal(f.rows[0].removed, false);
  assert.equal(f.refreshes.length, 1);
  assert.equal(f.timers.length, 0);
});

test("unknown hosts retain the safe refusal and emit metadata-only evidence", async () => {
  const f = deleteFixture(); f.rows[0].attributes.delete("data-app-action-sidebar-thread-host-id"); await f.begin();
  assert.equal(f.requests.length, 0); assert.equal(f.confirmations.length, 0);
  assert.match(f.toasts[0], /无法确定会话主机归属/);
  assert.equal(f.diagnostics.length, 1);
  assert.ok(!JSON.stringify(f.diagnostics).includes(uuid));
});

test("route identity must match rather than merely sharing the same pathname", () => {
  const f = deleteFixture(); f.rows[0].attributes.delete("data-app-action-sidebar-thread-active");
  f.rows[0].setAttribute("href", `app://-/index.html?thread=${uuid}`);
  f.setLocation(`app://-/index.html?thread=${otherUuid}`);
  assert.equal(f.context.isCurrentSessionRow(f.rows[0], f.context.sessionRefFromRow(f.rows[0])), false);
});

test("missing or ambiguous native new-chat affordances never trigger a reload", async () => {
  for (const ambiguous of [false, true]) {
    const f = deleteFixture();
    if (ambiguous) { const duplicate = new Element({ "aria-label": "New chat" }); duplicate.parentElement = new Element(); f.buttons.push(duplicate); }
    else f.native.visible = false;
    await f.begin(); await f.finish();
    assert.equal(f.native.clicks, 0); assert.equal(f.timers.length, 0); assert.equal(f.reloads(), 0);
  }
});

test("26.730 uses its loaded app-initial three-argument dispatcher without scanning a missing module", async () => {
  const f = deleteFixture(), loaded: string[] = [];
  f.context.codexAppAssetUrl = (name: string) => name === "app-initial-" ? "app://-/assets/app-initial-fixture.js" : "";
  vm.runInContext("function legacy(e,t,n){return n==null?rpc.sendRequest(e,t):rpc.sendRequest(e,t,n)}", f.context);
  f.context.loadOptionalCodexAppModule = async (name: string) => { loaded.push(name); return { dispatcher: f.context.legacy }; };
  await f.begin(); await f.finish();
  assert.deepEqual(loaded, ["app-initial-"]);
  assert.equal(f.refreshes.length, 1);
  assert.equal(f.refreshes[0].params.notification.method, "thread/deleted");
});

test("failed deletion never emits a native deletion notification or changes the list", async () => {
  const f = deleteFixture(); await f.begin();
  await f.finish({ status: "failed", session_id: uuid, message: "Thread not found in local storage" });
  assert.equal(f.refreshes.length, 0);
  assert.equal(f.rows[0].removed, false);
  assert.equal(f.native.clicks, 0);
});

test("undo notification restores the same local identity without calling server deletion", async () => {
  const f = deleteFixture();
  assert.equal(await f.context.syncLocalSessionMutation("thread/unarchived", `local:${uuid}`), true);
  assert.equal(f.refreshes[0].params.notification.method, "thread/unarchived");
  assert.equal(f.refreshes[0].params.notification.params.threadId, uuid);
  assert.equal(await f.context.syncLocalSessionMutation("thread/unarchived", "client-new-thread:fixture"), false);
  assert.equal(await f.context.syncLocalSessionMutation("thread/delete", uuid), false);
  assert.equal(f.refreshes.length, 1);
  assert.equal(f.reloads(), 0);
});

test("the undo button notifies native state only after a successful restore, without reloading drafts", async () => {
  for (const status of ["undone", "failed"]) {
    const f = deleteFixture(), elements: any[] = [];
    Object.assign(f.context, {
      codexPlusToastLimit: 3, codexPlusToastLifetimeMs: 10000,
      layoutCodexPlusToasts: () => {}, dismissCodexPlusToast: () => {},
      postJson: async () => ({ status, session_id: uuid, message: status }),
    });
    f.context.document.querySelectorAll = () => [];
    f.context.document.body = { appendChild() {} };
    f.context.document.createElement = () => {
      const element: any = {
        dataset: {}, listeners: {},
        appendChild() {},
        addEventListener(name: string, listener: Function) { this.listeners[name] = listener; },
      };
      elements.push(element);
      return element;
    };
    vm.runInContext(singleFunction(deletion, "showToast"), f.context);
    f.context.showToast("deleted", "test-backup-token");
    await elements[1].listeners.click();
    assert.equal(f.refreshes.length, status === "undone" ? 1 : 0);
    if (status === "undone") assert.equal(f.refreshes[0].params.notification.method, "thread/unarchived");
    assert.equal(f.reloads(), 0);
  }
});

test("notification incompatibility falls back to bounded native list refresh", async () => {
  const f = deleteFixture();
  f.context.rpc.sendRequest = async (method: string, params: any) => {
    f.refreshes.push({ method, params });
    if (method === "handle-app-server-notification-for-host") throw new Error("unsupported");
    return {};
  };
  await f.begin(); await f.finish();
  assert.deepEqual(f.refreshes.map((entry) => entry.method), [
    "handle-app-server-notification-for-host", "refresh-recent-conversations-for-host",
  ]);
  assert.equal(f.reloads(), 0);
});

test("module timeout cannot send a late deletion notification after undo", async () => {
  const f = deleteFixture(), module = deferred<any>(), callbacks: Function[] = [];
  f.context.loadOptionalCodexAppModule = () => module.promise;
  f.context.setTimeout = (fn: Function) => { callbacks.push(fn); return callbacks.length; };
  const request = f.context.sendNativeSessionRequest("handle-app-server-notification-for-host", {});
  callbacks[0]();
  assert.equal(await request, false);
  module.resolve({ signal: f.context.signal });
  await flush();
  assert.equal(f.refreshes.length, 0);
});

test("a hanging refresh is bounded and a wrong dispatcher signature is not invoked", async () => {
  const f = deleteFixture(), callbacks: Function[] = [];
  f.context.setTimeout = (fn: Function) => { callbacks.push(fn); return callbacks.length; };
  f.context.rpc.sendRequest = () => new Promise(() => {});
  const request = f.context.refreshRecentConversationsForHost();
  await flush(); callbacks[0]();
  assert.equal(await request, false);
  let called = false;
  f.context.loadOptionalCodexAppModule = async () => ({ unrelated: (_a: unknown, _b: unknown) => { called = true; } });
  assert.equal(await f.context.refreshRecentConversationsForHost(), false);
  assert.equal(called, false);
});
