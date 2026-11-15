// Static data files, metadata, download links and runnable reading examples.
import { html, raw } from '../html.js';
import { date, plural } from '../format.js';
import { href } from '../routes.js';
import { icon } from '../icons.js';
import { callout, facts } from '../ui/cards.js';
import { chips } from '../ui/chips.js';
import { disclosure } from '../ui/disclosure.js';
import { dataTable } from '../ui/table.js';
import { field, selectInput } from '../ui/forms.js';
import { emptyState } from '../ui/states.js';
import { statusPill } from '../ui/status.js';
import * as share from '../share.js';
import * as C from '../catalog.js';

export const needs = ['catalog', 'core?'];
export const styles = ['s25-api'];

/* ---------------------------------------------------------------- small helpers */
const modelOf = (ctx) => C.model(ctx.data.catalog, ctx.core?.sources);
const hasFile = (s) => !!s.file || s.parts.length > 0;
const isMulti = (s) => !s.file && s.parts.length > 0;
const wantedSet = (ctx) =>
  String(ctx.query?.set ?? '')
    .trim()
    .toLowerCase();
/** the set of the how-to block: the one asked for (slug or id), else the first one that has a file */
const pickSet = (M, key) => {
  const s = key ? M.find(key) : null;
  return s && hasFile(s) ? s : M.sets.find(hasFile) || null;
};
const at = (id, set) => href('api', {}, { ...(set ? { set } : {}), to: id });
const code = (text) => html`<code>${text}</code>`;
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

/** a section: the h2 carries the id (the target of ?to=), so a jump lands on a heading */
function block(id, title, build, o = {}) {
  let body;
  try {
    body = build();
  } catch (e) {
    console.error(`S25 ${id}`, e);
    body = html`<p class="muted">Този раздел не може да се покаже.</p>`;
  }
  return html`<section class="s25-block"${o.scan ? raw(' data-gl-scan') : ''} aria-labelledby="${id}">
    <h2 id="${id}" tabindex="-1">${title}</h2>
    ${body}</section>`;
}

/* ---------------------------------------------------------------- 1 · what there is and what there is not */
function stateBlock(M, withFiles, waiting) {
  return block(
    's25-state',
    'Как работят данните на сайта',
    () => html`
    ${callout({ kind: 'info', title: 'Отворени файлове с данни', body: html`<p>Всеки набор е готов файл с постоянен адрес: сваляш го цял и го филтрираш при себе си. Публичните файлове се четат без ключ за достъп и без регистрация.</p>` })}
    <p>Днес данните са ${plural(withFiles.length, 'набор', 'набора')} в ${plural(M.counts.files, 'файл', 'файла')}.</p>
    <ol class="s25-steps">
      <li>Избери файл от списъка „Файловете на сайта“ и го свали, или го поискай по адреса му.</li>
      <li>Отвори блока ${code('meta')} в началото на файла: той казва какво е наборът, откъде е, към коя дата е и в каква мерна единица са числата.</li>
      <li>Чети данните от останалите полета. Схемата на всеки файл е в „Как да прочетеш файл“.</li>
    </ol>`,
  );
}

/* ---------------------------------------------------------------- 2 · the files */
function fileRow(set) {
  const info = [
    isMulti(set) ? plural(set.parts.length, 'файл', 'файла') : '',
    C.sizeLabel(set.bytes),
  ]
    .filter(Boolean)
    .join(' · ');
  const who = html`<span class="sr-only"> – ${set.title}</span>`;
  const get = set.file
    ? html`<a class="btn btn-sm" href="${set.file}" download="${C.dlName(set)}">${icon('download', { size: 16 })}<span>Свали</span>${who}</a>`
    : html`<a class="btn btn-sm" href="${href('danni', { set: set.slug }, { to: 's24-d-get' })}">${icon('download', { size: 16 })}<span>Файловете по ведомства</span>${who}</a>`;
  return html`<li class="s25-file" data-st="${set.status}">
    <div class="s25-file-top"><a class="s25-file-t" href="${href('danni', { set: set.slug })}">${set.title}</a>${statusPill(set.status)}</div>
    <p class="s25-file-p">${code(set.file || set.template)}${info ? html` <span class="s25-file-s">${info}</span>` : ''}</p>
    <p class="s25-file-a">${get}<a class="btn btn-sm" href="${href('api', {}, { set: set.slug, to: 's25-read' })}">${icon('code', { size: 16 })}<span>Как се чете</span>${who}</a></p></li>`;
}

