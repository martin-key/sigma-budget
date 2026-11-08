import type { ReactNode } from 'react';
import type {
  MetadataContext,
  Manifest,
  JournalEntry,
  Validation,
} from '../lib/screens/metadata-types';
import { num, date, href } from '../lib/legacy';
import { NBSP } from '../../client/format.js';
import { facts } from '../components/Cards';
import { disclosure } from '../components/Disclosure';
import type { Column } from '../components/MetadataTable';
import type { ReleaseFile } from '../lib/screens/metadata-types';
import { icon } from '../components/Icon';
import { dataTable as table } from '../components/MetadataTable';
import type { TableOptions } from '../components/MetadataTable';
const dataTable = <R extends object>(o: TableOptions<R>) => table({ ...o, image: true });
import { statusPill, STATUS as UI_STATUS } from '../components/Status';
import { siteUrl } from '../../client/seo.js';
import { dataHref } from '../../client/data.js';
import { sizeLabel } from '../../client/catalog.js';
const ext = (url: string, label: ReactNode) => (
  <a className="ext" href={url} target="_blank" rel="noopener noreferrer">
    {label}
    {icon('external', { size: 14 })}
    <span className="sr-only"> (в нов раздел)</span>
  </a>
);
export const needs = [
  'releases/current',
  'release/manifest',
  'release/validation?',
  'release/journal?',
];
export const styles = ['s35-proverka'];

const REPO = 'https://github.com/midt-bg/sigma-budget';
const HEX64 = /^[0-9a-f]{64}$/;
const short = (sha: unknown) => String(sha || '').slice(0, 12);
const code = (t: ReactNode) => (
  <>
    <code>{t}</code>
  </>
);
const sha = (s: string | undefined) => (
  <>
    <code className="s35-sha" title={s}>
      {short(s)}
      {'…'}
    </code>
  </>
);
const fileName = (p: string) => String(p).split('/').pop();
const KIND: Record<string, string> = { publish: 'публикуване', rollback: 'връщане' };
// the status of a set as data/datasets.yaml gives it (real, mock, pending); one the site does not know is shown as it is, not as „Предстои“
const statusCell = (v: string) =>
  UI_STATUS[v as keyof typeof UI_STATUS] ? statusPill(v) : code(v || '—');

/** a section: the h2 carries the id (the target of ?to=), so a jump lands on a heading */
const block = (id: string, title: string, body: ReactNode) => (
  <>
    <section className="s35-block" aria-labelledby={id}>
      <h2 id={id} tabIndex={-1}>
        {title}
      </h2>
      {body}
    </section>
  </>
);

function releaseBlock(
  rid: string,
  m: Manifest,
  journal: JournalEntry[] | null,
  journalFailed: boolean,
  newer = '',
) {
  const mine = (journal || []).filter((e) => e.release_id === rid);
  const first = mine.length ? mine[mine.length - 1] : null;
  const last = mine.length ? mine[0] : null;
  return block(
    's35-release',
    'Изданието на тази страница',
    <>
      {facts([
        {
          k: 'Издание',
          v: (
            <>
              <code className="s35-rid">{rid}</code>
            </>
          ),
        },
        {
          k: 'Сглобено',
          v: m.processing?.parameters?.build_date ? date(m.processing.parameters.build_date) : null,
        },
        {
          k: 'Публикувано',
          v: first
            ? `${date(first.at.slice(0, 10))}, ревизия ${first.revision}`
            : journalFailed
              ? 'журналът на регистъра не се зареди'
              : 'заедно със сайта (без регистър)',
        },
        {
          k: 'Текущо от',
          v:
            last && last !== first
              ? `${date(last.at.slice(0, 10))} (${KIND[last.kind] || last.kind}), ревизия ${last.revision}`
              : null,
        },
        {
          k: 'Манифест',
          v: (
            <>
              <a href={'/data/releases/' + rid + '/manifest.json'}>{'manifest.json'}</a>
              {' (SHA-256 на манифеста е ID-то на изданието)'}
            </>
          ),
        },
      ])}

      <p className="s35-newer" data-s35-newer="" hidden={!newer}>
        {newer}
      </p>

      <p>
        {
          'Всичко на сайта по време на това посещение е от това издание: страниците, таблиците, графиките, файловете за сваляне и произходът на числата. Ново издание се показва при следващото отваряне на сайта.'
        }
      </p>
    </>,
  );
}

