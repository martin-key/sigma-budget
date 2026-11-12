// Historical fixture bytes and hashes remain intact. Only reviewed editorial values are projected.
import { readFileSync } from 'node:fs';
const replacements: Record<string, string> = JSON.parse(readFileSync(new URL('../../test/fixtures/launch-texts/wording.json', import.meta.url), 'utf8'));
const cache = new Map<string, string>();
export function launchTexts<T>(value: T): T {
  if (typeof value === 'string') {
    const cached = cache.get(value);
    if (cached !== undefined) return cached as T;
    let text: string = value;
    for (const [oldText, newText] of Object.entries(replacements)) text = text.replaceAll(oldText, newText);
    text = text.replace(/Отчетът за (\S+) (\d{4}) г\. още не е добавен: страницата на МФ с месечните отчети се отваря само през браузър \(отказ 403 към автоматични заявки\), а последният наличен файл е за (\S+) (\d{4}) г\./g, 'Последният месечен отчет в портала е за $3 $4 г. Отчетът за $1 $2 г. не е включен.');
    cache.set(value, text);
    return text as T;
  }
  if (Array.isArray(value)) return value.map(launchTexts) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, launchTexts(item)])) as T;
  return value;
}