function filesBlock(M, waiting) {
  return block(
    's25-files',
    'Файловете на сайта',
    () => html`
    <p>Адресите са спрямо мястото, където е публикуван сайтът. „Свали“ дава самия файл, а „Как се чете“ показва полетата му и готов код.</p>
    <div class="s25-groups">${M.groups.map((g) => {
      const sets = g.sets.filter(hasFile);
      return sets.length
        ? html`<div class="s25-group"><h3 class="s25-gh"><span>${g.label}</span><span class="s25-n">${plural(sets.length, 'набор', 'набора')}</span></h3>
        <ul class="s25-files" role="list">${sets.map(fileRow)}</ul></div>`
        : '';
    })}</div>
`,
    { scan: true },
  );
}

/* ---------------------------------------------------------------- 3 · how to read one file */
const META_FIELDS = [
  ['id', 'Номер на набора в каталога, например D01.'],
  ['title', 'Име на набора.'],
  [
    'status',
    'Статус на публикувания набор: real (официални), partial (частични) или forecast (прогнозни).',
  ],
  ['source', 'Ключове на източниците. Какво е всеки от тях е описано в „Откъде са данните?“.'],
  ['sourceNote', 'С думи: как са взети и подредени числата.'],
  ['asOf', 'Към коя дата са данните.'],
  ['retrieved', 'Кога са изтеглени от издателя.'],
  ['unit', 'Мерна единица на числата във файла.'],
  ['pending', 'Описание на липсващите данни, ако е включено във файла.'],
  ['mock', 'В публикуваните набори стойността е false.'],
];
const TYPE = {
  array: 'списък',
  object: 'обект',
  string: 'текст',
  number: 'число',
  boolean: 'да или не',
};
const inside = (x) =>
  x.type === 'array' && x.length != null
    ? plural(x.length, 'елемент', 'елемента')
    : x.type === 'object' && x.length != null
      ? plural(x.length, 'поле', 'полета')
      : null;

/** the real `meta` block of the file as JSON; a long text is cut so the block stays readable */
function excerpt(meta) {
  let cut = false;
  const text = JSON.stringify(
    meta,
    (k, v) => {
      if (['pending', 'sourceNote'].includes(k)) return undefined;
      if (typeof v === 'string' && v.length > 150) {
        cut = true;
        return `${v.slice(0, 147).trimEnd()}…`;
      }
      return v;
    },
    2,
  );
  return { text, cut };
}

/** the code of the three examples; a set that is not JSON (the RSS feed) is read as text */
function codes(set) {
  const part = isMulti(set) ? set.parts[0] : null;
  const url = C.fileUrl(part ? part.file : set.file);
  const name = C.dlName(set, part);
  const json = set.ext === 'json';
  const curl = ['# Свали файла', `curl -sSf -o ${name} "${url}"`];
  if (json) curl.push('', '# Покажи блока meta (нужен е jq)', `jq .meta ${name}`);
  const py = json
    ? [
        'import json',
        'from urllib.request import urlopen',
        '',
        `with urlopen("${url}") as r:`,
        '    data = json.load(r)',
        '',
        'print(data["meta"]["title"])',
        'print("Данни към:", data["meta"]["asOf"])',
      ]
    : [
        'from urllib.request import urlopen',
        'import xml.etree.ElementTree as ET',
        '',
        `with urlopen("${url}") as r:`,
        '    root = ET.parse(r).getroot()',
        '',
        'for item in root.iter("item"):',
        '    print(item.findtext("title"))',
      ];
  const js = json
    ? [
        `const res = await fetch("${url}");`,
        'if (!res.ok) throw new Error("HTTP " + res.status);',
        'const data = await res.json();',
        '',
        'console.log(data.meta.title);',
        'console.log("Данни към:", data.meta.asOf);',
      ]
    : [
        `const res = await fetch("${url}");`,
        'if (!res.ok) throw new Error("HTTP " + res.status);',
        'const xml = new DOMParser().parseFromString(await res.text(), "application/xml");',
        '',
        'for (const item of xml.querySelectorAll("item")) console.log(item.querySelector("title").textContent);',
      ];
  return { url, name, part, json, curl: curl.join('\n'), py: py.join('\n'), js: js.join('\n') };
}

