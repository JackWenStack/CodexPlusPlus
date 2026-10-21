  // 只过滤 renderer 的列表镜像；不改 worker、会话内容、数据库或删除状态。
  const desktopSessionFilter = window.__codexPlusDesktopSessionFilter
    || (window.__codexPlusDesktopSessionFilter = { target: null, enabled: true, lastDiscovery: 0 });
  clearTimeout(desktopSessionFilter.retryTimer);
  desktopSessionFilter.retryTimer = null;

  function isCliSidebarSession(thread, hostId) {
    if (hostId !== "local" || (thread?.hostId && thread.hostId !== "local")) return false;
    const originator = typeof thread?.originator === "string" ? thread.originator.trim().toLowerCase() : "";
    if (/^codex[ _-]?desktop$/.test(originator)) return false;
    const source = typeof thread?.source === "string" ? thread.source : thread?.source?.type;
    return source === "cli" || source === "exec" || /^(codex[-_]tui|codex[-_]cli(?:[-_]rs)?)$/.test(originator);
  }

  function desktopSidebarSessions(items, hostId) {
    if (!Array.isArray(items)) return items;
    const visible = items.filter((item) => !isCliSidebarSession(item, hostId));
    return visible.length === items.length ? items : visible;
  }
  desktopSessionFilter.filter = desktopSidebarSessions;

  function isLocalSessionListMirror(value) {
    return value?.hostId === "local"
      && typeof value.getRecentConversations === "function"
      && typeof value.getThreadSummaries === "function"
      && typeof value.applyRecentConversations === "function"
      && typeof value.applyThreadSummaries === "function";
  }

  function restoreDesktopSessionListMirror() {
    const state = desktopSessionFilter.target;
    if (!state) return;
    desktopSessionFilter.target = null;
    for (const entry of state.entries) {
      // 不覆盖随后安装的其他补丁。
      if (state.mirror[entry.method] === entry.wrapper) state.mirror[entry.method] = entry.original;
      entry.original.call(state.mirror, entry.raw, ...entry.args);
    }
  }

  function patchDesktopSessionListMirror(mirror) {
    if (!isLocalSessionListMirror(mirror)) return false;
    if (desktopSessionFilter.target?.mirror === mirror) return true;
    const recent = mirror.getRecentConversations();
    const summaries = mirror.getThreadSummaries();
    if (!Array.isArray(recent) || !Array.isArray(summaries)) return false;
    restoreDesktopSessionListMirror();
    const state = { mirror, entries: [] };
    try {
      for (const [method, raw, args] of [
        ["applyRecentConversations", recent, [mirror.hasFetchedRecentConversations]],
        ["applyThreadSummaries", summaries, []],
      ]) {
        const entry = { method, raw, args, original: mirror[method], wrapper: null };
        entry.wrapper = function (items, ...rest) {
          entry.raw = items;
          entry.args = rest;
          const visible = desktopSessionFilter.enabled
            ? desktopSessionFilter.filter(items, this.hostId) : items;
          return entry.original.call(this, visible, ...rest);
        };
        state.entries.push(entry);
        mirror[method] = entry.wrapper;
        if (mirror[method] !== entry.wrapper) throw new Error("Session mirror method is not writable");
      }
    } catch {
      for (const entry of state.entries) {
        if (mirror[entry.method] === entry.wrapper) mirror[entry.method] = entry.original;
      }
      return false;
    }
    desktopSessionFilter.target = state;
    for (const entry of state.entries) entry.wrapper.call(mirror, entry.raw, ...entry.args);
    return true;
  }

  function desktopSessionMirrorFromFiber(fiber) {
    const seenBindings = new Set();
    for (let depth = 0; fiber && depth < 32; depth++, fiber = fiber.return) {
      let hook = fiber.memoizedState;
      for (let index = 0; hook && index < 64; index++, hook = hook.next) {
        const bindings = hook.memoizedState?.current?.node?.familyBindings;
        if (!(bindings instanceof Map) || seenBindings.has(bindings)) continue;
        seenBindings.add(bindings);
        let count = 0;
        // 仅读取已经解析的 local signal，不猜压缩导出名、不创建新的 scope。
        for (const entries of bindings.values()) {
          if (++count > 256) break;
          const signal = entries instanceof Map ? entries.get("local")?.value : null;
          if (typeof signal?.get !== "function" || typeof signal?.subscribe !== "function") continue;
          try {
            const value = signal.get();
            if (isLocalSessionListMirror(value)) return value;
          } catch {}
        }
      }
    }
    return null;
  }

  function syncDesktopSessionListFilter(force = false) {
    desktopSessionFilter.enabled = codexPlusBackendSettings.enhancementsEnabled !== false;
    if (!desktopSessionFilter.enabled) {
      restoreDesktopSessionListMirror();
      return false;
    }
    const now = Date.now();
    if (!force && now - desktopSessionFilter.lastDiscovery < 2000) return !!desktopSessionFilter.target;
    desktopSessionFilter.lastDiscovery = now;
    const rows = document.querySelectorAll('[data-app-action-sidebar-thread-id]');
    for (const row of Array.from(rows).slice(0, 3)) {
      const key = Object.getOwnPropertyNames(row).find((key) => key.startsWith("__reactFiber$"));
      const mirror = desktopSessionMirrorFromFiber(key ? row[key] : null);
      if (mirror) return patchDesktopSessionListMirror(mirror);
    }
    return false;
  }

  function scheduleDesktopSessionFilterStartup() {
    let attempts = 0;
    const attempt = () => {
      desktopSessionFilter.retryTimer = null;
      try { if (syncDesktopSessionListFilter(true)) return; } catch {}
      if (++attempts >= 20 || codexPlusBackendSettings.enhancementsEnabled === false) return;
      desktopSessionFilter.retryTimer = setTimeout(attempt, 500);
    };
    attempt();
  }
