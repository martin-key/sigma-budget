import { cloneElement, isValidElement, type ReactNode } from 'react';
import { patterns, find, index } from '../lib/legacy';
import { href } from '../lib/legacy';
const skip = new Set(
  'a button summary label select option textarea input h1 h2 h3 h4 h5 h6 table svg code kbd mark nav'.split(
    ' ',
  ),
);
// Tokenize React text before commit; no scanner may mutate a React-owned subtree.
export function glossaryTree(
  tree: ReactNode,
  glossary: unknown,
  onTerm?: (anchor: HTMLElement, slug: string) => void,
): ReactNode {
  const done = new Set(),
    pats = patterns(index(glossary));
  function walk(node: ReactNode, scan = false, blocked = false, box = { count: 0 }): ReactNode {
    if (Array.isArray(node))
      return node.map((n, i) => {
        const child = walk(n, scan, blocked, box);
        return isValidElement(child) && child.key === null
          ? cloneElement(child, { key: i })
          : child;
      });
    if (typeof node === 'string' && scan && !blocked && node.trim().length >= 3) {
      let text = node,
        out: ReactNode[] = [];
      while (box.count < 3) {
        let best: { p: import('../lib/legacy').GlossaryPattern; m: RegExpExecArray } | undefined;
        for (const p of pats) {
          if (done.has(p.slug)) continue;
          const m = find(p, text);
          if (
            m &&
            (!best ||
              m.index < best.m.index ||
              (m.index === best.m.index && m[0].length > best.m[0].length))
          )
            best = { p, m };
        }
        if (!best) break;
        const { p, m } = best;
        out.push(
          text.slice(0, m.index),
          <a
            key={p.slug}
            className="gl"
            href={href('rechnik', { term: p.slug })}
            data-gl={p.slug}
            aria-haspopup="dialog"
            onClick={(e) => {
              if (onTerm && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                onTerm(e.currentTarget, p.slug);
              }
            }}
          >
            {m[0]}
          </a>,
        );
        text = text.slice(m.index + m[0].length);
        done.add(p.slug);
        box.count++;
      }
      return [...out, text];
    }
    if (
      !isValidElement<{
        children?: ReactNode;
        className?: string;
        'data-gl-scan'?: string;
        'data-gl-skip'?: string;
      }>(node)
    )
      return node;
    const props = node.props,
      tag = node.type;
    const active = scan || props['data-gl-scan'] !== undefined;
    const denied =
      blocked ||
      (typeof tag === 'string' && skip.has(tag)) ||
      props['data-gl-skip'] !== undefined ||
      /sr-only|kpi|chip|eyebrow|fig-legend/.test(props.className || '');
    const nextBox = ['p', 'li', 'dd', 'blockquote', 'figcaption'].includes(
      typeof tag === 'string' ? tag : '',
    )
      ? { count: 0 }
      : box;
    return cloneElement(node, {}, walk(props.children, active, denied, nextBox));
  }
  return walk(tree);
}
