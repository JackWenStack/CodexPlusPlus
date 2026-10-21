import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const read = (name: string) => readFileSync(new URL(`../../../assets/inject/renderer-inject/${name}`, import.meta.url), "utf8");
const action = read("90-action-groups.js"), view = read("95-conversation-view.js"), skin = read("10-style.js");
const fn = (source: string, name: string) => {
  const match = source.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"));
  assert.ok(match, name);
  return match[0];
};

test("alignment stops after two stable frames, remains bounded and respects disable", () => {
  const frames: (() => void)[] = [];
  let calls = 0, enabled = true, stable = true;
  const context = vm.createContext({
    conversationViewState: { settleFramesLeft: 0, stableFrames: 0, rafId: 0 },
    codexPlusSettings: () => ({ conversationView: enabled }),
    conversationViewAlignNow: () => { calls++; return stable; },
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
  });
  vm.runInContext(fn(action, "scheduleConversationViewAlign"), context);
  const drain = () => { let budget = 40; while (frames.length) { assert.ok(budget--); frames.shift()!(); } };
  context.scheduleConversationViewAlign(); drain(); assert.equal(calls, 2);
  stable = false; calls = 0; context.scheduleConversationViewAlign(); drain(); assert.equal(calls, 16);
  calls = 0; context.scheduleConversationViewAlign(); enabled = false; drain(); assert.equal(calls, 0);
});

test("cached targets are resolved again only when invalidated, moved or detached", () => {
  const parent = {}, content = { isConnected: true, parentElement: parent }, composer = { isConnected: true, parentElement: parent };
  let contentReads = 0, composerReads = 0;
  const state = { targetsDirty: true, contentEl: null, composerEl: null };
  const context = vm.createContext({
    conversationViewState: state, document: {}, conversationViewObserveIfNeeded: () => {},
    conversationViewFindContentEl: () => { contentReads++; return content; },
    conversationViewFindComposerEl: () => { composerReads++; return composer; },
  });
  vm.runInContext(fn(action, "conversationViewResolveTargets"), context);
  for (let i = 0; i < 20; i++) context.conversationViewResolveTargets();
  assert.equal(contentReads, 1); assert.equal(composerReads, 1);
  content.parentElement = {}; context.conversationViewResolveTargets(); assert.equal(contentReads, 2);
  state.targetsDirty = true; context.conversationViewResolveTargets(); assert.equal(contentReads, 3);
  content.isConnected = false; context.conversationViewResolveTargets(); assert.equal(contentReads, 4);
});

test("conversation observer ignores message/sidebar updates but invalidates replaced targets", () => {
  let observer: (records: object[]) => void = () => {}, schedules = 0;
  const message = {}, sidebar = { closest: () => ({}) };
  const content = { isConnected: true, contains: (node: unknown) => node === message || node === content };
  const composer = { isConnected: true, contains: () => false };
  const state = { contentEl: content, composerEl: composer, targetsDirty: false };
  const context = vm.createContext({
    conversationViewState: state, document: { body: {} },
    conversationViewPaneBoundarySelector: "aside", conversationViewScrollContainerSelector: ".scroller", conversationViewFooterSelector: ".footer",
    scheduleConversationViewAlign: () => { schedules++; },
    ResizeObserver: class {}, MutationObserver: class { constructor(callback: typeof observer) { observer = callback; } observe() {} },
  });
  vm.runInContext(fn(view, "ensureConversationViewRuntime"), context); context.ensureConversationViewRuntime();
  observer([{ target: sidebar, type: "attributes" }, { target: message, type: "attributes" }, { target: content, type: "childList" }]);
  observer([{ target: { contains: () => true }, type: "childList", addedNodes: [{}], removedNodes: [] }]);
  assert.equal(schedules, 0); assert.equal(state.targetsDirty, false);
  content.isConnected = false;
  observer([{ target: { contains: () => false }, type: "childList", addedNodes: [], removedNodes: [content] }]);
  assert.equal(schedules, 1); assert.equal(state.targetsDirty, true);
});

test("disabled skin cleans once and cleans again after enable or an external runtime", () => {
  const window: Record<string, unknown> = {};
  let enabled = false, sweeps = 0, externalCleanup = 0;
  const context = vm.createContext({
    window, codexPlusSettings: () => ({ dreamSkinEnabled: enabled }), codexPlusBackendSettingsLoaded: true,
    clearDreamSkinPresentation: () => { sweeps++; }, ensureDreamSkinMainSurface: () => {}, installDreamSkin: () => {},
  });
  vm.runInContext(fn(skin, "cleanupDreamSkin") + fn(skin, "refreshDreamSkin"), context);
  for (let i = 0; i < 25; i++) context.refreshDreamSkin();
  assert.equal(sweeps, 1);
  enabled = true; context.refreshDreamSkin(); enabled = false; context.refreshDreamSkin(); assert.equal(sweeps, 2);
  window.__CODEX_DREAM_SKIN_STATE__ = { cleanup: () => { externalCleanup++; } };
  context.refreshDreamSkin(); context.refreshDreamSkin(); assert.equal(sweeps, 3); assert.equal(externalCleanup, 1);
});

test("legacy plugin filter is restored during hot reload even when unlock is disabled", () => {
  const context = vm.createContext({ window: {}, sendCodexPlusDiagnostic: () => {} });
  vm.runInContext(`
    const native = Array.prototype.filter;
    Array.prototype.__codexPluginBuildFlavorOriginalFilter = native;
    Array.prototype.filter = function legacy() { throw new Error('global filter still patched'); };
    Array.prototype.filter.__codexPluginBuildFlavorPatched = '17';
    window.__codexPluginBuildFlavorFilterPatch = '17';
    ${fn(read("60-plugin-marketplace.js"), "restoreLegacyPluginBuildFlavorFilter")}
    restoreLegacyPluginBuildFlavorFilter();
    restoreLegacyPluginBuildFlavorFilter();
    globalThis.result = Array.prototype.filter === native && [1,2,3].filter(n => n > 1).length === 2
      && !Array.prototype.__codexPluginBuildFlavorOriginalFilter && !window.__codexPluginBuildFlavorFilterPatch;
  `, context);
  assert.equal(context.result, true);
});

test("legacy cleanup never overwrites an unrelated filter implementation", () => {
  const context = vm.createContext({ window: {}, sendCodexPlusDiagnostic: () => {} });
  vm.runInContext(`
    Array.prototype.__codexPluginBuildFlavorOriginalFilter = Array.prototype.filter;
    const other = function otherFilter() {};
    Array.prototype.filter = other;
    ${fn(read("60-plugin-marketplace.js"), "restoreLegacyPluginBuildFlavorFilter")}
    restoreLegacyPluginBuildFlavorFilter();
    globalThis.result = Array.prototype.filter === other;
  `, context);
  assert.equal(context.result, true);
});
