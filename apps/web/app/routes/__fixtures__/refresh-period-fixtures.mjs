// Rebuild the S14 cases changed by the annual period vocabulary and export metadata.
// The oracle uses the legacy renderer, never the React narrative components.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { provideScope } from '../../../client/env.js';
import { requestState } from '../../../client/store.js';
import { data } from '../../../client/data.js';
import { resolve, build, frameHtml, docTitle } from '../../../client/render.js';
import { head } from '../../../client/seo.js';
import { csvFor, get as shareSpec, reset as resetShare } from '../../../client/share.js';

const file = (name) => new URL(name, import.meta.url);
const read = (name) => readFileSync(file(name), 'utf8');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const check = process.argv.includes('--check');
const inputs = JSON.parse(read('narrative-inputs.json'));
const manifest = JSON.parse(read('narrative-manifest.json'));
const files = ['S14.html', 'S14-draft.html', 'S14-unsupported.html', 'S14-budgets.csv'];
for (const c of manifest.cases.filter((c) => files.includes(c.file))) {
  const url = new URL(c.address, manifest.origin);
  const scope = {
    url, origin: url.origin, state: requestState(c.query.per), data: new Map(),
    load: async (name) => name === 'releases/current' ? { release_id: manifest.releaseId } : inputs[name],
  };
  provideScope(() => scope);
  try {
    // The server loads core before building a screen: pending explanations and
    // dateModified must come from that same frozen release.
    await data.load('core');
    const r = resolve(c.address);
    resetShare(r.route);
    const vm = await build(r.route, r.params, r.query);
    for (const exported of manifest.exportCases.filter(e => e.address === c.address)) {
      await data.load('releases/current');
      const table = scope.maps.attached.get('s14-t-bjudzheti').table;
      const csv = csvFor({ ...shareSpec(exported.block), table });
      if (check && csv !== read(exported.file)) throw new Error(`${exported.file} differs from legacy oracle`);
      if (!check) writeFileSync(file(exported.file), csv);
      exported.sha256 = hash(csv);
    }
    const article = String(frameHtml(vm)).replace(/href="(#\/[^\"]*)"/g,
      (_match, href) => `href="${href.slice(1)}"`);
    const { document } = parseHTML(read(c.file));
    document.querySelector('article.page').outerHTML = article;
    const title = docTitle(vm), metadata = head(vm, title);
    document.title = title;
    for (const tag of metadata.tags) {
      const attrs = tag.attrs;
      const key = attrs.name ? 'name' : attrs.property ? 'property' : 'rel';
      let node = document.querySelector(`${tag.tag}[${key}="${attrs[key]}"]`);
      if (!node) { node = document.createElement(tag.tag); document.head.append(node); }
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    }
    document.querySelector('#ld-page').textContent = metadata.ld;
    const output = document.toString();
    if (check && output !== read(c.file)) throw new Error(`${c.file} differs from legacy oracle`);
    if (!check) writeFileSync(file(c.file), output);
    c.sha256 = hash(output);
  } finally { provideScope(() => null); }
}
const sources = ['../../../client/render.js', '../../../client/periods.js', '../../../client/routes.js',
  '../../../client/seo.js', '../../../client/pages/s14-zakon.js', '../../../client/share.js',
  '../../../client/ui/table.js', '../../../client/publication-query.js', '../../lib/routes.json'];
if (!check) manifest.periodContractOverrides = {
  integrationBaseCommit: '05d6f6eeca9991468f3c94c3c9c26e87d5b0fae0',
  generator: 'refresh-period-fixtures.mjs',
  renderer: 'Legacy build()/frameHtml()/head()/csvFor() with frozen narrative inputs and manifest edition metadata',
  sourceSha256: Object.fromEntries(sources.map((name) => [name, hash(readFileSync(file(name)))])),
  files,
};
const output = JSON.stringify(manifest, null, 2) + '\n';
if (check && output !== read('narrative-manifest.json')) throw new Error('Manifest differs');
if (!check) writeFileSync(file('narrative-manifest.json'), output);
console.log(`S14 period fixtures: ${check ? 'byte-identical' : 'regenerated from legacy renderer'}`);