function coverageBlock(m: Manifest) {
  const sets = m.coverage?.datasets || [];
  const rows = sets.map((d) => ({
    name: d.dataset,
    status: d.status,
    period: d.period,
    unit: d.unit,
    rebuilt: d.rebuiltByThisRelease ? 'да' : 'не, пренесен от git',
  }));
  const limited = sets.filter((d) => (d.limitations || []).length);
  const missing = m.coverage?.missingInputs || [];
  return block(
    's35-coverage',
    'Период, обхват и ограничения',
    <>
      {m.coverage?.latest ? (
        <>
          <p>
            {'Последните данни: '}
            {typeof m.coverage.latest === 'string'
              ? m.coverage.latest
              : Object.entries(m.coverage.latest)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}
            {'.'}
          </p>
        </>
      ) : (
        ''
      )}

      {dataTable({
        id: 's35-sets',
        caption: `Наборите в изданието (${sets.length})`,
        captionVisible: true,
        dense: true,
        columns: [
          { key: 'name', label: 'Набор', fmt: (v) => code(v) },
          { key: 'status', label: 'Статус', fmt: statusCell },
          { key: 'period', label: 'Период' },
          { key: 'unit', label: 'Единица' },
          { key: 'rebuilt', label: 'Сглобен от оригиналите' },
        ],
        rows,
      })}

      {missing.length ? (
        <>
          <p>
            {
              'Входове, които липсват на това сглобяване (наборите им са пренесени, без да се сглобят):'
            }
          </p>

          <ul className="s35-list">
            {missing.map((x) => (
              <>
                <li>
                  {code(x.path)}
                  {': '}
                  {(x.datasets || []).join(', ')}
                </li>
              </>
            ))}
          </ul>
        </>
      ) : (
        ''
      )}

      {limited.length
        ? disclosure({
            id: 's35-limits',
            title: `Известни ограничения (${limited.length} набора, бележките на манифеста на английски)`,
            body: (
              <>
                <ul className="s35-list">
                  {limited.map((d) => (
                    <>
                      <li>
                        {code(d.dataset)}
                        {d.scope ? (
                          <>
                            {' '}
                            <span lang="en">
                              {'('}
                              {d.scope}
                              {')'}
                            </span>
                          </>
                        ) : (
                          ''
                        )}
                        {': '}
                        <span lang="en">{d.limitations!.join('; ')}</span>
                      </li>
                    </>
                  ))}
                </ul>
              </>
            ),
          })
        : ''}
    </>,
  );
}

function filesBlock(rid: string, m: Manifest) {
  const link = (p: string) => (
    <>
      <a
        href={'/data/releases/' + rid + '/' + p.split('/').map(encodeURIComponent).join('/') + ''}
        download={'' + fileName(p) + ''}
      >
        {fileName(p)}
      </a>
    </>
  );
  const ins = m.inputs || [],
    outs = m.outputs || [];
  const cols = (first: string): Column<ReleaseFile>[] => [
    { key: 'path', label: first, fmt: (v) => link(String(v)) },
    { key: 'mime', label: 'Формат' },
    { key: 'bytes', label: 'Размер', align: 'end', fmt: (v) => sizeLabel(Number(v)) },
    { key: 'sha256', label: 'SHA-256', fmt: (v) => sha(String(v)) },
  ];
  return block(
    's35-files',
    'Оригинали и файлове',
    <>
      <p>
        {
          'Всеки файл се сваля от самото издание. Сайтът пази байтовете му непроменени, а SHA-256 до него показва дали копието ти е същото.'
        }
      </p>

      {disclosure({
        id: 's35-inputs',
        title: `Оригиналите (${ins.length})`,
        body: (
          <>
            <p>
              {
                'Отчетите, законите и таблиците, от които са сглобени данните, с източника и начина на получаване в '
              }
              <a href={'/data/releases/' + rid + '/manifest.json'}>{'манифеста'}</a>
              {'. HTML и XML оригиналите се свалят, а не се отварят като страница на сайта.'}
            </p>

            {dataTable({
              id: 's35-in',
              caption: 'Оригиналите на изданието',
              dense: true,
              columns: cols('Файл'),
              rows: ins.map((i) => ({
                path: i.path,
                mime: i.mime,
                bytes: i.bytes,
                sha256: i.sha256,
              })),
            })}
          </>
        ),
      })}

      {disclosure({
        id: 's35-outputs',
        title: `Файловете с данни (${outs.length})`,
        body: dataTable({
          id: 's35-out',
          caption: 'Файловете на изданието',
          dense: true,
          columns: cols('Файл'),
          rows: outs.map((o) => ({ path: o.path, mime: o.mime, bytes: o.bytes, sha256: o.sha256 })),
        }),
      })}
    </>,
  );
}

