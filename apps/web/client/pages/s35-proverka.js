// S35: metadata, outputs and reproduction of the release packaged with the site.
import { html } from '../html.js';
import { num, date } from '../format.js';
import { href } from '../routes.js';
import { facts, callout, ext } from '../ui/cards.js';
import { disclosure } from '../ui/disclosure.js';
import { dataTable } from '../ui/table.js';
import { statusPill, STATUS as UI_STATUS } from '../ui/status.js';
import { siteUrl } from '../seo.js';
import { dataHref } from '../data.js';
import { sizeLabel } from '../catalog.js';
import { checkRows } from '../check-groups.js';

export const needs = ['releases/current', 'release/manifest', 'release/validation?'];
export const styles = ['s35-proverka'];

const REPO = 'https://github.com/midt-bg/sigma-budget';
const DATA_REPO = 'https://github.com/midt-bg/sigma-budget-data';
const HEX64 = /^[0-9a-f]{64}$/;
const short = (sha) => String(sha || '').slice(0, 12);
const code = (t) => html`<code>${t}</code>`;
const sha = (s) => html`<code class="s35-sha" title="${s}">${short(s)}…</code>`;
const fileName = (p) => String(p).split('/').pop();
// the status of a set as data/datasets.yaml gives it (real, mock, pending); one the site does not know is shown as it is, not as „Предстои“
const statusCell = (v) => (UI_STATUS[v] ? statusPill(v) : code(v || '—'));

/** a section: the h2 carries the id (the target of ?to=), so a jump lands on a heading */
const block = (id, title, body) =>
  html`<section class="s35-block" aria-labelledby="${id}"><h2 id="${id}" tabindex="-1">${title}</h2>${body}</section>`;

function releaseBlock(rid, m) {
  return block(
    's35-release',
    'Изданието на тази страница',
    html`
    ${facts([
      { k: 'Издание', v: html`<code class="s35-rid">${rid}</code>` },
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
        v: html`<a href="/data/releases/${rid}/manifest.json">manifest.json</a> (SHA-256 на манифеста е ID-то на изданието)`,
      },
    ])}
    <p>Всичко на сайта по време на това посещение е от това издание: страниците, таблиците, графиките, файловете за сваляне и произходът на числата. Ново издание се показва при следващото отваряне на сайта.</p>`,
  );
}

function coverageBlock(m) {
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
    html`
    ${
      m.coverage?.latest
        ? html`<p>Последните данни: ${
            typeof m.coverage.latest === 'string'
              ? m.coverage.latest
              : Object.entries(m.coverage.latest)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')
          }.</p>`
        : ''
    }
    ${dataTable({
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
    ${
      missing.length
        ? html`<p>Входове, които липсват на това сглобяване (наборите им са пренесени, без да се сглобят):</p>
      <ul class="s35-list">${missing.map((x) => html`<li>${code(x.path)}: ${(x.datasets || []).join(', ')}</li>`)}</ul>`
        : ''
    }
    ${
      limited.length
        ? disclosure({
            id: 's35-limits',
            title: `Известни ограничения (${limited.length} набора, бележките на манифеста на английски)`,
            body: html`<ul class="s35-list">${limited.map((d) => html`<li>${code(d.dataset)}${d.scope ? html` <span lang="en">(${d.scope})</span>` : ''}: <span lang="en">${d.limitations.join('; ')}</span></li>`)}</ul>`,
          })
        : ''
    }`,
  );
}

function filesBlock(rid, m) {
  const link = (p) =>
    html`<a href="/data/releases/${rid}/${p.split('/').map(encodeURIComponent).join('/')}" download="${fileName(p)}">${fileName(p)}</a>`;
  const ins = m.inputs || [],
    outs = m.outputs || [];
  const sources = ins.filter((i) => i.kind === 'source').length,
    intermediates = ins.filter((i) => i.kind === 'intermediate').length;
  const other = ins.length - sources - intermediates;
  const inputKind = (v) =>
    v === 'source' ? 'източников' : v === 'intermediate' ? 'междинен' : String(v || 'непосочен');
  const cols = (first) => [
    { key: 'path', label: first, fmt: (v) => link(v) },
    { key: 'mime', label: 'Формат' },
    { key: 'bytes', label: 'Размер', align: 'end', fmt: (v) => sizeLabel(v) },
    { key: 'sha256', label: 'SHA-256', fmt: (v) => sha(v) },
  ];
  return block(
    's35-files',
    'Входни и изходни файлове',
    html`
    <p>Изходните файлове се свалят от текущото издание. Сайтът пази байтовете им непроменени, а SHA-256 показва дали копието ти е същото. Входните файлове са описани с име и хеш; не се свалят от този сайт.</p>
    ${disclosure({
      id: 's35-inputs',
      title: `Входни файлове (${ins.length})`,
      body: html`
      <p>Източниковите и запазените междинни файлове са описани с начина на получаване в <a href="/data/releases/${rid}/manifest.json">манифеста</a>. Инструкциите за получаването на входовете са в ${ext(DATA_REPO, 'хранилището с данните')}.</p>
      <p>Манифестът посочва източникови (${num(sources)}) и междинни (${num(intermediates)}) файлове${other ? `, както и ${num(other)} с друг или непосочен тип` : ''}. Междинните файлове са запазени резултати от предходна обработка. Пресглобяването с тях не доказва възстановяване от първоначалните източници.</p>
      ${dataTable({ id: 's35-in', caption: 'Входните файлове на изданието', dense: true, columns: [{ key: 'path', label: 'Файл', fmt: (v) => html`<span title="${v}">${fileName(v)}</span>` }, { key: 'kind', label: 'Тип', fmt: inputKind }, ...cols('Файл').slice(1)], rows: ins.map((i) => ({ path: i.path, kind: i.kind, mime: i.mime, bytes: i.bytes, sha256: i.sha256 })) })}`,
    })}
    ${disclosure({
      id: 's35-outputs',
      title: `Файловете с данни (${outs.length})`,
      body: dataTable({
        id: 's35-out',
        caption: 'Файловете на изданието',
        dense: true,
        columns: cols('Файл'),
        rows: outs.map((o) => ({ path: o.path, mime: o.mime, bytes: o.bytes, sha256: o.sha256 })),
      }),
    })}`,
  );
}