/** a block of code with its own copy button; the region is focusable so the keyboard can scroll a wide line */
const snippet = (id, label, text) => html`<div class="s25-snip" data-gl-skip>
  <div class="s25-snip-h"><span class="s25-snip-t" id="${id}-l">${label}</span>
    <button type="button" class="btn btn-sm" data-s25-copy-from="${id}">${icon('copy', { size: 16 })}<span>Копирай</span><span class="sr-only"> ${label}</span></button></div>
  <pre class="s25-pre" role="region" tabindex="0" aria-labelledby="${id}-l"><code id="${id}">${text}</code></pre></div>`;

/** what is real and what is made up in an example set (from the meta block of its file) */
function mockFacts(meta, M) {
  const real = list(meta?.realFields),
    model = list(meta?.modelFields),
    rules = list(meta?.constrainedBy);
  const rows = [
    real.length
      ? { k: 'Официални полета', v: html`${real.map((x, i) => html`${i ? ' ' : ''}${code(x)}`)}` }
      : null,
    model.length
      ? { k: 'Измислени полета', v: html`${model.map((x, i) => html`${i ? ' ' : ''}${code(x)}`)}` }
      : null,
    rules.length
      ? {
          k: 'Как е вързан с официалните данни',
          v: html`<ul class="s25-list">${rules.map((r) => html`<li>${C.rich(r, M)}</li>`)}</ul>`,
        }
      : null,
    meta?.seed != null ? { k: 'Начално число на генератора', v: code(String(meta.seed)) } : null,
  ].filter(Boolean);
  return rows.length
    ? html`<h3 class="s25-h3">Какво е измислено</h3>${facts(rows, { cls: 's25-facts' })}`
    : '';
}

