/** Dispose one widget without disturbing the other objects in an editor. */
const roots = new Map<Node, Set<() => void>>()
let installed = false
let registered = false
const disposeAll = () => {
  registered = false
  for (const callbacks of [...roots.values()]) for (const cleanup of [...callbacks]) cleanup()
  roots.clear()
}
export function onObjectDispose(root: Node, cleanup: () => void) {
  if (!registered && window.addCleanup) { registered = true; window.addCleanup(disposeAll) }
  if (!installed) {
    installed = true
    document.addEventListener("bb:dispose-object", event => {
      const parent = (event as CustomEvent).detail?.root as Node | undefined
      if (!parent) return
      for (const [node, callbacks] of roots) if (parent === node || parent.contains(node)) {
        roots.delete(node)
        for (const dispose of callbacks) dispose()
      }
    })
    document.addEventListener("nav", () => {
      for (const [node, callbacks] of roots) if (!node.isConnected) {
        roots.delete(node)
        for (const dispose of callbacks) dispose()
      }
    })
  }
  let cleaned = false
  const dispose = () => {
    if (cleaned) return
    cleaned = true
    cleanup()
    roots.get(root)?.delete(dispose)
    if (!roots.get(root)?.size) roots.delete(root)
  }
  const callbacks = roots.get(root) ?? new Set()
  callbacks.add(dispose)
  roots.set(root, callbacks)
}
