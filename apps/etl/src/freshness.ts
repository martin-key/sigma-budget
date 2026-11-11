import { readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

function parseDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('Невалидна дата');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Невалидна дата');
  return date;
}
function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0));
}
function format(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
}
export function checkFreshness(
  asOf: unknown,
  today: string,
): { overdue: boolean; message: string } {
  const latest = parseDate(asOf);
  if (latest.getTime() !== endOfMonth(latest.getUTCFullYear(), latest.getUTCMonth()).getTime())
    throw new Error('latest.asOf трябва да е последният ден на месеца');
  const now = parseDate(today);
  const year = latest.getUTCFullYear(),
    month = latest.getUTCMonth();
  const next = endOfMonth(year, month + 1),
    deadline = endOfMonth(year, month + 2);
  let missing = 0;
  while (now > endOfMonth(year, month + 2 + missing)) missing++;
  const message = missing
    ? `Отчетът по КФП към ${format(next)} г. закъснява: срокът беше ${format(deadline)} г. Последните данни са към ${format(latest)} г.${missing > 1 ? ` Липсват ${missing} отчета.` : ''}`
    : `Последни данни по КФП към ${format(latest)} г.; следващ отчет към ${format(next)} г., срок ${format(deadline)} г.`;
  return { overdue: missing > 0, message };
}
export async function freshnessCli(args: string[]): Promise<number> {
  try {
    let release = 'data/release';
    let today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Sofia',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    for (let i = 0; i < args.length; i += 2) {
      const option = args[i],
        value = args[i + 1];
      if (!value || value.startsWith('--') || (option !== '--release' && option !== '--today'))
        throw new Error('Употреба: budget-ts freshness [--release <dir>] [--today YYYY-MM-DD]');
      if (option === '--release') release = value;
      else today = value;
    }
    const data: unknown = JSON.parse(await readFile(join(release, 'execution.json'), 'utf8'));
    const latest = (data as { latest?: { asOf?: unknown } } | null)?.latest?.asOf;
    let result: ReturnType<typeof checkFreshness>;
    try {
      result = checkFreshness(latest, today);
    } catch (error) {
      throw new Error(`Невалидни latest.asOf или --today: ${String(error)}`);
    }
    console.log(result.message);
    if (process.env.GITHUB_ACTIONS === 'true') {
      if (result.overdue) console.log(`::warning title=Свежест на КФП::${result.message}`);
      if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(process.env.GITHUB_STEP_SUMMARY, `${result.message}\n`);
    }
    return 0;
  } catch (error) {
    console.error(`Проверка за свежест: ${String(error)}`);
    return 2;
  }
}
