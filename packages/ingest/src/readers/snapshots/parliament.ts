import { object } from '@sigma-budget/dataset-schema';
import { parliamentFacts } from '../../build/law-evidence.js';
import type { ParliamentEvidence } from '../../build/law-types.js';
import { parseSavedJson } from './jsonstat.js';

/** Restricted legacy representation observed by the donor: a list of string-
 * valued dictionaries. It is data, never eval/Function or executable Python. */
function legacyFiles(text: string): unknown {
  try {
    return parseSavedJson(text);
  } catch {
    /* Single-quoted legacy literal. */
  }
  if (text.length > 1_000_000) throw new Error('Parliament literal size limit');
  let p = 0;
  const space = () => {
    while (/\s/u.test(text[p] ?? '') && p < text.length) p++;
  };
  const take = (token: string) => {
    space();
    if (text[p++] !== token) throw new Error('Unsupported parliament file literal');
  };
  const string = (): string => {
    space();
    const quote = text[p++];
    if (quote !== "'" && quote !== '"') throw new Error('Expected quoted parliament file field');
    let out = '';
    while (p < text.length) {
      let c = text[p++]!;
      if (c === quote) return out;
      if (c === '\\') {
        c = text[p++]!;
        const simple: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          '\\': '\\',
          "'": "'",
          '"': '"',
          '/': '/',
        };
        if (c in simple) out += simple[c];
        else if (['u', 'U', 'x'].includes(c)) {
          const length = c === 'U' ? 8 : c === 'u' ? 4 : 2,
            hex = text.slice(p, p + length);
          if (
            !new RegExp(`^[0-9a-fA-F]{${length}}$`, 'u').test(hex) ||
            Number.parseInt(hex, 16) > 0x10ffff
          )
            throw new Error('Invalid parliament string escape');
          out += String.fromCodePoint(Number.parseInt(hex, 16));
          p += length;
        } else throw new Error('Unsupported parliament string escape');
      } else out += c;
    }
    throw new Error('Unterminated parliament string');
  };
  const result: Record<string, string>[] = [];
  take('[');
  space();
  while (text[p] !== ']') {
    take('{');
    const row: Record<string, string> = Object.create(null);
    space();
    while (text[p] !== '}') {
      const key = string();
      take(':');
      if (Object.hasOwn(row, key)) throw new Error('Duplicate parliament file key');
      row[key] = string();
      space();
      if (text[p] !== ',') break;
      p++;
      space();
    }
    take('}');
    result.push(row);
    space();
    if (text[p] !== ',') break;
    p++;
    space();
  }
  take(']');
  space();
  if (p !== text.length) throw new Error('Trailing parliament file literal');
  return result;
}

export function parseParliamentSnapshot(text: string, billId: number): ParliamentEvidence {
  const data = parseSavedJson(text);
  if (!Number.isSafeInteger(billId) || billId < 1 || !object(data) || data.L_Act_id !== billId)
    throw new Error('Parliament bill identity mismatch');
  for (const key of ['L_Act_sign', 'L_ActL_title', 'L_ActL_final', 'L_Act_date', 'L_Act_date2'])
    if (typeof data[key] !== 'string' || !data[key])
      throw new Error(`Missing parliament field: ${key}`);
  const lists: Record<string, Record<string, 'string' | 'number'>> = {
    activity: { L_Act_St_date: 'string', L_Act_St2_name: 'string', L_Act_St_name: 'string' },
    stan_list: { A_Cm_Stan_date: 'string', A_ns_CL_value: 'string' },
    standp_list: { A_Cm_Stan_date: 'string', A_Cm_Stanid: 'number' },
    proposal_12_list: { RN_DOC: 'string', DAT_DOC: 'string' },
    stan_list2_1: { A_Cm_Stan_date: 'string' },
    dist_list: { A_ns_CL_value: 'string', L_Act_DTL_value: 'string' },
    order: { FILENAME: 'string' },
    file_list: { FILENAME: 'string' },
  };
  for (const [list, fields] of Object.entries(lists)) {
    if (!Array.isArray(data[list])) throw new Error(`Missing parliament list: ${list}`);
    for (const row of data[list]) {
      if (!object(row) || Object.entries(fields).some(([key, type]) => typeof row[key] !== type))
        throw new Error(`Invalid parliament row: ${list}`);
      if (list === 'proposal_12_list') {
        const files =
          typeof row.act_files === 'string' ? legacyFiles(row.act_files) : row.act_files;
        if (
          !Array.isArray(files) ||
          !files.length ||
          files.some((f) => !object(f) || typeof f.FILENAME !== 'string' || !f.FILENAME)
        )
          throw new Error('Invalid parliament proposal files');
        row.act_files = files;
      }
    }
  }
  parliamentFacts(billId, data);
  // Only fields consumed by existing builders leave this adapter (no proposers' names).
  const keep = [
    ...Object.keys(lists),
    'L_Act_sign',
    'L_ActL_title',
    'L_ActL_final',
    'L_Act_date',
    'L_Act_date2',
    'L_Act_dv_iss',
    'static_archive',
  ];
  const evidence: Record<string, unknown> = Object.fromEntries(
    keep.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]),
  );
  for (const [list, fields] of Object.entries(lists))
    evidence[list] = (data[list] as Record<string, unknown>[]).map((row) =>
      Object.fromEntries(
        [...Object.keys(fields), ...(list === 'proposal_12_list' ? ['act_files'] : [])].map((k) => [
          k,
          row[k],
        ]),
      ),
    );
  return evidence as unknown as ParliamentEvidence;
}

export const reduceParliament = parliamentFacts;