function codeBlock(m) {
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
        v: c.commit
          ? html`${ext(`${c.repository || REPO}/commit/${c.commit}`, html`commit ${code(short(c.commit))}`)}`
          : null,
      },
      { k: 'Команда', v: p.command ? code(p.command) : null },
      {
        k: 'Образ за обработката',
        v: e.dockerfile ? html`${code(e.dockerfile)}, SHA-256 ${sha(e.dockerfile_sha256)}` : null,
      },
      { k: 'Зависимости', v: e.lock ? html`${code(e.lock)}, SHA-256 ${sha(e.lock_sha256)}` : null },
      ...Object.entries(reg).map(([f, s]) => ({
        k: 'Съпоставки и регистър',
        v: html`${code(f)}, SHA-256 ${sha(s)}`,
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

function checksBlock(v) {
  const groups = v?.groups || [];
  const origin = siteUrl('/').replace(/\/$/, '');
  return block(
    's35-checks',
    'Проверки и пресъздаване',
    html`
    ${
      groups.length
        ? dataTable({
            id: 's35-val',
            caption: `Проверките на данните в изданието (${v.passed === false ? 'с грешки' : 'минали'})`,
            captionVisible: true,
            dense: true,
            columns: [
              { key: 'label', label: 'Какво се проверява' },
              { key: 'checks', label: 'Проверки' },
              { key: 'status', label: 'Резултат' },
            ],
            rows: checkRows(groups),
          })
        : html`<p class="muted">Резултатите от проверките не са в изданието.</p>`
    }
    ${groups.length ? html`<p class="small muted">Техническото обобщение на всяка група (на английски) е във файла <code>validation.json</code> от списъка с файлове.</p>` : ''}
    <p>Изданието може да се пресъздаде от входните му файлове, включително запазените междинни данни, и всеки изходен файл да се сравни байт по байт. Нужни са кодът и локално копие на входните файлове:</p>
    <pre class="s35-cmd"><code>git clone ${REPO}.git && cd sigma-budget
./budget reproduce --current ${origin} --originals /път/до/входовете</code></pre>
    <p>Командата чете манифеста на текущото издание, проверява локалните входни файлове и сравнява пресъздадените изходи с публикуваните байтове. Изходът е <code lang="en">reproduced byte for byte</code> или списък с разликите. Подробности: ${ext(`${REPO}/blob/main/docs/release.md`, 'docs/release.md')}.</p>`,
  );
}

function provenanceBlock() {
  return block(
    's35-provenance',
    'Произход и методика',
    html`<ul class="s35-list">
    <li>Всяко число от месечните отчети води до листа и клетката на оригинала: <a href="${dataHref('execution-provenance')}">произходът на всяко число</a> (JSON) и „Откъде са числата“ в <a href="${href('izpalnenie')}">месечните отчети</a>.</li>
    <li>Наборите, източниците им и методиката: <a href="${href('danni')}">„Откъде са данните?“</a>.</li>
    <li>Файловете и как се четат с код: <a href="${href('api')}">„Отворени данни и API“</a>.</li>
    <li>Текущото издание: <a href="/api/releases/current">JSON указател</a>.</li>
  </ul>`,
  );
}

function historyBlock() {
  return block(
    's35-history',
    'История на изданията',
    html`<p>Изданията се публикуват с кода. Манифестите и историята са в ${ext(`${DATA_REPO}/tree/main/data/release/releases`, 'хранилището с данните')}.</p>`,
  );
}

export function render(ctx) {
  const rel = ctx.data['releases/current'];
  const rid = rel && HEX64.test(rel.release_id || '') ? rel.release_id : '';
  const m = ctx.data['release/manifest'];
  if (!rid || !m) ctx.notFound();
  const ins = (m.inputs || []).length,
    outs = (m.outputs || []).length;
  return {
    lede: `Откъде са данните на тази страница: изданието ${short(rid)} с ${num(ins)} входни файла и ${num(outs)} файла, всеки с SHA-256, кодът, който ги сглобява, проверките и как всеки може да го пресъздаде.`,
    answer: `Данните са от издание ${short(rid)}: ${num(ins)} входни файла и ${num(outs)} файла с данни, сглобени от commit ${short(m.processing?.code?.commit)} и проверими байт по байт.`,
    body: html`${releaseBlock(rid, m)}${coverageBlock(m)}${filesBlock(rid, m)}${codeBlock(m)}${checksBlock(ctx.data['release/validation'])}${provenanceBlock()}${historyBlock()}`,
  };
}
