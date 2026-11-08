import { Fragment, cloneElement, isValidElement, type ReactNode } from 'react';
export function fixFiles(node: ReactNode, base: string): ReactNode {
  if (Array.isArray(node)) return node.map((n) => fixFiles(n, base));
  if (!isValidElement<{ children?: ReactNode; href?: string }>(node)) return node;
  const href = node.props.href;
  return cloneElement(
    node,
    { ...(href?.startsWith('data/') ? { href: base + href.slice(5) } : {}) },
    fixFiles(node.props.children, base),
  );
}

// Keep adjacent text in one host node, as in the frozen server documents.
// React otherwise inserts separators which the independent SSR parser observes.
export function compactText(tree: ReactNode, path: readonly (string | number)[] = []): ReactNode[] {
  const result: ReactNode[] = [];
  function add(node: ReactNode, path: readonly (string | number)[]) {
    if (Array.isArray(node)) {
      node.forEach((child, i) => add(child, [...path, i]));
      return;
    }
    if (node == null || typeof node === 'boolean') return;
    if (isValidElement<{ children?: ReactNode }>(node)) {
      if (node.type === Fragment) {
        add(node.props.children, [...path, 'fragment', node.key ?? '']);
        return;
      }
      result.push(
        cloneElement(
          node,
          { key: JSON.stringify([...path, node.key ?? '']) },
          ...compactText(node.props.children, [...path, 'children']),
        ),
      );
      return;
    }
    const last = result[result.length - 1];
    if (
      (typeof node === 'string' || typeof node === 'number') &&
      (typeof last === 'string' || typeof last === 'number')
    )
      result[result.length - 1] = String(last) + String(node);
    else result.push(node);
  }
  add(tree, path);
  return result;
}
