import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
const repo = resolve(new URL('../../../../', import.meta.url).pathname),
  cli = join(repo, 'packages/ingest/dist/validate/cli.js'),
  report = 'tmp/ts-migration/candidates/17a/report.json',
  sentinel = 'declared input bytes\n',
  sha = createHash('sha256').update(sentinel).digest('hex');
function make(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
const scenarios: [string, (source: any, datasets: any, root: string) => void][] = [
  [
    'source parent components',
    (s) => {
      s.sources[0].files.push({ path: 'tmp/../' + report, sha256: sha });
    },
  ],
  [
    'source dot component',
    (s) => {
      s.sources[0].files.push({ path: './' + report, sha256: sha });
    },
  ],
  [
    'intermediate parent components',
    (s) => {
      s.intermediates.push({
        path: 'tmp/../' + report,
        sha256: sha,
        producer: null,
        reproducible: false,
      });
    },
  ],
  [
    'dataset file parent components',
    (_, d) => {
      d.datasets[0].files.push('tmp/../' + report);
    },
  ],
  [
    'later source after producer failure',
    (s) => {
      s.sources[0].parser = 'invalid command';
      s.sources.push({ id: 'later', files: [{ path: report, sha256: sha }] });
    },
  ],
  [
    'later schema after producer failure',
    (_, d) => {
      d.datasets[0].producer = 'invalid command';
      d.datasets[0].schema = report;
    },
  ],
  [
    'glob before producer failure',
    (s) => {
      s.sources[0].parser = 'invalid command';
      s.sources[0].files.push({ path: 'tmp/ts-migration/candidates/17a/*.json', sha256: sha });
    },
  ],
  [
    'root glob before producer failure',
    (s) => {
      s.sources[0].parser = 'invalid command';
      s.sources[0].files.push({ path: '**/*.json', sha256: sha });
    },
  ],
  [
    'rejected source symlink',
    (s, _, root) => {
      symlinkSync(join(root, report), join(root, 'alias.json'));
      s.sources[0].files.push({ path: 'alias.json', sha256: sha });
    },
  ],
  [
    'rejected glob symlink',
    (s, _, root) => {
      symlinkSync(join(root, dirname(report)), join(root, 'alias-dir'));
      s.sources[0].files.push({ path: 'alias-dir/*.json', sha256: sha });
    },
  ],
  [
    'absolute source',
    (s, _, root) => {
      s.sources[0].files.push({ path: join(root, report), sha256: sha });
    },
  ],
  [
    'backslash source',
    (s) => {
      s.sources[0].files.push({ path: 'tmp\\..\\' + report, sha256: sha });
    },
  ],
  [
    'pinned input after producer failure',
    (s, _, root) => {
      s.sources[0].parser = 'invalid command';
      make(root, 'data/originals.sha256', sha + '  ' + report + '\n');
    },
  ],
];
for (const malformed of ['sources', 'datasets'])
  it('preserves later declarations when the ' + malformed + ' registry cannot be parsed', () => {
    const root = mkdtempSync(join(tmpdir(), 'sigma-registry-inventory-'));
    try {
      make(root, report, sentinel);
      make(root, 'data/originals.sha256', '');
      make(
        root,
        'data/sources.yaml',
        JSON.stringify({
          sources: [{ id: 'src', files: [{ path: report, sha256: sha }] }],
        }),
      );
      make(
        root,
        'data/datasets.yaml',
        JSON.stringify({
          datasets: [{ id: 'item', schema: report, files: [] }],
        }),
      );
      make(root, 'data/' + malformed + '.yaml', malformed + ': [broken');
      const run = (target?: string) =>
        spawnSync(
          process.execPath,
          [cli, '--root', root, '--only', 'REGISTRY', ...(target ? ['--report', target] : [])],
          { cwd: root, encoding: 'utf8' },
        );
      expect(run(report).status).toBe(2);
      expect(readFileSync(join(root, report), 'utf8')).toBe(sentinel);
      const absent = 'tmp/ts-migration/absent/report.json';
      expect(run(absent).status).toBe(2);
      expect(existsSync(join(root, dirname(absent)))).toBe(false);
      const consoleOnly = run();
      expect(consoleOnly.status).toBe(1);
      expect(JSON.parse(consoleOnly.stdout).status).toBe('FAIL');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
for (const alias of [false, true])
  for (const [name, mutate] of scenarios)
    it(
      'preserves rejected and unvisited declared inputs: ' + name + (alias ? ' (root alias)' : ''),
      () => {
        const own = mkdtempSync(join(tmpdir(), 'sigma-registry-report-')),
          root = join(own, 'input');
        try {
          make(root, 'data/inputs/seed.txt', sentinel);
          make(root, 'data/originals.sha256', sha + '  data/inputs/seed.txt\n');
          make(root, 'data/release/item.json', '{"meta":{"status":"real"}}');
          make(root, 'data/release/catalog.json', '{"datasets":[],"files":[]}');
          make(root, 'pipeline/budget_pipeline/example.py', 'ok = True\n');
          make(root, 'docs/schema.md', 'schema');
          make(root, report, sentinel);
          const sources = {
              sources: [
                {
                  id: 'src',
                  title: 'source',
                  access: 'supplied',
                  acquisition: 'supplied',
                  files: [{ path: 'data/inputs/seed.txt' }],
                },
              ],
              intermediates: [],
            },
            datasets = {
              datasets: [
                {
                  id: 'item',
                  status: 'real',
                  producer: 'python -m budget_pipeline.example',
                  inputs: ['src'],
                  schema: 'docs/schema.md',
                  scope: 'test',
                  rebuild: 'yes',
                  sources: ['src'],
                  files: ['data/release/item.json'],
                },
              ],
            };
          mutate(sources, datasets, root);
          make(root, 'data/sources.yaml', JSON.stringify(sources));
          make(root, 'data/datasets.yaml', JSON.stringify(datasets));
          const input = alias ? join(own, 'root-alias') : root;
          if (alias) symlinkSync(root, input);
          const run = (target?: string) =>
            spawnSync(
              process.execPath,
              [cli, '--root', input, '--only', 'REGISTRY', ...(target ? ['--report', target] : [])],
              { cwd: root, encoding: 'utf8' },
            );
          const rejected = run(report);
          expect(rejected.status, rejected.stderr).toBe(2);
          expect(readFileSync(join(root, report), 'utf8')).toBe(sentinel);
          const absent = 'tmp/ts-migration/candidates/17a/absent/report.json';
          const rejectedAbsent = run(absent);
          if (
            [
              'source parent components',
              'source dot component',
              'intermediate parent components',
              'dataset file parent components',
              'rejected source symlink',
              'rejected glob symlink',
              'absolute source',
              'backslash source',
            ].includes(name)
          ) {
            expect(rejectedAbsent.status, rejectedAbsent.stderr).toBe(2);
            expect(existsSync(join(root, dirname(absent)))).toBe(false);
          }
          const consoleOnly = run();
          expect(consoleOnly.status, consoleOnly.stderr).toBe(1);
          expect(JSON.parse(consoleOnly.stdout).status).toBe('FAIL');
          expect(readFileSync(join(root, report), 'utf8')).toBe(sentinel);
        } finally {
          rmSync(own, { recursive: true, force: true });
        }
      },
    );
it('does not confuse a similar declared prefix with a report or suppress ordinary failure reports', () => {
  const root = mkdtempSync(join(tmpdir(), 'sigma-registry-prefix-'));
  try {
    make(root, 'data/originals.sha256', '');
    make(
      root,
      'data/sources.yaml',
      JSON.stringify({
        sources: [
          {
            id: 'src',
            parser: 'invalid command',
            files: [{ path: dirname(report) + '-other/input.json', sha256: sha }],
          },
        ],
      }),
    );
    make(root, 'data/datasets.yaml', '{"datasets":[]}');
    make(root, dirname(report) + '-other/input.json', sentinel);
    const run = spawnSync(
      process.execPath,
      [cli, '--root', root, '--only', 'REGISTRY', '--report', report],
      { cwd: root, encoding: 'utf8' },
    );
    expect(run.status, run.stderr).toBe(1);
    expect(JSON.parse(readFileSync(join(root, report), 'utf8')).status).toBe('FAIL');
    expect(readFileSync(join(root, dirname(report) + '-other/input.json'), 'utf8')).toBe(sentinel);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
