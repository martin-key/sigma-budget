// Rebuild the independent source proof and registry wording from pinned PDF bytes.
// Requires the locked Python environment and compiled dataset-schema package.
import { format } from 'prettier';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { programmeAccounting, programmeNotes } from '../packages/dataset-schema/dist/index.js';
const refs = JSON.parse(
  execFileSync(
    process.env.PYTHON312 ?? 'python3.12',
    ['-m', 'budget_pipeline.validate.programme_supplements'],
    { env: { ...process.env, PYTHONPATH: 'pipeline' }, maxBuffer: 8 * 1024 * 1024 },
  ),
);
writeFileSync(
  'packages/dataset-schema/src/programme-references.json',
  await format(JSON.stringify(refs), { parser: 'json' }),
);
writeFileSync(
  'packages/dataset-schema/src/programme-differences.json',
  await format(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(refs).map(([code, s]) => [
          s.sourceSha256,
          { code, unit: '0.1 хил. EUR', differences: programmeAccounting(s).differences },
        ]),
      ),
    ),
    { parser: 'json' },
  ),
);
const raw = readFileSync('data/datasets.yaml', 'utf8');
const blocks = raw
  .split(/\n(?=- id:)/u)
  .filter((block) => !block.startsWith('- id: p03\n'))
  .map((block) => {
    if (!/^- id: (ministries-programs|programs)\n/u.test(block)) return block;
    const notes = Object.values(refs).flatMap((s) =>
      programmeNotes(s).map((n) => s.code + ': ' + n),
    );
    return block
      .replace(/  checked:.*\n/u, "  checked: '2026-11-14'\n")
      .replace(
        /  limitations:[\s\S]*$/u,
        '  limitations:\n' + notes.map((n) => '  - ' + JSON.stringify(n)).join('\n'),
      );
  });
writeFileSync('data/datasets.yaml', blocks.join('\n'));
