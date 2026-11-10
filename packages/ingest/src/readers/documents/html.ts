import { Parser } from 'htmlparser2';
import type { GazetteBlock } from '../../build/law-types.js';

export const whitespace = (s: string): string => s.replace(/[\s\u001c-\u001f]+/gu, ' ').trim();

/** The legal DOCX uses single-cell rows for prose. Keep the remaining physical
 * cells (including empty cells) in consecutive ordered table chunks. */
export function splitParagraphRows(blocks: GazetteBlock[]): GazetteBlock[] {
  const out: GazetteBlock[] = [];
  for (const block of blocks) {
    if (block[0] === 'p') {
      out.push(block);
      continue;
    }
    let chunk: string[][] = [];
    for (const row of block[1]) {
      if (row.length > 0 && row.length <= 2 && row[0] && row.slice(1).every((c) => !c)) {
        if (chunk.length) out.push(['t', chunk]);
        chunk = [];
        out.push(['p', row[0]]);
      } else chunk.push(row);
    }
    if (chunk.length) out.push(['t', chunk]);
  }
  return out;
}

/** DV Word-export HTML: leaf tables are data, ancestor tables are layout.
 * htmlparser2 decodes entities and tolerates HTML's optional closing tags. */
export function parseLegalHtml(text: string): GazetteBlock[] {
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('HTML size limit');
  const leaves: boolean[] = [],
    stack: number[] = [];
  new Parser({
    onopentag(name) {
      if (name !== 'table') return;
      if (stack.length >= 128) throw new Error('HTML table depth limit');
      if (stack.length) leaves[stack.at(-1)!] = false;
      stack.push(leaves.length);
      leaves.push(true);
    },
    onclosetag(name) {
      if (name === 'table') stack.pop();
    },
  }).end(text);
  const blocks: GazetteBlock[] = [];
  let index = -1,
    leaf = false;
  let rows: string[][] = [],
    row: string[] | undefined,
    cell: string[] | undefined;
  let paragraph: string[] | undefined;
  new Parser({
    onopentag(name) {
      if (name === 'table') {
        if (leaves[++index]) {
          leaf = true;
          rows = [];
        }
      } else if (leaf) {
        if (name === 'tr') row = [];
        else if (name === 'td' || name === 'th') cell = [];
        else if (name === 'br') cell?.push(' ');
      } else if (name === 'p') paragraph = [];
      else if (name === 'br') paragraph?.push(' ');
    },
    onclosetag(name) {
      if (leaf) {
        if ((name === 'td' || name === 'th') && cell) {
          if (!row) throw new Error('HTML cell outside row');
          row.push(whitespace(cell.join('')));
          cell = undefined;
        } else if (name === 'tr' && row) {
          rows.push(row);
          row = undefined;
        } else if (name === 'table') {
          blocks.push(['t', rows]);
          rows = [];
          leaf = false;
        }
      } else if (name === 'p' && paragraph) {
        const value = whitespace(paragraph.join(''));
        if (value) blocks.push(['p', value]);
        paragraph = undefined;
      }
    },
    ontext(value) {
      if (leaf) cell?.push(value);
      else paragraph?.push(value);
    },
  }).end(text);
  const result = splitParagraphRows(blocks);
  if (!result.some((b) => b[0] === 'p' && /^Чл\.\s*1\./u.test(b[1])))
    throw new Error('Legal HTML has no article 1');
  return result;
}
