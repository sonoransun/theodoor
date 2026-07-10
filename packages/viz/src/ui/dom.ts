/** Tiny DOM helper — h('div', { class: 'x', onclick: fn }, 'text', node). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: readonly (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener)
    } else if (v === true) {
      el.setAttribute(k, '')
    } else {
      el.setAttribute(k, String(v))
    }
  }
  el.append(...children)
  return el
}
