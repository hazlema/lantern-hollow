type Child = Node | string | null | undefined | false;

export interface HProps {
  class?: string;
  html?: string;
  text?: string;
  style?: string;
  title?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  attrs?: Record<string, string>;
}

/** Tiny hyperscript: h('div', { class: 'panel' }, child, 'text'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: HProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.style) el.setAttribute('style', props.style);
  if (props.title) el.title = props.title;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener);
  for (const c of children) if (c) el.append(c);
  return el;
}

export function ico(svg: string, cls = 'ico'): HTMLSpanElement {
  return h('span', { class: cls, html: svg });
}

/** Restart a CSS animation class on an element. */
export function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** append() that skips null/false children. */
export function add(el: Element, ...children: Child[]): void {
  for (const c of children) if (c) el.append(c);
}
