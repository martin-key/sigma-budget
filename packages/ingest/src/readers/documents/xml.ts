import { SaxesParser, type SaxesTagNS } from 'saxes';

export interface XmlNode {
  local: string;
  uri: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** Ordered text and child nodes, for OOXML text runs. */
  content: (string | XmlNode)[];
}

/** Strict, bounded XML with no DTD, entity declaration, schema or network IO. */
export function parseXml(text: string): XmlNode {
  if (Buffer.byteLength(text) > 100 * 1024 * 1024) throw new Error('XML size limit');
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined,
    count = 0;
  parser.on('doctype', () => {
    throw new Error('XML DOCTYPE is not supported');
  });
  parser.on('opentag', (tag: SaxesTagNS) => {
    if (++count > 2_000_000 || stack.length >= 256) throw new Error('XML structural limit');
    const node: XmlNode = {
      local: tag.local,
      uri: tag.uri,
      attributes: {},
      children: [],
      content: [],
    };
    for (const attr of Object.values(tag.attributes)) {
      // Qualified attributes use expanded names; namespace declarations cannot mask source attributes.
      node.attributes[attr.uri ? `{${attr.uri}}${attr.local}` : attr.local] = attr.value;
    }
    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(node);
      parent.content.push(node);
    } else root = node;
    stack.push(node);
  });
  const textNode = (value: string) => {
    stack.at(-1)?.content.push(value);
  };
  parser.on('text', textNode);
  parser.on('cdata', textNode);
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(text).close();
  if (!root) throw new Error('Missing XML root');
  return root;
}

export function* descendants(node: XmlNode): Generator<XmlNode> {
  yield node;
  for (const child of node.children) yield* descendants(child);
}
export const xmlText = (node: XmlNode): string =>
  node.content.map((c) => (typeof c === 'string' ? c : xmlText(c))).join('');
