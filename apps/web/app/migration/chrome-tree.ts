import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';

const attributeNames: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  autofocus: 'autoFocus',
  viewbox: 'viewBox',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'xlink:href': 'xlinkHref',
};
const booleanAttributes = new Set([
  'hidden',
  'open',
  'disabled',
  'checked',
  'selected',
  'multiple',
  'required',
  'readonly',
  'autofocus',
  'inert',
]);

function styleProps(element: Element) {
  const style = (element as HTMLElement | SVGElement).style;
  return Object.fromEntries(
    Array.from(style).map((name) => [
      name.startsWith('--')
        ? name
        : name.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
      style.getPropertyValue(name),
    ]),
  );
}

function fromDOM(node: Node): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const props: Record<string, unknown> = {};
  for (const { name, value } of node.attributes) {
    props[attributeNames[name] || name] =
      name === 'style' ? styleProps(node) : booleanAttributes.has(name) ? true : value;
  }
  return createElement(node.localName, props, ...Array.from(node.childNodes, fromDOM));
}

type ChromeProps = { children?: ReactNode; [attribute: string]: unknown };
function identity(node: ReactElement<ChromeProps>): string {
  const tag = String(node.type);
  for (const attribute of [
    'id',
    'data-route',
    'data-tab',
    'data-action',
    'data-grp',
    'data-sec',
    'className',
  ]) {
    const value = node.props[attribute];
    if (value != null) return `${tag}[${attribute}=${String(value)}]`;
  }
  // Anonymous wrappers inherit their first element's identity. In particular,
  // late core data must not move the footer's sister link.
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  const child = children.find((item): item is ReactElement<ChromeProps> =>
    isValidElement<ChromeProps>(item),
  );
  return child ? `${tag}>${identity(child)}` : tag;
}

/** Legacy HTML has indentation text nodes; React chrome has fragments and arrays.
 * Flatten both into the same host-element tree. Element keys follow stable attributes and ignore whitespace,
 * so the first model update retains links, controls, SVG nodes and keyboard focus. */
export function chromeTree(value: ReactNode, preserveControls = false): ReactNode[] {
  const flat: ReactNode[] = [];
  function visit(node: ReactNode) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node == null || typeof node === 'boolean') return;
    if (
      !isValidElement<{ children?: ReactNode; dangerouslySetInnerHTML?: { __html: string } }>(node)
    ) {
      flat.push(node);
      return;
    }
    if (node.type === Fragment) {
      visit(node.props.children);
      return;
    }
    if (typeof node.type !== 'string')
      throw new Error('Chrome factories must return host elements');
    const { children, dangerouslySetInnerHTML, ...props } = node.props;
    // The legacy sheet/search handlers own expanded state even while React adopts the chrome.
    const attributes = props as ChromeProps;
    if (preserveControls && 'aria-expanded' in attributes) {
      const live =
        typeof attributes.id === 'string'
          ? document.getElementById(attributes.id)
          : attributes['data-grp'] != null
            ? document.querySelector(`[data-grp="${String(attributes['data-grp'])}"]`)
            : null;
      if (live) attributes['aria-expanded'] = live.getAttribute('aria-expanded');
    }
    let content = children;
    if (dangerouslySetInnerHTML) {
      // Parse trusted icon markup only in a detached template; React owns the live SVG.
      const template = document.createElement('template');
      template.innerHTML =
        node.type === 'svg'
          ? `<svg>${dangerouslySetInnerHTML.__html}</svg>`
          : dangerouslySetInnerHTML.__html;
      const parent = node.type === 'svg' ? template.content.firstChild! : template.content;
      content = Array.from(parent.childNodes, fromDOM);
    }
    flat.push(createElement(node.type, props, ...chromeTree(content, preserveControls)));
  }
  visit(value);
  const counts = new Map<string, number>();
  return flat.map((node) => {
    if (!isValidElement<ChromeProps>(node)) return node;
    const key = identity(node),
      index = counts.get(key) || 0;
    counts.set(key, index + 1);
    return createElement(node.type, { ...node.props, key: `${key}:${index}` });
  });
}

export function chromeDOM(container: Element) {
  return chromeTree(Array.from(container.childNodes, fromDOM));
}
