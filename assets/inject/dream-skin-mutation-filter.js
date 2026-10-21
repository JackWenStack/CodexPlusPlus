// Codex++: 皮肤结构选择器不依赖文字内容；元素增删仍走上游完整刷新。
if (record.type === "childList") {
  const changedNodes = [...record.addedNodes, ...record.removedNodes];
  if (changedNodes.length > 0 && changedNodes.every((node) => node.nodeType === 3 || node.nodeType === 8)) return false;
}
if (record.type !== "attributes") return true;
