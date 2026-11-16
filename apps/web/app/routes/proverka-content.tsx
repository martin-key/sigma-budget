import type { ReactNode } from 'react';
import type { MetadataContext, Manifest, Validation } from '../lib/screens/metadata-types';
import { num, date, href } from '../lib/legacy';
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
import { checkRows } from '../../client/check-groups.js';
const ext = (url: string, label: ReactNode) => (
  <a className="ext" href={url} target="_blank" rel="noopener noreferrer">
    {label}
    {icon('external', { size: 14 })}
    <span className="sr-only"> (в нов раздел)</span>
  </a>
);
export const needs = ['releases/current', 'release/manifest', 'release/validation?'];
export const styles = ['s35-proverka'];

const REPO = 'https://github.com/midt-bg/sigma-budget';
const DATA_REPO = 'https://github.com/midt-bg/sigma-budget-data';
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

function releaseBlock(rid: string, m: Manifest) {
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
          v: 'заедно със сайта',
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
    rebuilt:
      d.status === 'pending' && !d.files?.length
        ? '—'
        : d.rebuiltByThisRelease
          ? 'да'
          : 'не, запазен от предходното издание',
    reason: d.reason || '',
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
          { key: 'reason', label: 'Обхват без данни' },
          { key: 'rebuilt', label: 'Пресглобен в това издание' },
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
  const sources = ins.filter((i) => i.kind === 'source').length;
  const intermediates = ins.filter((i) => i.kind === 'intermediate').length;
  const other = ins.length - sources - intermediates;
  const inputKind = (v: unknown) =>
    v === 'source' ? 'източников' : v === 'intermediate' ? 'междинен' : String(v || 'непосочен');
  const cols = (first: string): Column<ReleaseFile>[] => [
    { key: 'path', label: first, fmt: (v) => link(String(v)) },
    { key: 'mime', label: 'Формат' },
    { key: 'bytes', label: 'Размер', align: 'end', fmt: (v) => sizeLabel(Number(v)) },
    { key: 'sha256', label: 'SHA-256', fmt: (v) => sha(String(v)) },
  ];
  return block(
    's35-files',
    'Входни и изходни файлове',
    <>
      <p>
        {
          'Изходните файлове се свалят от текущото издание. Сайтът пази байтовете им непроменени, а SHA-256 показва дали копието ти е същото. Входните файлове са описани с име и хеш; не се свалят от този сайт.'
        }
      </p>

      {disclosure({
        id: 's35-inputs',
        title: `Входни файлове (${ins.length})`,
        body: (
          <>
            <p>
              {'Източниковите и запазените междинни файлове са описани с начина на получаване в '}
              <a href={'/data/releases/' + rid + '/manifest.json'}>{'манифеста'}</a>
              {'. Инструкциите за получаването на входовете са в '}
              {ext(DATA_REPO, 'хранилището с данните')}
              {'.'}
            </p>

            <p>
              {`Манифестът посочва източникови (${num(sources)}) и междинни (${num(intermediates)}) файлове${other ? `, както и ${num(other)} с друг или непосочен тип` : ''}. `}
              {
                'Междинните файлове са запазени резултати от предходна обработка. Пресглобяването с тях не доказва възстановяване от първоначалните източници.'
              }
            </p>

            {dataTable({
              id: 's35-in',
              caption: 'Входните файлове на изданието',
              dense: true,
              columns: [
                {
                  key: 'path',
                  label: 'Файл',
                  fmt: (v) => <span title={String(v)}>{fileName(String(v))}</span>,
                },
                { key: 'kind', label: 'Тип', fmt: inputKind },
                ...cols('Файл').slice(1),
              ],
              rows: ins.map((i) => ({
                path: i.path,
                kind: i.kind,
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
            { key: 'label', label: 'Какво се проверява' },
            { key: 'checks', label: 'Проверки' },
            { key: 'status', label: 'Резултат' },
          ],
          rows: checkRows(groups),
        })
      ) : (
        <>
          <p className="muted">{'Резултатите от проверките не са в изданието.'}</p>
        </>
      )}
      {groups.length ? (
        <p className="small muted">
          Техническото обобщение на всяка група (на английски) е във файла{' '}
          <code>validation.json</code> от списъка с файлове.
        </p>
      ) : (
        ''
      )}

      <p>
        {
          'Изданието може да се пресъздаде от входните му файлове, включително запазените междинни данни, и всеки изходен файл да се сравни байт по байт. Нужни са кодът и локално копие на входните файлове:'
        }
      </p>

      <pre className="s35-cmd">
        <code>
          {'git clone '}
          {REPO}
          {'.git && cd sigma-budget\n./budget reproduce --current '}
          {origin}
          {' --originals /път/до/входовете'}
        </code>
      </pre>

      <p>
        {
          'Командата чете манифеста на текущото издание, проверява локалните входни файлове и сравнява пресъздадените изходи с публикуваните байтове. Изходът е '
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
          {'Текущото издание: '}
          <a href="/api/releases/current">{'JSON указател'}</a>
          {'.'}
        </li>
      </ul>
    </>,
  );
}

function historyBlock() {
  return block(
    's35-history',
    'История на изданията',
    <p>
      Изданията се публикуват с кода. Манифестите и историята са в{' '}
      {ext(`${DATA_REPO}/tree/main/data/release/releases`, 'хранилището с данните')}.
    </p>,
  );
}

export function render(ctx: MetadataContext) {
  const rel = ctx.data['releases/current'];
  const rid = rel && HEX64.test(rel.release_id || '') ? rel.release_id : '';
  const m = ctx.data['release/manifest'];
  if (!rid || !m) throw new Error('Missing release manifest');
  const ins = (m.inputs || []).length,
    outs = (m.outputs || []).length;
  return {
    lede: `Откъде са данните на тази страница: изданието ${short(rid)} с ${num(ins)} входни файла и ${num(outs)} файла, всеки с SHA-256, кодът, който ги сглобява, проверките и как всеки може да го пресъздаде.`,
    answer: `Данните са от издание ${short(rid)}: ${num(ins)} входни файла и ${num(outs)} файла с данни, сглобени от commit ${short(m.processing?.code?.commit)} и проверими байт по байт.`,
    body: (
      <>
        {releaseBlock(rid, m)}
        {coverageBlock(m)}
        {filesBlock(rid, m)}
        {codeBlock(m)}
        {checksBlock(ctx.data['release/validation'])}
        {provenanceBlock()}
        {historyBlock()}
      </>
    ),
  };
}