function codeBlock(m: Manifest) {
  const p = m.processing || {},
    c = p.code || {},
    e = p.environment || {},
    reg = p.registries || {};
  return block(
    's35-code',
    'Код и среда',
    facts([
      {
        k: 'Код',
        v: c.commit ? (
          <>
            {ext(
              `${c.repository || REPO}/commit/${c.commit}`,
              <>
                {'commit '}
                {code(short(c.commit))}
              </>,
            )}
          </>
        ) : null,
      },
      { k: 'Команда', v: p.command ? code(p.command) : null },
      {
        k: 'Образ за обработката',
        v: e.dockerfile ? (
          <>
            {code(e.dockerfile)}
            {', SHA-256 '}
            {sha(e.dockerfile_sha256)}
          </>
        ) : null,
      },
      {
        k: 'Зависимости',
        v: e.lock ? (
          <>
            {code(e.lock)}
            {', SHA-256 '}
            {sha(e.lock_sha256)}
          </>
        ) : null,
      },
      ...Object.entries(reg).map(([f, s]) => ({
        k: 'Съпоставки и регистър',
        v: (
          <>
            {code(f)}
            {', SHA-256 '}
            {sha(s)}
          </>
        ),
      })),
      {
        k: 'Версии на договорите',
        v: Object.entries(m.data_schema || {})
          .map(([k, v]) => `${k}: ${v}`)
          .join(', '),
      },
    ]),
  );
}

function checksBlock(v: Validation | undefined) {
  const groups = v?.groups || [];
  const origin = siteUrl('/').replace(/\/$/, '');
  return block(
    's35-checks',
    'Проверки и пресъздаване',
    <>
      {groups.length ? (
        dataTable({
          id: 's35-val',
          caption: `Проверките на данните в изданието (${v?.passed === false ? 'с грешки' : 'минали'})`,
          captionVisible: true,
          dense: true,
          columns: [
            { key: 'group', label: 'Група', fmt: (x) => code(x) },
            { key: 'status', label: 'Резултат' },
            {
              key: 'summary',
              label: 'Обобщение',
              fmt: (x) => (
                <>
                  <span lang="en">{x || ''}</span>
                </>
              ),
            },
          ],
          rows: groups.map((g) => ({
            group: g.group,
            status: g.status === 'OK' ? 'наред' : g.status,
            summary: g.summary,
          })),
        })
      ) : (
        <>
          <p className="muted">{'Резултатите от проверките не са в изданието.'}</p>
        </>
      )}

      <p>
        {
          'Всеки може да сглоби изданието отново от оригиналите и да сравни всеки файл байт по байт. Нужни са само кодът и Docker:'
        }
      </p>

      <pre className="s35-cmd">
        <code>
          {'git clone '}
          {REPO}
          {'.git && cd sigma-budget\n./budget reproduce --current '}
          {origin}
        </code>
      </pre>

      <p>
        {
          'Командата чете манифеста на текущото издание, сваля оригиналите му оттук и сглобява commit-а му в закования образ. Изходът е '
        }
        <code lang="en">{'reproduced byte for byte'}</code>
        {' или списък с разликите. Подробности: '}
        {ext(`${REPO}/blob/main/docs/release.md`, 'docs/release.md')}
        {'.'}
      </p>
    </>,
  );
}