async function readBlock(ctx, M, set) {
  const c = codes(set);
  const { meta, state } = await C.loadMeta(
    c.part ? { stem: C.stemOf(c.part.file), bytes: c.part.bytes } : set,
    { signal: ctx.signal },
  );
  const multi = isMulti(set);
  const size = C.sizeLabel(set.bytes),
    gz = C.sizeLabel(set.gz);
  const fmt = [set.format || set.ext.toUpperCase(), set.mediaType].filter(Boolean).join(', ');
  const rows = [
    multi ? { k: 'Адрес на файловете', v: code(set.template) } : null,
    { k: multi ? 'Пример за адрес' : 'Адрес', v: html`<code id="s25-addr">${c.url}</code>` },
    { k: 'Формат', v: fmt },
    {
      k: 'Размер',
      v: [
        multi ? `${plural(set.parts.length, 'файл', 'файла')}, общо ${size}` : size,
        gz ? `около ${gz} при компресиране` : '',
      ]
        .filter(Boolean)
        .join(', '),
    },
    { k: set.mock ? 'Създадени на' : 'Данни към', v: set.asOf ? date(set.asOf) : '' },
    { k: 'Период', v: C.periodLabel(set.period) },
    { k: 'Мерна единица', v: set.unit },
  ];
  const ex = meta ? excerpt(meta) : null;
  const options = M.sets.filter(hasFile).map((s) => ({ value: s.slug, label: s.title }));

  return block(
    's25-read',
    'Как да прочетеш файл',
    () => html`
    ${field({ id: 's25-set', label: 'Набор', hint: 'Избери файл, за да видиш адреса, полетата и кода му.', control: selectInput({ id: 's25-set', name: 'set', query: 'set', hint: true, value: set.slug, options }) })}
    <div class="s25-set" data-st="${set.status}">
      <div class="s25-set-top"><p class="s25-set-t">${set.title}</p>${statusPill(set.status)}</div>
      </div>
    ${set.mock ? callout({ kind: 'warn', title: 'Примерни данни: не ги цитирай', body: html`<p>Стойностите в този файл са измислени: той показва как ще изглежда екранът, а не какво е в действителност.</p>` }) : ''}
    <h3 class="s25-h3">Адрес и формат</h3>
    ${facts(rows, { cls: 's25-facts' })}
    <p class="s25-actions"><a class="btn btn-primary" href="${c.part ? c.part.file : set.file}" download="${c.name}">${icon('download', { size: 18 })}<span>${multi ? 'Свали примерния файл' : 'Свали'}</span></a>
      <button type="button" class="btn" data-s25-copy-from="s25-addr">${icon('copy', { size: 16 })}<span>Копирай адреса</span></button>
      <a class="btn" href="${href('danni', { set: set.slug })}">Описание на набора</a>${multi ? html`<a class="btn" href="${href('danni', { set: set.slug }, { to: 's24-d-get' })}">Всички файлове</a>` : ''}</p>
    ${mockFacts(meta, M)}
    <h3 class="s25-h3">Какво има във файла</h3>
    ${
      c.json
        ? html`<p>Файлът има блок ${code('meta')}, който описва набора, и данни в полета на най-горно ниво.</p>
      ${disclosure({
        id: 's25-d-meta',
        title: 'Полетата на блока meta',
        meta: 'във всеки файл',
        body: facts(
          META_FIELDS.map(([k, v]) => ({ k: code(k), v })),
          { cls: 's25-facts' },
        ),
      })}`
        : html`<p>Файлът е RSS 2.0: канал със събития, които четци на новини показват като списък.</p>`
    }
    ${
      set.schema.length
        ? dataTable({
            id: 's25-schema',
            caption: 'Полета на най-горно ниво във файла',
            dense: true,
            captionVisible: true,
            columns: [
              { key: 'key', label: 'Поле', fmt: (v) => code(v) },
              { key: 'type', label: 'Вид', fmt: (v) => TYPE[v] || v },
              { key: 'inside', label: 'Съдържа' },
            ],
            rows: set.schema.map((x) => ({ key: x.key, type: x.type, inside: inside(x) })),
          })
        : ''
    }
    ${
      ex
        ? html`<h3 class="s25-h3">Така започва файлът</h3>
      <p>Това е блокът с основните полета от ${code('meta')} на файла${ex.cut ? ': дългите текстове са съкратени' : ''}.</p>
      ${snippet('s25-c-meta', 'Блокът meta (JSON)', ex.text)}`
        : state === 'skip'
          ? html`<p class="small muted">Файлът е голям и затова блокът ${code('meta')} не е показан тук. Той е в началото на файла.</p>`
          : ''
    }
    <h3 class="s25-h3">Как се чете с код</h3>
    <div class="s25-snips">
      ${snippet('s25-c-curl', 'curl (терминал)', c.curl)}
      ${snippet('s25-c-py', 'Python 3', c.py)}
      ${snippet('s25-c-js', c.json ? 'JavaScript (браузър или Node.js 18+)' : 'JavaScript (браузър)', c.js)}
    </div>
    <p class="small muted">${c.json ? 'Всеки пример отпечатва името на набора и датата „Данни към“.' : 'Всеки пример отпечатва заглавията на събитията.'} Файловете са в UTF-8. Публичните /api/releases и /data адреси позволяват четене от други сайтове чрез GET и HEAD (CORS: *), без изпращане на cookies или други удостоверителни данни.</p>`,
    { scan: true },
  );
}

