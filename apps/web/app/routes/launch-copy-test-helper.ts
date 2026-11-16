import { parseHTML } from 'linkedom';

// The owner retired the working-group identity. Historical captures stay unchanged.
export const publicOrganization = (html: string) =>
  html
    .replaceAll('Работна група „Бюджет на светло“', 'СИГМА Бюджет')
    .replaceAll(',"alternateName":"СИГМА Бюджет"', '');

// The owner renamed two screens (their addresses stay), reordered the «Бюджет» menu group and removed the footer legend entry (the legend
// stays on the pages). Historical captures keep the old chrome and names; adapt exactly these parts and fail if one is not found.
// (the old names are split, so that the scan of live files in navigation.test.tsx does not match them here)
export const SCREEN_RENAMES = [
  ['Данни и ' + 'методика', 'Методология'],
  ['Данни и ' + 'проверка', 'Проверка на данните'],
] as const;
export const BUDGET_GROUP = ['S34', 'S05', 'S07', 'S06', 'S10', 'S12', 'S13', 'S20', 'S14'];
export const currentScreenNames = (html: string) =>
  SCREEN_RENAMES.reduce((s, [from, to]) => s.replaceAll(from, to), html);
export function currentNavigation(html: string) {
  const legend =
    /\s*<button type="button" class="link-btn" data-action="legend">Легенда: какво означават белезите<\/button>/;
  const group = /(<summary[^>]*>Бюджет<\/summary><ul>)([\s\S]*?)(<\/ul>)/;
  if (!legend.test(html) || !group.test(html))
    throw new Error('the capture has no footer legend or «Бюджет» group');
  return currentScreenNames(html)
    .replace(legend, '')
    .replace(group, (_, open: string, items: string, close: string) => {
      const byRoute = new Map(
        [...items.matchAll(/<li>[\s\S]*?<\/li>/g)].map(([li]) => [
          /data-route="(S\d+)"/.exec(li)![1],
          li,
        ]),
      );
      if ([...byRoute.keys()].sort().join() !== [...BUDGET_GROUP].sort().join())
        throw new Error(`unexpected «Бюджет» group: ${[...byRoute.keys()].join()}`);
      return open + BUDGET_GROUP.map((id) => byRoute.get(id)).join('') + close;
    });
}

// The owner retired «За проекта» (S26, its address redirects to «Методология»): the footer has no entry for it, and the fine print carries
// the notes the page used to give, just before the СИГМА link. Historical captures keep the old footer; adapt exactly these parts and
// fail if one is not found.
export const FOOTER_NOTES = [
  'Речникът и поясненията са редакционни текстове, а не официални данни.',
  'Без бисквитки и проследяване.',
];
// the legal pages (S36, S37, client/legal.js) follow the notes, before the open code link
export const FOOTER_LEGAL = [
  ['S36', '/poveritelnost', 'Поверителност'],
  ['S37', '/usloviya', 'Условия за ползване'],
] as const;
export function currentFooter(html: string) {
  const entry = /<li><a href="\/za-proekta" data-route="S26"[^>]*>За проекта<\/a><\/li>/;
  const sigma = /(\s*)(<span><a class="sister-link")/;
  if (!entry.test(html) || !sigma.test(html))
    throw new Error('the capture has no «За проекта» footer entry or СИГМА link');
  return html
    .replace(entry, '')
    .replace(
      sigma,
      (_, space: string, link: string) =>
        FOOTER_NOTES.map((note) => `${space}<span>${note}</span>`).join('') +
        FOOTER_LEGAL.map(
          ([id, path, label]) =>
            `${space}<span><a href="${path}" data-route="${id}">${label}</a></span>`,
        ).join('') +
        `${space}<span><a class="code-link" href="https://github.com/midt-bg/sigma-budget" target="_blank" rel="noopener">Отворен код<span class="sr-only"> (друг сайт, в нов раздел)</span></a></span>` +
        space +
        link,
    );
}

// Only the shared missing-data presentation changes; preserve headings, links and controls.
export function finalPendingCopy(html: string) {
  const { document } = parseHTML(html.replaceAll('Предстои', 'Няма данни'));
  document.querySelectorAll('.state-pending').forEach((state) => {
    state.querySelector('.state-text')!.textContent =
      'Не показваме число без налични официални данни за този показател.';
    state.querySelectorAll('.state-text.small').forEach((note) => note.remove());
  });
  return document.toString();
}

// Adapt only the retired API proposal and launch copy; retain the rest of the frozen oracle.
export function finalApiCopy(html: string) {
  html = html
    .replace(
      /, а още \d+ набора предстоят\. Истински API има само като предложение за втората фаза: виж по-долу\./g,
      '.',
    )
    .replaceAll(
      'Статус на данните: real (официални), partial (частични), forecast (прогнозни), mock (примерни) или pending (предстоящи).',
      'Статус на публикувания набор: real (официални), partial (частични) или forecast (прогнозни).',
    )
    .replaceAll(
      'Какво още предстои да се добави, когато има такова.',
      'Описание на липсващите данни, ако е включено във файла.',
    )
    .replaceAll('true, ако стойностите са измислени.', 'В публикуваните набори стойността е false.')
    .replaceAll(
      'Сайтът е в бета версия: адресите и полетата във файловете още могат да се променят без предупреждение. Затова при ползване записвай версията и датата „Данни към“ от блока ',
      'При използване на данните посочвай версията и датата „Данни към“ от блока ',
    )
    .replaceAll('Това е действителният блок', 'Това е блокът с основните полета от');
  const { document } = parseHTML(html);
  document.getElementById('s25-proposal')?.closest('section')?.remove();
  document.querySelectorAll('a[href*="to=s25-proposal"]').forEach((link) => link.remove());
  document
    .querySelectorAll('#s25-files ~ *, section[aria-labelledby="s25-files"] p.small.muted')
    .forEach((node) => {
      if (node.tagName === 'P' && node.textContent?.startsWith('Още ')) node.remove();
    });
  document.querySelectorAll('li').forEach((node) => {
    if (node.textContent === 'Примерните набори са измислени и не се цитират като действителни.')
      node.remove();
  });
  document.querySelectorAll('p').forEach((node) => {
    if (node.textContent?.startsWith('В истинския портал предлагаме'))
      node.innerHTML = 'Историята на изданията е в <a href="/proverka">„Проверка на данните“</a>.';
  });
  document.querySelector('.s25-set-d')?.remove(); // Dataset descriptions contain internal release notes.
  const meta = document.getElementById('s25-c-meta');
  if (meta) {
    const data = JSON.parse(meta.textContent!);
    delete data.pending;
    delete data.sourceNote;
    meta.textContent = JSON.stringify(data, null, 2);
    if (!meta.textContent.includes('…')) {
      const note = meta.closest('.s25-snip')!.previousElementSibling!;
      note.textContent = note.textContent!.replace(': дългите текстове са съкратени.', '.');
    }
  }
  return finalPendingCopy(document.toString());
}
