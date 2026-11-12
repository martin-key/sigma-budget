import { parseHTML } from 'linkedom';

// The owner retired the working-group identity. Historical captures stay unchanged.
export const publicOrganization = (html: string) =>
  html
    .replaceAll('Работна група „Бюджет на светло“', 'СИГМА Бюджет')
    .replaceAll(',"alternateName":"СИГМА Бюджет"', '');

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
      node.innerHTML = 'Историята на изданията е в <a href="/proverka">„Данни и проверка“</a>.';
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