function provenanceBlock() {
  return block(
    's35-provenance',
    'Произход и методика',
    <>
      <ul className="s35-list">
        <li>
          {'Всяко число от месечните отчети води до листа и клетката на оригинала: '}
          <a href={'' + dataHref('execution-provenance') + ''}>{'произходът на всяко число'}</a>
          {' (JSON) и „Откъде са числата“ в '}
          <a href={'' + href('izpalnenie') + ''}>{'месечните отчети'}</a>
          {'.'}
        </li>

        <li>
          {'Наборите, източниците им и методиката: '}
          <a href={'' + href('danni') + ''}>{'„Откъде са данните?“'}</a>
          {'.'}
        </li>

        <li>
          {'Файловете и как се четат с код: '}
          <a href={'' + href('api') + ''}>{'„Отворени данни и API“'}</a>
          {'.'}
        </li>

        <li>
          {'Публичният API на изданията: '}
          <a href="/api/releases/current">{'текущото издание'}</a>
          {' и '}
          <a href="/api/releases">{'журналът'}</a>
          {' (JSON).'}
        </li>
      </ul>
    </>,
  );
}

function historyBlock(rid: string, journal: JournalEntry[] | null, journalFailed: boolean) {
  // a registry whose journal could not be read now is not an environment without one (the screen is then not kept in the edge cache)
  if (!journal && journalFailed)
    return block(
      's35-history',
      'История на изданията',
      <>
        <p>
          {'Журналът на публикуванията не може да се зареди в момента. Опитайте отново след малко.'}
        </p>
      </>,
    );
  if (!journal)
    return block(
      's35-history',
      'История на изданията',
      <>
        <p>
          {
            'Тази среда няма регистър: изданието е публикувано заедно със сайта, затова няма журнал на публикуванията.'
          }
        </p>
      </>,
    );
  const rows = journal.map((e) => ({
    revision: e.revision,
    release: e.release_id,
    kind: KIND[e.kind] || e.kind,
    at: e.at,
    by: [e.role === 'operator' ? 'оператор' : e.role, e.by].filter(Boolean).join(' '),
  }));
  return block(
    's35-history',
    'История на изданията',
    <>
      <p>
        {
          'Всяко публикуване и всяко връщане е нова ревизия. Издание, което е било текущо, остава публично на адреса си. Операторът е с псевдоним, без имейл.'
        }
      </p>

      {dataTable({
        id: 's35-journal',
        caption: 'Журналът на публикуванията',
        captionVisible: true,
        dense: true,
        columns: [
          { key: 'revision', label: 'Ревизия', align: 'end', fmt: (v) => String(v) },
          {
            key: 'release',
            label: 'Издание',
            fmt: (v) => (
              <>
                <a href={'/data/releases/' + v + '/manifest.json'}>{code(short(v))}</a>
                {v === rid ? ' (тази страница)' : ''}
              </>
            ),
          },
          { key: 'kind', label: 'Събитие' },
          {
            key: 'at',
            label: 'Кога',
            fmt: (v) => `${date(String(v).slice(0, 10))}${NBSP}${String(v).slice(11, 16)}`,
          },
          { key: 'by', label: 'Кой' },
        ],
        rows,
      })}
    </>,
  );
}

export function render(ctx: MetadataContext) {
  const rel = ctx.data['releases/current'];
  const rid = rel && HEX64.test(rel.release_id || '') ? rel.release_id : '';
  const m = ctx.data['release/manifest'];
  if (!rid || !m) throw new Error('Missing release manifest');
  const journal = ctx.data['release/journal']?.items || null;
  const journalFailed = (ctx.failed || []).includes('release/journal');
  const ins = (m.inputs || []).length,
    outs = (m.outputs || []).length;
  return {
    lede: `Откъде са данните на тази страница: изданието ${short(rid)} с ${num(ins)} оригинала и ${num(outs)} файла, всеки с SHA-256, кодът, който ги сглобява, проверките и как всеки може да го пресъздаде.`,
    answer: `Данните са от издание ${short(rid)}: ${num(ins)} оригинала и ${num(outs)} файла с данни, сглобени от commit ${short(m.processing?.code?.commit)} и проверими байт по байт.`,
    body: (
      <>
        {releaseBlock(rid, m, journal, journalFailed, ctx.newer)}
        {coverageBlock(m)}
        {filesBlock(rid, m)}
        {codeBlock(m)}
        {checksBlock(ctx.data['release/validation'])}
        {provenanceBlock()}
        {historyBlock(rid, journal, journalFailed)}
      </>
    ),
  };
}

/** after load: is there a newer release than the one on the screen? (the page itself never switches in the middle of a visit) */
