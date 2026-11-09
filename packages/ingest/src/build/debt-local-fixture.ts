import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadAnnex } from './annex.js';
import { parseJsonStat } from '../io/data.js';
import { buildDebt, type DebtInput } from './debt.js';
import { buildMunicipalities, type MunicipalityInput } from './municipalities.js';
import { buildSebra, type SebraEvidence } from './sebra.js';

const provenanceSha256 = 'cd079c17f85e7ddef38b02f5eac1b8164547c58a4a61e51afdfd462d6688fcdf';
export async function loadDebtLocalFixture(path: string, buildDate: string) {
  const root = resolve(path);
  if ((await realpath(root)) !== root) throw new Error('Symlink in TS07 fixture root');
  const checked = async (name: string) => {
    const target = resolve(root, name),
      rel = relative(root, target);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
      throw new Error('Invalid fixture path');
    let current = root;
    for (const part of rel.split(sep)) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink in TS07 fixture');
    }
    return target;
  };
  const manifestBytes = await readFile(await checked('provenance.json'));
  if (createHash('sha256').update(manifestBytes).digest('hex') !== provenanceSha256)
    throw new Error('TS07 provenance hash mismatch');
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    inputSha256: Record<string, string>;
    policySha256: string;
    registrySha256: string;
  };
  for (const [name, hash] of [
    ['policy.json', manifest.policySha256],
    ['registry.yaml', manifest.registrySha256],
  ]) {
    if (
      createHash('sha256')
        .update(await readFile(await checked(name!)))
        .digest('hex') !== hash
    )
      throw new Error(`TS07 policy or registry hash mismatch: ${name}`);
  }
  for (const [name, hash] of Object.entries(manifest.inputSha256)) {
    const bytes = await readFile(await checked(name));
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error(`TS07 input hash mismatch: ${name}`);
  }
  const text = async (name: string) => readFile(await checked('inputs/' + name), 'utf8');
  const read = async (name: string) => JSON.parse(await text(name));
  const [
    tables,
    capture,
    pages,
    blocks,
    stock,
    gdpCopy,
    annualText,
    quarterlyText,
    execution,
    law,
    proto,
    gis,
    oblast,
    oblastText,
    population,
  ] = await Promise.all([
    read('data/originals/asbp/asbp_tables.json'),
    read('reader-captures.json'),
    read('data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json'),
    read('dv-blocks.json'),
    read('data/inputs/debt_stock.json'),
    read('data/inputs/debt_gdp.json'),
    text('data/originals/eurostat/gov_10dd_edpt1_BG_EU.json'),
    text('data/originals/eurostat/gov_10q_ggdebt_BG.json'),
    read('execution.json'),
    read('data/cache/law_bill.json'),
    read('data/inputs/municipal_transfers_2026.json'),
    read('data/cache/gisco_lau_bg.json'),
    read('data/cache/eurostat_pop_nuts3_bg.json'),
    text('oblast-jsonstat.json'),
    read('data/inputs/population.json'),
  ]);
  const debt: DebtInput = {
    table: tables.tables.VI_1,
    gdp: loadAnnex(tables.tables).gdp as number[],
    pages,
    paragraphs: blocks.zdb
      .filter((b: [string, unknown]) => b[0] === 'p')
      .map((b: [string, string]) => b[1]),
    stock,
    gdpCopy,
    annual: parseJsonStat(annualText) as DebtInput['annual'],
    quarterly: parseJsonStat(quarterlyText) as DebtInput['quarterly'],
    bnbGg: capture.bnbGg,
    bnbCg: capture.bnbCg,
    revisions: capture.revisions,
    execution,
  };
  const municipal: MunicipalityInput = {
    art: law.municipal.art51,
    proto,
    gis,
    oblast: { updated: oblast.updated, jsonstat: parseJsonStat(oblastText) },
    population,
  };
  const sebra = capture as SebraEvidence;
  const local = buildMunicipalities(municipal, buildDate, { preserveHistoricalChirpan: true });
  return {
    'debt.json': buildDebt(debt, buildDate),
    'municipalities.json': local.municipalities,
    'geo/obshtini.json': local.geo,
    'sebra.json': buildSebra(sebra, buildDate),
  };
}