/* ---------------------------------------------------------------- 5 · licence, 6 · versions */
function licenceBlock() {
  return block(
    's25-licence',
    'Лиценз и условия за ползване',
    () => html`
    <p>Данните са публични: идват от официални документи и нямат отделен лиценз.</p>
    <p>При ползване:</p>
    <ul class="s25-list">
      <li>Числата са на първичните източници, а всеки източник има свои условия. Виж ги в <a href="${href('danni', {}, { to: 's24-sources' })}">„Откъде са данните?“</a>.</li>
      <li>Всеки официален набор има готово цитиране в паспорта си.</li>
    </ul>`,
    { scan: true },
  );
}

function versionsBlock(ctx, M) {
  const b = ctx.core?.build;
  const rows = [
    b?.dataVersion ? { k: 'Версия на данните', v: code(b.dataVersion) } : null,
    M.meta.asOf ? { k: 'Каталог към', v: date(M.meta.asOf) } : null,
    b?.kfpLatest ? { k: 'Последни данни за изпълнението', v: date(b.kfpLatest) } : null,
  ].filter(Boolean);
  const feed = M.bySlug.get('feed-rss');
  return block(
    's25-versions',
    'Версии и стабилност',
    () => html`
    ${rows.length ? facts(rows, { cls: 's25-facts' }) : ''}
    <p>При използване на данните посочвай версията и датата „Данни към“ от блока ${code('meta')}.</p>
    <p>Историята на изданията е в <a href="${href('proverka')}">„Проверка на данните“</a>.</p>
    <p>Кога излизат нови данни: виж <a href="${href('novo')}">„Какво ново?“</a>${feed && hasFile(feed) ? html` и RSS файла ${html`<a href="${href('api', {}, { set: feed.slug, to: 's25-read' })}">${code(feed.file)}</a>`}` : ''}.</p>`,
    { scan: true },
  );
}

/* ---------------------------------------------------------------- the page contract */
export async function render(ctx) {
  const M = modelOf(ctx);
  const withFiles = M.sets.filter(hasFile),
    waiting = M.sets.filter((s) => !hasFile(s));
  const want = wantedSet(ctx);
  const set = pickSet(M, want);
  const chosen = set && want ? set.slug : '';
  const toc = [
    ['s25-files', 'Файловете'],
    ['s25-read', 'Как да прочетеш файл'],
    ['s25-licence', 'Лиценз'],
    ['s25-versions', 'Версии'],
  ];
  const read = set
    ? await readBlock(ctx, M, set)
    : block('s25-read', 'Как да прочетеш файл', () =>
        emptyState({
          title: 'Още няма файлове за показване',
          text: 'Каталогът не съдържа набор с файл.',
        }),
      );
  return {
    lede: 'Всички публикувани данни са достъпни като файлове, които можеш да свалиш и да прочетеш с код. Тук са адресите, полетата и примерите за използване.',
    body: html`<nav class="s25-toc" aria-label="На тази страница">${chips({ items: toc.map(([id, label]) => ({ label, href: at(id, chosen) })) })}</nav>
      ${stateBlock(M, withFiles, waiting)}${filesBlock(M, waiting)}${read}${licenceBlock()}${versionsBlock(ctx, M)}`,
  };
}

const COPIED = {
  's25-addr': 'Адресът е копиран.',
  's25-c-curl': 'Командата е копирана.',
  's25-c-py': 'Кодът е копиран.',
  's25-c-js': 'Кодът е копиран.',
  's25-c-meta': 'Блокът meta е копиран.',
};

export function mount(root, ctx) {
  const onClick = (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-s25-copy-from]') : null;
    if (!b || !root.contains(b)) return;
    const text = document.getElementById(b.dataset.s25CopyFrom)?.textContent.trim();
    if (text)
      share.copyOrShow(text, COPIED[b.dataset.s25CopyFrom] || 'Копирано.', 'Копирай ръчно', b);
  };
  root.addEventListener('click', onClick);
  if (ctx.kind === 'rerender') {
    // the select was used: say what is shown now
    const t = root.querySelector('.s25-set-t')?.textContent;
    if (t) ctx.announce(`Показан е наборът: ${t}.`);
  }
  return () => root.removeEventListener('click', onClick);
}
